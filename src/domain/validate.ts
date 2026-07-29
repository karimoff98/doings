import type {
  Area,
  ChecklistItem,
  Database,
  Heading,
  ItemStatus,
  Project,
  RepeatRule,
  RepeatUnit,
  Tag,
  Todo,
  When,
  WhenKind,
} from './types';

/**
 * Bumped whenever the stored shape changes in a way that needs conversion.
 * Every migration step lives in MIGRATIONS below.
 */
export const SCHEMA_VERSION = 5;

export interface ValidationResult {
  db: Database;
  /** Human readable notes about anything repaired or dropped. */
  issues: string[];
}

const WHEN_KINDS = new Set<WhenKind>(['unscheduled', 'today', 'evening', 'scheduled', 'someday']);
const STATUSES = new Set<ItemStatus>(['open', 'completed', 'canceled']);
const REPEAT_UNITS = new Set<RepeatUnit>(['day', 'week', 'month', 'year']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** `yyyy-MM-dd` that really exists in the calendar: 2026-99-99 is not a day. */
function isoDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const exists =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return exists ? value : undefined;
}

/** `HH:mm` inside a real clock: 47:80 is not a time. */
function clockTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || !HH_MM.test(value)) return undefined;
  const [hours, minutes] = value.split(':').map(Number);
  return hours <= 23 && minutes <= 59 ? value : undefined;
}

function timestamp(value: unknown): string {
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

function when(value: unknown): When {
  if (!isRecord(value)) return { kind: 'unscheduled' };
  const kind = WHEN_KINDS.has(value.kind as WhenKind) ? (value.kind as WhenKind) : 'unscheduled';
  if (kind !== 'scheduled') return { kind };
  const date = isoDay(value.date);
  // A scheduled item without a valid day cannot be placed on the timeline.
  return date ? { kind, date } : { kind: 'unscheduled' };
}

function status(value: unknown): ItemStatus {
  return STATUSES.has(value as ItemStatus) ? (value as ItemStatus) : 'open';
}

function repeat(value: unknown): RepeatRule | undefined {
  if (!isRecord(value)) return undefined;
  if (!REPEAT_UNITS.has(value.unit as RepeatUnit)) return undefined;
  const weekdays = Array.isArray(value.weekdays)
    ? value.weekdays.filter((day): day is number => typeof day === 'number' && day >= 1 && day <= 7)
    : undefined;
  return {
    unit: value.unit as RepeatUnit,
    every: Math.max(1, Math.round(num(value.every, 1))),
    ...(weekdays?.length ? { weekdays } : {}),
  };
}

function checklist(value: unknown, makeId: () => string): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    id: optionalId(item.id) ?? makeId(),
    title: str(item.title),
    done: bool(item.done),
  }));
}

function tagIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Repairs whatever can be repaired and reports the rest. A single broken row
 * must never cost the user the whole database.
 */
