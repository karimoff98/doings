// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useStore } from '../store/store';

/**
 * The help sheet is the one place a Windows user goes to learn the keys, so it
 * must not show macOS glyphs there.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(platform: string): void {
  (window as unknown as { desktop: unknown }).desktop = { platform };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ShortcutsDialog />));
}

function rows(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of container.querySelectorAll('.shortcuts__row')) {
    const label = row.firstElementChild?.textContent?.trim();
    const keys = row.querySelector('.shortcuts__keys')?.textContent?.trim();
    if (label && keys) result[label] = keys;
  }
  return result;
}

beforeEach(() => {
  useStore.setState({ shortcutsOpen: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { desktop?: unknown }).desktop;
  useStore.setState({ shortcutsOpen: false });
});

describe('справка по горячим клавишам', () => {
  it('на macOS показывает символы клавиш', () => {
    render('darwin');
    const table = rows();
    expect(table['Новая задача']).toBe('⌘N');
    expect(table['Новый проект']).toBe('⇧⌘N');
    expect(table['Напоминание']).toBe('⌥⌘R');
    expect(table['В корзину']).toBe('⌘⌫');
    expect(table['Списки 1–7']).toBe('⌘1…⌘7');
    expect(table['Открыть задачу']).toBe('⏎ или Space');
  });

  it('на Windows показывает Ctrl вместо ⌘', () => {
    render('win32');
    const table = rows();
    expect(table['Новая задача']).toBe('Ctrl+N');
    expect(table['Новый проект']).toBe('Ctrl+Shift+N');
    expect(table['Напоминание']).toBe('Ctrl+Alt+R');
    expect(table['В корзину']).toBe('Ctrl+Backspace');
    expect(table['Списки 1–7']).toBe('Ctrl+1…Ctrl+7');
    expect(table['Открыть задачу']).toBe('Enter или Space');
    expect(table['Быстрый ввод (глобально)']).toBe('Ctrl+Alt+Space');
    expect(table['Выделить точечно']).toBe('Ctrl-клик');

    // Not a single macOS glyph anywhere in the sheet.
    expect(container.textContent ?? '').not.toMatch(/[⌘⇧⌥⌃⌫⏎]/);
  });
});
