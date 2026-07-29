// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../domain/types';
import { commitPendingEdits } from '../store/pendingEdits';
import { useStore } from '../store/store';
import { TaskEditor } from './TaskEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const todoId = 'checklist-performance';
const itemId = 'checklist-item';

function todo(): Todo {
  return {
    id: todoId,
    title: 'Большая задача',
    notes: '',
    checklist: [{ id: itemId, title: 'Старый текст', done: false }],
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-07-29T10:00:00.000Z',
    index: 0,
  };
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({
    db: { todos: [todo()], projects: [], areas: [], headings: [], tags: [] },
    selectedList: 'anytime',
    selectedTodoId: todoId,
    selectionAnchor: todoId,
    selection: [todoId],
    editingTodoId: todoId,
    freshTodoId: undefined,
    autoPanel: undefined,
    moveDialogOpen: false,
    onboardingOpen: false,
    tourOpen: false,
    past: [],
    future: [],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<TaskEditor todo={useStore.getState().db.todos[0]} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('ввод пункта чек-листа', () => {
  it('не меняет базу на каждый символ и сохраняет после короткой паузы', () => {
    const input = container.querySelector<HTMLInputElement>('.checkitem__input');
    expect(input).not.toBeNull();

    act(() => typeInto(input!, 'Новый текст'));
    expect(useStore.getState().db.todos[0].checklist[0].title).toBe('Старый текст');

    act(() => vi.advanceTimersByTime(349));
    expect(useStore.getState().db.todos[0].checklist[0].title).toBe('Старый текст');

    act(() => vi.advanceTimersByTime(1));
    expect(useStore.getState().db.todos[0].checklist[0].title).toBe('Новый текст');
  });

  it('немедленно фиксирует недопечатанный пункт перед сохранением приложения', () => {
    const input = container.querySelector<HTMLInputElement>('.checkitem__input');
    act(() => typeInto(input!, 'Последние символы'));

    act(() => commitPendingEdits());

    expect(useStore.getState().db.todos[0].checklist[0].title).toBe('Последние символы');
  });
});
