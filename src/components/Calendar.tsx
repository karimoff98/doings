import { useState } from 'react';
import { addMonths, isSameMonth } from 'date-fns';
import { WEEKDAY_INITIALS, formatMonthTitle, monthGrid, toIsoDay, today } from '../domain/dates';
import type { IsoDay } from '../domain/types';
import { Icon } from './Icon';

interface CalendarProps {
  value?: IsoDay;
  onPick: (day: IsoDay) => void;
}

export function Calendar({ value, onPick }: CalendarProps) {
  const [anchor, setAnchor] = useState(() => (value ? new Date(`${value}T00:00:00`) : new Date()));
  const days = monthGrid(anchor);
  const todayIso = today();

  return (
    <div className="cal">
      <div className="cal__head">
        <button
          type="button"
          className="cal__nav"
          aria-label="Предыдущий месяц"
          onClick={() => setAnchor(addMonths(anchor, -1))}
        >
          <Icon name="chevron-left" size={13} />
        </button>
        <span style={{ textTransform: 'capitalize' }}>{formatMonthTitle(anchor)}</span>
        <button
          type="button"
          className="cal__nav"
          aria-label="Следующий месяц"
          onClick={() => setAnchor(addMonths(anchor, 1))}
        >
          <Icon name="chevron-right" size={13} />
        </button>
      </div>
      <div className="cal__grid">
        {WEEKDAY_INITIALS.map((initial) => (
          <div key={initial} className="cal__weekday">
            {initial}
          </div>
        ))}
        {days.map((date) => {
          const iso = toIsoDay(date);
          const classes = [
            'cal__day',
            !isSameMonth(date, anchor) && 'cal__day--outside',
            iso === todayIso && 'cal__day--today',
            iso === value && 'cal__day--selected',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button key={iso} type="button" className={classes} onClick={() => onPick(iso)}>
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
