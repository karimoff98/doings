// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseDatabase } from './store';
import { createDemoDatabase, createEmptyDatabase } from './seed';

/**
 * A new installation must open empty. Example projects belong to whoever asked
 * for them, not to every first-time user.
 */

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

beforeEach(fakeLocalStorage);

describe('пустая база', () => {
  it('проходит проверку как корректная база', () => {
    const empty = createEmptyDatabase();
    // Same gate the file on disk goes through.
    expect(parseDatabase(empty)).not.toBeNull();
  });

  it('содержит все обязательные массивы и ничего в них', () => {
    const empty = createEmptyDatabase();
    expect(empty).toEqual({ todos: [], projects: [], areas: [], headings: [], tags: [] });
    for (const key of ['todos', 'projects', 'areas', 'headings', 'tags'] as const) {
      expect(Array.isArray(empty[key])).toBe(true);
      expect(empty[key]).toHaveLength(0);
    }
  });

  it('каждый вызов возвращает независимую базу', () => {
    const first = createEmptyDatabase();
    first.todos.push({} as never);
    expect(createEmptyDatabase().todos).toHaveLength(0);
  });
});

describe('демонстрационные данные', () => {
  it('остаются доступными отдельной функцией', () => {
    const demo = createDemoDatabase();
    expect(parseDatabase(demo)).not.toBeNull();
    expect(demo.projects.length).toBeGreaterThan(0);
    expect(demo.todos.length).toBeGreaterThan(0);
  });

  it('не попадают в приложение сами: свежий стор пуст', async () => {
    // A fresh module graph is the closest thing to a first launch.
    const { useStore } = await import('./store');
    const db = useStore.getState().db;
    expect(db.todos).toHaveLength(0);
    expect(db.projects).toHaveLength(0);
    expect(db.areas).toHaveLength(0);
    expect(db.headings).toHaveLength(0);
    expect(db.tags).toHaveLength(0);
  });
});
