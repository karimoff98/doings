import { daysFromToday, formatDayLong, formatWeekday, today } from './dates';
import type {
  Database,
  Id,
  IsoDay,
  ListKey,
  Project,
  Row,
  Section,
  SmartList,
  Todo,
} from './types';
import { parseListKey } from './types';

export interface ListMeta {
  key: ListKey;
  title: string;
  /** Icon id resolved by the Icon component. */
  icon: string;
  accent: string;
}

export const SMART_LIST_META: Record<SmartList, Omit<ListMeta, 'key'>> = {
  inbox: { title: 'Входящие', icon: 'inbox', accent: 'var(--c-inbox)' },
  today: { title: 'Сегодня', icon: 'star', accent: 'var(--c-today)' },
  upcoming: { title: 'Предстоящие', icon: 'calendar', accent: 'var(--c-upcoming)' },
  anytime: { title: 'В любое время', icon: 'layers', accent: 'var(--c-anytime)' },
  someday: { title: 'Когда-нибудь', icon: 'box', accent: 'var(--c-someday)' },
  logbook: { title: 'Журнал', icon: 'book', accent: 'var(--c-logbook)' },
  trash: { title: 'Корзина', icon: 'trash', accent: 'var(--c-trash)' },
};

/** Shown wherever a project has no name yet, so it is never an empty row. */
export const UNTITLED_PROJECT = 'Проект без названия';

/** A project's display name, with a fallback for blank titles. */
export function projectTitle(project: { title: string }): string {
  return project.title.trim() || UNTITLED_PROJECT;
}

const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;

function isLive(item: { status: string; trashed: boolean }): boolean {
  return item.status === 'open' && !item.trashed;
}

function isDone(item: { status: string; trashed: boolean }): boolean {
  return (item.status === 'completed' || item.status === 'canceled') && !item.trashed;
}

/** A todo inherits visibility from its project: a Someday project hides its todos. */
function projectOf(projectsById: ReadonlyMap<Id, Project>, todo: Todo): Project | undefined {
  return todo.projectId ? projectsById.get(todo.projectId) : undefined;
}

function blockedByProject(projectsById: ReadonlyMap<Id, Project>, todo: Todo): boolean {
  const project = projectOf(projectsById, todo);
  // Orphans (missing or trashed project) stay visible: they live in the Inbox.
  if (!project || project.trashed) return false;
  if (project.status !== 'open') return true;
  return project.when.kind === 'someday';
}

/** The day a todo becomes actionable, if any. */
function startDay(todo: Todo): IsoDay | undefined {
  if (todo.when.kind === 'scheduled') return todo.when.date;
  if (todo.when.kind === 'today' || todo.when.kind === 'evening') return today();
  return undefined;
}

function isActionableNow(todo: Todo): boolean {
  switch (todo.when.kind) {
    case 'unscheduled':
    case 'today':
    case 'evening':
      return true;
    case 'scheduled':
      return todo.when.date !== undefined && daysFromToday(todo.when.date) <= 0;
    case 'someday':
      return false;
  }
}

function todoRows(todos: Todo[]): Row[] {
  return todos.sort(byIndex).map((todo) => ({ kind: 'todo', todo }));
}

function projectRow(db: Database, project: Project): Row {
  const todos = db.todos.filter((t) => t.projectId === project.id && !t.trashed);
  return {
    kind: 'project',
    project,
    openCount: todos.filter((t) => t.status === 'open').length,
    totalCount: todos.length,
  };
}

/** A todo pointing at a deleted or trashed project has no home: treat it as Inbox. */
function isOrphan(projectsById: ReadonlyMap<Id, Project>, todo: Todo): boolean {
  if (!todo.projectId) return false;
  const project = projectsById.get(todo.projectId);
  return !project || project.trashed;
}

function inboxTodos(db: Database, projectsById: ReadonlyMap<Id, Project>): Todo[] {
  return db.todos.filter(
    (t) => isLive(t) && !t.areaId && (!t.projectId || isOrphan(projectsById, t)),
  );
}

/** Group todos by their container, projects first in sidebar order, then areas, then Inbox. */
function groupByContainer(
  db: Database,
  todos: Todo[],
  projectsById: ReadonlyMap<Id, Project>,
): Section[] {
  const loose: Todo[] = [];
  const byProject = new Map<Id, Todo[]>();
  const byArea = new Map<Id, Todo[]>();

  for (const todo of todos) {
    if (todo.projectId && !isOrphan(projectsById, todo)) {
      const list = byProject.get(todo.projectId) ?? [];
      list.push(todo);
      byProject.set(todo.projectId, list);
    } else if (todo.areaId) {
      const list = byArea.get(todo.areaId) ?? [];
      list.push(todo);
      byArea.set(todo.areaId, list);
    } else {
      loose.push(todo);
    }
  }

  const sections: Section[] = [];
  if (loose.length) {
    sections.push({
      id: 'inbox',
      title: SMART_LIST_META.inbox.title,
      rows: todoRows(loose),
      container: {},
      reorderable: true,
    });
  }
  for (const project of [...db.projects].sort(byIndex)) {
    const list = byProject.get(project.id);
    if (list?.length) {
      sections.push({
        id: `project:${project.id}`,
        title: projectTitle(project),
        rows: todoRows(list),
        container: { projectId: project.id },
        reorderable: true,
      });
    }
  }
  for (const area of [...db.areas].sort(byIndex)) {
    const list = byArea.get(area.id);
    if (list?.length) {
      sections.push({
        id: `area:${area.id}`,
        title: area.title,
        rows: todoRows(list),
        container: { areaId: area.id },
        reorderable: true,
      });
    }
  }
  return sections;
}

