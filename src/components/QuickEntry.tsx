import { useState } from 'react';
import { Icon } from './Icon';

/**
 * The Quick Entry window: a single field that drops a to-do into the Inbox
 * without switching to the app. Rendered instead of the main UI when the
 * window is opened with the `#quick` hash.
 */
export function QuickEntry() {
  const [title, setTitle] = useState('');
  const bridge = window.desktop;

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
      <div className="quick__hint">
        <span>⏎ сохранить</span>
        <span>Esc закрыть</span>
      </div>
    </div>
  );
}
