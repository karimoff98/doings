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
  // Most cases below need something to work with, so they ask for the examples
  // explicitly — the app itself now starts empty.
  store().loadDemoData();
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

  it('не открывает несуществующий или удалённый проект', () => {
    store().selectList('project:missing');
    expect(store().selectedList).toBe('today');

    const id = store().createProject({ title: 'Удаляемый' });
    store().trashProject(id);
    store().selectList(`project:${id}`);
    expect(store().selectedList).toBe('today');
  });

  it('закрывает редактор, если действие убрало задачу из текущего списка', () => {
    const todo = store().db.todos.find(
      (item) => item.status === 'open' && item.when.kind === 'today',
    )!;
    store().selectList('today');
    store().openEditor(todo.id);
    store().completeTodo(todo.id);

    expect(store().editingTodoId).toBeUndefined();
    expect(store().selectedTodoId).toBeUndefined();
    expect(store().selection).toEqual([]);
    expect(store().db.todos.some((item) => item.id === todo.id)).toBe(true);
  });

  it('после скрытия старой задачи создание новой не удаляет старую', () => {
    const oldId = store().createTodo({ when: { kind: 'today' } });
    store().setDeadline(oldId, today());
    store().completeTodo(oldId);
    store().createTodo({ title: 'Следующая' });

    expect(store().db.todos.some((item) => item.id === oldId)).toBe(true);
  });
});

