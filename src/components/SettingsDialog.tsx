import { useCallback, useEffect, useState } from 'react';
import { quickEntryLabel, shortcutLabel } from '../domain/platform';
import { useStore } from '../store/store';
import type { CompletionLogging, Theme } from '../store/store';
import { exportDatabase, pickDatabase } from '../store/backup';
import {
  backupsAvailable,
  createBackupNow,
  deleteBackup,
  describeBackup,
  formatSize,
  guardBeforeDanger,
  isRestorable,
  listBackups,
  restoreBackup,
} from '../store/backups';
import type { BackupItem } from '../store/backups';
import { Icon } from './Icon';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Системная' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

const COMPLETION_LOGGING: { value: CompletionLogging; label: string }[] = [
  { value: 'immediately', label: 'Сразу' },
  { value: 'on-list-change', label: 'При переходе' },
  { value: 'manual', label: 'Вручную' },
];

/** Turns a raw process arch into something a person recognises. */
function archLabel(arch: string): string {
  if (arch === 'arm64') return 'Apple Silicon (arm64)';
  if (arch === 'x64') return 'Intel (x64)';
  return arch;
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setSettings = useStore((s) => s.setSettings);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const completionLogging = useStore((s) => s.completionLogging);
  const setCompletionLogging = useStore((s) => s.setCompletionLogging);
  const db = useStore((s) => s.db);
  const importDatabase = useStore((s) => s.importDatabase);
  const resetToEmpty = useStore((s) => s.resetToEmpty);
  const loadDemoData = useStore((s) => s.loadDemoData);
  const startTour = useStore((s) => s.startTour);

  const [status, setStatus] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [items, setItems] = useState<BackupItem[]>([]);
  const [busy, setBusy] = useState(false);

  /** One call for the whole list: payloads stay on disk until a restore. */
  const refreshBackups = useCallback(async () => {
    setItems(await listBackups());
  }, []);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    void window.desktop?.storage?.path().then(setPath);
    void window.desktop?.appInfo?.().then(setInfo);
    void refreshBackups();
  }, [open, refreshBackups]);

  if (!open) return null;

  const counts = [
    `${db.todos.filter((todo) => todo.status === 'open' && !todo.trashed).length} открытых задач`,
    `${db.projects.filter((project) => !project.trashed).length} проектов`,
    `${db.areas.length} областей`,
    `${db.tags.length} тегов`,
  ].join(' · ');

  return (
    <div className="dialog__scrim" onMouseDown={() => setSettings(false)}>
      <div
        className="dialog dialog--settings"
        role="dialog"
        aria-label="Настройки"
        data-testid="settings-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings">
          <h2 className="settings__title">Настройки</h2>

          <section className="settings__row">
            <div>
              <div className="settings__label">Оформление</div>
              <div className="settings__hint">Системная следует за настройкой macOS</div>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Тема">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  className={`segmented__item${theme === option.value ? ' segmented__item--on' : ''}`}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="settings__row">
            <div>
              <div className="settings__label">Выполненные задачи</div>
              <div className="settings__hint">Когда переносить отмеченные задачи в Журнал</div>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Перенос выполненных задач">
              {COMPLETION_LOGGING.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={completionLogging === option.value}
                  className={`segmented__item${
                    completionLogging === option.value ? ' segmented__item--on' : ''
                  }`}
                  onClick={() => setCompletionLogging(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="settings__row">
            <div>
              <div className="settings__label">Данные</div>
              <div className="settings__hint">{counts}</div>
            </div>
            <div className="settings__actions">
              <button
                type="button"
                className="settings__button"
                onClick={async () => {
                  const result = await exportDatabase(db);
                  setStatus(result.message);
                }}
              >
                <Icon name="moved" size={13} />
                Сохранить копию
              </button>
              <button
                type="button"
                className="settings__button"
                onClick={async () => {
                  const result = await pickDatabase();
                  if (!result.db) {
                    setStatus(result.message);
                    return;
                  }
                  if (
                    !window.confirm(
                      'Импорт заменит текущие данные. Перед этим будет создана резервная копия. ' +
                        `Отменить можно через ${shortcutLabel('Z')}. Продолжить?`,
                    )
                  ) {
                    setStatus('Импорт отменён');
                    return;
                  }
                  // Current data is copied first; a failed copy stops the import.
                  if (!(await guardBeforeDanger('import'))) {
                    setStatus('Импорт отменён: резервная копия не создана');
                    return;
                  }
                  importDatabase(result.db);
                  await refreshBackups();
                  setStatus(result.message);
                }}
              >
                <Icon name="undo" size={13} />
                Загрузить из файла
              </button>
              <button
                type="button"
                className="settings__button settings__button--danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      'Все задачи, проекты, области и теги будут удалены. Перед этим будет создана ' +
                        `резервная копия. Действие можно отменить через ${shortcutLabel('Z')} до закрытия приложения.`,
                    )
                  ) {
                    return;
                  }
                  if (!(await guardBeforeDanger('clear'))) {
                    setStatus('Очистка отменена: резервная копия не создана');
                    return;
                  }
                  resetToEmpty();
                  await refreshBackups();
                  setStatus('Все данные удалены');
                }}
              >
                <Icon name="trash" size={13} />
                Очистить все данные
              </button>
            </div>
          </section>

          <section className="settings__row">
            <div>
              <div className="settings__label">Примеры</div>
              <div className="settings__hint">
                Несколько областей, проектов и задач, чтобы осмотреться в приложении
              </div>
            </div>
            <div className="settings__actions">
              <button
                type="button"
                className="settings__button settings__button--quiet"
                onClick={async () => {
                  // Replacing real data needs a warning; an empty database does not.
                  const hasData =
                    db.todos.length > 0 ||
                    db.projects.length > 0 ||
                    db.areas.length > 0 ||
                    db.tags.length > 0;
                  if (
                    hasData &&
                    !window.confirm(
                      'Демонстрационные данные заменят всё, что есть. Перед этим будет создана резервная копия. Продолжить?',
                    )
                  ) {
                    return;
                  }
                  if (hasData && !(await guardBeforeDanger('demo'))) {
                    setStatus('Загрузка примеров отменена: резервная копия не создана');
                    return;
                  }
                  loadDemoData();
                  await refreshBackups();
                  setStatus('Демонстрационные данные загружены');
                }}
              >
                <Icon name="layers" size={13} />
                Загрузить демонстрационные данные
              </button>
            </div>
          </section>

          {backupsAvailable() && (
            <section className="settings__row settings__row--stack">
              <div className="settings__head">
                <div>
                  <div className="settings__label">Резервные копии</div>
                  <div className="settings__hint">
                    Создаются автоматически и перед импортом, очисткой и загрузкой примеров
                  </div>
                </div>
                <button
                  type="button"
                  className="settings__button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      // Writes what is pending first; a stale copy is not made.
                      const created = await createBackupNow();
                      await refreshBackups();
                      setStatus(created.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Icon name="moved" size={13} />
                  Создать резервную копию сейчас
                </button>
              </div>

              {items.length === 0 ? (
                <p className="settings__hint" data-testid="backups-empty">
                  Резервных копий пока нет.
                </p>
              ) : (
                <ul className="backups" data-testid="backups-list">
                  {items.map((item) => (
                    <li key={item.name} className="backups__row">
                      <span className="backups__main">
                        <span className="backups__title">{describeBackup(item)}</span>
                        <span className="backups__meta">
                          {item.corrupt
                            ? 'Файл повреждён — восстановление недоступно'
                            : !isRestorable(item)
                              ? `Схема ${item.schemaVersion} новее — нужна свежая версия приложения`
                              : `${item.counts?.todos ?? 0} задач · ${item.counts?.projects ?? 0} проектов · ${formatSize(item.size)}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="settings__button"
                        disabled={busy || !isRestorable(item)}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'Текущие данные будут заменены выбранной копией. Перед восстановлением будет создана ещё одна резервная копия.',
                            )
                          ) {
                            return;
                          }
                          setBusy(true);
                          try {
                            const result = await restoreBackup(item);
                            if (result.ok && result.db) importDatabase(result.db);
                            await refreshBackups();
                            setStatus(result.message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Восстановить
                      </button>
                      <button
                        type="button"
                        className="settings__button settings__button--danger"
                        aria-label={`Удалить копию: ${describeBackup(item)}`}
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm('Удалить эту резервную копию?')) return;
                          setBusy(true);
                          try {
                            const removed = await deleteBackup(item.name);
                            await refreshBackups();
                            setStatus(removed ? 'Копия удалена' : 'Не удалось удалить копию');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="settings__row">
            <div>
              <div className="settings__label">Быстрый ввод</div>
              <div className="settings__hint">
                Глобальный хоткей {quickEntryLabel()} открывает окно быстрого ввода даже из другого
                приложения
              </div>
            </div>
          </section>

          {info && (
            <section className="settings__row">
              <div>
                <div className="settings__label">Сборка</div>
                <div className="settings__hint">
                  Версия {info.version} · {archLabel(info.arch)}
                  {!info.packaged && ' · режим разработки'}
                </div>
                {path && <div className="settings__path">{path}</div>}
              </div>
              {window.desktop?.storage?.reveal && (
                <div className="settings__actions">
                  <button
                    type="button"
                    className="settings__button"
                    onClick={() => window.desktop?.storage?.reveal?.()}
                  >
                    <Icon name="project" size={13} />
                    Открыть папку с данными
                  </button>
                </div>
              )}
            </section>
          )}

          {status && <p className="settings__status">{status}</p>}

          <div className="settings__footer">
            <button
              type="button"
              className="settings__button"
              onClick={() => {
                setSettings(false);
                window.setTimeout(startTour, 0);
              }}
            >
              <Icon name="star" size={13} />
              Повторить знакомство
            </button>
            <button type="button" className="settings__button" onClick={() => setSettings(false)}>
              Готово
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
