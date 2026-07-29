import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { tomorrow } from '../domain/dates';
import { selectSections } from '../domain/lists';
import { nextRepeatCopy } from '../domain/repeat';
import { SCHEMA_VERSION, loadDatabase, validateDatabase } from '../domain/validate';
import { parseListKey } from '../domain/types';
import type {
  Area,
  ChecklistItem,
  Database,
  Heading,
  Id,
  IsoDay,
  ListKey,
  Container,
  Project,
  RepeatRule,
  Todo,
  When,
} from '../domain/types';
import { requestMigrationBackup } from './backups';
import { appStorage, blockWrites, drainStorageErrors, setStorageErrorHandler } from './persistence';
import { createDemoDatabase, createEmptyDatabase, newId } from './seed';

export type Theme = 'system' | 'light' | 'dark';

/** Where a todo should live after a move. */
export type MoveTarget = Container;

export interface StoreState {
  db: Database;
  past: Database[];
  future: Database[];

  selectedList: ListKey;
  /** Focus of the selection: the row keyboard actions and the editor act on. */
  selectedTodoId?: Id;
  /** Fixed end of a shift-range; stays put while the focus moves. */
  selectionAnchor?: Id;
  /** Everything currently selected; single click leaves exactly one id here. */
  selection: Id[];
  editingTodoId?: Id;
  /** Set right after creation so the title field can grab focus. */
  freshTodoId?: Id;
  /** Panel the editor should open automatically, set by keyboard shortcuts. */
  autoPanel?: 'when' | 'deadline' | 'tags' | 'repeat' | 'reminder';
  theme: Theme;
  /** Tags picked in the list's tag bar; empty means no filtering. */
  tagFilter: Id[];
  quickFindOpen: boolean;
  moveDialogOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  /**
   * The first-run introduction is modal: while it is up, keyboard shortcuts and
   * menu commands must not reach the app behind it. Session-only, never stored.
   */
  onboardingOpen: boolean;
  /** Interactive spotlight tour shown after the first-run introduction. */
  tourOpen: boolean;
  tourStep: number;
  /** Set when saving or loading the database failed; shown as a banner. */
  storageError?: string;
  /** Hydration ended with an error: the app must still render something. */
  hydrationFailed: boolean;
  /** Notes from validation and migration of the loaded file. */
  storageIssues: string[];
  dismissStorageNotice: () => void;

  selectList: (key: ListKey) => void;
  selectTodo: (id?: Id) => void;
  /** ⌘-click: add or remove a single row from the selection. */
  toggleSelection: (id: Id) => void;
  /**
   * ⇧-click or ⇧↑/⇧↓: select a range. `focus` becomes the moving end;
   * `merge` keeps rows that were picked earlier with ⌘-click.
   */
  selectRange: (ids: Id[], focus: Id, merge?: boolean) => void;
  openEditor: (id: Id) => void;
  openEditorPanel: (id: Id, panel: NonNullable<StoreState['autoPanel']>) => void;
  clearAutoPanel: () => void;
  closeEditor: () => void;
  setTheme: (theme: Theme) => void;
  toggleTagFilter: (tagId: Id) => void;
  clearTagFilter: () => void;
  setQuickFind: (open: boolean) => void;
  setMoveDialog: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  setSettings: (open: boolean) => void;
  setOnboarding: (open: boolean) => void;
  startTour: () => void;
  stopTour: () => void;
  setTourStep: (step: number) => void;

  createTodo: (options?: {
    title?: string;
    target?: MoveTarget;
    when?: When;
    deadline?: IsoDay;
    reminder?: string;
    important?: boolean;
    tagIds?: Id[];
  }) => Id;
  updateTodo: (id: Id, patch: Partial<Omit<Todo, 'id'>>) => void;
  /**
   * Title/notes edits from the open editor. Coalesced into one undo step per
   * session, so a paragraph of typing is a single ⌘Z, not one per character.
   */
  commitTodoText: (id: Id, patch: { title?: string; notes?: string }) => void;
  /** All mutators below take one id or many, so multi-select needs no special casing. */
  setWhen: (ids: Id | Id[], when: When) => void;
  setDeadline: (ids: Id | Id[], deadline?: IsoDay) => void;
  setImportant: (ids: Id | Id[], important: boolean) => void;
  setRepeat: (ids: Id | Id[], repeat?: RepeatRule) => void;
  setReminder: (ids: Id | Id[], reminder?: string) => void;
  toggleTag: (ids: Id | Id[], tagId: Id) => void;
  createTag: (title: string) => Id;
  renameTag: (id: Id, title: string) => void;
  /** Removes the tag everywhere, including from the todos wearing it. */
  removeTag: (id: Id) => void;
  completeTodo: (ids: Id | Id[]) => void;
  uncompleteTodo: (ids: Id | Id[]) => void;
  cancelTodo: (ids: Id | Id[]) => void;
  trashTodo: (ids: Id | Id[]) => void;
  restoreTodo: (ids: Id | Id[]) => void;
  emptyTrash: () => void;
  moveTodo: (ids: Id | Id[], target: MoveTarget) => void;
  /** ⌘D: copies land right below their originals and become the new selection. */
  duplicateTodo: (ids: Id | Id[]) => Id[];
  /**
   * Result of a drag and drop: re-home, re-schedule and reorder in one
   * undoable step.
   */
  dropTodos: (ids: Id[], options: { container?: Container; when?: When; order?: Id[] }) => void;
  /** Ids currently being dragged; transient, never persisted. */
  draggingIds: Id[];
  setDragging: (ids: Id[]) => void;
  endDrag: () => void;