describe('создание в отфильтрованном списке', () => {
  it('создаёт важную задачу прямо из списка «Важное»', () => {
    store().selectList('important');
    const id = store().createTodo({ title: 'Не забыть' });

    expect(store().db.todos.find((todo) => todo.id === id)?.important).toBe(true);
    expect(
      selectSections(store().db, 'important')
        .flatMap((section) => section.rows)
        .some((row) => row.kind === 'todo' && row.todo.id === id),
    ).toBe(true);
  });

  it('снятие важности убирает задачу из списка и закрывает редактор', () => {
    const id = store().createTodo({ title: 'Было важно', important: true });
    store().selectList('important');
    store().openEditor(id);

    store().setImportant(id, false);

    expect(store().editingTodoId).toBeUndefined();
    expect(store().selection).toEqual([]);
    expect(store().db.todos.find((todo) => todo.id === id)?.important).toBe(false);
  });

  it('наследует активный тег и не исчезает сразу после создания', () => {
    const tag = store().db.tags[0];
    store().selectList('today');
    store().toggleTagFilter(tag.id);
    const id = store().createTodo({ title: 'В фильтре' });

    expect(store().db.todos.find((todo) => todo.id === id)?.tagIds).toContain(tag.id);
    expect(
      selectSections(store().db, 'today')
        .flatMap((section) => section.rows)
        .some((row) => row.kind === 'todo' && row.todo.id === id),
    ).toBe(true);
  });

  it('закрывает редактор, если задача перестала подходить активному фильтру', () => {
    const tag = store().db.tags[0];
    const first = store().createTodo({ title: 'Первая', when: { kind: 'today' } });
    const second = store().createTodo({ title: 'Вторая', when: { kind: 'today' } });
    store().toggleTag(first, tag.id);
    store().toggleTag(second, tag.id);
    store().selectList('today');
    store().toggleTagFilter(tag.id);
    store().openEditor(first);

    store().toggleTag(first, tag.id);

    expect(store().editingTodoId).toBeUndefined();
    expect(store().selection).toEqual([]);
    expect(store().tagFilter).toEqual([tag.id]);
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

  it('новая задача с настроенным сроком не удаляется без заголовка', () => {
    const id = store().createTodo();
    store().setDeadline(id, today());
    store().closeEditor();

    expect(store().db.todos.find((todo) => todo.id === id)?.deadline).toBe(today());
  });

  it('новая задача с изменённой датой не считается нетронутой', () => {
    const id = store().createTodo();
    store().setWhen(id, { kind: 'someday' });
    store().closeEditor();

    expect(store().db.todos.find((todo) => todo.id === id)?.when.kind).toBe('someday');
  });

  it('существующая пустая задача не удаляется после просмотра', () => {
    const id = store().createTodo({ title: 'Временное имя' });
    store().closeEditor();
    store().updateTodo(id, { title: '' });
    store().openEditor(id);
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

  it('отбрасывает то, что базой не является', () => {
    expect(parseDatabase(null)).toBeNull();
    expect(parseDatabase({ todos: 'нет' })).toBeNull();
    expect(parseDatabase({ areas: [], projects: [], headings: [], tags: [] })).toBeNull();
  });

  it('битую запись выбрасывает, а базу загружает', () => {
    const db = parseDatabase({
      areas: [],
      projects: [],
      headings: [],
      tags: [],
      todos: [{ id: 1 }, { id: 'td_ok', title: 'Целая' }],
    });
    expect(db?.todos.map((todo) => todo.title)).toEqual(['Целая']);
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

describe('состояние после удалений', () => {
  it('удаление тега уводит из его списка', () => {
    const tagId = store().db.tags[0].id;
    store().selectList(`tag:${tagId}`);

    store().removeTag(tagId);

    expect(store().selectedList).toBe('today');
    expect(store().db.todos.every((todo) => !todo.tagIds.includes(tagId))).toBe(true);
  });

  it('удаление проекта уводит из его списка', () => {
    const projectId = store().db.projects[0].id;
    store().selectList(`project:${projectId}`);

    store().trashProject(projectId);

    expect(store().selectedList).toBe('today');
  });

  it('удаление области уводит из её списка', () => {
    const areaId = store().db.areas[0].id;
    store().selectList(`area:${areaId}`);

    store().trashArea(areaId);

    expect(store().selectedList).toBe('today');
  });
});

describe('выделение после действий', () => {
  it('задачи, ушедшие из списка, покидают и выделение', () => {
    store().selectList('today');
    const visible = selectSections(store().db, 'today').flatMap((section) =>
      section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
    );
    store().selectRange(visible, visible[visible.length - 1]);
    expect(store().selection).toHaveLength(visible.length);

    // «Когда-нибудь» убирает задачи из «Сегодня»
    store().setWhen(visible, { kind: 'someday' });

    // Иначе панель пакетных действий висела бы над пустым списком.
    expect(store().selection).toEqual([]);
    expect(store().selectedTodoId).toBeUndefined();
  });

  it('задача, оставшаяся в списке, остаётся выделенной', () => {
    store().selectList('anytime');
    const todo = byTitle('Позвонить в сервис');
    store().selectTodo(todo.id);

    store().updateTodo(todo.id, { notes: 'правка' });

    expect(store().selection).toEqual([todo.id]);
  });
});

describe('повторное выполнение', () => {
  it('второй вызов completeTodo не создаёт вторую копию повтора', () => {
    const todo = byTitle('Позвонить в сервис');
    store().setWhen(todo.id, { kind: 'today' });
    store().setRepeat(todo.id, { unit: 'day', every: 1 });

    store().completeTodo(todo.id);
    store().completeTodo(todo.id);

    const series = store().db.todos.filter((item) => item.repeat);
    expect(series).toHaveLength(2);
    expect(series.filter((item) => item.status === 'open')).toHaveLength(1);
  });

  it('выполнение задачи из корзины ничего не меняет', () => {
    const todo = byTitle('Позвонить в сервис');
    store().trashTodo(todo.id);
    store().completeTodo(todo.id);

    expect(byTitle('Позвонить в сервис').status).toBe('open');
  });
});

describe('завершение проекта с повторяющейся задачей', () => {
  it('серия продолжается во Входящих, а не внутри закрытого проекта', () => {
    const project = store().db.projects.find((p) => p.title === 'Запуск приложения')!;
    const todo = store().db.todos.find((t) => t.projectId === project.id)!;
    store().setWhen(todo.id, { kind: 'today' });
    store().setRepeat(todo.id, { unit: 'day', every: 1 });

    store().completeProject(project.id);

    const copy = store().db.todos.find(
      (item) => item.seriesId === todo.id && item.status === 'open',
    );
    expect(copy).toBeDefined();
    // Внутри завершённого проекта копия была бы не видна ни в одном списке.
    expect(copy?.projectId).toBeUndefined();
    expect(copy?.headingId).toBeUndefined();
    const inbox = selectSections(store().db, 'inbox').flatMap((section) =>
      section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
    );
    expect(inbox).toContain(copy!.id);
  });
});

describe('восстановление проекта', () => {
  it('возвращает только задачи, удалённые вместе с ним', () => {
    const project = store().db.projects.find((p) => p.title === 'Запуск приложения')!;
    const удалённаяРаньше = store().db.todos.find((t) => t.projectId === project.id)!;

    store().trashTodo(удалённаяРаньше.id);
    store().trashProject(project.id);
    store().restoreProject(project.id);

    const after = store().db.todos.filter((t) => t.projectId === project.id);
    expect(after.find((t) => t.id === удалённаяРаньше.id)?.trashed).toBe(true);
    expect(after.filter((t) => t.id !== удалённаяРаньше.id).every((t) => !t.trashed)).toBe(true);
  });
});

describe('возобновление проекта с повторяющейся задачей', () => {
  it('в серии остаётся ровно одна открытая задача', () => {
    const project = store().db.projects.find((p) => p.title === 'Запуск приложения')!;
    const todo = store().db.todos.find((t) => t.projectId === project.id)!;
    store().setWhen(todo.id, { kind: 'today' });
    store().setRepeat(todo.id, { unit: 'day', every: 1 });

    store().completeProject(project.id);
    store().completeProject(project.id);

    const series = store().db.todos.filter(
      (item) => (item.seriesId ?? item.id) === todo.id && !item.trashed,
    );
    const открытых = series.filter((item) => item.status === 'open');
    // Иначе рутина существовала бы дважды: копия во Входящих и оригинал в проекте.
    expect(открытых).toHaveLength(1);
  });

  it('обычные задачи проекта возвращаются в открытое состояние', () => {
    const project = store().db.projects.find((p) => p.title === 'Запуск приложения')!;
    const обычных = store().db.todos.filter(
      (t) => t.projectId === project.id && t.status === 'open' && !t.repeat,
    ).length;

    store().completeProject(project.id);
    store().completeProject(project.id);

    expect(
      store().db.todos.filter(
        (t) => t.projectId === project.id && t.status === 'open' && !t.repeat,
      ),
    ).toHaveLength(обычных);
  });
});

describe('корзина и гидратация', () => {
  /** Round-trips the database through JSON like a real restart would. */
  function rehydrate() {
    const snapshot = JSON.parse(JSON.stringify(store().db));
    const loaded = parseDatabase(snapshot);
    if (!loaded) throw new Error('база не разобралась после перезагрузки');
    useStore.setState({ db: loaded, past: [], future: [] });
  }

  it('emptyTrash физически удаляет задачи и проекты', () => {
    const todo = store().db.todos.find((t) => t.status === 'open')!;
    const projectId = store().createProject({ title: 'На выброс' });
    const headingId = store().createHeading(projectId, 'Тоже на выброс');

    store().trashTodo(todo.id);
    store().trashProject(projectId);
    useStore.setState({ selection: [todo.id], selectedTodoId: todo.id });
    expect(store().db.todos.some((t) => t.id === todo.id && t.trashed)).toBe(true);
    expect(store().db.projects.some((p) => p.id === projectId && p.trashed)).toBe(true);

    store().emptyTrash();
    // Gone from the arrays entirely, not just flagged.
    expect(store().db.todos.some((t) => t.id === todo.id)).toBe(false);
    expect(store().db.projects.some((p) => p.id === projectId)).toBe(false);
    expect(store().db.headings.some((heading) => heading.id === headingId)).toBe(false);
    expect(store().selection).toEqual([]);
  });

  it('действия над задачей в корзине не изменяют её скрытые свойства', () => {
    const todo = store().db.todos.find((item) => item.status === 'open')!;
    const checklistId = store().addChecklistItem(todo.id, { title: 'Сохранённый пункт' });
    store().completeTodo(todo.id);
    const before = structuredClone(store().db.todos.find((item) => item.id === todo.id)!);
    store().trashTodo(todo.id);
    useStore.setState({ editingTodoId: undefined, autoPanel: undefined });

    store().setWhen(todo.id, { kind: 'someday' });
    store().setDeadline(todo.id, today());
    store().setImportant(todo.id, true);
    store().moveTodo(todo.id, {});
    store().uncompleteTodo(todo.id);
    store().addChecklistItem(todo.id, { title: 'Лишний пункт' });
    store().updateChecklistItem(todo.id, checklistId, { title: 'Испорчено' });
    store().removeChecklistItem(todo.id, checklistId);
    store().openEditor(todo.id);
    store().openEditorPanel(todo.id, 'tags');
    expect(store().duplicateTodo(todo.id)).toEqual([]);

    const after = store().db.todos.find((item) => item.id === todo.id);
    expect(after?.when).toEqual(before.when);
    expect(after?.deadline).toBe(before.deadline);
    expect(after?.important).toBe(before.important);
    expect(after?.projectId).toBe(before.projectId);
    expect(after?.areaId).toBe(before.areaId);
    expect(after?.status).toBe('completed');
    expect(after?.checklist).toEqual(before.checklist);
    expect(after?.trashed).toBe(true);
    expect(store().editingTodoId).toBeUndefined();
    expect(store().autoPanel).toBeUndefined();
  });

  it('undo возвращает содержимое корзины, redo снова удаляет', () => {
    const todo = store().db.todos.find((t) => t.status === 'open')!;
    store().trashTodo(todo.id);
    store().emptyTrash();
    expect(store().db.todos.some((t) => t.id === todo.id)).toBe(false);

    store().undo();
    const restored = store().db.todos.find((t) => t.id === todo.id);
    expect(restored).toBeDefined();
    expect(restored?.trashed).toBe(true);

    store().redo();
    expect(store().db.todos.some((t) => t.id === todo.id)).toBe(false);
  });

  it('очистка сохраняется после повторной гидратации', () => {
    const todo = store().db.todos.find((t) => t.status === 'open')!;
    const projectId = store().createProject({ title: 'Больше не нужен' });
    store().trashTodo(todo.id);
    store().trashProject(projectId);
    store().emptyTrash();

    rehydrate();

    // A restart must not resurrect anything the user threw away.
    expect(store().db.todos.some((t) => t.id === todo.id)).toBe(false);
    expect(store().db.projects.some((p) => p.id === projectId)).toBe(false);
  });

  it('ранее пустой проект не появляется после перезапуска', () => {
    const projectId = store().createProject({ title: 'Пустой' });
    store().trashProject(projectId);
    store().emptyTrash();
    rehydrate();
    expect(store().db.projects.some((p) => p.id === projectId)).toBe(false);
  });

  it('кнопка очистки скрыта, когда корзина пуста', () => {
    // The visible «Очистить корзину» button is gated on the trash having rows.
    expect(selectSections(store().db, 'trash')).toHaveLength(0);

    const todo = store().db.todos.find((t) => t.status === 'open')!;
    store().trashTodo(todo.id);
    expect(selectSections(store().db, 'trash').length).toBeGreaterThan(0);

    store().emptyTrash();
    expect(selectSections(store().db, 'trash')).toHaveLength(0);
  });
});

describe('пустые проекты', () => {
  it('новый проект создаётся без названия', () => {
    const id = store().createProject();
    const project = store().db.projects.find((p) => p.id === id)!;
    expect(project.title).toBe('');
    expect(store().draftProjectId).toBe(id);
  });

  it('нетронутый пустой проект удаляется при уходе', () => {
    const id = store().createProject();
    store().selectList(`project:${id}`);
    store().selectList('today');
    expect(store().db.projects.some((p) => p.id === id)).toBe(false);
    expect(store().draftProjectId).toBeUndefined();
  });

  it('проект с названием остаётся при уходе', () => {
    const id = store().createProject();
    store().updateProject(id, { title: 'Реальный' });
    store().selectList('today');
    expect(store().db.projects.some((p) => p.id === id)).toBe(true);
    expect(store().draftProjectId).toBeUndefined();
  });

  it('проект снова считается брошенным, если введённое название стёрли', () => {
    const id = store().createProject();
    store().updateProject(id, { title: 'Черновик' });
    store().updateProject(id, { title: '' });
    store().selectList('today');

    expect(store().db.projects.some((project) => project.id === id)).toBe(false);
  });

  it('пустой проект с задачей не удаляется при уходе', () => {
    const id = store().createProject();
    store().selectList(`project:${id}`);
    store().createTodo({ title: 'Есть дело', target: { projectId: id } });
    store().selectList('today');
    expect(store().db.projects.some((p) => p.id === id)).toBe(true);
  });

  it('проект без названия, но с заметкой не удаляется при уходе', () => {
    const id = store().createProject();
    store().updateProject(id, { notes: 'Важная заметка' });
    store().selectList('today');

    expect(store().db.projects.find((project) => project.id === id)?.notes).toBe('Важная заметка');
  });

  it('проект без названия, но со сроком не удаляется при уходе', () => {
    const id = store().createProject();
    store().updateProject(id, { deadline: today() });
    store().selectList('today');

    expect(store().db.projects.find((project) => project.id === id)?.deadline).toBe(today());
  });

  it('старый импортированный пустой проект не удаляется', () => {
    // Loaded from disk, not a session draft: it must survive navigation and
    // simply show the fallback name instead of vanishing.
    const id = store().createProject({ title: 'Импорт' });
    store().updateProject(id, { title: '' });
    store().selectList(`project:${id}`);
    store().selectList('today');
    expect(store().db.projects.some((p) => p.id === id)).toBe(true);
  });

  it('fallback-название подставляется в секции проекта', () => {
    const id = store().createProject({ title: 'Импорт' });
    store().updateProject(id, { title: '   ' });
    store().createTodo({ title: 'Дело', target: { projectId: id } });
    // The Anytime list groups open todos under their project heading.
    const section = selectSections(store().db, 'anytime').find((s) => s.id === `project:${id}`);
    expect(section).toBeDefined();
    expect(section?.title).toBe('Проект без названия');
  });
});

describe('пустые области', () => {
  it('новая область создаётся пустым черновиком', () => {
    const id = store().createArea();
    expect(store().db.areas.find((area) => area.id === id)?.title).toBe('');
    expect(store().draftAreaId).toBe(id);
  });

  it('удаляет брошенную пустую область при уходе', () => {
    const id = store().createArea();
    store().selectList(`area:${id}`);
    store().selectList('today');
    expect(store().db.areas.some((area) => area.id === id)).toBe(false);
    expect(store().draftAreaId).toBeUndefined();
  });

  it('сохраняет названную область при уходе', () => {
    const id = store().createArea();
    store().updateArea(id, { title: 'Работа' });
    store().selectList('today');
    expect(store().db.areas.find((area) => area.id === id)?.title).toBe('Работа');
    expect(store().draftAreaId).toBeUndefined();
  });

  it('удаляет область, если введённое название полностью стёрли', () => {
    const id = store().createArea();
    store().updateArea(id, { title: 'Черновик' });
    store().updateArea(id, { title: '' });
    store().selectList('today');

    expect(store().db.areas.some((area) => area.id === id)).toBe(false);
  });

  it('не удаляет пустую область, если в ней уже есть проект', () => {
    const id = store().createArea();
    store().createProject({ title: 'Проект', areaId: id });
    store().selectList('today');
    expect(store().db.areas.some((area) => area.id === id)).toBe(true);
  });
});

describe('коалесинг ввода в один шаг undo', () => {
  it('весь сеанс правок текста — один шаг отмены', () => {
    const todo = byTitle('Позвонить в сервис');
    const before = store().past.length;

    store().commitTodoText(todo.id, { title: 'Позвонить в сервис!' });
    store().commitTodoText(todo.id, { title: 'Позвонить в сервис!!' });
    store().commitTodoText(todo.id, { notes: 'до 18:00' });

    // Three keystroke-sized commits, but only one undo step.
    expect(store().past.length).toBe(before + 1);

    store().undo();
    const reverted = store().db.todos.find((t) => t.id === todo.id)!;
    expect(reverted.title).toBe('Позвонить в сервис');
    expect(reverted.notes).toBe('');
  });

  it('другое действие завершает сеанс, следующая правка — новый шаг', () => {
    const todo = byTitle('Позвонить в сервис');
    const before = store().past.length;

    store().commitTodoText(todo.id, { title: 'Черновик' });
    store().setWhen(todo.id, { kind: 'today' });
    store().commitTodoText(todo.id, { title: 'Черновик 2' });

    // commit + setWhen + commit = three separate steps.
    expect(store().past.length).toBe(before + 3);
  });

  it('закрытие редактора завершает сеанс', () => {
    const todo = byTitle('Позвонить в сервис');
    const before = store().past.length;

    store().commitTodoText(todo.id, { title: 'Один' });
    store().closeEditor();
    store().commitTodoText(todo.id, { title: 'Два' });

    expect(store().past.length).toBe(before + 2);
  });
});

describe('чистая установка и сохранность данных', () => {
  /** Round-trips the database through JSON like a restart would. */
  function rehydrate() {
    const snapshot = JSON.parse(JSON.stringify(store().db));
    const loaded = parseDatabase(snapshot);
    if (!loaded) throw new Error('база не разобралась после перезапуска');
    useStore.setState({ db: loaded, past: [], future: [] });
  }

  it('очистка данных оставляет пустую, но корректную базу', () => {
    expect(store().db.projects.length).toBeGreaterThan(0);
    store().resetToEmpty();

    const db = store().db;
    expect(db).toEqual({ todos: [], projects: [], areas: [], headings: [], tags: [] });
    expect(parseDatabase(JSON.parse(JSON.stringify(db)))).not.toBeNull();
    // Nothing may keep pointing into the database that was just thrown away.
    expect(store().selection).toEqual([]);
    expect(store().editingTodoId).toBeUndefined();
  });

  it('очистку можно отменить в рамках сеанса', () => {
    const before = store().db.todos.length;
    store().resetToEmpty();
    expect(store().db.todos).toHaveLength(0);

    store().undo();
    expect(store().db.todos).toHaveLength(before);
  });

  it('обновление с существующей базой сохраняет все данные', () => {
    const todos = store().db.todos.map((t) => t.id);
    const projects = store().db.projects.map((p) => p.id);
    const areas = store().db.areas.map((a) => a.id);

    rehydrate();

    // A new version reads the old file as is: nothing added, nothing dropped.
    expect(store().db.todos.map((t) => t.id)).toEqual(todos);
    expect(store().db.projects.map((p) => p.id)).toEqual(projects);
    expect(store().db.areas.map((a) => a.id)).toEqual(areas);
  });

  it('импортированная база не подменяется пустой', () => {
    const imported = parseDatabase(JSON.parse(JSON.stringify(store().db)));
    if (!imported) throw new Error('демо-база не разобралась');
    store().resetToEmpty();
    store().importDatabase(imported);

    expect(store().db.todos.length).toBeGreaterThan(0);
    rehydrate();
    expect(store().db.todos.length).toBeGreaterThan(0);
  });

  it('удалённые проекты не возвращаются после перезапуска', () => {
    const project = store().db.projects[0];
    store().trashProject(project.id);
    store().emptyTrash();
    expect(store().db.projects.some((p) => p.id === project.id)).toBe(false);

    rehydrate();
    // Demo content is never re-seeded, so what the user removed stays removed.
    expect(store().db.projects.some((p) => p.id === project.id)).toBe(false);
    expect(store().db.projects.some((p) => p.title === 'Запуск приложения')).toBe(false);
  });

  it('после очистки перезапуск не возвращает демонстрационные данные', () => {
    store().resetToEmpty();
    rehydrate();
    expect(store().db.projects).toHaveLength(0);
    expect(store().db.todos).toHaveLength(0);
  });

  it('демонстрационные данные появляются только по явному действию', () => {
    store().resetToEmpty();
    expect(store().db.projects).toHaveLength(0);

    store().loadDemoData();
    expect(store().db.projects.length).toBeGreaterThan(0);
    expect(store().db.todos.length).toBeGreaterThan(0);
  });
});
