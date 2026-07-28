import { allowWrites, writeBlock } from '../store/persistence';
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
  const touch = useStore((s) => s.setSettings);

  if (!error && !issues.length) return null;

  // Writing is refused and only the user can decide to go on — right now this
  // happens when the copy taken before a schema update could not be written.
  const block = writeBlock();
  const choice = block?.canContinue ? block : null;

  return (
    <div
      className={`notice${error ? ' notice--error' : ''}`}
      role={error ? 'alert' : 'status'}
      data-testid="storage-notice"
    >
      <span className="notice__icon">
        <Icon name={error ? 'flag' : 'notes'} size={14} />
      </span>
      <div className="notice__body">
        {error && <div className="notice__title">{error}</div>}
        {issues.map((issue) => (
          <div key={issue} className="notice__line">
            {issue}
          </div>
        ))}
        {choice && (
          <div className="notice__actions">
            <button
              type="button"
              className="notice__action"
              onClick={() => {
                allowWrites();
                dismiss();
                // A state change is what makes the migrated database reach the disk.
                touch(false);
              }}
            >
              Продолжить без резервной копии
            </button>
            <button
              type="button"
              className="notice__action notice__action--quiet"
              onClick={dismiss}
            >
              Не перезаписывать базу
            </button>
          </div>
        )}
      </div>
      <button type="button" className="notice__close" aria-label="Скрыть" onClick={dismiss}>
        <Icon name="cross" size={12} />
      </button>
    </div>
  );
}
