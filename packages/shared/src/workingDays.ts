const DAY_MS = 86_400_000;

export type WorkCalendarOptions = {
  /** false = sábado não conta como dia útil. Por omissão inclui sábado (obra MZ típica). */
  saturdayWorking?: boolean;
  /** Datas AAAA-MM-DD a excluir (feriados). */
  holidays?: ReadonlySet<string> | readonly string[];
};

function isoDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function holidaySet(calendar?: WorkCalendarOptions): Set<string> | null {
  if (!calendar?.holidays) return null;
  return calendar.holidays instanceof Set ? calendar.holidays : new Set(calendar.holidays);
}

/** Segunda a sábado por omissão — domingo nunca conta; feriados e sábado opcional. */
export function isWorkingDay(date: string | Date, calendar?: WorkCalendarOptions): boolean {
  const value = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const day = value.getUTCDay();
  if (day === 0) return false;
  if (day === 6 && calendar?.saturdayWorking === false) return false;
  const holidays = holidaySet(calendar);
  if (holidays?.has(isoDate(value))) return false;
  return true;
}

export function addWorkingDays(date: string, days: number, calendar?: WorkCalendarOptions): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  let remaining = Math.max(0, Math.round(days));
  if (remaining === 0) return date.slice(0, 10);
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + 1);
    if (isWorkingDay(value, calendar)) remaining -= 1;
  }
  return value.toISOString().slice(0, 10);
}

export function nextWorkingDay(date: string, calendar?: WorkCalendarOptions): string {
  return addWorkingDays(date, 1, calendar);
}

/** Como addWorkingDays, mas aceita dias negativos (anda para trás) — usado para adiantar datas. */
export function shiftWorkingDays(date: string, days: number, calendar?: WorkCalendarOptions): string {
  const rounded = Math.round(days);
  if (rounded === 0) return date.slice(0, 10);
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const step = rounded > 0 ? 1 : -1;
  let remaining = Math.abs(rounded);
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + step);
    if (isWorkingDay(value, calendar)) remaining -= 1;
  }
  return value.toISOString().slice(0, 10);
}

export function workingDaysInclusive(startDate: string, endDate: string, calendar?: WorkCalendarOptions): number {
  let cursor = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`);
  let count = 0;
  while (cursor <= end) {
    if (isWorkingDay(cursor, calendar)) count += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

export function calendarDaysInclusive(startDate: string, endDate: string): number {
  return Math.max(
    1,
    Math.round((new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${startDate.slice(0, 10)}T00:00:00Z`).getTime()) / DAY_MS) + 1,
  );
}

export function workingDayOffset(projectStart: string, date: string, calendar?: WorkCalendarOptions): number {
  if (date < projectStart) return 0;
  return workingDaysInclusive(projectStart, date, calendar) - 1;
}
