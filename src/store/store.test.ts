// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { selectSections } from '../domain/lists';
import { shiftDay, today } from '../domain/dates';
import type { Todo } from '../domain/types';
import { parseDatabase, useStore } from './store';

const store = () => useStore.getState();

function reset() {
  // jsdom's storage shim is minimal, so only clear it when it is real.
  globalThis.localStorage?.clear?.();
  store().resetToSeed();
  useStore.setState({
    selectedList: 'today',
    selection: [],
    selectedTodoId: undefined,
    selectionAnchor: undefined,
    editingTodoId: undefined,
    tagFilter: [],
    past: [],
    future: [],
  });
}

function byTitle(title: string): Todo {
  const found = store().db.todos.find((todo) => todo.title === title);
  if (!found) throw new Error(`Нет задачи «${title}»`);
  return found;
}

beforeEach(reset);

describe('пакетные действия и отмена', () => {
  it('переносят всю выборку и откатываются одним шагом', () => {
    const ids = store()
      .db.todos.filter((todo) => todo.status === 'open')
      .slice(0, 3)
      .map((todo) => todo.id);

    store().setWhen(ids, { kind: 'someday' });
    expect(
      ids.every((id) => store().db.todos.find((t) => t.id === id)?.when.kind === 'someday'),
    ).toBe(true);
    expect(store().past).toHaveLength(1);

    store().undo();
    expect(
      ids.some((id) => store().db.todos.find((t) => t.id === id)?.when.kind === 'someday'),
    ).toBe(false);

    store().redo();
    expect(
      ids.every((id) => store().db.todos.find((t) => t.id === id)?.when.kind === 'someday'),
    ).toBe(true);
  });

  it('отмена уводит из списка, которого больше нет', () => {
    const projectId = store().createProject({ title: 'Скоро исчезнет' });
    store().selectList(`project:${projectId}`);
    store().undo();

    expect(store().db.projects.some((p) => p.id === projectId)).toBe(false);
    expect(store().selectedList).toBe('today');
  });
});

describe('повторяющиеся задачи', () => {
  it('выполнение создаёт копию, снятие отметки её убирает', () => {
    const source = byTitle('Позвонить в сервис');
    store().setWhen(source.id, { kind: 'scheduled', date: today() });
    store().setRepeat(source.id, { unit: 'day', every: 1 });

    store().completeTodo(source.id);
    const copies = store().db.todos.filter((todo) => todo.seriesId === source.id);
    expect(copies).toHaveLength(1);
    expect(copies[0].when).toEqual({ kind: 'scheduled', date: shiftDay(today(), 1) });
    expect(copies[0].status).toBe('open');

    store().uncompleteTodo(source.id);
    expect(store().db.todos.filter((todo) => todo.seriesId === source.id)).toHaveLength(0);
    expect(byTitle('Позвонить в сервис').status).toBe('open');
  });
});

describe('проекты', () => {
  it('завершение закрывает задачи проекта, возврат их открывает', () => {
    const project = store().db.projects.find((p) => p.title === 'Запуск приложения');
    if (!project) throw new Error('нет демо-проекта');
    const openBefore = store().db.todos.filter(
      (t) => t.projectId === project.id && t.status === 'open',
    ).length;
    expect(openBefore).toBeGreaterThan(0);

    store().completeProject(project.id);
    expect(
      store().db.todos.filter((t) => t.projectId === project.id && t.status === 'open'),
    ).toHaveLength(0);

    store().completeProject(project.id);
    expect(
      store().db.todos.filter((t) => t.projectId === project.id && t.status === 'open'),
    ).toHaveLength(openBefore);
  });

  it('задачи удалённого проекта возвращаются во Входящие', () => {
    const project = store().db.projects.find((p) => p.title === 'Запуск приложения')!;
    const todoId = store().db.todos.find((t) => t.projectId === project.id)!.id;

    store().trashProject(project.id);
    store().restoreTodo(todoId);

    const inbox = selectSections(store().db, 'inbox').flatMap((section) =>
      section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
    );
    expect(inbox).toContain(todoId);
  });
});

describe('создание и закрытие редактора', () => {
  it('в Журнале задача создаётся во Входящих', () => {
    store().selectList('logbook');
    const id = store().createTodo({ title: 'Из журнала' });

    expect(store().selectedList).toBe('inbox');
    expect(store().db.todos.find((t) => t.id === id)?.projectId).toBeUndefined();
  });

  it('пустая задача не остаётся, даже с пустым пунктом списка', () => {
    const id = store().createTodo();
    store().addChecklistItem(id);
    store().closeEditor();

    expect(store().db.todos.some((todo) => todo.id === id)).toBe(false);
  });

  it('задача с текстом сохраняется', () => {
    const id = store().createTodo({ title: 'Живая' });
    store().closeEditor();

    expect(store().db.todos.some((todo) => todo.id === id)).toBe(true);
  });
});