  /** `afterId` inserts right below that item instead of at the end. */
  addChecklistItem: (todoId: Id, options?: { title?: string; afterId?: Id }) => Id;
  updateChecklistItem: (todoId: Id, itemId: Id, patch: Partial<ChecklistItem>) => void;
  removeChecklistItem: (todoId: Id, itemId: Id) => void;

  /** Newly created project or area, so its title field can grab focus once. */
  freshListId?: Id;
  /**
   * A just-created project the user has not named or filled yet. Leaving it
   * throws it away, so an abandoned "new project" never lingers as a blank row.
   * Session-only: it is not part of the persisted state.
   */
  draftProjectId?: Id;
  /** Same lifecycle as a draft project, but for a newly created empty area. */
  draftAreaId?: Id;
  clearFreshList: () => void;
  /** Asks the list header to focus its title, used by "Переименовать". */
  focusListTitle: (id: Id) => void;
  createProject: (options?: { title?: string; areaId?: Id }) => Id;
  updateProject: (id: Id, patch: Partial<Omit<Project, 'id'>>) => void;
  completeProject: (id: Id) => void;
  trashProject: (id: Id) => void;
  restoreProject: (id: Id) => void;
  createArea: (title?: string) => Id;
  updateArea: (id: Id, patch: Partial<Omit<Area, 'id'>>) => void;
  trashArea: (id: Id) => void;
  createHeading: (projectId: Id, title?: string) => Id;
  updateHeading: (id: Id, patch: Partial<Omit<Heading, 'id'>>) => void;
  removeHeading: (id: Id) => void;

  /** Manual order in the sidebar; ids keep the slots the group already occupies. */
  reorderProjects: (orderedIds: Id[]) => void;
  reorderAreas: (orderedIds: Id[]) => void;
  /** Moves a project between areas (or out of any area). */
  moveProject: (id: Id, areaId?: Id) => void;

  undo: () => void;
  redo: () => void;
  /** Wipes everything the user has, leaving a valid empty database. */
  resetToEmpty: () => void;
  /** Loads the example content, only ever on an explicit request. */
  loadDemoData: () => void;
  /** Replaces everything with a database read from a file. */
  importDatabase: (db: Database) => void;
}

/**
 * Files can be edited by hand or come from another version, so everything goes
 * through the version check, migration and validation before it replaces the
 * live database.
 */
export function parseDatabase(raw: unknown): Database | null {
  const outcome = loadDatabase(raw);
  return outcome.ok ? outcome.db : null;
}

const UNDO_LIMIT = 60;

function nextIndex(items: { index: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.index), 0) + 1;
}

function topIndex(items: { index: number }[]): number {
  return items.reduce((min, item) => Math.min(min, item.index), 0) - 1;
}

/** Defaults for a new todo, derived from the list the user is looking at. */
function defaultsForList(key: ListKey): {
  when: When;
  target: MoveTarget;
  tagIds: Id[];
  important: boolean;
} {
  const list = parseListKey(key);
  switch (list.kind) {
    case 'today':
      return { when: { kind: 'today' }, target: {}, tagIds: [], important: false };
    case 'important':
      return { when: { kind: 'unscheduled' }, target: {}, tagIds: [], important: true };
    case 'upcoming':
      // Upcoming only shows future days, so today's date would hide the new todo.
      return {
        when: { kind: 'scheduled', date: tomorrow() },
        target: {},
        tagIds: [],
        important: false,
      };
    case 'someday':
      return { when: { kind: 'someday' }, target: {}, tagIds: [], important: false };
    case 'project':
      return {
        when: { kind: 'unscheduled' },
        target: { projectId: list.id },
        tagIds: [],
        important: false,
      };
    case 'area':
      return {
        when: { kind: 'unscheduled' },
        target: { areaId: list.id },
        tagIds: [],
        important: false,
      };
    case 'tag':
      return {
        when: { kind: 'unscheduled' },
        target: {},
        tagIds: [list.id],
        important: false,
      };
    default:
      return { when: { kind: 'unscheduled' }, target: {}, tagIds: [], important: false };
  }
}

/**
 * Undo can remove the project or area the user is looking at. Falling back to
 * Today keeps the app out of a dead end where nothing renders.
 */
function validList(db: Database, key: ListKey): ListKey {
  const list = parseListKey(key);
  if (list.kind === 'project' && !db.projects.some((p) => p.id === list.id && !p.trashed)) {
    return 'today';
  }
  if (list.kind === 'area' && !db.areas.some((a) => a.id === list.id)) return 'today';
  if (list.kind === 'tag' && !db.tags.some((t) => t.id === list.id)) return 'today';
  return key;
}

/** True when another live todo of the same repeat series already exists. */
function hasOpenSibling(db: Database, todo: Todo): boolean {
  const series = todo.seriesId ?? todo.id;
  return db.todos.some(
    (other) =>
      other.id !== todo.id &&
      other.status === 'open' &&
      !other.trashed &&
      (other.seriesId ?? other.id) === series,
  );
}

