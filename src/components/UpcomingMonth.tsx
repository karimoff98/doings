import { useState } from 'react';
import { addMonths, isBefore, isSameMonth, startOfMonth } from 'date-fns';
import {
  WEEKDAY_INITIALS,
  daysFromToday,
  formatDayLong,
  formatMonthTitle,
  formatWeekday,
  fromIsoDay,
  monthGrid,
  toIsoDay,
  today,
  tomorrow,
} from '../domain/dates';
import type { IsoDay, Section } from '../domain/types';
import { Icon } from './Icon';

interface UpcomingMonthProps {
  sections: Section[];
  value: IsoDay;
  onPick: (day: IsoDay) => void;
}

function taskWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'задач';
  if (last === 1) return 'задача';
  if (last >= 2 && last <= 4) return 'задачи';
  return 'задач';
}

/** Counts only todo rows; Upcoming never contains project rows, but the guard is cheap. */
export function upcomingTaskCounts(sections: Section[]): Map<IsoDay, number> {
  const counts = new Map<IsoDay, number>();
  for (const section of sections) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(section.id)) continue;
    const count = section.rows.filter((row) => row.kind === 'todo').length;
    if (count) counts.set(section.id, count);
  }
  return counts;
}

export function UpcomingMonth({ sections, value, onPick }: UpcomingMonthProps) {
  const [anchor, setAnchor] = useState(() => startOfMonth(fromIsoDay(value)));
  const counts = upcomingTaskCounts(sections);
  const currentMonth = startOfMonth(new Date());
  const todayIso = today();

  const moveMonth = (offset: number) => {
    const next = addMonths(anchor, offset);
    if (isBefore(next, currentMonth)) return;
    setAnchor(next);

    const firstWithTasks = [...counts.keys()]
      .filter((day) => daysFromToday(day) > 0 && isSameMonth(fromIsoDay(day), next))
      .sort()[0];
    if (firstWithTasks) {
      onPick(firstWithTasks);
      return;
    }

    const firstAvailable = isSameMonth(next, currentMonth) ? tomorrow() : toIsoDay(next);
    onPick(firstAvailable);
  };

  return (
    <section className="monthview" aria-label="Календарь предстоящих задач">
      <header className="monthview__head">
        <button
          type="button"
          className="monthview__nav"
          aria-label="Предыдущий месяц"
          disabled={!isBefore(currentMonth, anchor)}
          onClick={() => moveMonth(-1)}
        >
          <Icon name="chevron-left" size={15} />
        </button>
        <strong className="monthview__title">{formatMonthTitle(anchor)}</strong>
        <button
          type="button"
          className="monthview__nav"
          aria-label="Следующий месяц"
          onClick={() => moveMonth(1)}
        >
          <Icon name="chevron-right" size={15} />
        </button>
      </header>

      <div className="monthview__grid">
        {WEEKDAY_INITIALS.map((initial) => (
          <div key={initial} className="monthview__weekday">
            {initial}
          </div>
        ))}
        {monthGrid(anchor).map((date) => {
          const iso = toIsoDay(date);
          const count = counts.get(iso) ?? 0;
          const disabled = daysFromToday(iso) <= 0;
          const classes = [
            'monthview__day',
            !isSameMonth(date, anchor) && 'monthview__day--outside',
            iso === todayIso && 'monthview__day--today',
            iso === value && 'monthview__day--selected',
            count > 0 && 'monthview__day--busy',
          ]
            .filter(Boolean)
            .join(' ');
          const taskLabel = count ? `${count} ${taskWord(count)}` : 'нет задач';

          return (
            <button
              key={iso}
              type="button"
              className={classes}
              disabled={disabled}
              aria-label={`${formatDayLong(iso)}, ${formatWeekday(iso)}, ${taskLabel}`}
              aria-pressed={iso === value}
              onClick={() => {
                if (!isSameMonth(date, anchor)) setAnchor(startOfMonth(date));
                onPick(iso);
              }}
            >
              <span className="monthview__number">{date.getDate()}</span>
              {count > 0 && <span className="monthview__count">{count}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
