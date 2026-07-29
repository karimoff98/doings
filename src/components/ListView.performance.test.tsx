// @vitest-environment jsdom
import { act } from 'react';
import type { MouseEventHandler } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../domain/types';
import { useStore } from '../store/store';

const rowRenders = vi.hoisted(() => new Map<string, number>());

vi.mock('./TaskRow', () => ({
  TaskRow({
    todo: item,
    selected,
    onClick,
  }: {
    todo: Todo;
    selected: boolean;
    onClick: MouseEventHandler<HTMLButtonElement>;
  }) {
    rowRenders.set(item.id, (rowRenders.get(item.id) ?? 0) + 1);
    return (
      <button
        type="button"
        data-testid="task-row"
        data-todo-id={item.id}
        aria-selected={selected}
        onClick={onClick}
      >
        {item.title}
      </button>
    );
  },
}));

import { ListView } from './ListView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function todo(index: number): Todo {
  return {
    id: `load-${index}`,
    title: `Задача ${index}`,
    notes: '',
    checklist: [],
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-07-29T10:00:00.000Z',
    index,
  };
}

beforeEach(() => {
  rowRenders.clear();
  useStore.setState({
    db: {
      todos: Array.from({ length: 2000 }, (_, index) => todo(index)),
      projects: [],
      areas: [],
      headings: [],
      tags: [],
    },
    selectedList: 'anytime',
    selectedTodoId: undefined,
    selectionAnchor: undefined,
    selection: [],
    retainedCompletedIds: [],
    editingTodoId: undefined,
    draggingIds: [],
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
});

describe('длинный список', () => {
  it('при выборе задачи перерисовывает только изменившуюся строку', () => {
    rowRenders.clear();
    const target = container.querySelector<HTMLElement>('[data-todo-id="load-1500"]');
    expect(target).not.toBeNull();
    target!.focus();

    act(() => target!.click());

    expect([...rowRenders.keys()]).toEqual(['load-1500']);
    expect(rowRenders.get('load-1500')).toBe(1);
    expect(document.activeElement).toBe(target);
  });

  it('при изменении одной задачи не перерисовывает остальные строки', () => {
    rowRenders.clear();

    act(() => {
      useStore.getState().commitTodoText('load-500', { title: 'Изменённая задача' });
    });

    expect([...rowRenders.keys()]).toEqual(['load-500']);
    expect(rowRenders.get('load-500')).toBe(1);
  });

  it('восстанавливает прокрутку отдельно для каждого списка', () => {
    const content = container.querySelector<HTMLElement>('.app__content');
    expect(content).not.toBeNull();
    content!.scrollTop = 480;

    act(() => useStore.getState().selectList('today'));
    expect(content!.scrollTop).toBe(0);
    content!.scrollTop = 75;

    act(() => useStore.getState().selectList('anytime'));
    expect(content!.scrollTop).toBe(480);
  });
});
