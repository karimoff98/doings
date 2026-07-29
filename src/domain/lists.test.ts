import { describe, expect, it } from 'vitest';
import { shiftDay, today } from './dates';
import { listCount, projectStats, selectSections } from './lists';
import type { Database, ListKey, Project, Section, Todo } from './types';

function todo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    title: overrides.id,
    notes: '',
    checklist: [],
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    index: 0,
    ...overrides,
  };
}

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    title: overrides.id,
    notes: '',
    when: { kind: 'unscheduled' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    index: 0,
    ...overrides,
  };
}

function database(parts: Partial<Database> = {}): Database {
  return { areas: [], projects: [], headings: [], todos: [], tags: [], ...parts };
}

/** Titles of every row a list renders, section by section. */
function titles(db: Database, key: ListKey): string[] {
  return selectSections(db, key).flatMap((section: Section) =>
    section.rows.map((row) => (row.kind === 'todo' ? row.todo.title : row.project.title)),
  );
}

describe('Входящие', () => {
  it('берёт задачи без проекта и области', () => {
    const db = database({
      areas: [{ id: 'area', title: 'Работа', tagIds: [], index: 0, collapsed: false }],
      projects: [project({ id: 'prj' })],
      todos: [
        todo({ id: 'свободная' }),
        todo({ id: 'в проекте', projectId: 'prj' }),
        todo({ id: 'в области', areaId: 'area' }),
      ],
    });
    expect(titles(db, 'inbox')).toEqual(['свободная']);
  });

  it('подбирает сирот, чей проект удалён или в корзине', () => {
    const db = database({
      projects: [project({ id: 'мусорный', trashed: true })],
      todos: [
        todo({ id: 'из корзины проекта', projectId: 'мусорный' }),
        todo({ id: 'без проекта вовсе', projectId: 'исчез' }),
      ],
    });
    // Иначе такие задачи не видны нигде и считаются потерянными.
    expect(titles(db, 'inbox').sort()).toEqual(['без проекта вовсе', 'из корзины проекта']);
  });
});

describe('статистика проектов', () => {
  it('считает открытые, завершённые и удалённые задачи одним индексом', () => {
    const db = database({
      projects: [project({ id: 'проект' })],
      todos: [
        todo({ id: 'открытая', projectId: 'проект' }),
        todo({ id: 'готовая', projectId: 'проект', status: 'completed' }),
        todo({ id: 'в корзине', projectId: 'проект', trashed: true }),
      ],
    });

    expect(projectStats(db).get('проект')).toEqual({
      open: 1,
      total: 2,
      progress: 0.5,
    });
  });
});

describe('Сегодня', () => {
  const db = database({
    projects: [project({ id: 'потом', when: { kind: 'someday' } })],
    todos: [
      todo({ id: 'на сегодня', when: { kind: 'today' } }),
      todo({ id: 'вечером', when: { kind: 'evening' } }),
      todo({ id: 'просроченная', when: { kind: 'scheduled', date: shiftDay(today(), -3) } }),
      todo({ id: 'завтра', when: { kind: 'scheduled', date: shiftDay(today(), 1) } }),
      todo({ id: 'со сроком', deadline: today() }),
      todo({ id: 'из отложенного проекта', projectId: 'потом', when: { kind: 'today' } }),
      todo({ id: 'выполненная', when: { kind: 'today' }, status: 'completed' }),
    ],
  });

  it('собирает наступившие даты, вечер и сроки сдачи', () => {
    expect(titles(db, 'today').sort()).toEqual(
      ['вечером', 'на сегодня', 'просроченная', 'со сроком'].sort(),
    );
  });

  it('вечерние задачи живут в отдельной секции', () => {
    const sections = selectSections(db, 'today');
    const evening = sections.find((section) => section.id === 'evening');
    expect(evening?.rows.map((row) => (row.kind === 'todo' ? row.todo.title : ''))).toEqual([
      'вечером',
    ]);
  });

  it('счётчик в сайдбаре совпадает с числом строк', () => {
    expect(listCount(db, 'today')).toBe(4);
  });
});

describe('Предстоящие', () => {
  it('только будущие даты, сгруппированные по дню', () => {
    const db = database({
      todos: [
        todo({ id: 'сегодня', when: { kind: 'today' } }),
        todo({ id: 'через два дня', when: { kind: 'scheduled', date: shiftDay(today(), 2) } }),
        todo({ id: 'через день', when: { kind: 'scheduled', date: shiftDay(today(), 1) } }),
        todo({ id: 'только срок', deadline: shiftDay(today(), 4) }),
      ],
    });
    expect(titles(db, 'upcoming')).toEqual(['через день', 'через два дня', 'только срок']);
  });
});

describe('Важное', () => {
  it('показывает только открытые важные задачи и считает их', () => {
    const db = database({
      todos: [
        todo({ id: 'важная', important: true }),
        todo({ id: 'обычная' }),
        todo({ id: 'готовая важная', important: true, status: 'completed' }),
        todo({ id: 'удалённая важная', important: true, trashed: true }),
      ],
    });

    expect(titles(db, 'important')).toEqual(['важная']);
    expect(listCount(db, 'important')).toBe(1);
  });

  it('не вытаскивает задачи из завершённых и отложенных проектов', () => {
    const db = database({
      projects: [
        project({ id: 'закрыт', status: 'completed' }),
        project({ id: 'потом', when: { kind: 'someday' } }),
      ],
      todos: [
        todo({ id: 'из закрытого', projectId: 'закрыт', important: true }),
        todo({ id: 'из отложенного', projectId: 'потом', important: true }),
      ],
    });

    expect(titles(db, 'important')).toEqual([]);
  });
});

