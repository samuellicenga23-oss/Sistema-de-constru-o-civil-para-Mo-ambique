/** Data de calendário local (AAAA-MM-DD), sem UTC — evita off-by-one em MZ (UTC+2). */
export function localTodayIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Diferença em dias de calendário: due − today (negativo = atrasado). */
export function calendarDaysUntil(dueDate: string, today = localTodayIso()): number {
  const [dy, dm, dd] = dueDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const due = Date.UTC(dy, dm - 1, dd);
  const now = Date.UTC(ty, tm - 1, td);
  return Math.round((due - now) / 86_400_000);
}
