import { nextWeek, today, tomorrow } from '../domain/dates';
import type { Database } from '../domain/types';

let counter = 0;
export function newId(prefix = 'id'): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

/**
 * A valid but completely empty database. This is what a new installation gets:
 * someone else's example projects are not the user's data.
 */
export function createEmptyDatabase(): Database {
  return {
    areas: [],
    projects: [],
    headings: [],
    todos: [],
    tags: [],
  };
}

/**
 * Example content for development, tests and the «Загрузить демонстрационные
 * данные» button. Never loaded on its own.
 */
export function createDemoDatabase(): Database {
  const now = new Date().toISOString();
  const areaWork = newId('area');
  const areaHome = newId('area');
  const projectLaunch = newId('prj');
  const projectTrip = newId('prj');
  const headingPrep = newId('hd');
  const headingShip = newId('hd');
  const tagWork = newId('tag');
  const tagQuick = newId('tag');

  let order = 0;
  const next = () => (order += 1);

  return {
    areas: [
      { id: areaWork, title: 'Работа', tagIds: [], index: next(), collapsed: false },
      { id: areaHome, title: 'Личное', tagIds: [], index: next(), collapsed: false },
    ],
    projects: [
      {
        id: projectLaunch,
        title: 'Запуск приложения',
        notes: 'Первая публичная версия для macOS.',
        areaId: areaWork,
        when: { kind: 'unscheduled' },
        deadline: nextWeek(),
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: projectTrip,
        title: 'Поездка в горы',
        notes: '',
        areaId: areaHome,
        when: { kind: 'someday' },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
    ],
    headings: [
      { id: headingPrep, projectId: projectLaunch, title: 'Подготовка', index: next() },
      { id: headingShip, projectId: projectLaunch, title: 'Релиз', index: next() },
    ],
    tags: [
      { id: tagWork, title: 'офис' },
      { id: tagQuick, title: 'быстро' },
    ],
    todos: [
      {
        id: newId('td'),
        title: 'Прочитать про горячие клавиши в Things',
        notes: 'Cmd+N новая задача, Space открыть, Cmd+K переместить.',
        checklist: [],
        when: { kind: 'today' },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Позвонить в сервис',
        notes: '',
        checklist: [],
        when: { kind: 'unscheduled' },
        tagIds: [tagQuick],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Собрать сборку для macOS',
        notes: '',
        checklist: [
          { id: newId('ci'), title: 'Подписать бинарь', done: false },
          { id: newId('ci'), title: 'Проверить на чистой системе', done: false },
        ],
        projectId: projectLaunch,
        headingId: headingShip,
        when: { kind: 'today' },
        deadline: tomorrow(),
        tagIds: [tagWork],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Сверстать экран настроек',
        notes: '',
        checklist: [],
        projectId: projectLaunch,
        headingId: headingPrep,
        when: { kind: 'unscheduled' },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Обзор конкурентов',
        notes: '',
        checklist: [],
        projectId: projectLaunch,
        headingId: headingPrep,
        when: { kind: 'scheduled', date: nextWeek() },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Вечером разобрать почту',
        notes: '',
        checklist: [],
        areaId: areaWork,
        when: { kind: 'evening' },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Купить рюкзак',
        notes: '',
        checklist: [],
        projectId: projectTrip,
        when: { kind: 'unscheduled' },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Оплатить домен',
        notes: '',
        checklist: [],
        areaId: areaHome,
        when: { kind: 'scheduled', date: tomorrow() },
        tagIds: [],
        status: 'open',
        trashed: false,
        createdAt: now,
        index: next(),
      },
      {
        id: newId('td'),
        title: 'Настроить рабочее место',
        notes: '',
        checklist: [],
        areaId: areaWork,
        when: { kind: 'today' },
        tagIds: [],
        status: 'completed',
        completedAt: `${today()}T09:12:00.000Z`,
        trashed: false,
        createdAt: now,
        index: next(),
      },
    ],
  };
}
