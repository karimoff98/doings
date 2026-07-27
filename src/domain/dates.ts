import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameYear,
  nextSaturday,
  parseISO,
  startOfDay,
} from 'date-fns';
import { ru as locale } from 'date-fns/locale';
import type { IsoDay } from './types';

export function toIsoDay(date: Date): IsoDay {
  return format(date, 'yyyy-MM-dd');
}

export function fromIsoDay(day: IsoDay): Date {
  return startOfDay(parseISO(day));
}

export function today(): IsoDay {
  return toIsoDay(new Date());
}

export function tomorrow(): IsoDay {
  return toIsoDay(addDays(new Date(), 1));
}

export function thisWeekend(): IsoDay {
  return toIsoDay(nextSaturday(new Date()));
}

export function nextWeek(): IsoDay {
  // Things jumps to the upcoming Monday.
  const now = new Date();
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  return toIsoDay(addDays(now, daysUntilMonday));
}

export function shiftDay(day: IsoDay, days: number): IsoDay {
  return toIsoDay(addDays(fromIsoDay(day), days));
}

/** Whole days between two calendar days, `to - from`. */
export function daysBetween(from: IsoDay, to: IsoDay): number {
  return differenceInCalendarDays(fromIsoDay(to), fromIsoDay(from));
}

/** Negative in the past, 0 today, positive in the future. */
export function daysFromToday(day: IsoDay): number {
  return differenceInCalendarDays(fromIsoDay(day), startOfDay(new Date()));
}

export function isPast(day: IsoDay): boolean {
  return daysFromToday(day) < 0;
}

export function isToday(day: IsoDay): boolean {
  return daysFromToday(day) === 0;
}

/** Short human label used on rows: "Сегодня", "Завтра", "пн, 12 авг". */
export function formatDayShort(day: IsoDay): string {
  const diff = daysFromToday(day);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  const date = fromIsoDay(day);
  if (diff > 1 && diff < 7) return format(date, 'EEEE', { locale });
  return isSameYear(date, new Date())
    ? format(date, 'd MMM', { locale })
    : format(date, 'd MMM yyyy', { locale });
}

/** Section header used in Upcoming and Logbook. */
export function formatDayLong(day: IsoDay): string {
  const diff = daysFromToday(day);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  const date = fromIsoDay(day);
  return isSameYear(date, new Date())
    ? format(date, 'd MMMM', { locale })
    : format(date, 'd MMMM yyyy', { locale });
}

export function formatWeekday(day: IsoDay): string {
  return format(fromIsoDay(day), 'EEEE', { locale });
}

export function formatMonthTitle(date: Date): string {
  return format(date, 'LLLL yyyy', { locale });
}

/** Weekday initials starting Monday, for the mini calendar. */
export const WEEKDAY_INITIALS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** 6x7 grid of days covering the month of `anchor`, Monday first. */
export function monthGrid(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const weekdayMondayFirst = (firstOfMonth.getDay() + 6) % 7;
  const start = addDays(firstOfMonth, -weekdayMondayFirst);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
