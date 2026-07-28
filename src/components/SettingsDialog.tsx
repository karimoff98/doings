import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import type { Theme } from '../store/store';
import { exportDatabase, pickDatabase } from '../store/backup';
import { Icon } from './Icon';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Системная' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
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
  const db = useStore((s) => s.db);
  const importDatabase = useStore((s) => s.importDatabase);
  const resetToSeed = useStore((s) => s.resetToSeed);

  const [status, setStatus] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    void window.desktop?.storage?.path().then(setPath);
    void window.desktop?.appInfo?.().then(setInfo);
  }, [open]);

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
                      'Импорт заменит текущие данные. Отменить можно через ⌘Z. Продолжить?',
                    )
                  ) {
                    setStatus('Импорт отменён');
                    return;
                  }
                  importDatabase(result.db);
                  setStatus(result.message);
                }}
              >
                <Icon name="undo" size={13} />
                Загрузить из файла
              </button>
              <button
                type="button"
                className="settings__button settings__button--danger"
                onClick={() => {
                  if (window.confirm('Заменить всё демонстрационными данными?')) {
                    resetToSeed();
                    setStatus('Данные сброшены');
                  }
                }}
              >
                <Icon name="trash" size={13} />
                Сбросить на демо
              </button>
            </div>
          </section>

          <section className="settings__row">
            <div>
              <div className="settings__label">Быстрый ввод</div>
              <div className="settings__hint">
                Глобальный хоткей ⌃⌥Space открывает окно быстрого ввода даже из другого приложения
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
            <button type="button" className="settings__button" onClick={() => setSettings(false)}>
              Готово
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
