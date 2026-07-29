// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding, shortcutsFor } from './Onboarding';
import { useDesktopMenu } from '../hooks/useDesktopMenu';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../store/store';

/**
 * The introduction is a small state machine over three screens; rendering it for
 * real is the only way to check that the buttons lead where they promise.
 *
 * Whether it appears at all is decided by `isFirstRun`, covered in
 * persistence.test.ts. Here that single check is forced, and everything else —
 * the completion marker included — stays real.
 */
const visible = vi.hoisted(() => ({ firstRun: true }));

vi.mock('../store/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  return { ...actual, isFirstRun: () => visible.firstRun };
});

let container: HTMLDivElement;
let root: Root;

/** Native menu commands are delivered through the preload bridge. */
let menuHandler: ((command: string, payload?: string) => void) | null = null;

function sendMenuCommand(command: string, payload?: string): void {
  if (!menuHandler) throw new Error('меню не подписано');
  menuHandler(command, payload);
}

/** ⌘N as the global keyboard layer sees it: the listener sits on the window. */
function pressNewTodo(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));
}

/**
 * The introduction alone proves nothing: the keyboard and menu layers live in
 * the app around it, so the harness mounts them together.
 */
function Harness() {
  useKeyboard();
  useDesktopMenu();
  return <Onboarding />;
}

function render(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
}

