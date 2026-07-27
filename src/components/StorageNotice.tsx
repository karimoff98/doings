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

  if (!error && !issues.length) return null;

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
      </div>
      <button type="button" className="notice__close" aria-label="Скрыть" onClick={dismiss}>
        <Icon name="cross" size={12} />
      </button>
    </div>
  );
}
