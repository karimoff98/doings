export type Id = string;

/** ISO calendar day, `yyyy-MM-dd`. Deliberately not a Date: a due day has no timezone. */
export type IsoDay = string;

/**
 * "When" in Things terms: when an item becomes actionable.
 * - `unscheduled` -> lives in Anytime
 * - `today` / `evening` -> Today list (evening is a separate section)
 * - `scheduled` -> Upcoming until `date` arrives, then Today
 * - `someday` -> Someday list, hidden from Anytime
 */
export type WhenKind = 'unscheduled' | 'today' | 'evening' | 'scheduled' | 'someday';

export interface When {
  kind: WhenKind;
  /** Set only when kind is `scheduled`. */
  date?: IsoDay;
}

export type ItemStatus = 'open' | 'completed' | 'canceled';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

/**
 * A repeating to-do spawns its next copy when the current one is completed,
 * the way Things does it.
 */
export interface RepeatRule {
  unit: RepeatUnit;
  /** Interval: every N days / weeks / months / years. */
  every: number;
  /** Weekly rules only: ISO weekdays (1 = Monday). Empty means "same weekday". */
  weekdays?: number[];
}

export interface ChecklistItem {
  id: Id;
  title: string;
  done: boolean;
}

export interface Todo {
  id: Id;
  title: string;
  notes: string;
  checklist: ChecklistItem[];
  /** A todo belongs to a project, or directly to an area, or to neither (Inbox). */
  projectId?: Id;
  areaId?: Id;
  headingId?: Id;
  when: When;
  /** Hard due date, shown as a red flag when close or overdue. */
  deadline?: IsoDay;
  /** `HH:mm`, only meaningful together with a scheduled/today date. */
  reminder?: string;
  repeat?: RepeatRule;
  /** Ties every copy of a repeating todo to the original. */
  seriesId?: Id;
  /**
   * Id of the project whose deletion sent this todo to the trash. Restoring the
   * project only brings back its own casualties, not todos deleted separately.
   */
  trashedBy?: Id;
  tagIds: Id[];
  status: ItemStatus;
  completedAt?: string;
  trashed: boolean;
  createdAt: string;
  /** Manual sort position inside its list. Lower comes first. */
  index: number;
}

export interface Heading {
  id: Id;
  projectId: Id;
  title: string;
  index: number;
}

export interface Project {
  id: Id;
  title: string;
  notes: string;
  areaId?: Id;
  when: When;
  deadline?: IsoDay;
  tagIds: Id[];
  status: ItemStatus;
  completedAt?: string;
  trashed: boolean;
  createdAt: string;
  index: number;
}

export interface Area {
  id: Id;
  title: string;
  tagIds: Id[];
  index: number;
  collapsed: boolean;
}

export interface Tag {
  id: Id;
  title: string;
  parentId?: Id;
}

export interface Database {
  areas: Area[];
  projects: Project[];
  headings: Heading[];
  todos: Todo[];
  tags: Tag[];
}

/** Smart lists that always exist, in sidebar order. */
export const SMART_LISTS = [
  'inbox',
  'today',
  'upcoming',
  'anytime',
  'someday',
  'logbook',
  'trash',
] as const;

export type SmartList = (typeof SMART_LISTS)[number];

/**
 * Selected list, encoded as a string so it can be persisted and compared cheaply.
 * Either a smart list name, or `project:<id>` / `area:<id>` / `tag:<id>`.
 */
export type ListKey = SmartList | `project:${string}` | `area:${string}` | `tag:${string}`;

export type ParsedList =
  | { kind: SmartList }
  | { kind: 'project'; id: Id }
  | { kind: 'area'; id: Id }
  | { kind: 'tag'; id: Id };

export function parseListKey(key: ListKey): ParsedList {
  const sep = key.indexOf(':');
  if (sep === -1) return { kind: key as SmartList };
  const prefix = key.slice(0, sep);
  const id = key.slice(sep + 1);
  if (prefix === 'project' || prefix === 'area' || prefix === 'tag') {
    return { kind: prefix, id };
  }
  throw new Error(`Unknown list key: ${key}`);
}

/** A row in a list can be a todo or (in area views) a project. */
export type Row =
  | { kind: 'todo'; todo: Todo }
  | { kind: 'project'; project: Project; openCount: number; totalCount: number };

/** Where a todo lives: a project (optionally under a heading), an area, or nowhere. */
export interface Container {
  projectId?: Id;
  areaId?: Id;
  headingId?: Id;
}

export interface Section {
  id: string;
  title?: string;
  /** Right-hand side of a section header, e.g. a weekday. */
  subtitle?: string;
  rows: Row[];
  /** Completed/canceled items render muted. */
  muted?: boolean;
  /** Dropping a todo here re-homes it (grouped lists, project headings). */
  container?: Container;
  /** Dropping a todo here re-schedules it (Today, Upcoming). */
  when?: When;
  /** Sections without this cannot accept drops. */
  reorderable?: boolean;
  /** Exists only as a drop target: hidden while nothing is being dragged. */
  placeholder?: boolean;
}
