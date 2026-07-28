// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding, shortcutsFor } from './Onboarding';
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

function render(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Onboarding />));
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
  (window as unknown as { desktop: unknown }).desktop = { platform };
}

beforeEach(() => {
  visible.firstRun = true;
  fakeLocalStorage();
  setPlatform('darwin');
  useStore.setState({ selectedList: 'today' });
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

  it('это модальное окно с доступным именем и фокусом внутри', () => {
    render();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBeTruthy();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
