import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, loadDatabase, validateDatabase } from './validate';

const empty = { areas: [], projects: [], headings: [], todos: [], tags: [] };

describe('validateDatabase: что отвергается целиком', () => {
  it('не база', () => {
    expect(validateDatabase(null)).toBeNull();
    expect(validateDatabase('строка')).toBeNull();
    expect(validateDatabase(42)).toBeNull();
  });

  it('нет обязательных коллекций', () => {
    expect(validateDatabase({ todos: [] })).toBeNull();
    expect(validateDatabase({ ...empty, todos: 'нет' })).toBeNull();
  });
});

describe('validateDatabase: что достаётся из формата файла', () => {
  it('принимает голую базу, файл экспорта и снимок стора', () => {
    const db = { ...empty, todos: [{ id: 'td_1', title: 'Задача' }] };
    expect(validateDatabase(db)?.db.todos).toHaveLength(1);
    expect(validateDatabase({ version: 1, db })?.db.todos).toHaveLength(1);
    expect(validateDatabase({ state: { db }, version: 1 })?.db.todos).toHaveLength(1);
  });
});

describe('validateDatabase: починка данных', () => {
  it('заполняет пропущенные поля задачи', () => {
    const result = validateDatabase({ ...empty, todos: [{ id: 'td_1' }] });
    const todo = result!.db.todos[0];
    expect(todo).toMatchObject({
      title: '',
      notes: '',
      checklist: [],
      tagIds: [],
      status: 'open',
      trashed: false,
    });
    expect(todo.when).toEqual({ kind: 'unscheduled' });
    expect(typeof todo.createdAt).toBe('string');
  });

  it('выбрасывает записи без идентификатора и дубли', () => {
    const result = validateDatabase({
      ...empty,
      todos: [{ id: 'td_1' }, { title: 'без id' }, { id: 'td_1', title: 'дубль' }],
    });
    expect(result!.db.todos).toHaveLength(1);
    expect(result!.issues.join(' ')).toContain('Задачи');
  });

  it('приводит неизвестные значения к разумным', () => {
    const result = validateDatabase({
      ...empty,
      todos: [
        {
          id: 'td_1',
          status: 'улетела',
          when: { kind: 'послезавтра' },
          deadline: 'не дата',
          reminder: '25',
          repeat: { unit: 'век', every: -3 },
        },
      ],
    });
    const todo = result!.db.todos[0];
    expect(todo.status).toBe('open');
    expect(todo.when).toEqual({ kind: 'unscheduled' });
    expect(todo.deadline).toBeUndefined();
    expect(todo.reminder).toBeUndefined();
    expect(todo.repeat).toBeUndefined();
  });

  it('запланированная задача без даты становится без даты', () => {
    const result = validateDatabase({
      ...empty,
      todos: [{ id: 'td_1', when: { kind: 'scheduled' } }],
    });
    expect(result!.db.todos[0].when).toEqual({ kind: 'unscheduled' });
  });

  it('чистит ссылки на то, чего нет', () => {
    const result = validateDatabase({
      ...empty,
      areas: [{ id: 'area_1', title: 'Дом' }],
      projects: [{ id: 'prj_1', title: 'Проект', areaId: 'нет такой области' }],
      headings: [
        { id: 'hd_1', projectId: 'prj_1', title: 'Раз' },
        { id: 'hd_2', projectId: 'нет такого проекта', title: 'Два' },
      ],
      todos: [
        {
          id: 'td_1',
          headingId: 'hd_2',
          areaId: 'нет такой области',
          tagIds: ['нет такого тега'],
        },
      ],
    });

    expect(result!.db.headings.map((h) => h.id)).toEqual(['hd_1']);
    expect(result!.db.projects[0].areaId).toBeUndefined();
    const todo = result!.db.todos[0];
    expect(todo.headingId).toBeUndefined();
    expect(todo.areaId).toBeUndefined();
    expect(todo.tagIds).toEqual([]);
    expect(result!.issues.join(' ')).toContain('битых ссылок');
  });

  it('выдаёт идентификаторы пунктам чеклиста без них', () => {
    const result = validateDatabase({
      ...empty,
      todos: [{ id: 'td_1', checklist: [{ title: 'без id' }, 'мусор'] }],
    });
    const checklist = result!.db.todos[0].checklist;
    expect(checklist).toHaveLength(1);
    expect(checklist[0].id).toBeTruthy();
    expect(checklist[0].done).toBe(false);
  });
});

describe('loadDatabase: миграции схемы', () => {
  it('файл без версии проходит миграцию и сообщает об этом', () => {
    const loaded = loadDatabase({ ...empty, todos: [{ id: 'td_1', title: 'Старая' }] });
    expect(loaded!.db.todos[0].checklist).toEqual([]);
    expect(loaded!.issues.join(' ')).toContain(`версии ${SCHEMA_VERSION}`);
  });

  it('файл текущей версии не переписывается миграциями', () => {
    const loaded = loadDatabase({
      version: SCHEMA_VERSION,
      db: { ...empty, todos: [{ id: 'td_1', title: 'Свежая' }] },
    });
    expect(loaded!.issues.join(' ')).not.toContain('Схема обновлена');
  });

  it('мусор не проходит', () => {
    expect(loadDatabase({ todos: 'нет' })).toBeNull();
  });
});