export function validateDatabase(raw: unknown): ValidationResult | null {
  const source = extractDatabase(raw);
  if (!isRecord(source)) return null;

  const required = ['areas', 'projects', 'headings', 'todos', 'tags'] as const;
  if (!required.every((key) => Array.isArray(source[key]))) return null;

  const issues: string[] = [];
  let generated = 0;
  const makeId = () => `gen_${(generated += 1)}_${Math.random().toString(36).slice(2, 8)}`;

  /** Keeps only records with a usable id and no duplicates. */
  const collect = <T extends { id: string }>(
    rows: unknown[],
    label: string,
    build: (row: Record<string, unknown>, id: string) => T,
  ): T[] => {
    const seen = new Set<string>();
    const result: T[] = [];
    let dropped = 0;
    for (const row of rows) {
      const id = isRecord(row) ? optionalId(row.id) : undefined;
      if (!id || seen.has(id)) {
        dropped += 1;
        continue;
      }
      seen.add(id);
      result.push(build(row as Record<string, unknown>, id));
    }
    if (dropped)
      issues.push(`${label}: пропущено записей без идентификатора или с дублем — ${dropped}`);
    return result;
  };

  const areas = collect<Area>(source.areas as unknown[], 'Области', (row, id) => ({
    id,
    title: str(row.title, 'Без названия'),
    tagIds: tagIds(row.tagIds),
    index: num(row.index),
    collapsed: bool(row.collapsed),
  }));

  const projects = collect<Project>(source.projects as unknown[], 'Проекты', (row, id) => ({
    id,
    title: str(row.title, 'Без названия'),
    notes: str(row.notes),
    areaId: optionalId(row.areaId),
    when: when(row.when),
    deadline: isoDay(row.deadline),
    tagIds: tagIds(row.tagIds),
    status: status(row.status),
    completedAt: optionalId(row.completedAt),
    trashed: bool(row.trashed),
    createdAt: timestamp(row.createdAt),
    index: num(row.index),
  }));

  const headings = collect<Heading>(source.headings as unknown[], 'Заголовки', (row, id) => ({
    id,
    projectId: str(row.projectId),
    title: str(row.title, 'Без названия'),
    index: num(row.index),
  }));

  const tags = collect<Tag>(source.tags as unknown[], 'Теги', (row, id) => ({
    id,
    title: str(row.title, 'без имени'),
    parentId: optionalId(row.parentId),
  }));

  const todos = collect<Todo>(source.todos as unknown[], 'Задачи', (row, id) => ({
    id,
    title: str(row.title),
    notes: str(row.notes),
    checklist: checklist(row.checklist, makeId),
    projectId: optionalId(row.projectId),
    areaId: optionalId(row.areaId),
    headingId: optionalId(row.headingId),
    when: when(row.when),
    deadline: isoDay(row.deadline),
    important: bool(row.important),
    reminder: clockTime(row.reminder),
    repeat: repeat(row.repeat),
    seriesId: optionalId(row.seriesId),
    trashedBy: optionalId(row.trashedBy),
    tagIds: tagIds(row.tagIds),
    status: status(row.status),
    completedAt: optionalId(row.completedAt),
    loggedAt: optionalId(row.loggedAt),
    trashed: bool(row.trashed),
    createdAt: timestamp(row.createdAt),
    index: num(row.index),
  }));

  // Dangling references confuse the list logic, so they are cleared here.
  const projectIds = new Set(projects.map((project) => project.id));
  const areaIds = new Set(areas.map((area) => area.id));
  const tagSet = new Set(tags.map((tag) => tag.id));

  let brokenHeadings = 0;
  const liveHeadings = headings.filter((heading) => {
    const ok = projectIds.has(heading.projectId);
    if (!ok) brokenHeadings += 1;
    return ok;
  });
  if (brokenHeadings) issues.push(`Заголовки без проекта удалены — ${brokenHeadings}`);
  const headingIds = new Set(liveHeadings.map((heading) => heading.id));
  const headingProject = new Map(
    liveHeadings.map((heading) => [heading.id, heading.projectId] as const),
  );

  let repairedLinks = 0;
  for (const todo of todos) {
    if (
      todo.headingId &&
      (!headingIds.has(todo.headingId) || headingProject.get(todo.headingId) !== todo.projectId)
    ) {
      todo.headingId = undefined;
      repairedLinks += 1;
    }
    if (todo.areaId && !areaIds.has(todo.areaId)) {
      todo.areaId = undefined;
      repairedLinks += 1;
    }
    const cleanTags = todo.tagIds.filter((tagId) => tagSet.has(tagId));
    if (cleanTags.length !== todo.tagIds.length) {
      todo.tagIds = cleanTags;
      repairedLinks += 1;
    }
  }
  for (const project of projects) {
    if (project.areaId && !areaIds.has(project.areaId)) {
      project.areaId = undefined;
      repairedLinks += 1;
    }
    const cleanTags = project.tagIds.filter((tagId) => tagSet.has(tagId));
    if (cleanTags.length !== project.tagIds.length) {
      project.tagIds = cleanTags;
      repairedLinks += 1;
    }
  }
  for (const area of areas) {
    const cleanTags = area.tagIds.filter((tagId) => tagSet.has(tagId));
    if (cleanTags.length !== area.tagIds.length) {
      area.tagIds = cleanTags;
      repairedLinks += 1;
    }
  }
  if (repairedLinks) issues.push(`Исправлено битых ссылок — ${repairedLinks}`);
  if (generated) issues.push(`Сгенерировано идентификаторов для пунктов списков — ${generated}`);

  return { db: { areas, projects, headings: liveHeadings, todos, tags }, issues };
}

