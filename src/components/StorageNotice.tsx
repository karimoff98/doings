import { useState } from 'react';
import { retryBlockedWrite, writeBlock } from '../store/persistence';
import { useStore } from '../store/store';
import { Icon } from './Icon';

/**
 * Storage problems must not be silent: a failed write means the user is about to
 * lose work, and repaired data is worth mentioning once.
 */
export function StorageNotice() {
  const error = useStore((s) => s.storageError);
  const issues = useStore((s) => s.storageIssues);
  const dismiss = useStore((s) => s.dismissStorageNotice);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Writing is refused and only the user can decide to go on — right now this
  // happens when the copy taken before a schema update could not be written.
  const block = writeBlock();
  const choice = block?.canContinue ? block : null;

  if (!error && !issues.length && !choice) return null;

  return (
    <div
      className={`notice${error || choice ? ' notice--error' : ''}`}
      role={error || choice ? 'alert' : 'status'}
      data-testid="storage-notice"
    >
      <span className="notice__icon">
        <Icon name={error || choice ? 'flag' : 'notes'} size={14} />
      </span>
      <div className="notice__body">
        {(error || choice) && <div className="notice__title">{error ?? choice?.reason}</div>}
        {issues.map((issue) => (
          <div key={issue} className="notice__line">
            {issue}
          </div>
        ))}
        {choice && (
          <>
            <div className="notice__line">
              Новые изменения не сохраняются, пока вы не решите, что делать. Прежний файл базы
              остался нетронутым — его можно скопировать вручную и после этого продолжить.
            </div>
            {retryError && <div className="notice__line">{retryError}</div>}
            <div className="notice__actions">
              <button
                type="button"
                className="notice__action"
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  setRetryError(null);
                  try {
                    // Writes the snapshot the block turned away.
                    const result = await retryBlockedWrite();
                    if (result.ok) dismiss();
                    else
                      setRetryError(
                        `Сохранить не удалось: ${result.error ?? 'причина неизвестна'}`,
                      );
                  } finally {
                    setRetrying(false);
                  }
                }}
              >
                Продолжить без резервной копии
              </button>
            </div>
          </>
        )}
      </div>
      {/* An active block has no close button: hiding it would hide data loss. */}
      {!choice && (
        <button type="button" className="notice__close" aria-label="Скрыть" onClick={dismiss}>
          <Icon name="cross" size={12} />
        </button>
      )}
    </div>
  );
}
