import { and, eq, gte, lte } from "drizzle-orm";
import type { WorkCalendarOptions } from "@sigo/shared";
import { db } from "../db/index.js";
import { companies, mzHolidays, projectScheduleCalendars, projects } from "../db/schema.js";

export type ProjectWorkCalendar = WorkCalendarOptions & {
  projectId: string;
  hoursPerDay: number;
  useNationalHolidays: boolean;
};

const DEFAULT_HOURS = 8;

export async function loadProjectWorkCalendar(projectId: string): Promise<ProjectWorkCalendar> {
  const [[project], [row]] = await Promise.all([
    db.select({ companyId: projects.companyId }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db.select().from(projectScheduleCalendars).where(eq(projectScheduleCalendars.projectId, projectId)).limit(1),
  ]);
  const company = project
    ? (await db.select({ workingHoursPerDay: companies.workingHoursPerDay }).from(companies).where(eq(companies.id, project.companyId)).limit(1))[0]
    : null;

  const saturdayWorking = row?.saturdayWorking ?? true;
  const useNationalHolidays = row?.useNationalHolidays ?? true;
  const hoursPerDay = row?.hoursPerDay != null ? Number(row.hoursPerDay) : Number(company?.workingHoursPerDay ?? DEFAULT_HOURS);

  let holidays: Set<string> | undefined;
  if (useNationalHolidays) {
    const year = new Date().getFullYear();
    const rows = await db
      .select({ date: mzHolidays.date })
      .from(mzHolidays)
      .where(and(gte(mzHolidays.year, year - 1), lte(mzHolidays.year, year + 2)));
    holidays = new Set(rows.map((entry) => String(entry.date)));
  }

  return {
    projectId,
    saturdayWorking,
    useNationalHolidays,
    hoursPerDay,
    holidays,
  };
}

export function toWorkCalendarOptions(calendar: ProjectWorkCalendar): WorkCalendarOptions {
  return {
    saturdayWorking: calendar.saturdayWorking,
    holidays: calendar.holidays,
  };
}
