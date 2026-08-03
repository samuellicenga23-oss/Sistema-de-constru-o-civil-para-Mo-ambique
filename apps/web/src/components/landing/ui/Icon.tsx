import React from 'react';
import {
  BadgeCheckIcon,
  BookOpenIcon,
  Building2Icon,
  CalculatorIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  FileSpreadsheetIcon,
  GanttChartSquareIcon,
  HardHatIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  RulerIcon,
  TruckIcon,
  UserRoundIcon } from
'lucide-react';

const registry = {
  LayoutDashboard: LayoutDashboardIcon,
  Ruler: RulerIcon,
  FileSpreadsheet: FileSpreadsheetIcon,
  BookOpen: BookOpenIcon,
  Truck: TruckIcon,
  Calculator: CalculatorIcon,
  Building2: Building2Icon,
  UserRound: UserRoundIcon,
  GanttChartSquare: GanttChartSquareIcon,
  BadgeCheck: BadgeCheckIcon,
  ClipboardList: ClipboardListIcon,
  ClipboardCheck: ClipboardCheckIcon,
  HardHat: HardHatIcon,
  Landmark: LandmarkIcon
} as const;

export type IconName = keyof typeof registry;

export function Icon({ name, className = 'h-4 w-4' }: {name: string;className?: string;}) {
  const Cmp = registry[name as IconName] ?? LayoutDashboardIcon;
  return <Cmp className={className} aria-hidden="true" />;
}