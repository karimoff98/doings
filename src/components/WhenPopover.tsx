import { formatDayShort, thisWeekend, today, tomorrow } from '../domain/dates';
import type { IsoDay, When } from '../domain/types';
import { Calendar } from './Calendar';
import { Icon } from './Icon';
import { Popover } from './Popover';
import type { IconName } from './Icon';

interface WhenPopoverProps {
  open: boolean;
  onClose: () => void;
  when: When;
  onPick: (when: When) => void;
  up?: boolean;
}

interface Choice {
  key: string;
  icon: IconName;
  color: string;
  title: string;
  hint?: string;
  when: When;
}

/** The "When" panel: quick choices on top, calendar below, Someday at the bottom. */
export function WhenPopover({ open, onClose, when, onPick, up }: WhenPopoverProps) {
  const choices: Choice[] = [
    {
      key: 'today',
      icon: 'star',
      color: 'var(--c-today)',
      title: 'Сегодня',
      when: { kind: 'today' },
    },
    {
      key: 'evening',
      icon: 'moon',
      color: 'var(--c-someday)',
      title: 'Сегодня вечером',
      when: { kind: 'evening' },
    },
    {
      key: 'tomorrow',
      icon: 'calendar',
      color: 'var(--c-upcoming)',
      title: 'Завтра',
      hint: formatDayShort(tomorrow()),
      when: { kind: 'scheduled', date: tomorrow() },
    },
    {
      key: 'weekend',
      icon: 'calendar',
      color: 'var(--c-upcoming)',
      title: 'На выходных',
      hint: formatDayShort(thisWeekend()),
      when: { kind: 'scheduled', date: thisWeekend() },
    },
  ];

  const select = (next: When) => {
    onPick(next);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} up={up} width={252}>
      <div className="popover__label">Когда</div>
      {choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          className="popitem"
          onClick={() => select(choice.when)}
        >
          <span className="popitem__icon" style={{ color: choice.color }}>
            <Icon name={choice.icon} size={14} />
          </span>
          <span className="popitem__title">{choice.title}</span>
          {choice.hint && <span className="popitem__hint">{choice.hint}</span>}
        </button>
      ))}

      <div className="popover__divider" />
      <Calendar
        value={when.kind === 'scheduled' ? when.date : undefined}
        onPick={(day: IsoDay) =>
          select({ kind: day === today() ? 'today' : 'scheduled', date: day })
        }
      />

      <div className="popover__divider" />
      <button type="button" className="popitem" onClick={() => select({ kind: 'someday' })}>
        <span className="popitem__icon" style={{ color: 'var(--c-someday)' }}>
          <Icon name="box" size={14} />
        </span>
        <span className="popitem__title">Когда-нибудь</span>
      </button>
      {when.kind !== 'unscheduled' && (
        <button type="button" className="popitem" onClick={() => select({ kind: 'unscheduled' })}>
          <span className="popitem__icon">
            <Icon name="cross" size={13} />
          </span>
          <span className="popitem__title">Убрать дату</span>
        </button>
      )}
    </Popover>
  );
}

interface DeadlinePopoverProps {
  open: boolean;
  onClose: () => void;
  deadline?: IsoDay;
  onPick: (deadline?: IsoDay) => void;
  up?: boolean;
}

export function DeadlinePopover({ open, onClose, deadline, onPick, up }: DeadlinePopoverProps) {
  const select = (day?: IsoDay) => {
    onPick(day);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} up={up} width={252}>
      <div className="popover__label">Срок сдачи</div>
      <button type="button" className="popitem" onClick={() => select(today())}>
        <span className="popitem__icon" style={{ color: 'var(--c-deadline)' }}>
          <Icon name="flag" size={14} />
        </span>
        <span className="popitem__title">Сегодня</span>
      </button>
      <button type="button" className="popitem" onClick={() => select(tomorrow())}>
        <span className="popitem__icon" style={{ color: 'var(--c-deadline)' }}>
          <Icon name="flag" size={14} />
        </span>
        <span className="popitem__title">Завтра</span>
        <span className="popitem__hint">{formatDayShort(tomorrow())}</span>
      </button>
      <div className="popover__divider" />
      <Calendar value={deadline} onPick={(day) => select(day)} />
      {deadline && (
        <>
          <div className="popover__divider" />
          <button type="button" className="popitem" onClick={() => select(undefined)}>
            <span className="popitem__icon">
              <Icon name="cross" size={13} />
            </span>
            <span className="popitem__title">Убрать срок</span>
          </button>
        </>
      )}
    </Popover>
  );
}