/** Accepts a bare database, an export file or a persisted store snapshot. */
export function extractDatabase(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if (isRecord(raw.state) && 'db' in raw.state) return (raw.state as { db: unknown }).db;
  if ('db' in raw) return raw.db;
  return raw;
}

/**
 * Schema version of a file, defaulting to 0 for anything written before
 * versioning existed. Both the export format and the persisted snapshot keep it
 * at the top level.
 */
export function schemaVersionOf(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  return typeof raw.version === 'number' ? raw.version : 0;
}

type Migration = (db: Database) => Database;

/**
 * Migrations run in order for every version below the current one. Version 1
 * is the first documented shape: it fills in fields that early builds omitted.
 */
const MIGRATIONS: Record<number, Migration> = {
  1: (db) => ({
    ...db,
    todos: db.todos.map((todo) => ({
      ...todo,
      checklist: todo.checklist ?? [],
      tagIds: todo.tagIds ?? [],
      when: todo.when ?? { kind: 'unscheduled' },
      trashed: todo.trashed ?? false,
    })),
    projects: db.projects.map((project) => ({
      ...project,
      tagIds: project.tagIds ?? [],
      when: project.when ?? { kind: 'unscheduled' },
      trashed: project.trashed ?? false,
    })),
  }),
  // Version 2 was briefly used by a development build. Keep the number
  // reserved so databases opened by it remain readable after the feature was
  // removed; normal validation drops its unused fields.
  2: (db) => db,
  3: (db) => ({
    ...db,
    // Everything completed by earlier builds already lived in the Logbook.
    todos: db.todos.map((todo) =>
      todo.status === 'completed' || todo.status === 'canceled'
        ? { ...todo, loggedAt: todo.loggedAt ?? todo.completedAt ?? todo.createdAt }
        : { ...todo, loggedAt: undefined },
    ),
  }),
  // Development builds could hot-reload after announcing v3 but before the
  // migration ran. Repeating the idempotent repair makes those files safe too.
  4: (db) => ({
    ...db,
    todos: db.todos.map((todo) =>
      todo.status === 'completed' || todo.status === 'canceled'
        ? { ...todo, loggedAt: todo.loggedAt ?? todo.completedAt ?? todo.createdAt }
        : todo,
    ),
  }),
  // The first v4 validator accidentally discarded the new field before the
  // migration result was persisted. Run the repair once more for those files.
  5: (db) => ({
    ...db,
    todos: db.todos.map((todo) =>
      todo.status === 'completed' || todo.status === 'canceled'
        ? { ...todo, loggedAt: todo.loggedAt ?? todo.completedAt ?? todo.createdAt }
        : todo,
    ),
  }),
};

export function migrateDatabase(
  db: Database,
  fromVersion: number,
): { db: Database; steps: number[] } {
  let result = db;
  const steps: number[] = [];
  for (let version = fromVersion + 1; version <= SCHEMA_VERSION; version += 1) {
    const migration = MIGRATIONS[version];
    if (!migration) continue;
    result = migration(result);
    steps.push(version);
  }
  return { db: result, steps };
}

export type LoadOutcome =
  | { ok: true; db: Database; issues: string[] }
  | { ok: false; reason: 'invalid' }
  /** Written by a newer app: normalising it here would strip fields we do not know. */
  | { ok: false; reason: 'newer'; version: number };

/** One call for the whole pipeline: check version, unwrap, migrate, validate. */
export function loadDatabase(raw: unknown): LoadOutcome {
  const version = schemaVersionOf(raw);
  if (version > SCHEMA_VERSION) return { ok: false, reason: 'newer', version };

  const validated = validateDatabase(raw);
  if (!validated) return { ok: false, reason: 'invalid' };

  const { db, steps } = migrateDatabase(validated.db, version);
  return {
    ok: true,
    db,
    issues: steps.length
      ? [...validated.issues, `Схема обновлена до версии ${SCHEMA_VERSION}`]
      : validated.issues,
  };
}
