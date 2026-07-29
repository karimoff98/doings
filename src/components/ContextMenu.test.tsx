// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListView } from './ListView';
import { useStore } from '../store/store';
import type { Todo } from '../domain/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const id = 'context-date';

function todo(): Todo {
  return {
    id,
    title: 'Поменять дату',
    notes: '',
    checklist: [],
    when: { kind: 'someday' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-07-29T10:00:00.000Z',
    index: 0,
  };
}

function menuButton(label: string): HTMLButtonElement {
  const menu = container.querySelector('[data-testid="context-menu"]');
  const button = [...(menu?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Нет пункта «${label}»`);
  return button;
}

function openMenu(): void {
  const row = container.querySelector('[data-testid="task-row"]');
  if (!(row instanceof HTMLElement)) throw new Error('Нет строки задачи');
  act(() => {
    row.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
  });
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 100,
    width: 252,
    height: 320,
    top: 100,
    right: 352,
    bottom: 420,
    left: 100,
    toJSON: () => ({}),
  });
  useStore.setState({
    db: { todos: [todo()], projects: [], areas: [], headings: [], tags: [] },
    selectedList: 'someday',
    selectedTodoId: undefined,
    selectionAnchor: undefined,
    selection: [],
    retainedCompletedIds: [],
    editingTodoId: undefined,
    autoPanel: undefined,
    onboardingOpen: false,
    tourOpen: false,
    past: [],
    future: [],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ListView />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('дата из контекстного меню', () => {
  it('быстрый пункт меняет дату выбранной задачи', () => {
    openMenu();
    act(() => menuButton('Сегодня').click());

    expect(useStore.getState().db.todos[0].when).toEqual({ kind: 'today' });
  });

  it('правый клик переносит действие с прежнего выделения на новую строку', () => {
    const other = { ...todo(), id: 'previous', title: 'Была выбрана раньше' };
    act(() => {
      useStore.setState((state) => ({
        db: { ...state.db, todos: [other, todo()] },
        selection: [other.id],
        selectedTodoId: other.id,
      }));
    });

    const rows = container.querySelectorAll<HTMLElement>('[data-testid="task-row"]');
    act(() => {
      rows[1].dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    act(() => menuButton('Сегодня').click());

    expect(useStore.getState().db.todos.find((item) => item.id === id)?.when).toEqual({
      kind: 'today',
    });
    expect(useStore.getState().db.todos.find((item) => item.id === other.id)?.when).toEqual({
      kind: 'someday',
    });
  });

  it('открывает календарь и сохраняет выбранный день', () => {
    openMenu();
    act(() => menuButton('Когда выполнить').click());

    const day = container.querySelector<HTMLButtonElement>('.cal__day:not(.cal__day--outside)');
    expect(day).not.toBeNull();
    act(() => day!.click());

    expect(useStore.getState().db.todos[0].when.kind).not.toBe('someday');
  });
});
