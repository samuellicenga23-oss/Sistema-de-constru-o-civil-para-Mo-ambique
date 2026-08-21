import { type WorkCalendarOptions } from "@sigo/shared";
import { addWorkingDays, shiftWorkingDays, workingDaysInclusive, type DependencyType } from "./schedulePlanning.js";

export type CpmActivity = {
  id: string;
  durationDays: number;
};

export type CpmDependency = {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
};

export type CpmResult = {
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatDays: number;
  isCritical: boolean;
  isMilestone: boolean;
};

function maxDate(values: string[]): string {
  return values.reduce((max, value) => (value > max ? value : max));
}

function minDate(values: string[]): string {
  return values.reduce((min, value) => (value < min ? value : min));
}

function finishFromStart(startDate: string, durationDays: number): string {
  if (durationDays <= 0) return startDate;
  return addWorkingDays(startDate, durationDays - 1);
}

function startFromFinish(endDate: string, durationDays: number): string {
  if (durationDays <= 0) return endDate;
  return shiftWorkingDays(endDate, -(durationDays - 1));
}

function constraintStart(predecessor: { earlyStart: string; earlyFinish: string }, type: DependencyType, lagDays: number, durationDays: number): string {
  if (type === "SS") return shiftWorkingDays(predecessor.earlyStart, lagDays);
  if (type === "FF") return startFromFinish(shiftWorkingDays(predecessor.earlyFinish, lagDays), durationDays);
  if (type === "SF") return startFromFinish(shiftWorkingDays(predecessor.earlyStart, lagDays), durationDays);
  return shiftWorkingDays(predecessor.earlyFinish, 1 + lagDays);
}

function constraintLateFinish(successor: { lateStart: string; lateFinish: string }, type: DependencyType, lagDays: number, durationDays: number): string {
  if (type === "SS") return finishFromStart(shiftWorkingDays(successor.lateStart, -lagDays), durationDays);
  if (type === "FF") return shiftWorkingDays(successor.lateFinish, -lagDays);
  if (type === "SF") return shiftWorkingDays(successor.lateStart, -lagDays);
  return shiftWorkingDays(successor.lateStart, -(1 + lagDays));
}