function unmount(): void {
  act(() => root.unmount());
  container.remove();
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Нет кнопки «${label}»: ${container.textContent}`);
  return found;
}

function click(label: string): void {
  act(() => button(label).click());
}

const heading = () => container.querySelector('.onboard__title')?.textContent ?? '';
const progress = () =>
  container.querySelector('.onboard__progress')?.textContent?.replace(/\s/g, '') ?? '';
const keys = () => [...container.querySelectorAll('.onboard__kbd')].map((n) => n.textContent);

/** jsdom in Node 25 ships an incomplete localStorage, so install a working one. */
function fakeLocalStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: () => null,
      length: 0,
    },
  });
}

function setPlatform(platform: string): void {
  (window as unknown as { desktop: unknown }).desktop = {
    platform,
    onCommand(callback: (command: string, payload?: string) => void) {
      menuHandler = callback;
      return () => {
        menuHandler = null;
      };
    },
  };
}

// Tells React that `act` is legitimate here.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  visible.firstRun = true;
  fakeLocalStorage();
  setPlatform('darwin');
  // A leftover open editor or selection would blur the signals below.
  useStore.setState({
    selectedList: 'today',
    editingTodoId: undefined,
    freshTodoId: undefined,
    selection: [],
    selectedTodoId: undefined,
    onboardingOpen: false,
    tourOpen: false,
    tourStep: 0,
  });
});

afterEach(() => {
  delete (window as unknown as { desktop?: unknown }).desktop;
});

describe('онбординг', () => {
  afterEach(() => {
    try {
      unmount();
    } catch {
      // Some tests unmount on their own.
    }
  });

  it('не показывается, когда запуск не первый', () => {
    visible.firstRun = false;
    render();
    expect(container.querySelector('[data-testid="onboarding"]')).toBeNull();
  });

  it('идёт вперёд и назад по трём экранам', () => {
    render();
    expect(heading()).toContain('Добро пожаловать');
    expect(progress()).toBe('1/3');

    click('Продолжить');
    expect(heading()).toContain('Разложите дела');
    expect(progress()).toBe('2/3');

    click('Продолжить');
    expect(heading()).toContain('первой задачи');
    expect(progress()).toBe('3/3');

    click('Назад');
    expect(progress()).toBe('2/3');
    click('Назад');
    expect(progress()).toBe('1/3');
    // «Назад» has nowhere to go from the first screen, so it is not offered.
    expect(() => button('Назад')).toThrow();
  });

  it('показывает комбинации macOS', () => {
    render();
    click('Продолжить');
    click('Продолжить');
    expect(keys()).toEqual(['⌘N', '⌘F', '⌃⌥Space']);
  });

  it('показывает комбинации Windows', () => {
    setPlatform('win32');
    render();
    click('Продолжить');
    click('Продолжить');
    expect(keys()).toEqual(['Ctrl+N', 'Ctrl+F', 'Ctrl+Alt+Space']);
  });

  it('комбинации собираются по платформе', () => {
    expect(shortcutsFor(true).map((s) => s.keys)).toEqual(['⌘N', '⌘F', '⌃⌥Space']);
    expect(shortcutsFor(false).map((s) => s.keys)).toEqual(['Ctrl+N', 'Ctrl+F', 'Ctrl+Alt+Space']);
  });

  it('Escape не закрывает знакомство', () => {
    render();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="onboarding"]')).not.toBeNull();
  });

  it('«Пропустить» закрывает, ставит отметку и открывает Входящие', () => {
    render();
    click('Пропустить');

    expect(container.querySelector('[data-testid="onboarding"]')).toBeNull();
    expect(localStorage.getItem('doings.onboarding.completed.v1')).toBe('1');
    expect(useStore.getState().selectedList).toBe('inbox');
  });

  it('«Начать работу» не создаёт задачу, отдельная кнопка создаёт', () => {
    const before = useStore.getState().db.todos.length;
    render();
    click('Продолжить');
    click('Продолжить');
    click('Начать работу');

    // Nothing is created behind the user's back.
    expect(useStore.getState().db.todos).toHaveLength(before);
    expect(localStorage.getItem('doings.onboarding.completed.v1')).toBe('1');
    unmount();

    render();
    click('Продолжить');
    click('Продолжить');
    click('Создать первую задачу');
    expect(useStore.getState().db.todos).toHaveLength(before + 1);
  });

  it('пока знакомство открыто, ⌘N не создаёт задачу', () => {
    render();
    const before = useStore.getState().db.todos.length;
    expect(useStore.getState().onboardingOpen).toBe(true);

    act(() => pressNewTodo());

    // Creating a todo opens it in the editor, so an untouched editor is the
    // reliable sign that nothing happened behind the introduction.
    expect(useStore.getState().editingTodoId).toBeUndefined();
    expect(useStore.getState().db.todos).toHaveLength(before);
  });

  it('пока знакомство открыто, команда меню new-todo не создаёт задачу', () => {
    render();
    const before = useStore.getState().db.todos.length;

    act(() => sendMenuCommand('new-todo'));

    expect(useStore.getState().editingTodoId).toBeUndefined();
    expect(useStore.getState().db.todos).toHaveLength(before);
  });

  it('после «Начать работу» те же команды снова работают', () => {
    render();
    click('Продолжить');
    click('Продолжить');
    click('Начать работу');
    expect(useStore.getState().onboardingOpen).toBe(false);
    expect(useStore.getState().tourOpen).toBe(true);
    act(() => useStore.getState().stopTour());
    const before = useStore.getState().db.todos.length;

    act(() => pressNewTodo());
    const created = useStore.getState().editingTodoId;
    expect(created).toBeDefined();
    expect(useStore.getState().db.todos).toHaveLength(before + 1);

    // Giving it a title keeps it: a still-blank todo is dropped when the next
    // one is created, which would mask the menu command.
    act(() => useStore.getState().commitTodoText(created!, { title: 'Есть текст' }));
    act(() => sendMenuCommand('new-todo'));

    expect(useStore.getState().db.todos).toHaveLength(before + 2);
    expect(useStore.getState().editingTodoId).not.toBe(created);
  });

  it('быстрый ввод переносит распознанные дату и время в задачу', () => {
    visible.firstRun = false;
    act(() => useStore.getState().resetToEmpty());
    render();

    act(() => sendMenuCommand('quick-add', 'Позвонить завтра в 18:30'));

    const todo = useStore.getState().db.todos[0];
    expect(todo).toMatchObject({
      title: 'Позвонить',
      when: { kind: 'scheduled' },
      reminder: '18:30',
    });
    expect(todo.when.date).toBeDefined();
    expect(todo.projectId).toBeUndefined();
    expect(todo.areaId).toBeUndefined();
    expect(useStore.getState().editingTodoId).toBeUndefined();
  });

  it('быстрый ввод сохраняет две одинаковые задачи и время у обеих', () => {
    visible.firstRun = false;
    act(() => useStore.getState().resetToEmpty());
    act(() => useStore.getState().selectList('today'));
    render();

    act(() => sendMenuCommand('quick-add', 'Позвонить завтра в 18:30'));
    act(() => sendMenuCommand('quick-add', 'Позвонить завтра в 18:30'));

    const todos = useStore.getState().db.todos;
    expect(todos).toHaveLength(2);
    expect(new Set(todos.map((todo) => todo.id)).size).toBe(2);
    expect(todos.map((todo) => todo.title)).toEqual(['Позвонить', 'Позвонить']);
    expect(todos.map((todo) => todo.reminder)).toEqual(['18:30', '18:30']);
    expect(useStore.getState().selectedList).toBe('inbox');
    expect(useStore.getState().selectedTodoId).toBe(todos[1].id);
  });

  it('после завершения знакомства демонстрационных данных нет', () => {
    // A brand-new profile: the store starts empty and must stay that way.
    act(() => useStore.getState().resetToEmpty());
    render();
    click('Продолжить');
    click('Продолжить');
    click('Начать работу');

    const db = useStore.getState().db;
    expect(db.todos).toHaveLength(0);
    expect(db.projects).toHaveLength(0);
    expect(db.areas).toHaveLength(0);
    expect(useStore.getState().selectedList).toBe('inbox');
  });

  it('«Создать первую задачу» создаёт ровно одну задачу с курсором в названии', () => {
    act(() => useStore.getState().resetToEmpty());
    render();
    click('Продолжить');
    click('Продолжить');
    click('Создать первую задачу');

    const { db, editingTodoId, freshTodoId, selectedList } = useStore.getState();
    expect(db.todos).toHaveLength(1);
    expect(selectedList).toBe('inbox');
    // Open in the editor and marked fresh, which is what focuses the title.
    expect(editingTodoId).toBe(db.todos[0].id);
    expect(freshTodoId).toBe(db.todos[0].id);
  });

  it('оставленная пустой первая задача удаляется при закрытии', () => {
    act(() => useStore.getState().resetToEmpty());
    render();
    click('Продолжить');
    click('Продолжить');
    click('Создать первую задачу');
    expect(useStore.getState().db.todos).toHaveLength(1);

    act(() => useStore.getState().closeEditor());
    // Nothing was typed, so the row does not stay behind.
    expect(useStore.getState().db.todos).toHaveLength(0);
  });

  it('это модальное окно с доступным именем и фокусом внутри', () => {
    render();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBeTruthy();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
