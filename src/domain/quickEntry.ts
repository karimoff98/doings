import { addDays } from 'date-fns';
import { toIsoDay } from './dates';
import type { IsoDay, When } from './types';

export interface ParsedQuickEntry {
  title: string;
  when: When;
  deadline?: IsoDay;
  reminder?: string;
}

interface DateMatch {
  day: IsoDay;
  text: string;
}

const SEPARATOR = String.raw`(?=$|[\s,.!?;:])`;
const PREFIX = String.raw`(^|[\s,;])`;

const WEEKDAYS = [
  { scheduled: 'понедельник', deadline: 'понедельника', day: 1 },
  { scheduled: 'вторник', deadline: 'вторника', day: 2 },
  { scheduled: 'среду', deadline: 'среды', day: 3 },
  { scheduled: 'четверг', deadline: 'четверга', day: 4 },
  { scheduled: 'пятницу', deadline: 'пятницы', day: 5 },
  { scheduled: 'субботу', deadline: 'субботы', day: 6 },
  { scheduled: 'воскресенье', deadline: 'воскресенья', day: 0 },
] as const;

function replaceFirst(text: string, pattern: RegExp): { text: string; found: boolean } {
  let found = false;
  const next = text.replace(pattern, (_match, prefix: string) => {
    found = true;
    return prefix;
  });
  return { text: next, found };
}

function dayAfter(now: Date, offset: number): IsoDay {
  return toIsoDay(addDays(now, offset));
}

function nextWeekday(now: Date, weekday: number): IsoDay {
  const offset = (weekday - now.getDay() + 7) % 7 || 7;
  return dayAfter(now, offset);
}

function parseDeadline(text: string, now: Date): DateMatch | undefined {
  const relative = [
    { word: 'сегодня', offset: 0 },
    { word: 'завтра', offset: 1 },
    { word: 'послезавтра', offset: 2 },
  ];

  for (const item of relative) {
    const result = replaceFirst(text, new RegExp(`${PREFIX}до\\s+${item.word}${SEPARATOR}`, 'iu'));
    if (result.found) return { day: dayAfter(now, item.offset), text: result.text };
  }

  for (const item of WEEKDAYS) {
    const result = replaceFirst(
      text,
      new RegExp(`${PREFIX}до\\s+${item.deadline}${SEPARATOR}`, 'iu'),
    );
    if (result.found) return { day: nextWeekday(now, item.day), text: result.text };
  }

  return undefined;
}

function parseScheduledDay(text: string, now: Date): DateMatch | undefined {
  const relative = [
    { word: 'сегодня', offset: 0 },
    { word: 'завтра', offset: 1 },
    { word: 'послезавтра', offset: 2 },
  ];

  for (const item of relative) {
    const result = replaceFirst(
      text,
      new RegExp(`${PREFIX}(?:на\\s+)?${item.word}${SEPARATOR}`, 'iu'),
    );
    if (result.found) return { day: dayAfter(now, item.offset), text: result.text };
  }

  for (const item of WEEKDAYS) {
    const result = replaceFirst(
      text,
      new RegExp(`${PREFIX}(?:в|во)\\s+${item.scheduled}${SEPARATOR}`, 'iu'),
    );
    if (result.found) return { day: nextWeekday(now, item.day), text: result.text };
  }

  return undefined;
}

function parseTime(text: string): { reminder?: string; text: string } {
  let reminder: string | undefined;
  const next = text.replace(
    new RegExp(`${PREFIX}в\\s+([01]?\\d|2[0-3])(?::([0-5]\\d))?${SEPARATOR}`, 'iu'),
    (_match, prefix: string, hours: string, minutes?: string) => {
      reminder = `${hours.padStart(2, '0')}:${minutes ?? '00'}`;
      return prefix;
    },
  );
  return { reminder, text: next };
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extracts the small, predictable subset of Russian natural dates supported by
 * Quick Entry. An explicit `now` keeps calendar-boundary behaviour testable.
 */
export function parseQuickEntry(input: string, now = new Date()): ParsedQuickEntry {
  const original = input.trim();
  let remaining = original;

  const deadline = parseDeadline(remaining, now);
  if (deadline) remaining = deadline.text;

  const scheduled = parseScheduledDay(remaining, now);
  if (scheduled) remaining = scheduled.text;

  const time = parseTime(remaining);
  remaining = time.text;

  // A reminder needs a day. With no explicit scheduled day, a deadline supplies
  // it; otherwise a bare "в 18:00" naturally means today.
  const scheduledDay =
    scheduled?.day ?? (time.reminder ? (deadline?.day ?? dayAfter(now, 0)) : undefined);
  const when: When = scheduledDay
    ? scheduledDay === dayAfter(now, 0)
      ? { kind: 'today' }
      : { kind: 'scheduled', date: scheduledDay }
    : { kind: 'unscheduled' };

  return {
    title: cleanTitle(remaining) || original,
    when,
    deadline: deadline?.day,
    reminder: time.reminder,
  };
}
