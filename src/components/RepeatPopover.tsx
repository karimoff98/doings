import { useEffect, useState } from 'react';
import { REPEAT_PRESETS, describeRepeat } from '../domain/repeat';
import type { RepeatRule } from '../domain/types';
import { Icon } from './Icon';
import { Popover } from './Popover';

interface RepeatPopoverProps {
  open: boolean;
  onClose: () => void;
  repeat?: RepeatRule;
  onPick: (repeat?: RepeatRule) => void;
}

export function RepeatPopover({ open, onClose, repeat, onPick }: RepeatPopoverProps) {
  const select = (rule?: RepeatRule) => {
    onPick(rule);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} width={236}>
      <div className="popover__label">Повтор</div>
      {REPEAT_PRESETS.map((preset) => {
        const current =
          repeat &&
          repeat.unit === preset.rule.unit &&
          repeat.every === preset.rule.every &&
          JSON.stringify(repeat.weekdays ?? null) === JSON.stringify(preset.rule.weekdays ?? null);
        return (
          <button
            key={preset.label}
            type="button"
            className="popitem"
            onClick={() => select(preset.rule)}
          >
            <span className="popitem__icon">
              <Icon name="repeat" size={13} />
            </span>
            <span className="popitem__title">{preset.label}</span>
            {current && (
              <span className="popitem__icon" style={{ color: 'var(--accent)' }}>
                <Icon name="check" size={12} />
              </span>
            )}
          </button>
        );
      })}
      {repeat && (
        <>
          <div className="popover__divider" />
          <div className="popitem__sub" style={{ padding: '2px 8px 6px' }}>
            Сейчас: {describeRepeat(repeat)}
          </div>
          <button type="button" className="popitem" onClick={() => select(undefined)}>
            <span className="popitem__icon">
              <Icon name="cross" size={13} />
            </span>
            <span className="popitem__title">Не повторять</span>
          </button>
        </>
      )}
    </Popover>
  );
}

interface ReminderPopoverProps {
  open: boolean;
  onClose: () => void;
  reminder?: string;
  onPick: (reminder?: string) => void;
}

const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00', '21:00'];

export function ReminderPopover({ open, onClose, reminder, onPick }: ReminderPopoverProps) {
  const [custom, setCustom] = useState(reminder ?? '08:00');

  // Reopening the panel should show the todo's own time, not the last one typed.
  useEffect(() => {
    if (open) setCustom(reminder ?? '08:00');
  }, [open, reminder]);

  const select = (time?: string) => {
    onPick(time);
    onClose();
  };

  return (
    <Popover open={open} onClose={onClose} width={222}>
      <div className="popover__label">Напомнить в</div>
      {TIME_PRESETS.map((time) => (
        <button key={time} type="button" className="popitem" onClick={() => select(time)}>
          <span className="popitem__icon">
            <Icon name="clock" size={13} />
          </span>
          <span className="popitem__title">{time}</span>
          {reminder === time && (
            <span className="popitem__icon" style={{ color: 'var(--accent)' }}>
              <Icon name="check" size={12} />
            </span>
          )}
        </button>
      ))}
      <div className="popover__divider" />
      <div className="popitem" style={{ gap: 8 }}>
        <span className="popitem__icon">
          <Icon name="clock" size={13} />
        </span>
        <input
          type="time"
          className="popitem__title"
          aria-label="Своё время"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              select(custom);
            }
          }}
        />
        <button
          type="button"
          className="popitem__hint"
          style={{ color: 'var(--accent)' }}
          onClick={() => select(custom)}
        >
          ОК
        </button>
      </div>
      {reminder && (
        <>
          <div className="popover__divider" />
          <button type="button" className="popitem" onClick={() => select(undefined)}>
            <span className="popitem__icon">
              <Icon name="cross" size={13} />
            </span>
            <span className="popitem__title">Убрать напоминание</span>
          </button>
        </>
      )}
    </Popover>
  );
}
