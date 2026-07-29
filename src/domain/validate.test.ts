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
      important: false,
    });
    expect(todo.when).toEqual({ kind: 'unscheduled' });
    expect(typeof todo.createdAt).toBe('string');
  });

  it('сохраняет отметку важности и безопасно выключает неизвестное значение', () => {
    const result = validateDatabase({
      ...empty,
      todos: [
        { id: 'td_1', important: true },
        { id: 'td_2', important: 'да' },
      ],
    });

    expect(result!.db.todos.map((todo) => todo.important)).toEqual([true, false]);
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
      areas: [{ id: 'area_1', title: 'Дом', tagIds: ['нет такого тега'] }],
      projects: [
        {
          id: 'prj_1',
          title: 'Проект',
          areaId: 'нет такой области',
          tagIds: ['нет такого тега'],
        },
        { id: 'prj_2', title: 'Другой проект' },
      ],
      headings: [
        { id: 'hd_1', projectId: 'prj_1', title: 'Раз' },
        { id: 'hd_wrong', projectId: 'prj_2', title: 'Чужой' },
        { id: 'hd_2', projectId: 'нет такого проекта', title: 'Два' },
      ],
      todos: [
        {
          id: 'td_1',
          headingId: 'hd_2',
          areaId: 'нет такой области',
          tagIds: ['нет такого тега'],
        },
        { id: 'td_2', projectId: 'prj_1', headingId: 'hd_wrong' },
      ],
    });

    expect(result!.db.headings.map((h) => h.id)).toEqual(['hd_1', 'hd_wrong']);
    expect(result!.db.projects[0].areaId).toBeUndefined();
    const todo = result!.db.todos[0];
    expect(todo.headingId).toBeUndefined();
    expect(todo.areaId).toBeUndefined();
    expect(todo.tagIds).toEqual([]);
    expect(result!.db.todos[1].headingId).toBeUndefined();
    expect(result!.db.projects[0].tagIds).toEqual([]);
    expect(result!.db.areas[0].tagIds).toEqual([]);
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
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.db.todos[0].checklist).toEqual([]);
    expect(loaded.issues.join(' ')).toContain(`версии ${SCHEMA_VERSION}`);
  });

  it('файл текущей версии не переписывается миграциями', () => {
    const loaded = loadDatabase({
      version: SCHEMA_VERSION,
      db: { ...empty, todos: [{ id: 'td_1', title: 'Свежая' }] },
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.issues.join(' ')).not.toContain('Схема обновлена');
  });

  it('мусор не проходит', () => {
    expect(loadDatabase({ todos: 'нет' })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('файл более новой схемы не открывается', () => {
    const outcome = loadDatabase({
      version: SCHEMA_VERSION + 1,
      db: { ...empty, todos: [{ id: 'td_1', title: 'Из будущего' }] },
    });
    // Нормализовать его нельзя: неизвестные поля потерялись бы при сохранении.
    expect(outcome).toEqual({ ok: false, reason: 'newer', version: SCHEMA_VERSION + 1 });
  });
});

describe('validateDatabase: строгие даты и время', () => {
  it('несуществующие даты отбрасываются', () => {
    const result = validateDatabase({
      ...empty,
      todos: [
        { id: 'td_1', deadline: '2026-99-99' },
        { id: 'td_2', deadline: '2026-02-30' },
        { id: 'td_3', deadline: '2026-02-28' },
        { id: 'td_4', when: { kind: 'scheduled', date: '2026-13-01' } },
      ],
    });
    const [a, b, c, d] = result!.db.todos;
    expect(a.deadline).toBeUndefined();
    expect(b.deadline).toBeUndefined();
    expect(c.deadline).toBe('2026-02-28');
    expect(d.when).toEqual({ kind: 'unscheduled' });
  });

  it('29 февраля проходит только в высокосный год', () => {
    const leap = validateDatabase({ ...empty, todos: [{ id: 'td_1', deadline: '2028-02-29' }] });
    const plain = validateDatabase({ ...empty, todos: [{ id: 'td_1', deadline: '2026-02-29' }] });
    expect(leap!.db.todos[0].deadline).toBe('2028-02-29');
    expect(plain!.db.todos[0].deadline).toBeUndefined();
  });

  it('время вне циферблата отбрасывается', () => {
    const result = validateDatabase({
      ...empty,
      todos: [
        { id: 'td_1', reminder: '47:80' },
        { id: 'td_2', reminder: '24:00' },
        { id: 'td_3', reminder: '23:59' },
        { id: 'td_4', reminder: '00:00' },
      ],
    });
    const reminders = result!.db.todos.map((todo) => todo.reminder);
    expect(reminders).toEqual([undefined, undefined, '23:59', '00:00']);
  });
});
