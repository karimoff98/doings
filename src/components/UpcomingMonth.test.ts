import { describe, expect, it } from 'vitest';
import type { Section, Todo } from '../domain/types';
import { upcomingTaskCounts } from './UpcomingMonth';

function todo(id: string): Todo {
  return {
    id,
    title: id,
    notes: '',
    checklist: [],
    when: { kind: 'scheduled', date: '2026-08-10' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-07-29T00:00:00.000Z',
    index: 0,
  };
}

describe('месячный обзор', () => {
  it('считает задачи по ISO-дням', () => {
    const sections: Section[] = [
      {
        id: '2026-08-10',
        rows: [
          { kind: 'todo', todo: todo('первая') },
          { kind: 'todo', todo: todo('вторая') },
        ],
      },
      { id: '2026-08-11', rows: [{ kind: 'todo', todo: todo('третья') }] },
    ];

    expect([...upcomingTaskCounts(sections)]).toEqual([
      ['2026-08-10', 2],
      ['2026-08-11', 1],
    ]);
  });

  it('игнорирует служебные секции и пустые дни', () => {
    const sections: Section[] = [
      { id: 'not-a-day', rows: [{ kind: 'todo', todo: todo('служебная') }] },
      { id: '2026-08-12', rows: [] },
    ];

    expect(upcomingTaskCounts(sections).size).toBe(0);
  });
});