describe('дублирование', () => {
  it('копия встаёт рядом, получает свои пункты списка и своё выделение', () => {
    const source = byTitle('Собрать сборку для macOS');
    const [copyId] = store().duplicateTodo(source.id);
    const copy = store().db.todos.find((todo) => todo.id === copyId)!;

    expect(copy.title).toBe(source.title);
    expect(copy.index).toBeGreaterThan(source.index);
    expect(copy.checklist).toHaveLength(source.checklist.length);
    expect(copy.checklist.map((item) => item.id)).not.toEqual(
      source.checklist.map((item) => item.id),
    );
    expect(copy.status).toBe('open');
    expect(store().selection).toEqual([copyId]);
  });
});

describe('перетаскивание', () => {
  it('меняет порядок внутри группы, не задевая остальные задачи', () => {
    store().selectList('anytime');
    const sections = selectSections(store().db, 'anytime');
    const group = sections[0].rows.flatMap((row) => (row.kind === 'todo' ? [row.todo] : []));
    const ids = group.map((todo) => todo.id);
    const slots = group.map((todo) => todo.index).sort((a, b) => a - b);

    const reordered = [ids[ids.length - 1], ...ids.slice(0, -1)];
    store().dropTodos([ids[ids.length - 1]], { order: reordered });

    const after = reordered.map((id) => store().db.todos.find((t) => t.id === id)!.index);
    // Группа занимает те же места, только в новом порядке.
    expect([...after].sort((a, b) => a - b)).toEqual(slots);
    expect(after[0]).toBeLessThan(after[1]);
  });

  it('перенос в другую секцию меняет и контейнер, и дату', () => {
    const todo = byTitle('Позвонить в сервис');
    store().dropTodos([todo.id], {
      container: { projectId: store().db.projects[0].id },
      when: { kind: 'today' },
    });

    const moved = byTitle('Позвонить в сервис');
    expect(moved.projectId).toBe(store().db.projects[0].id);
    expect(moved.when.kind).toBe('today');
  });
});

describe('фильтр по тегам', () => {
  it('сбрасывается при переходе в другой список', () => {
    const tagId = store().db.tags[0].id;
    store().toggleTagFilter(tagId);
    expect(store().tagFilter).toEqual([tagId]);

    store().selectList('anytime');
    expect(store().tagFilter).toEqual([]);
  });
});

describe('порядок проектов и областей', () => {
  it('перестановка проектов занимает те же места', () => {
    const ids = store()
      .db.projects.map((project) => project.id)
      .reverse();
    const slots = store()
      .db.projects.map((project) => project.index)
      .sort((a, b) => a - b);

    store().reorderProjects(ids);

    const after = ids.map((id) => store().db.projects.find((p) => p.id === id)!.index);
    expect([...after].sort((a, b) => a - b)).toEqual(slots);
    expect(after[0]).toBeLessThan(after[1]);
  });

  it('проект переезжает в другую область и обратно наружу', () => {
    const project = store().db.projects[0];
    const otherArea = store().db.areas[1];

    store().moveProject(project.id, otherArea.id);
    expect(store().db.projects.find((p) => p.id === project.id)?.areaId).toBe(otherArea.id);

    store().moveProject(project.id, undefined);
    expect(store().db.projects.find((p) => p.id === project.id)?.areaId).toBeUndefined();
  });

  it('перестановка областей меняет их порядок', () => {
    const reversed = store()
      .db.areas.map((area) => area.id)
      .reverse();
    store().reorderAreas(reversed);

    const sorted = [...store().db.areas].sort((a, b) => a.index - b.index).map((area) => area.id);
    expect(sorted).toEqual(reversed);
  });
});

describe('импорт базы', () => {
  it('принимает и полный снимок, и голую базу', () => {
    const snapshot = { state: { db: store().db } };
    expect(parseDatabase(snapshot)?.todos.length).toBe(store().db.todos.length);
    expect(parseDatabase(store().db)?.todos.length).toBe(store().db.todos.length);
  });

  it('отбрасывает мусор', () => {
    expect(parseDatabase(null)).toBeNull();
    expect(parseDatabase({ todos: 'нет' })).toBeNull();
    expect(parseDatabase({ areas: [], projects: [], headings: [], tags: [] })).toBeNull();
    expect(
      parseDatabase({ areas: [], projects: [], headings: [], tags: [], todos: [{ id: 1 }] }),
    ).toBeNull();
  });

  it('заменяет данные и уводит из исчезнувшего списка', () => {
    const projectId = store().db.projects[0].id;
    store().selectList(`project:${projectId}`);

    store().importDatabase({ areas: [], projects: [], headings: [], todos: [], tags: [] });

    expect(store().db.todos).toHaveLength(0);
    expect(store().selectedList).toBe('today');
    // Импорт — обычное изменение, значит откатывается.
    store().undo();
    expect(store().db.projects.some((p) => p.id === projectId)).toBe(true);
  });
});