function todayList(db: Database, projectsById: ReadonlyMap<Id, Project>): Section[] {
  const candidates = db.todos.filter((todo) => {
    if (!isLive(todo) || blockedByProject(projectsById, todo)) return false;
    const start = startDay(todo);
    const startedByNow = start !== undefined && daysFromToday(start) <= 0;
    const deadlineDue = todo.deadline !== undefined && daysFromToday(todo.deadline) <= 0;
    return startedByNow || deadlineDue;
  });

  const day = candidates.filter((t) => t.when.kind !== 'evening');
  const evening = candidates.filter((t) => t.when.kind === 'evening');

  const sections: Section[] = [];
  if (day.length) {
    sections.push({
      id: 'today',
      rows: todoRows(day),
      when: { kind: 'today' },
      reorderable: true,
    });
  }
  if (evening.length || day.length) {
    sections.push({
      id: 'evening',
      title: 'Вечером',
      rows: todoRows(evening),
      when: { kind: 'evening' },
      reorderable: true,
      // An empty evening group only exists as a drop target while dragging.
      placeholder: evening.length === 0,
    });
  }
  return sections;
}

function upcomingList(db: Database, projectsById: ReadonlyMap<Id, Project>): Section[] {
  const items = new Map<IsoDay, Todo[]>();
  for (const todo of db.todos) {
    if (!isLive(todo) || blockedByProject(projectsById, todo)) continue;
    let day: IsoDay | undefined;
    if (todo.when.kind === 'scheduled' && todo.when.date && daysFromToday(todo.when.date) > 0) {
      day = todo.when.date;
    } else if (
      todo.when.kind !== 'someday' &&
      todo.deadline &&
      daysFromToday(todo.deadline) > 0 &&
      todo.when.kind === 'unscheduled'
    ) {
      // A todo with only a future deadline still needs to show up on the timeline.
      day = todo.deadline;
    }
    if (!day) continue;
    const list = items.get(day) ?? [];
    list.push(todo);
    items.set(day, list);
  }

  return [...items.keys()].sort().map((day) => ({
    id: day,
    title: formatDayLong(day),
    subtitle: formatWeekday(day),
    rows: todoRows(items.get(day) ?? []),
    when: { kind: 'scheduled' as const, date: day },
    reorderable: true,
  }));
}

function anytimeList(db: Database, projectsById: ReadonlyMap<Id, Project>): Section[] {
  const todos = db.todos.filter(
    (todo) => isLive(todo) && !blockedByProject(projectsById, todo) && isActionableNow(todo),
  );
  return groupByContainer(db, todos, projectsById);
}

function somedayList(db: Database, projectsById: ReadonlyMap<Id, Project>): Section[] {
  const todos = db.todos.filter((todo) => {
    if (!isLive(todo)) return false;
    if (todo.when.kind === 'someday') return true;
    const project = projectOf(projectsById, todo);
    return project?.status === 'open' && !project.trashed && project.when.kind === 'someday';
  });
  return groupByContainer(db, todos, projectsById);
}

function logbookList(db: Database): Section[] {
  /** Completed todos and completed projects share the timeline, newest first. */
  const byDay = new Map<IsoDay, { at: string; row: Row }[]>();

  const add = (at: string, row: Row) => {
    const day = at.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push({ at, row });
    byDay.set(day, list);
  };

  for (const todo of db.todos.filter(isDone)) {
    add(todo.completedAt ?? todo.createdAt, { kind: 'todo', todo });
  }
  for (const project of db.projects.filter(isDone)) {
    add(project.completedAt ?? project.createdAt, projectRow(db, project));
  }

  return [...byDay.keys()]
    .sort()
    .reverse()
    .map((day) => ({
      id: day,
      title: formatDayLong(day),
      rows: byDay
        .get(day)!
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((entry) => entry.row),
      muted: true,
    }));
}

function trashList(db: Database): Section[] {
  const sections: Section[] = [];
  const projects = db.projects.filter((p) => p.trashed).sort(byIndex);
  if (projects.length) {
    sections.push({
      id: 'trash-projects',
      title: 'Проекты',
      rows: projects.map((project) => projectRow(db, project)),
      muted: true,
    });
  }
  const rows = todoRows(db.todos.filter((t) => t.trashed));
  if (rows.length) sections.push({ id: 'trash', rows, muted: true });
  return sections;
}

