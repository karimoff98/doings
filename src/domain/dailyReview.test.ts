import { describe, expect, it } from 'vitest';
import { shiftDay, today } from './dates';
import { dailyReviewTodos } from './dailyReview';
import type { Database, Todo } from './types';

function todo(id: string, patch: Partial<Todo> = {}): Todo {
  return {
    id,
    title: id,
    notes: '',
    checklist: [],
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-07-29T00:00:00.000Z',
    index: 0,
    ...patch,
  };
}

function database(todos: Todo[]): Database {
  return { areas: [], projects: [], headings: [], tags: [], todos };
}

describe('планирование дня', () => {
  it('собирает задачи на сегодня, вечер и просроченные задачи', () => {
    const db = database([
      todo('сегодня', { when: { kind: 'today' } }),
      todo('вечером', { when: { kind: 'evening' } }),
      todo('просрочено', { when: { kind: 'scheduled', date: shiftDay(today(), -2) } }),
      todo('завтра', { when: { kind: 'scheduled', date: shiftDay(today(), 1) } }),
    ]);

    expect(dailyReviewTodos(db).map((item) => item.id)).toEqual([
      'сегодня',
      'просрочено',
      'вечером',
    ]);
  });

  it('не предлагает задачу, попавшую в Сегодня только из-за срока сдачи', () => {
    const db = database([todo('срок', { deadline: today() })]);
    expect(dailyReviewTodos(db)).toEqual([]);
  });

  it('не показывает выполненные и удалённые задачи', () => {
    const db = database([
      todo('готово', { when: { kind: 'today' }, status: 'completed' }),
      todo('удалено', { when: { kind: 'today' }, trashed: true }),
    ]);
    expect(dailyReviewTodos(db)).toEqual([]);
  });
});
