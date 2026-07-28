import { useEffect, useRef, useState } from 'react';
import { isFirstRun, markOnboardingComplete } from '../store/persistence';
import { useStore } from '../store/store';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/** Modifier as written on this platform's keyboard. */
function isMacPlatform(): boolean {
  const platform = window.desktop?.platform ?? navigator.platform ?? '';
  return platform.toLowerCase().includes('mac') || platform === 'darwin';
}

export interface Shortcut {
  label: string;
  keys: string;
}

/** Exported for tests: the keys differ between macOS and Windows. */
export function shortcutsFor(mac: boolean): Shortcut[] {
  return [
    { label: 'Новая задача', keys: mac ? '⌘N' : 'Ctrl+N' },
    { label: 'Быстрый поиск', keys: mac ? '⌘F' : 'Ctrl+F' },
    { label: 'Быстрый ввод из любого приложения', keys: mac ? '⌃⌥Space' : 'Ctrl+Alt+Space' },
  ];
}

const PLACES: { icon: IconName; title: string; text: string; accent: string }[] = [
  {
    icon: 'inbox',
    title: 'Входящие',
    text: 'Место, куда можно быстро записать мысль, не выбирая проект.',
    accent: 'var(--c-inbox)',
  },
  {
    icon: 'star',
    title: 'Сегодня',
    text: 'Дела на текущий день — то, чем вы занимаетесь прямо сейчас.',
    accent: 'var(--c-today)',
  },
  {
    icon: 'calendar',
    title: 'Планы',
    text: 'Задачи с датами: видно, что и когда предстоит сделать.',
    accent: 'var(--c-upcoming)',
  },
  {
    icon: 'project',
    title: 'Проекты',
    text: 'Задачи, объединённые общей целью, внутри областей жизни и работы.',
    accent: 'var(--c-project)',
  },
];

const TOTAL_SCREENS = 3;

/**
 * Three short screens for someone who opened Doings for the first time. Shown
 * only on a genuinely empty profile: an update from an earlier version finds a
 * database and skips this entirely.
 */
export function Onboarding() {
  const [open, setOpen] = useState(() => isFirstRun());
  const [screen, setScreen] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const selectList = useStore((s) => s.selectList);
  const createTodo = useStore((s) => s.createTodo);
  const mac = isMacPlatform();

  // Focus starts inside the dialog and stays there: nothing behind it is usable
  // while the introduction is open.
  useEffect(() => {
    if (!open) return;
    const focusFirst = () => {
      const target = card.current?.querySelector<HTMLElement>('[data-autofocus]');
      target?.focus();
    };
    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      // Escape must not dismiss the very first introduction by accident:
      // leaving is an explicit choice via «Пропустить».
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(card.current?.querySelectorAll<HTMLElement>('button') ?? [])].filter(
        (node) => !node.hasAttribute('disabled'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !card.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, screen]);

  if (!open) return null;

  /** Remembers the introduction as seen and hands the app over to the user. */
  const finish = (withFirstTodo: boolean) => {
    markOnboardingComplete();
    setOpen(false);
    selectList('inbox');
    // A todo appears only when it was explicitly asked for.
    if (withFirstTodo) createTodo();
  };

  const heading =
    screen === 0
      ? 'Добро пожаловать в Doings'
      : screen === 1
        ? 'Разложите дела по местам'
        : 'Начните с первой задачи';

  return (
    <div className="onboard__scrim" data-testid="onboarding">
      <div
        ref={card}
        className="onboard"
        role="dialog"
        aria-modal="true"
        aria-label="Знакомство с Doings"
      >
        <div className="onboard__body" key={screen}>
          {screen === 0 && (
            <>
              <span className="onboard__mark" aria-hidden="true">
                <Icon name="check" size={30} />
              </span>
              <h2 className="onboard__title">{heading}</h2>
              <p className="onboard__text">
                Менеджер задач, в котором дела разложены по областям, проектам и дням. Ничего
                лишнего: список, задача, срок.
              </p>
              <p className="onboard__note">
                Задачи хранятся локально на вашем компьютере. Приложение не отправляет данные в сеть
                — копию базы можно сохранить и загрузить в настройках.
              </p>
            </>
          )}

          {screen === 1 && (
            <>
              <h2 className="onboard__title">{heading}</h2>
              <ul className="onboard__places">
                {PLACES.map((place) => (
                  <li key={place.title} className="onboard__place">
                    <span className="onboard__place-icon" style={{ color: place.accent }}>
                      <Icon name={place.icon} size={17} />
                    </span>
                    <span>
                      <span className="onboard__place-title">{place.title}</span>
                      <span className="onboard__place-text">{place.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {screen === 2 && (
            <>
              <h2 className="onboard__title">{heading}</h2>
              <ul className="onboard__keys">
                {shortcutsFor(mac).map((shortcut) => (
                  <li key={shortcut.label} className="onboard__key">
                    <span>{shortcut.label}</span>
                    <kbd className="onboard__kbd">{shortcut.keys}</kbd>
                  </li>
                ))}
              </ul>
              <p className="onboard__note">
                Полный список команд — в меню горячих клавиш ({mac ? '⌘/' : 'Ctrl+/'}), там же он
                открывается кнопкой с клавиатурой в нижней части боковой панели.
              </p>
            </>
          )}
        </div>

        <div className="onboard__footer">
          <span
            className="onboard__progress"
            aria-label={`Экран ${screen + 1} из ${TOTAL_SCREENS}`}
          >
            {screen + 1} / {TOTAL_SCREENS}
          </span>
          <span className="onboard__spacer" />

          {screen > 0 && (
            <button
              type="button"
              className="settings__button"
              onClick={() => setScreen((current) => current - 1)}
            >
              Назад
            </button>
          )}

          {screen < TOTAL_SCREENS - 1 ? (
            <>
              <button type="button" className="settings__button" onClick={() => finish(false)}>
                Пропустить
              </button>
              <button
                type="button"
                className="settings__button onboard__primary"
                data-autofocus
                onClick={() => setScreen((current) => current + 1)}
              >
                Продолжить
              </button>
            </>
          ) : (
            <>
              <button type="button" className="settings__button" onClick={() => finish(true)}>
                Создать первую задачу
              </button>
              <button
                type="button"
                className="settings__button onboard__primary"
                data-autofocus
                onClick={() => finish(false)}
              >
                Начать работу
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