function projectList(db: Database, projectId: Id): Section[] {
  const all = db.todos.filter((t) => t.projectId === projectId && !t.trashed);
  const open = all.filter((t) => t.status === 'open');
  const done = all.filter((t) => t.status !== 'open');
  const headings = db.headings.filter((h) => h.projectId === projectId).sort(byIndex);

  const sections: Section[] = [];
  const withoutHeading = open.filter((t) => !t.headingId);
  sections.push({
    id: 'root',
    rows: todoRows(withoutHeading),
    container: { projectId },
    reorderable: true,
  });
  for (const heading of headings) {
    sections.push({
      id: `heading:${heading.id}`,
      title: heading.title,
      rows: todoRows(open.filter((t) => t.headingId === heading.id)),
      container: { projectId, headingId: heading.id },
      reorderable: true,
    });
  }
  if (done.length) {
    sections.push({
      id: 'done',
      title: 'Выполнено',
      rows: done
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .map((todo) => ({ kind: 'todo' as const, todo })),
      muted: true,
    });
  }
  return sections;
}

function areaList(db: Database, areaId: Id): Section[] {
  const sections: Section[] = [];
  const loose = db.todos.filter((t) => t.areaId === areaId && !t.projectId && isLive(t));
  sections.push({
    id: 'root',
    rows: todoRows(loose),
    container: { areaId },
    reorderable: true,
  });

  const projects = db.projects.filter((p) => p.areaId === areaId && isLive(p)).sort(byIndex);
  if (projects.length) {
    sections.push({
      id: 'projects',
      title: 'Проекты',
      rows: projects.map((project) => projectRow(db, project)),
    });
  }

  // Without this, a completed todo of an area is unreachable from the area view.
  const done = db.todos.filter((t) => t.areaId === areaId && !t.projectId && isDone(t));
  if (done.length) {
    sections.push({
      id: 'done',
      title: 'Выполнено',
      rows: done
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .map((todo) => ({ kind: 'todo' as const, todo })),
      muted: true,
    });
  }
  return sections;
}

function tagList(db: Database, tagId: Id, projectsById: ReadonlyMap<Id, Project>): Section[] {
  const todos = db.todos.filter((t) => isLive(t) && t.tagIds.includes(tagId));
  return groupByContainer(db, todos, projectsById);
}

/** Single entry point: turn a list key into rendered sections. */
export function selectSections(db: Database, key: ListKey): Section[] {
  const list = parseListKey(key);
  const projectsById = new Map(db.projects.map((project) => [project.id, project]));
  switch (list.kind) {
    case 'inbox':
      return [
        {
          id: 'inbox',
          rows: todoRows(inboxTodos(db, projectsById)),
          container: {},
          reorderable: true,
        },
      ];
    case 'today':
      return todayList(db, projectsById);
    case 'upcoming':
      return upcomingList(db, projectsById);
    case 'anytime':
      return anytimeList(db, projectsById);
    case 'someday':
      return somedayList(db, projectsById);
    case 'logbook':
      return logbookList(db);
    case 'trash':
      return trashList(db);
    case 'project':
      return projectList(db, list.id);
    case 'area':
      return areaList(db, list.id);
    case 'tag':
      return tagList(db, list.id, projectsById);
  }
}

/** Badge numbers in the sidebar. Things only counts Inbox and Today. */
export function listCount(db: Database, key: ListKey): number {
  const list = parseListKey(key);
  const projectsById = new Map(db.projects.map((project) => [project.id, project]));
  if (list.kind === 'inbox') return inboxTodos(db, projectsById).length;
  if (list.kind === 'today') {
    return todayList(db, projectsById).reduce((sum, section) => sum + section.rows.length, 0);
  }
  if (list.kind === 'project') {
    return db.todos.filter((t) => t.projectId === list.id && t.status === 'open' && !t.trashed)
      .length;
  }
  return 0;
}

export function listTitle(db: Database, key: ListKey): string {
  const list = parseListKey(key);
  switch (list.kind) {
    case 'project':
      return db.projects.find((p) => p.id === list.id)?.title ?? 'Проект';
    case 'area':
      return db.areas.find((a) => a.id === list.id)?.title ?? 'Область';
    case 'tag':
      return db.tags.find((t) => t.id === list.id)?.title ?? 'Тег';
    default:
      return SMART_LIST_META[list.kind].title;
  }
}

export function projectProgress(db: Database, projectId: Id): number {
  const todos = db.todos.filter((t) => t.projectId === projectId && !t.trashed);
  if (!todos.length) return 0;
  const done = todos.filter((t) => t.status !== 'open').length;
  return done / todos.length;
}

export interface ProjectStats {
  open: number;
  total: number;
  progress: number;
}

/** Calculates every project's counters in one pass instead of scanning all todos per row. */
export function projectStats(db: Database): Map<Id, ProjectStats> {
  const counts = new Map<Id, { open: number; total: number }>();
  for (const todo of db.todos) {
    if (!todo.projectId || todo.trashed) continue;
    const current = counts.get(todo.projectId) ?? { open: 0, total: 0 };
    current.total += 1;
    if (todo.status === 'open') current.open += 1;
    counts.set(todo.projectId, current);
  }
  return new Map(
    [...counts].map(([id, count]) => [
      id,
      {
        ...count,
        progress: count.total ? (count.total - count.open) / count.total : 0,
      },
    ]),
  );
}
