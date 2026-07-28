import { useEffect, useState } from 'react';
import { useSaveStatus } from '../store/saveStatus';

/** How long the reassuring «Сохранено» stays on screen. */
const SAVED_VISIBLE_MS = 2200;

const LABELS = {
  saving: 'Сохранение…',
  saved: 'Сохранено',
  error: 'Ошибка сохранения',
} as const;

/**
 * Tiny status line in the sidebar footer: it answers the only question that
 * matters before quitting — is everything already on disk?
 */
export function SaveIndicator() {
  const status = useSaveStatus((s) => s.status);
  const savedAt = useSaveStatus((s) => s.savedAt);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (status !== 'saved') return;
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [status, savedAt]);

  if (status === 'idle') return null;
  if (status === 'saved' && !showSaved) return null;

  return (
    <span
      className={`save-status save-status--${status}`}
      data-testid="save-status"
      title={
        status === 'error'
          ? 'Изменения не записаны на диск. Подробности — в сообщении приложения и в настройках.'
          : undefined
      }
      role={status === 'error' ? 'alert' : 'status'}
    >
      <span className="save-status__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
