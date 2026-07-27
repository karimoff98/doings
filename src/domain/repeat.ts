import { addDays, addMonths, addWeeks, addYears, getISODay } from 'date-fns';
import { daysBetween, fromIsoDay, shiftDay, toIsoDay, today } from './dates';
import type { IsoDay, RepeatRule, Todo, When } from './types';

/** Human label for the repeat chip, e.g. "каждые 2 недели". */
export function describeRepeat(rule: RepeatRule): string {
  const { every, unit, weekdays } = rule;
  const names: Record<RepeatRule['unit'], [string, string, string]> = {
    day: ['день', 'дня', 'дней'],
    week: ['неделю', 'недели', 'недель'],
    month: ['месяц', 'месяца', 'месяцев'],
    year: ['год', 'года', 'лет'],
  };
  const [one, few, many] = names[unit];
  const base =
    every === 1
      ? `${unit === 'week' ? 'каждую' : 'каждый'} ${one}`
      : `каждые ${every} ${every < 5 ? few : many}`;

  if (unit === 'week' && weekdays?.length) {
    const initials = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    const list = [...weekdays]
      .sort()
      .map((day) => initials[day - 1])
      .join(', ');
    return `${base}: ${list}`;
  }
  return base;
}

/**
 * The day after `from` on which the rule fires again.
 * Weekly rules with explicit weekdays walk day by day; the interval is then
 * applied per week cycle, which keeps the common cases (every week on Mon/Wed)
 * exact without a full RRULE implementation.
 */
export function nextOccurrence(rule: RepeatRule, from: IsoDay): IsoDay {
  const start = fromIsoDay(from);
  const every = Math.max(1, Math.round(rule.every));

  if (rule.unit === 'week' && rule.weekdays?.length) {
    const wanted = new Set(rule.weekdays);
    for (let offset = 1; offset <= 7 * every + 7; offset += 1) {
      const candidate = addDays(start, offset);
      if (wanted.has(getISODay(candidate))) return toIsoDay(candidate);
    }
    return toIsoDay(addWeeks(start, every));
  }

  switch (rule.unit) {
    case 'day':
      return toIsoDay(addDays(start, every));
    case 'week':
      return toIsoDay(addWeeks(start, every));
    case 'month':
      return toIsoDay(addMonths(start, every));
    case 'year':
      return toIsoDay(addYears(start, every));
  }
}

/**
 * Completing a repeating todo leaves the finished copy in the Logbook and puts
 * a fresh one on the next matching day, like Things does. Ids come from the
 * caller so this stays a pure function.
 */
export function nextRepeatCopy(todo: Todo, makeId: (prefix: string) => string): Todo | undefined {
  if (!todo.repeat) return undefined;
  const base = todo.when.kind === 'scheduled' && todo.when.date ? todo.when.date : today();
  const next = nextOccurrence(todo.repeat, base);
  const shift = daysBetween(base, next);
  // An evening todo keeps its evening slot when the next day is today.
  const when: When =
    next === today()
      ? { kind: todo.when.kind === 'evening' ? 'evening' : 'today' }
      : { kind: 'scheduled', date: next };

  return {
    id: makeId('td'),
    title: todo.title,
    notes: todo.notes,
    checklist: todo.checklist.map((item) => ({
      id: makeId('ci'),
      title: item.title,
      done: false,
    })),
    projectId: todo.projectId,
    areaId: todo.areaId,
    headingId: todo.headingId,
    when,
    deadline: todo.deadline ? shiftDay(todo.deadline, shift) : undefined,
    reminder: todo.reminder,
    repeat: { ...todo.repeat },
    seriesId: todo.seriesId ?? todo.id,
    tagIds: [...todo.tagIds],
    status: 'open',
    trashed: false,
    createdAt: new Date().toISOString(),
    index: todo.index,
  };
}

/** Ready-made rules offered in the repeat popover. */
export const REPEAT_PRESETS: { label: string; rule: RepeatRule }[] = [
  { label: 'Каждый день', rule: { unit: 'day', every: 1 } },
  { label: 'Каждую неделю', rule: { unit: 'week', every: 1 } },
  { label: 'По будням', rule: { unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] } },
  { label: 'Каждые 2 недели', rule: { unit: 'week', every: 2 } },
  { label: 'Каждый месяц', rule: { unit: 'month', every: 1 } },
  { label: 'Каждый год', rule: { unit: 'year', every: 1 } },
];
