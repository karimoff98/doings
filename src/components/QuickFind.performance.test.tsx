// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Todo } from '../domain/types';
import { useStore } from '../store/store';
import { QuickFind } from './QuickFind';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function todo(index: number): Todo {
  return {
    id: `search-${index}`,
    title: index === 1999 ? 'Уникальная игла' : `Обычная задача ${index}`,
    notes: index === 1999 ? 'находится в конце большой базы' : '',
    checklist: [],
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-07-29T10:00:00.000Z',
    index,
  };
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  useStore.setState({
    db: {
      todos: Array.from({ length: 2000 }, (_, index) => todo(index)),
      projects: [],
      areas: [],
      headings: [],
      tags: [],
    },
    selectedList: 'today',
    selectedTodoId: undefined,
    selectionAnchor: undefined,
    selection: [],
    quickFindOpen: true,
    onboardingOpen: false,
    tourOpen: false,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<QuickFind />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('поиск по большой базе', () => {
  it('оставляет поле отзывчивым и находит задачу в конце 2000 записей', async () => {
    const input = container.querySelector<HTMLInputElement>('.dialog__input');
    expect(input).not.toBeNull();

    await act(async () => {
      typeInto(input!, 'уникальная игла');
      await Promise.resolve();
    });

    expect(input!.value).toBe('уникальная игла');
    const results = container.querySelectorAll<HTMLButtonElement>('.dialog__list button');
    expect(results).toHaveLength(1);
    expect(results[0].textContent).toContain('Уникальная игла');

    act(() => results[0].click());
    expect(useStore.getState().selectedTodoId).toBe('search-1999');
    expect(useStore.getState().selectedList).toBe('inbox');
  });

  it('ограничивает выдачу сорока результатами', async () => {
    const input = container.querySelector<HTMLInputElement>('.dialog__input');

    await act(async () => {
      typeInto(input!, 'обычная задача');
      await Promise.resolve();
    });

    expect(container.querySelectorAll('.dialog__list button')).toHaveLength(40);
  });
});