/** Nothing the user actually typed: safe to throw away when the editor closes. */
function isBlank(todo: Todo): boolean {
  return (
    !todo.title.trim() && !todo.notes.trim() && !todo.checklist.some((item) => item.title.trim())
  );
}

/** Only a brand-new task that still matches the list defaults is safe to discard. */
function isUntouchedDraft(todo: Todo, listKey: ListKey): boolean {
  if (!isBlank(todo)) return false;
  if (todo.deadline || todo.reminder || todo.repeat || todo.status !== 'open' || todo.trashed) {
    return false;
  }
  const defaults = defaultsForList(listKey);
  const sameWhen =
    todo.when.kind === defaults.when.kind &&
    (todo.when.kind !== 'scheduled' || todo.when.date === defaults.when.date);
  const sameTags =
    todo.tagIds.length === defaults.tagIds.length &&
    todo.tagIds.every((id) => defaults.tagIds.includes(id));
  return (
    sameWhen &&
    sameTags &&
    Boolean(todo.important) === defaults.important &&
    todo.projectId === defaults.target.projectId &&
    todo.areaId === defaults.target.areaId &&
    todo.headingId === defaults.target.headingId
  );
}

/** A project with any user-entered property is real even if its title is blank. */
function isAbandonedProject(db: Database, project: Project): boolean {
  return (
    !project.title.trim() &&
    !project.notes.trim() &&
    project.when.kind === 'unscheduled' &&
    !project.deadline &&
    project.tagIds.length === 0 &&
    !db.todos.some((todo) => todo.projectId === project.id) &&
    !db.headings.some((heading) => heading.projectId === project.id)
  );
}

/** True when the todo sits on a concrete day, so it can carry a time or a repeat. */
function hasDay(todo: Todo): boolean {
  return (
    todo.when.kind === 'scheduled' || todo.when.kind === 'today' || todo.when.kind === 'evening'
  );
}

/** Dev-only handle so the store can be inspected from the browser console. */
function exposeForDebug(store: unknown) {
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__store = store;
  }
}