export function computeCpmNetwork(activities: CpmActivity[], dependencies: CpmDependency[], projectStart: string): Map<string, CpmResult> {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const incoming = new Map<string, CpmDependency[]>();
  const outgoing = new Map<string, CpmDependency[]>();
  for (const activity of activities) {
    incoming.set(activity.id, []);
    outgoing.set(activity.id, []);
  }
  for (const dep of dependencies) {
    if (!byId.has(dep.predecessorId) || !byId.has(dep.successorId)) continue;
    incoming.get(dep.successorId)!.push(dep);
    outgoing.get(dep.predecessorId)!.push(dep);
  }

  const early = new Map<string, { earlyStart: string; earlyFinish: string }>();
  const remaining = new Set(activities.map((activity) => activity.id));
  let guard = activities.length * 4;
  while (remaining.size && guard-- > 0) {
    let progressed = false;
    for (const id of [...remaining]) {
      const preds = incoming.get(id)!;
      if (preds.some((dep) => !early.has(dep.predecessorId))) continue;
      const duration = Math.max(0, byId.get(id)!.durationDays);
      const starts = preds.length
        ? preds.map((dep) => constraintStart(early.get(dep.predecessorId)!, dep.type, dep.lagDays, duration))
        : [projectStart];
      const earlyStart = maxDate(starts);
      early.set(id, { earlyStart, earlyFinish: finishFromStart(earlyStart, duration) });
      remaining.delete(id);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const id of remaining) {
    const duration = Math.max(0, byId.get(id)!.durationDays);
    early.set(id, { earlyStart: projectStart, earlyFinish: finishFromStart(projectStart, duration) });
  }

  const projectEnd = maxDate([...early.values()].map((row) => row.earlyFinish));
  const late = new Map<string, { lateStart: string; lateFinish: string }>();
  const pending = new Set(activities.map((activity) => activity.id));
  guard = activities.length * 4;
  while (pending.size && guard-- > 0) {
    let progressed = false;
    for (const id of [...pending]) {
      const succs = outgoing.get(id)!;
      if (succs.some((dep) => !late.has(dep.successorId))) continue;
      const duration = Math.max(0, byId.get(id)!.durationDays);
      const finishes = succs.length
        ? succs.map((dep) => constraintLateFinish(late.get(dep.successorId)!, dep.type, dep.lagDays, duration))
        : [projectEnd];
      const lateFinish = minDate(finishes);
      late.set(id, { lateFinish, lateStart: startFromFinish(lateFinish, duration) });
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const id of pending) {
    const duration = Math.max(0, byId.get(id)!.durationDays);
    late.set(id, { lateFinish: projectEnd, lateStart: startFromFinish(projectEnd, duration) });
  }

  const results = new Map<string, CpmResult>();
  for (const activity of activities) {
    const es = early.get(activity.id)!;
    const ls = late.get(activity.id)!;
    const totalFloatDays = workingDaysInclusive(es.earlyFinish, ls.lateFinish) - 1;
    results.set(activity.id, {
      ...es,
      ...ls,
      totalFloatDays: Math.max(0, totalFloatDays),
      isCritical: totalFloatDays <= 0,
      isMilestone: activity.durationDays <= 0,
    });
  }
  return results;
}

export function lookaheadWindow(asOf: string, weeks: 2 | 4 | 6, calendar?: WorkCalendarOptions) {
  const end = addWorkingDays(asOf, weeks * 6 - 1, calendar);
  return { start: asOf, end };
}

export function inLookahead(
  task: { startDate: string; endDate: string; status?: string },
  window: { start: string; end: string },
) {
  if (task.status === "concluido") return false;
  return task.startDate <= window.end && task.endDate >= window.start;
}

export type SCurvePoint = {
  weekIndex: number;
  startDate: string;
  endDate: string;
  plannedCumulative: number;
  actualCumulative: number;
};

function enumerateWorkingDays(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    if (cursor.getUTCDay() !== 0) days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

/**
 * Curva S em valor da WBS (plannedValue / executedValue), sem misturar moedas.
 * O peso de cada folha é distribuído uniformemente pelos dias úteis da actividade.
 */
export function buildValueSCurve(
  tasks: Array<{ startDate: string; endDate: string; plannedValue: number; executedValue: number; isSummary?: boolean }>,
  asOf: string,
  weeks: number,
): SCurvePoint[] {
  const leaves = tasks.filter((task) => !task.isSummary);
  const projectStart = leaves.reduce((min, task) => task.startDate < min ? task.startDate : min, leaves[0]?.startDate ?? asOf);
  const points: SCurvePoint[] = [];
  for (let week = 0; week < weeks; week++) {
    const startDate = addWorkingDays(projectStart, week * 6);
    const endDate = addWorkingDays(startDate, 5);
    let plannedCumulative = 0;
    let actualCumulative = 0;
    for (const task of leaves) {
      const days = enumerateWorkingDays(task.startDate, task.endDate);
      const perDay = days.length ? task.plannedValue / days.length : task.plannedValue;
      plannedCumulative += days.filter((day) => day <= endDate).length * perDay;
      if (task.endDate <= endDate || asOf >= task.endDate) actualCumulative += task.executedValue;
      else if (asOf >= task.startDate) {
        const doneDays = days.filter((day) => day <= asOf && day <= endDate).length;
        actualCumulative += days.length ? (task.executedValue || task.plannedValue * (doneDays / days.length)) : 0;
      }
    }
    points.push({ weekIndex: week, startDate, endDate, plannedCumulative, actualCumulative });
    if (endDate >= asOf && week >= 7) break;
  }
  return points;
}
