const DAY_MS = 86_400_000;

/** Segunda a sábado — domingo não conta como dia útil de obra. */
export function isWorkingDay(date: string | Date): boolean {
  const value = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  const day = value.getUTCDay();
  return day !== 0;
}

export function addWorkingDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  let remaining = Math.max(0, Math.round(days));
  if (remaining === 0) return date;
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + 1);
    if (isWorkingDay(value)) remaining -= 1;
  }
  return value.toISOString().slice(0, 10);
}

export function nextWorkingDay(date: string): string {
  return addWorkingDays(date, 1);
}

export function workingDaysInclusive(startDate: string, endDate: string): number {
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  while (cursor <= end) {
    if (isWorkingDay(cursor)) count += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

export function calendarDaysInclusive(startDate: string, endDate: string): number {
  return Math.max(
    1,
    Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / DAY_MS) + 1,
  );
}

export function workingDayOffset(projectStart: string, date: string): number {
  if (date < projectStart) return 0;
  return workingDaysInclusive(projectStart, date) - 1;
}