export const useStore = create<StoreState>()(
  persist(
    immer((set, get) => {
      /**
       * Marks the current coalescing session. While it stays the same, text
       * edits fold into one undo step; any other mutation clears it, so the
       * next keystroke opens a fresh step.
       */
      let coalesceTag: string | null = null;

      /** Wraps a mutation so every change is undoable. */
      const mutate = (recipe: (db: Database) => void) => {
        coalesceTag = null;
        const snapshot = get().db;
        set((state) => {
          state.past.push(snapshot);
          if (state.past.length > UNDO_LIMIT) state.past.shift();
          state.future = [];
          recipe(state.db);
        });
      };

      /**
       * Like `mutate`, but consecutive calls sharing a tag reuse the first
       * snapshot instead of stacking one per keystroke. Typing a title and a
       * note in the same editor collapses into a single undoable step.
       */
      const mutateCoalesced = (tag: string, recipe: (db: Database) => void) => {
        if (tag === coalesceTag) {
          set((state) => {
            state.future = [];
            recipe(state.db);
          });
          return;
        }
        const snapshot = get().db;
        coalesceTag = tag;
        set((state) => {
          state.past.push(snapshot);
          if (state.past.length > UNDO_LIMIT) state.past.shift();
          state.future = [];
          recipe(state.db);
        });
      };

      /** Ends the current text-editing session so the next edit is a new step. */
      const endTextSession = () => {
        coalesceTag = null;
      };

      /**
       * Swaps the whole database and clears everything that pointed into the old
       * one. Undo history keeps the previous database, so even a full wipe can be
       * taken back with ⌘Z within the session.
       */
      const replaceDatabase = (next: Database) => {
        endTextSession();
        const previous = get().db;
        set((state) => {
          state.past.push(previous);
          if (state.past.length > UNDO_LIMIT) state.past.shift();
          state.future = [];
          state.db = next;
          state.selectedList = validList(next, state.selectedList);
          state.selectedTodoId = undefined;
          state.selectionAnchor = undefined;
          state.selection = [];
          state.editingTodoId = undefined;
          state.freshTodoId = undefined;
          state.draftProjectId = undefined;
          state.draftAreaId = undefined;
          state.tagFilter = [];
        });
      };

      const findTodo = (db: Database, id: Id) => db.todos.find((t) => t.id === id);

      /**
       * For mutations that can delete whatever the user is looking at: the
       * selected list must never point at something that no longer exists.
       */
      const mutateAndKeepListValid = (recipe: (db: Database) => void) => {
        mutate(recipe);
        set((state) => {
          state.selectedList = validList(state.db, state.selectedList);
        });
      };

      /**
       * Runs one recipe over one or many todos inside a single undo step, then
       * drops from the selection whatever left the current list — otherwise the
       * batch toolbar keeps hovering over rows nobody can see.
       */
      const mutateEach = (ids: Id | Id[], recipe: (todo: Todo, db: Database) => void) => {
        const list = Array.isArray(ids) ? ids : [ids];
        mutate((db) => {
          for (const id of list) {
            const todo = findTodo(db, id);
            if (todo) recipe(todo, db);
          }
        });
        set((state) => {
          if (!state.selection.length) return;
          const rows = selectSections(state.db, state.selectedList).flatMap(
            (section) => section.rows,
          );
          const availableTags = new Set(
            rows.flatMap((row) => (row.kind === 'todo' ? row.todo.tagIds : [])),
          );
          const activeTags = state.tagFilter.filter((tagId) => availableTags.has(tagId));
          const visible = new Set(
            rows.flatMap((row) => {
              if (row.kind !== 'todo') return [];
              if (
                activeTags.length &&
                !row.todo.tagIds.some((tagId) => activeTags.includes(tagId))
              ) {
                return [];
              }
              return [row.todo.id];
            }),
          );
          state.selection = state.selection.filter((id) => visible.has(id));
          if (state.selectedTodoId && !visible.has(state.selectedTodoId)) {
            state.selectedTodoId = state.selection[state.selection.length - 1];
          }
          if (state.selectionAnchor && !visible.has(state.selectionAnchor)) {
            state.selectionAnchor = state.selectedTodoId;
          }
          if (state.editingTodoId && !visible.has(state.editingTodoId)) {
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
            state.autoPanel = undefined;
          }
        });
      };

      return {
        // A new installation starts empty; example content is a separate,
        // explicit choice in the settings.
        db: createEmptyDatabase(),
        past: [],
        future: [],

        selectedList: 'today',
        selectedTodoId: undefined,
        selectionAnchor: undefined,
        selection: [],
        editingTodoId: undefined,
        freshTodoId: undefined,
        autoPanel: undefined,
        theme: 'system',
        tagFilter: [],
        quickFindOpen: false,
        moveDialogOpen: false,
        shortcutsOpen: false,
        settingsOpen: false,
        onboardingOpen: false,
        tourOpen: false,
        tourStep: 0,
        storageError: undefined,
        storageIssues: [],
        hydrationFailed: false,

        dismissStorageNotice: () =>
          set((state) => {
            state.storageError = undefined;
            state.storageIssues = [];
          }),

        selectList: (key) =>
          set((state) => {
            // A brand-new project the user opened but never named or filled
            // would otherwise stay behind as a blank row. Drop it on the way out.
            const draftId = state.draftProjectId;
            if (draftId && key !== `project:${draftId}`) {
              const draft = state.db.projects.find((p) => p.id === draftId);
              const abandoned = draft && isAbandonedProject(state.db, draft);
              if (abandoned) {
                state.db.projects = state.db.projects.filter((p) => p.id !== draftId);
              }
              state.draftProjectId = undefined;
            }
            const draftAreaId = state.draftAreaId;
            if (draftAreaId && key !== `area:${draftAreaId}`) {
              const draft = state.db.areas.find((area) => area.id === draftAreaId);
              const abandoned =
                draft &&
                !draft.title.trim() &&
                !state.db.projects.some((project) => project.areaId === draftAreaId) &&
                !state.db.todos.some((todo) => todo.areaId === draftAreaId);
              if (abandoned) {
                state.db.areas = state.db.areas.filter((area) => area.id !== draftAreaId);
              }
              state.draftAreaId = undefined;
            }
            state.selectedList = validList(state.db, key);
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.selection = [];
            // A filter that survived the jump to another list is confusing.
            state.tagFilter = [];
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
            state.autoPanel = undefined;
          }),

        selectTodo: (id) =>
          set((state) => {
            state.selectedTodoId = id;
            state.selectionAnchor = id;
            state.selection = id ? [id] : [];
            if (state.editingTodoId && state.editingTodoId !== id) {
              state.editingTodoId = undefined;
            }
          }),

        toggleSelection: (id) =>
          set((state) => {
            state.editingTodoId = undefined;
            if (state.selection.includes(id)) {
              state.selection = state.selection.filter((item) => item !== id);
              state.selectedTodoId = state.selection[state.selection.length - 1];
            } else {
              state.selection.push(id);
              state.selectedTodoId = id;
            }
            state.selectionAnchor = id;
          }),

        selectRange: (ids, focus, merge) =>
          set((state) => {
            state.selection = merge
              ? [...state.selection, ...ids.filter((id) => !state.selection.includes(id))]
              : [...ids];
            state.selectedTodoId = focus;
            if (!state.selectionAnchor) state.selectionAnchor = ids[0];
            state.editingTodoId = undefined;
          }),

        openEditor: (id) =>
          set((state) => {
            const todo = state.db.todos.find((item) => item.id === id);
            if (!todo || todo.trashed) return;
            state.selectedTodoId = id;
            state.selection = [id];
            state.editingTodoId = id;
          }),

        openEditorPanel: (id, panel) =>
          set((state) => {
            const todo = state.db.todos.find((item) => item.id === id);
            if (!todo || todo.trashed) return;
            state.selectedTodoId = id;
            if (!state.selection.includes(id)) state.selection = [id];
            state.editingTodoId = id;
            state.autoPanel = panel;
          }),

        clearAutoPanel: () => set((state) => void (state.autoPanel = undefined)),

        closeEditor: () => {
          endTextSession();
          set((state) => {
            const id = state.editingTodoId;
            const fresh = Boolean(id && state.freshTodoId === id);
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
            state.autoPanel = undefined;
            // Drop a todo that was created and left completely empty. Blank
            // checklist rows do not count as content.
            const todo = id ? state.db.todos.find((t) => t.id === id) : undefined;
            if (todo && fresh && isUntouchedDraft(todo, state.selectedList)) {
              state.db.todos = state.db.todos.filter((t) => t.id !== todo.id);
              state.selectedTodoId = undefined;
              state.selection = [];
            }
          });
        },

        setTheme: (theme) => set((state) => void (state.theme = theme)),

        toggleTagFilter: (tagId) =>
          set((state) => {
            state.tagFilter = state.tagFilter.includes(tagId)
              ? state.tagFilter.filter((id) => id !== tagId)
              : [...state.tagFilter, tagId];
          }),

        clearTagFilter: () => set((state) => void (state.tagFilter = [])),
        setQuickFind: (open) => set((state) => void (state.quickFindOpen = open)),
        setMoveDialog: (open) => set((state) => void (state.moveDialogOpen = open)),
        setShortcuts: (open) => set((state) => void (state.shortcutsOpen = open)),
        setSettings: (open) => set((state) => void (state.settingsOpen = open)),
        setOnboarding: (open) => set((state) => void (state.onboardingOpen = open)),
        startTour: () =>
          set((state) => {
            state.quickFindOpen = false;
            state.moveDialogOpen = false;
            state.shortcutsOpen = false;
            state.settingsOpen = false;
            state.tourStep = 0;
            state.tourOpen = true;
          }),
        stopTour: () =>
          set((state) => {
            state.tourOpen = false;
            state.tourStep = 0;
          }),
        setTourStep: (step) => set((state) => void (state.tourStep = Math.max(0, step))),

        createTodo: (options) => {
          const id = newId('td');
          // The Logbook and the Trash cannot hold a new todo: fall back to the Inbox
          // so the row the user is about to type into is actually visible.
          const listKind = parseListKey(get().selectedList).kind;
          if (listKind === 'logbook' || listKind === 'trash') {
            set((state) => void (state.selectedList = 'inbox'));
          }
          // Leaving an untouched todo behind would litter the list.
          const previous = get().editingTodoId;
          if (previous) {
            set((state) => {
              const stale = state.db.todos.find((t) => t.id === previous);
              if (stale && isBlank(stale)) {
                state.db.todos = state.db.todos.filter((t) => t.id !== previous);
              }
            });
          }

          const defaults = defaultsForList(get().selectedList);
          const target = options?.target ?? defaults.target;
          const inheritedTags = options?.tagIds ?? [
            ...new Set([...defaults.tagIds, ...get().tagFilter]),
          ];
          mutate((db) => {
            const todo: Todo = {
              id,
              title: options?.title ?? '',
              notes: '',
              checklist: [],
              when: options?.when ?? defaults.when,
              deadline: options?.deadline,
              reminder: options?.reminder,
              important: options?.important ?? defaults.important,
              tagIds: inheritedTags,
              status: 'open',
              trashed: false,
              createdAt: new Date().toISOString(),
              index: topIndex(db.todos),
              ...target,
            };
            db.todos.push(todo);
          });
          set((state) => {
            state.selectedTodoId = id;
            state.selection = [id];
            state.editingTodoId = id;
            state.freshTodoId = id;
          });
          return id;
        },

        updateTodo: (id, patch) =>
          mutate((db) => {
            const todo = findTodo(db, id);
            if (todo) Object.assign(todo, patch);
          }),

        commitTodoText: (id, patch) =>
          mutateCoalesced(`text:${id}`, (db) => {
            const todo = findTodo(db, id);
            if (todo) Object.assign(todo, patch);
          }),

        setWhen: (ids, when) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.when = when.kind === 'scheduled' ? { ...when } : { kind: when.kind };
            // A reminder without a day has nothing to fire on.
            if (when.kind === 'someday' || when.kind === 'unscheduled') todo.reminder = undefined;
          }),

        setDeadline: (ids, deadline) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.deadline = deadline;
          }),

        setImportant: (ids, important) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.important = important;
          }),

        setRepeat: (ids, repeat) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.repeat = repeat ? { ...repeat } : undefined;
            // A repeating todo needs a day to repeat from.
            if (repeat && !hasDay(todo)) todo.when = { kind: 'today' };
          }),

        setReminder: (ids, reminder) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.reminder = reminder;
            if (reminder && !hasDay(todo)) todo.when = { kind: 'today' };
          }),

        toggleTag: (ids, tagId) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.tagIds = todo.tagIds.includes(tagId)
              ? todo.tagIds.filter((t) => t !== tagId)
              : [...todo.tagIds, tagId];
          }),

        createTag: (title) => {
          const id = newId('tag');
          mutate((db) => {
            db.tags.push({ id, title });
          });
          return id;
        },

        renameTag: (id, title) =>
          mutate((db) => {
            const tag = db.tags.find((item) => item.id === id);
            if (tag) tag.title = title;
          }),

        removeTag: (id) =>
          mutateAndKeepListValid((db) => {
            db.tags = db.tags.filter((tag) => tag.id !== id);
            for (const todo of db.todos) {
              if (todo.tagIds.includes(id)) {
                todo.tagIds = todo.tagIds.filter((tagId) => tagId !== id);
              }
            }
            for (const project of db.projects) {
              project.tagIds = project.tagIds.filter((tagId) => tagId !== id);
            }
            for (const area of db.areas) {
              area.tagIds = area.tagIds.filter((tagId) => tagId !== id);
            }
          }),

        completeTodo: (ids) =>
          mutateEach(ids, (todo, db) => {
            // Trashed items cannot be worked on, and completing an already
            // completed todo would spawn a second copy of a repeating one.
            if (todo.trashed || todo.status !== 'open') return;
            todo.status = 'completed';
            todo.completedAt = new Date().toISOString();
            const spawned = nextRepeatCopy(todo, newId);
            if (spawned) db.todos.push(spawned);
          }),

        uncompleteTodo: (ids) =>
          mutateEach(ids, (todo, db) => {
            if (todo.trashed) return;
            todo.status = 'open';
            todo.completedAt = undefined;
            // Reopening a repeating todo takes back the copy its completion spawned.
            if (!todo.repeat) return;
            const series = todo.seriesId ?? todo.id;
            db.todos = db.todos.filter(
              (other) =>
                other.id === todo.id ||
                other.status !== 'open' ||
                !other.repeat ||
                (other.seriesId ?? other.id) !== series ||
                other.createdAt <= todo.createdAt,
            );
          }),

        cancelTodo: (ids) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.status = todo.status === 'canceled' ? 'open' : 'canceled';
            todo.completedAt = todo.status === 'canceled' ? new Date().toISOString() : undefined;
          }),

        trashTodo: (ids) =>
          mutateEach(ids, (todo) => {
            todo.trashed = true;
          }),

        restoreTodo: (ids) =>
          mutateEach(ids, (todo) => {
            todo.trashed = false;
            todo.trashedBy = undefined;
          }),

        emptyTrash: () => {
          const removedProjects = new Set(
            get()
              .db.projects.filter((project) => project.trashed)
              .map((project) => project.id),
          );
          mutateAndKeepListValid((db) => {
            db.todos = db.todos.filter((t) => !t.trashed);
            db.projects = db.projects.filter((p) => !p.trashed);
            db.headings = db.headings.filter((heading) => !removedProjects.has(heading.projectId));
          });
          set((state) => {
            state.selection = [];
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.editingTodoId = undefined;
          });
        },

        moveTodo: (ids, target) =>
          mutateEach(ids, (todo) => {
            if (todo.trashed) return;
            todo.projectId = target.projectId;
            todo.areaId = target.areaId;
            todo.headingId = target.headingId;
          }),

        duplicateTodo: (ids) => {
          const list = Array.isArray(ids) ? ids : [ids];
          const copies: Id[] = [];
          mutate((db) => {
            for (const id of list) {
              const source = findTodo(db, id);
              if (!source || source.trashed) continue;
              const copyId = newId('td');
              copies.push(copyId);
              db.todos.push({
                ...source,
                id: copyId,
                checklist: source.checklist.map((item) => ({
                  ...item,
                  id: newId('ci'),
                })),
                tagIds: [...source.tagIds],
                repeat: source.repeat ? { ...source.repeat } : undefined,
                // A copy starts its own repeat series and its own history.
                seriesId: undefined,
                status: 'open',
                completedAt: undefined,
                createdAt: new Date().toISOString(),
                index: source.index + 0.5,
              });
            }
          });
          if (copies.length) {
            set((state) => {
              state.selection = copies;
              state.selectedTodoId = copies[copies.length - 1];
              state.selectionAnchor = copies[0];
              state.editingTodoId = undefined;
            });
          }
          return copies;
        },

        dropTodos: (ids, options) =>
          mutate((db) => {
            for (const id of ids) {
              const todo = findTodo(db, id);
              if (!todo) continue;
              if (options.container) {
                todo.projectId = options.container.projectId;
                todo.areaId = options.container.areaId;
                todo.headingId = options.container.headingId;
              }
              if (options.when) {
                todo.when =
                  options.when.kind === 'scheduled'
                    ? { ...options.when }
                    : { kind: options.when.kind };
              }
            }
            if (!options.order) return;
            const todos = options.order
              .map((id) => findTodo(db, id))
              .filter((todo): todo is Todo => Boolean(todo));
            // Reuse the group's own index slots, so items outside it stay put.
            const slots = todos.map((todo) => todo.index).sort((a, b) => a - b);
            todos.forEach((todo, position) => {
              todo.index = slots[position];
            });
          }),

        draggingIds: [],
        setDragging: (ids) => set((state) => void (state.draggingIds = ids)),
        endDrag: () => set((state) => void (state.draggingIds = [])),

        addChecklistItem: (todoId, options) => {
          const id = newId('ci');
          mutate((db) => {
            const todo = findTodo(db, todoId);
            if (!todo || todo.trashed) return;
            const item = { id, title: options?.title ?? '', done: false };
            const at = options?.afterId
              ? todo.checklist.findIndex((c) => c.id === options.afterId)
              : -1;
            if (at === -1) todo.checklist.push(item);
            else todo.checklist.splice(at + 1, 0, item);
          });
          return id;
        },

        updateChecklistItem: (todoId, itemId, patch) =>
          mutate((db) => {
            const todo = findTodo(db, todoId);
            if (!todo || todo.trashed) return;
            const item = todo.checklist.find((c) => c.id === itemId);
            if (item) Object.assign(item, patch);
          }),

        removeChecklistItem: (todoId, itemId) =>
          mutate((db) => {
            const todo = findTodo(db, todoId);
            if (todo && !todo.trashed) {
              todo.checklist = todo.checklist.filter((c) => c.id !== itemId);
            }
          }),

        freshListId: undefined,
        clearFreshList: () => set((state) => void (state.freshListId = undefined)),
        focusListTitle: (id) => set((state) => void (state.freshListId = id)),

        createProject: (options) => {
          const id = newId('prj');
          const title = options?.title ?? '';
          set((state) => {
            state.freshListId = id;
            // Only an unnamed project counts as a disposable draft; a project
            // created with a title (import, duplication) is real from the start.
            state.draftProjectId = title.trim() ? undefined : id;
          });
          mutate((db) => {
            db.projects.push({
              id,
              title,
              notes: '',
              areaId: options?.areaId,
              when: { kind: 'unscheduled' },
              tagIds: [],
              status: 'open',
              trashed: false,
              createdAt: new Date().toISOString(),
              index: nextIndex(db.projects),
            });
          });
          return id;
        },

        updateProject: (id, patch) => {
          mutate((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (project) Object.assign(project, patch);
          });
        },

        completeProject: (id) =>
          mutate((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (!project) return;
            const completing = project.status === 'open';
            const previousStamp = project.completedAt;
            const stamp = new Date().toISOString();
            project.status = completing ? 'completed' : 'open';
            project.completedAt = completing ? stamp : undefined;
            // Its open todos go with it, otherwise they would silently
            // disappear from every list while still being open. Reopening the
            // project only reopens the todos that were closed together with it,
            // recognised by the shared timestamp.
            const spawned: Todo[] = [];
            for (const todo of db.todos) {
              if (todo.projectId !== id || todo.trashed) continue;
              if (completing) {
                if (todo.status !== 'open') continue;
                todo.status = 'completed';
                todo.completedAt = stamp;
                // A repeating routine outlives the project it lived in: its next
                // copy goes to the Inbox, otherwise the series would either break
                // or hide inside a project nobody looks at any more.
                const next = nextRepeatCopy(todo, newId);
                if (next) {
                  next.projectId = undefined;
                  next.headingId = undefined;
                  next.areaId = undefined;
                  spawned.push(next);
                }
              } else if (previousStamp && todo.completedAt === previousStamp) {
                // Its series may already continue in the Inbox: reopening the
                // original would leave two live copies of the same routine.
                if (todo.repeat && hasOpenSibling(db, todo)) continue;
                todo.status = 'open';
                todo.completedAt = undefined;
              }
            }
            db.todos.push(...spawned);
          }),

        trashProject: (id) =>
          mutateAndKeepListValid((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (project) project.trashed = true;
            for (const todo of db.todos) {
              if (todo.projectId !== id || todo.trashed) continue;
              todo.trashed = true;
              // Remember who did it, so restoring the project does not also
              // resurrect todos the user had thrown away earlier.
              todo.trashedBy = id;
            }
          }),

        restoreProject: (id) =>
          mutate((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (project) project.trashed = false;
            for (const todo of db.todos) {
              if (todo.projectId !== id || todo.trashedBy !== id) continue;
              todo.trashed = false;
              todo.trashedBy = undefined;
            }
          }),

        createArea: (title = '') => {
          const id = newId('area');
          set((state) => {
            state.freshListId = id;
            state.draftAreaId = title.trim() ? undefined : id;
          });
          mutate((db) => {
            db.areas.push({ id, title, tagIds: [], index: nextIndex(db.areas), collapsed: false });
          });
          return id;
        },

        updateArea: (id, patch) => {
          mutate((db) => {
            const area = db.areas.find((a) => a.id === id);
            if (area) Object.assign(area, patch);
          });
        },

        trashArea: (id) =>
          mutateAndKeepListValid((db) => {
            db.areas = db.areas.filter((a) => a.id !== id);
            for (const project of db.projects) {
              if (project.areaId === id) project.areaId = undefined;
            }
            for (const todo of db.todos) {
              if (todo.areaId === id) todo.areaId = undefined;
            }
          }),

        createHeading: (projectId, title = 'Новый заголовок') => {
          const id = newId('hd');
          mutate((db) => {
            db.headings.push({ id, projectId, title, index: nextIndex(db.headings) });
          });
          return id;
        },

        updateHeading: (id, patch) =>
          mutate((db) => {
            const heading = db.headings.find((h) => h.id === id);
            if (heading) Object.assign(heading, patch);
          }),

        removeHeading: (id) =>
          mutate((db) => {
            db.headings = db.headings.filter((h) => h.id !== id);
            for (const todo of db.todos) {
              if (todo.headingId === id) todo.headingId = undefined;
            }
          }),

        undo: () => {
          endTextSession();
          const { past, db } = get();
          if (!past.length) return;
          const previous = past[past.length - 1];
          set((state) => {
            state.past.pop();
            state.future.push(db);
            state.db = previous;
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
            state.autoPanel = undefined;
            state.draftProjectId = undefined;
            state.draftAreaId = undefined;
            state.selection = [];
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.selectedList = validList(previous, state.selectedList);
          });
        },

        redo: () => {
          endTextSession();
          const { future, db } = get();
          if (!future.length) return;
          const next = future[future.length - 1];
          set((state) => {
            state.future.pop();
            state.past.push(db);
            state.db = next;
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
            state.autoPanel = undefined;
            state.draftProjectId = undefined;
            state.draftAreaId = undefined;
            state.selection = [];
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.selectedList = validList(next, state.selectedList);
          });
        },

        reorderProjects: (orderedIds) =>
          mutate((db) => {
            const projects = orderedIds
              .map((id) => db.projects.find((project) => project.id === id))
              .filter((project): project is Project => Boolean(project));
            const slots = projects.map((project) => project.index).sort((a, b) => a - b);
            projects.forEach((project, position) => {
              project.index = slots[position];
            });
          }),

        reorderAreas: (orderedIds) =>
          mutate((db) => {
            const areas = orderedIds
              .map((id) => db.areas.find((area) => area.id === id))
              .filter((area): area is Area => Boolean(area));
            const slots = areas.map((area) => area.index).sort((a, b) => a - b);
            areas.forEach((area, position) => {
              area.index = slots[position];
            });
          }),

        moveProject: (id, areaId) =>
          mutate((db) => {
            const project = db.projects.find((item) => item.id === id);
            if (project) project.areaId = areaId;
          }),

        importDatabase: (next) => {
          mutate((db) => {
            db.areas = next.areas;
            db.projects = next.projects;
            db.headings = next.headings;
            db.todos = next.todos;
            db.tags = next.tags;
          });
          set((state) => {
            // The list that was open may not exist in the imported data.
            state.selectedList = validList(state.db, state.selectedList);
            state.selection = [];
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.editingTodoId = undefined;
            state.tagFilter = [];
          });
        },

        resetToEmpty: () => replaceDatabase(createEmptyDatabase()),

        loadDemoData: () => replaceDatabase(createDemoDatabase()),
      };
    }),
    {
      // Renamed from `things-clone` together with the package; the storage layer
      // still reads the old key once and moves the data over.
      name: 'doings.v1',
      version: SCHEMA_VERSION,
      storage: appStorage,
      partialize: (state) => ({
        db: state.db,
        selectedList: state.selectedList,
        theme: state.theme,
      }),
      /** Runs only when the stored version differs from the current one. */
      migrate: (persisted, from) => {
        const state = (persisted ?? {}) as Partial<StoreState>;

        if (from > SCHEMA_VERSION) {
          // A file from a newer app knows fields this build would silently drop.
          const message =
            `База сделана более новой версией приложения (схема ${from}, здесь ${SCHEMA_VERSION}). ` +
            'Файл не открыт и не будет перезаписан — обновите приложение.';
          blockWrites(message);
          return {
            selectedList: 'today',
            theme: state.theme,
            storageError: message,
          } as unknown as Partial<StoreState>;
        }

        // The file on disk is still the old one here, so this copy captures the
        // data exactly as the previous version left it. Writes wait for it.
        void requestMigrationBackup();

        const loaded = loadDatabase({ version: from, db: state.db });
        if (!loaded.ok) {
          return {
            ...state,
            // Nothing is invented in place of the file: an empty list with a
            // visible warning is honest, demo projects would not be.
            db: createEmptyDatabase(),
            selectedList: 'today',
            storageError:
              'Файл базы не удалось разобрать. Данные не загружены — прежний файл сохранён рядом, его можно загрузить через настройки.',
          } as unknown as Partial<StoreState>;
        }
        return { ...state, db: loaded.db, storageIssues: loaded.issues } as Partial<StoreState>;
      },
      /**
       * Every load goes through validation, not just version changes: the file
       * lives on disk where anything could have happened to it.
       */
      merge: (persisted, current) => {
        const state = (persisted ?? {}) as Partial<StoreState> & { storageIssues?: string[] };
        // Problems found while reading are collected here, because a message
        // pushed into the state earlier would be lost when hydration replaces it.
        const [pending, ...alsoPending] = drainStorageErrors();
        // No database in the snapshot: either a first run, or `migrate` refused
        // to open the file and only passed the message through.
        if (!state.db) {
          return {
            ...current,
            ...state,
            storageError: state.storageError ?? pending ?? current.storageError,
            storageIssues: [...(state.storageIssues ?? []), ...alsoPending],
          };
        }
        // Only validation here: version steps already ran in `migrate` above.
        const loaded = validateDatabase(state.db);
        if (!loaded) {
          return {
            ...current,
            ...state,
            db: current.db,
            // The previous file becomes database.json.bak on the next successful
            // save, so it can still be recovered by hand.
            selectedList: 'today',
            storageIssues: [...(state.storageIssues ?? []), ...alsoPending],
            storageError:
              pending ??
              'Файл базы повреждён и не был загружен. Список пока пуст; прежний файл сохранится рядом как database.json.bak, из него можно восстановить данные через настройки.',
          };
        }
        return {
          ...current,
          ...state,
          db: loaded.db,
          // A stored list may point at a project that the file no longer has.
          selectedList: validList(loaded.db, state.selectedList ?? current.selectedList),
          storageError: state.storageError ?? pending ?? current.storageError,
          // Nothing found during loading is dropped: only the first message goes
          // to the banner title, the rest are listed under it.
          storageIssues: [...(state.storageIssues ?? []), ...alsoPending, ...loaded.issues],
        };
      },
      /**
       * zustand leaves `hasHydrated` false when hydration throws, so without
       * this the window would stay on the loading screen forever.
       */
      onRehydrateStorage: () => (_state, error) => {
        if (!error) return;
        useStore.setState({
          hydrationFailed: true,
          storageError: `Не удалось загрузить сохранённые данные: ${String(error)}`,
        });
      },
    },
  ),
);

// A failed write must be visible: silence here means losing the user's work.
setStorageErrorHandler((message) => {
  useStore.setState({ storageError: message });
});

exposeForDebug(useStore);
