/** Data de calendário Africa/Maputo (AAAA-MM-DD) — evita off-by-one em UTC+2. */
import { maputoTodayIso, calendarDaysBetween } from "@sigo/shared";

export function localTodayIso(date = new Date()): string {
  return maputoTodayIso(date);
}

/** Diferença em dias de calendário: due − today (negativo = atrasado). */
export function calendarDaysUntil(dueDate: string, today = localTodayIso()): number {
  return calendarDaysBetween(today, dueDate);
}
