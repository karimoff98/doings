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
  if (status === 'idle') return null;
  const saved = status === 'saved';

  return (
    <span
      className={`save-status save-status--${status}`}
      data-testid="save-status"
      title={
        status === 'error'
          ? 'Изменения не записаны на диск. Подробности — в сообщении приложения и в настройках.'
          : saved
            ? 'Все изменения сохранены'
            : undefined
      }
      aria-label={saved ? 'Все изменения сохранены' : undefined}
      role={status === 'error' ? 'alert' : 'status'}
    >
      <span className="save-status__dot" aria-hidden="true" />
      {!saved && LABELS[status]}
    </span>
  );
}