describe('В любое время и Когда-нибудь', () => {
  const db = database({
    projects: [project({ id: 'потом', when: { kind: 'someday' } })],
    todos: [
      todo({ id: 'свободная' }),
      todo({ id: 'на сегодня', when: { kind: 'today' } }),
      todo({ id: 'позже', when: { kind: 'scheduled', date: shiftDay(today(), 5) } }),
      todo({ id: 'отложенная', when: { kind: 'someday' } }),
      todo({ id: 'в отложенном проекте', projectId: 'потом' }),
    ],
  });

  it('«В любое время» показывает то, что можно делать сейчас', () => {
    expect(titles(db, 'anytime').sort()).toEqual(['на сегодня', 'свободная'].sort());
  });

  it('«Когда-нибудь» включает задачи отложенного проекта', () => {
    expect(titles(db, 'someday').sort()).toEqual(['в отложенном проекте', 'отложенная'].sort());
  });
});

describe('Журнал и Корзина', () => {
  it('журнал показывает и выполненные задачи, и завершённые проекты', () => {
    const db = database({
      projects: [
        project({
          id: 'закрытый проект',
          status: 'completed',
          completedAt: '2026-05-02T10:00:00.000Z',
        }),
      ],
      todos: [
        todo({ id: 'выполненная', status: 'completed', completedAt: '2026-05-02T09:00:00.000Z' }),
        todo({ id: 'отменённая', status: 'canceled', completedAt: '2026-05-01T09:00:00.000Z' }),
        todo({ id: 'открытая' }),
      ],
    });
    // Новое сверху: 2 мая перед 1 мая, проект перед задачей того же дня.
    expect(titles(db, 'logbook')).toEqual(['закрытый проект', 'выполненная', 'отменённая']);
  });

  it('корзина показывает удалённый проект отдельной секцией', () => {
    const db = database({
      projects: [project({ id: 'удалённый проект', trashed: true })],
      todos: [todo({ id: 'удалённая задача', trashed: true }), todo({ id: 'живая' })],
    });
    const sections = selectSections(db, 'trash');
    expect(sections.map((section) => section.id)).toEqual(['trash-projects', 'trash']);
    expect(titles(db, 'trash')).toEqual(['удалённый проект', 'удалённая задача']);
  });
});

describe('Проект', () => {
  const db = database({
    projects: [project({ id: 'prj' })],
    headings: [
      { id: 'h2', projectId: 'prj', title: 'Второй', index: 2 },
      { id: 'h1', projectId: 'prj', title: 'Первый', index: 1 },
    ],
    todos: [
      todo({ id: 'без заголовка', projectId: 'prj' }),
      todo({ id: 'под вторым', projectId: 'prj', headingId: 'h2' }),
      todo({ id: 'под первым', projectId: 'prj', headingId: 'h1' }),
      todo({
        id: 'сделанная',
        projectId: 'prj',
        status: 'completed',
        completedAt: '2026-05-01T09:00:00.000Z',
      }),
    ],
  });

  it('группирует по заголовкам в их порядке, выполненное — в конце', () => {
    expect(titles(db, 'project:prj')).toEqual([
      'без заголовка',
      'под первым',
      'под вторым',
      'сделанная',
    ]);
  });

  it('секции знают, куда переносить брошенную задачу', () => {
    const sections = selectSections(db, 'project:prj');
    expect(sections.find((s) => s.id === 'heading:h1')?.container).toEqual({
      projectId: 'prj',
      headingId: 'h1',
    });
  });
});

describe('Область', () => {
  it('показывает свои задачи, проекты и выполненное', () => {
    const db = database({
      areas: [{ id: 'area', title: 'Дом', tagIds: [], index: 0, collapsed: false }],
      projects: [project({ id: 'проект области', areaId: 'area' })],
      todos: [
        todo({ id: 'задача области', areaId: 'area' }),
        todo({
          id: 'сделанная в области',
          areaId: 'area',
          status: 'completed',
          completedAt: '2026-05-01T09:00:00.000Z',
        }),
      ],
    });
    expect(titles(db, 'area:area')).toEqual([
      'задача области',
      'проект области',
      'сделанная в области',
    ]);
  });
});

describe('Тег', () => {
  it('собирает задачи с тегом по контейнерам', () => {
    const db = database({
      tags: [{ id: 'tag', title: 'быстро' }],
      projects: [project({ id: 'prj' })],
      todos: [
        todo({ id: 'с тегом в проекте', projectId: 'prj', tagIds: ['tag'] }),
        todo({ id: 'с тегом без проекта', tagIds: ['tag'] }),
        todo({ id: 'без тега' }),
      ],
    });
    expect(titles(db, 'tag:tag')).toEqual(['с тегом без проекта', 'с тегом в проекте']);
  });
});
