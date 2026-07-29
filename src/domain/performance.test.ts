import { describe, expect, it } from 'vitest';
import { projectStats, selectSections } from './lists';
import type { Database, Project, Todo } from './types';

/** A realistic stress fixture: many containers used to make every lookup scan an array. */
function largeDatabase(size: number): Database {
  const createdAt = '2026-01-01T00:00:00.000Z';
  const projects: Project[] = Array.from({ length: size }, (_, index) => ({
    id: `project-${index}`,
    title: `Проект ${index}`,
    notes: '',
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt,
    index,
  }));
  const todos: Todo[] = Array.from({ length: size }, (_, index) => ({
    id: `todo-${index}`,
    title: `Задача ${index}`,
    notes: '',
    checklist: [],
    projectId: `project-${index}`,
    when: { kind: index % 2 === 0 ? 'today' : 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt,
    index,
  }));
  return { areas: [], projects, headings: [], todos, tags: [] };
}

describe('производительность больших списков', () => {
  it('строит основные списки из 10 000 задач без квадратичного замедления', () => {
    const db = largeDatabase(10_000);
    const startedAt = performance.now();

    const today = selectSections(db, 'today');
    const anytime = selectSections(db, 'anytime');
    const someday = selectSections(db, 'someday');
    const stats = projectStats(db);

    expect(today.flatMap((section) => section.rows)).toHaveLength(5_000);
    expect(anytime.flatMap((section) => section.rows)).toHaveLength(10_000);
    expect(someday).toHaveLength(0);
    expect(stats.size).toBe(10_000);
    // Deliberately generous for shared CI machines; this catches accidental O(n²) scans.
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
