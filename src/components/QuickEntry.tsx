import { useMemo, useState } from 'react';
import { formatDayShort, today } from '../domain/dates';
import { parseQuickEntry } from '../domain/quickEntry';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/**
 * The Quick Entry window: a single field that drops a to-do into the Inbox
 * without switching to the app. Rendered instead of the main UI when the
 * window is opened with the `#quick` hash.
 */
export function QuickEntry() {
  const [title, setTitle] = useState('');
  const bridge = window.desktop;
  const preview = useMemo(() => {
    const parsed = parseQuickEntry(title);
    const tokens: { icon: IconName; label: string }[] = [];
    const scheduled =
      parsed.when.kind === 'today'
        ? today()
        : parsed.when.kind === 'scheduled'
          ? parsed.when.date
          : undefined;
    if (scheduled) tokens.push({ icon: 'calendar', label: formatDayShort(scheduled) });
    if (parsed.deadline) {
      tokens.push({ icon: 'flag', label: `Срок: ${formatDayShort(parsed.deadline)}` });
    }
    if (parsed.reminder) tokens.push({ icon: 'clock', label: parsed.reminder });
    if (parsed.repeat) tokens.push({ icon: 'repeat', label: 'Повтор: еженедельно' });
    return { parsed, tokens };
  }, [title]);

  const submit = () => {
    const text = title.trim();
    if (!text) {
      bridge?.closeQuickEntry?.();
      return;
    }
    bridge?.submitQuickEntry?.(text);
    setTitle('');
  };

  return (
    <div className="quick">
      <div className="quick__row">
        <span className="quick__icon">
          <Icon name="inbox" size={18} color="var(--c-inbox)" />
        </span>
        <input
          className="quick__input"
          autoFocus
          placeholder="Новая задача во Входящие"
          aria-label="Новая задача"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              bridge?.closeQuickEntry?.();
            }
          }}
        />
      </div>
      <div className="quick__preview" aria-live="polite">
        {preview.tokens.length > 0 ? (
          <>
            <span className="quick__preview-title">{preview.parsed.title}</span>
            <span className="quick__tokens">
              {preview.tokens.map((token) => (
                <span className="quick__token" key={`${token.icon}:${token.label}`}>
                  <Icon name={token.icon} size={11} />
                  {token.label}
                </span>
              ))}
            </span>
          </>
        ) : (
          <span className="quick__preview-empty">Дата и время появятся здесь</span>
        )}
      </div>
      <div className="quick__hint">
        <span>⏎ сохранить</span>
        <span>сегодня · завтра · в пятницу · в 18:00</span>
        <span>Esc закрыть</span>
      </div>
    </div>
  );
}
