import { and, eq, inArray, or } from "drizzle-orm";
import { addWorkingDays, type WorkCalendarOptions } from "@sigo/shared";
import { db } from "../db/index.js";
import { purchaseOrders, purchaseRequisitionLines, purchaseRequisitions } from "../db/schema.js";

export type ScheduleMaterialAlert = {
  taskId: string;
  taskName: string;
  startDate: string;
  daysUntilStart: number;
  message: string;
  requisitionId: string | null;
  purchaseOrderId: string | null;
};

const CONFIRMED_REQUISITION = new Set(["adjudicada", "comprada", "fechada"]);
const CONFIRMED_PO = new Set(["confirmado"]);

function daysUntil(asOf: string, target: string, calendar?: WorkCalendarOptions): number {
  if (target <= asOf) return 0;
  let count = 0;
  let cursor = asOf;
  while (cursor < target) {
    cursor = addWorkingDays(cursor, 1, calendar);
    count += 1;
  }
  return count;
}

/** Alerta stub: actividade começa em breve e material ligado ainda não confirmado. */
export async function buildScheduleMaterialAlerts(args: {
  projectId: string;
  asOf: string;
  calendar?: WorkCalendarOptions;
  tasks: Array<{ id: string; name: string; startDate: string; status: string }>;
  horizonDays?: number;
}): Promise<ScheduleMaterialAlert[]> {
  const horizonDays = args.horizonDays ?? 14;
  const upcoming = args.tasks.filter((task) => {
    if (task.status === "concluido") return false;
    const until = daysUntil(args.asOf, task.startDate, args.calendar);
    return until >= 0 && until <= horizonDays;
  });
  if (!upcoming.length) return [];

  const taskIds = upcoming.map((task) => task.id);
  const [requisitions, orders] = await Promise.all([
    db.select({
      id: purchaseRequisitions.id,
      status: purchaseRequisitions.status,
      scheduleTaskId: purchaseRequisitions.scheduleTaskId,
      lineTaskId: purchaseRequisitionLines.sourceScheduleTaskId,
    })
      .from(purchaseRequisitions)
      .leftJoin(purchaseRequisitionLines, eq(purchaseRequisitionLines.requisitionId, purchaseRequisitions.id))
      .where(and(
        eq(purchaseRequisitions.projectId, args.projectId),
        or(
          inArray(purchaseRequisitions.scheduleTaskId, taskIds),
          inArray(purchaseRequisitionLines.sourceScheduleTaskId, taskIds),
        ),
      )),
    db.select({
      id: purchaseOrders.id,
      scheduleTaskId: purchaseOrders.scheduleTaskId,
      supplierConfirmationStatus: purchaseOrders.supplierConfirmationStatus,
    })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.projectId, args.projectId), inArray(purchaseOrders.scheduleTaskId, taskIds))),
  ]);

  const alerts: ScheduleMaterialAlert[] = [];
  for (const task of upcoming) {
    const linkedReqs = requisitions.filter((row) => row.scheduleTaskId === task.id || row.lineTaskId === task.id);
    const linkedOrders = orders.filter((row) => row.scheduleTaskId === task.id);
    if (!linkedReqs.length && !linkedOrders.length) continue;

    const unconfirmedReq = linkedReqs.find((row) => !CONFIRMED_REQUISITION.has(row.status));
    const unconfirmedPo = linkedOrders.find((row) => !CONFIRMED_PO.has(row.supplierConfirmationStatus));
    if (!unconfirmedReq && !unconfirmedPo) continue;

    const days = daysUntil(args.asOf, task.startDate, args.calendar);
    alerts.push({
      taskId: task.id,
      taskName: task.name,
      startDate: task.startDate,
      daysUntilStart: days,
      message: `Actividade começa em ${days} dia(s) úteis; material ainda não confirmado.`,
      requisitionId: unconfirmedReq?.id ?? null,
      purchaseOrderId: unconfirmedPo?.id ?? null,
    });
  }
  return alerts;
}
