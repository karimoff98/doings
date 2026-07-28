import { useSaveStatus } from '../store/saveStatus';

const LABELS = {
  saving: 'Сохранение…',
  error: 'Ошибка сохранения',
} as const;

/**
 * Tiny status line in the sidebar footer: it answers the only question that
 * matters before quitting — is everything already on disk?
 */
export function SaveIndicator() {
  const status = useSaveStatus((s) => s.status);
  // Success is intentionally silent: showing «Сохранено» after every small
  // action makes the footer flicker. Only active work and failures need attention.
  if (status === 'idle' || status === 'saved') return null;

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
