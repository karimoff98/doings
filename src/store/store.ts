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
import { appStorage, blockWrites, drainStorageErrors, setStorageErrorHandler } from './persistence';
import { createSeedDatabase, newId } from './seed';

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

  createTodo: (options?: { title?: string; target?: MoveTarget; when?: When }) => Id;
  updateTodo: (id: Id, patch: Partial<Omit<Todo, 'id'>>) => void;
  /** All mutators below take one id or many, so multi-select needs no special casing. */
  setWhen: (ids: Id | Id[], when: When) => void;
  setDeadline: (ids: Id | Id[], deadline?: IsoDay) => void;
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
  resetToSeed: () => void;
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
function defaultsForList(key: ListKey): { when: When; target: MoveTarget; tagIds: Id[] } {
  const list = parseListKey(key);
  switch (list.kind) {
    case 'today':
      return { when: { kind: 'today' }, target: {}, tagIds: [] };
    case 'upcoming':
      // Upcoming only shows future days, so today's date would hide the new todo.
      return { when: { kind: 'scheduled', date: tomorrow() }, target: {}, tagIds: [] };
    case 'someday':
      return { when: { kind: 'someday' }, target: {}, tagIds: [] };
    case 'project':
      return { when: { kind: 'unscheduled' }, target: { projectId: list.id }, tagIds: [] };
    case 'area':
      return { when: { kind: 'unscheduled' }, target: { areaId: list.id }, tagIds: [] };
    case 'tag':
      return { when: { kind: 'unscheduled' }, target: {}, tagIds: [list.id] };
    default:
      return { when: { kind: 'unscheduled' }, target: {}, tagIds: [] };
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

/** Nothing the user actually typed: safe to throw away when the editor closes. */
function isBlank(todo: Todo): boolean {
  return (
    !todo.title.trim() && !todo.notes.trim() && !todo.checklist.some((item) => item.title.trim())
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
      /** Wraps a mutation so every change is undoable. */
      const mutate = (recipe: (db: Database) => void) => {
        const snapshot = get().db;
        set((state) => {
          state.past.push(snapshot);
          if (state.past.length > UNDO_LIMIT) state.past.shift();
          state.future = [];
          recipe(state.db);
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
          const visible = new Set(
            selectSections(state.db, state.selectedList).flatMap((section) =>
              section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
            ),
          );
          state.selection = state.selection.filter((id) => visible.has(id));
          if (state.selectedTodoId && !visible.has(state.selectedTodoId)) {
            state.selectedTodoId = state.selection[state.selection.length - 1];
          }
          if (state.selectionAnchor && !visible.has(state.selectionAnchor)) {
            state.selectionAnchor = state.selectedTodoId;
          }
        });
      };

      return {
        db: createSeedDatabase(),
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
            state.selectedList = key;
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.selection = [];
            // A filter that survived the jump to another list is confusing.
            state.tagFilter = [];
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
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
            state.selectedTodoId = id;
            state.selection = [id];
            state.editingTodoId = id;
          }),

        openEditorPanel: (id, panel) =>
          set((state) => {
            state.selectedTodoId = id;
            if (!state.selection.includes(id)) state.selection = [id];
            state.editingTodoId = id;
            state.autoPanel = panel;
          }),

        clearAutoPanel: () => set((state) => void (state.autoPanel = undefined)),

        closeEditor: () =>
          set((state) => {
            const id = state.editingTodoId;
            state.editingTodoId = undefined;
            state.freshTodoId = undefined;
            state.autoPanel = undefined;
            // Drop a todo that was created and left completely empty. Blank
            // checklist rows do not count as content.
            const todo = id ? state.db.todos.find((t) => t.id === id) : undefined;
            if (todo && isBlank(todo)) {
              state.db.todos = state.db.todos.filter((t) => t.id !== todo.id);
              state.selectedTodoId = undefined;
              state.selection = [];
            }
          }),

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
          mutate((db) => {
            const todo: Todo = {
              id,
              title: options?.title ?? '',
              notes: '',
              checklist: [],
              when: options?.when ?? defaults.when,
              tagIds: [...defaults.tagIds],
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

        setWhen: (ids, when) =>
          mutateEach(ids, (todo) => {
            todo.when = when.kind === 'scheduled' ? { ...when } : { kind: when.kind };
            // A reminder without a day has nothing to fire on.
            if (when.kind === 'someday' || when.kind === 'unscheduled') todo.reminder = undefined;
          }),

        setDeadline: (ids, deadline) =>
          mutateEach(ids, (todo) => {
            todo.deadline = deadline;
          }),

        setRepeat: (ids, repeat) =>
          mutateEach(ids, (todo) => {
            todo.repeat = repeat ? { ...repeat } : undefined;
            // A repeating todo needs a day to repeat from.
            if (repeat && !hasDay(todo)) todo.when = { kind: 'today' };
          }),

        setReminder: (ids, reminder) =>
          mutateEach(ids, (todo) => {
            todo.reminder = reminder;
            if (reminder && !hasDay(todo)) todo.when = { kind: 'today' };
          }),

        toggleTag: (ids, tagId) =>
          mutateEach(ids, (todo) => {
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
            // A todo in the trash cannot be worked on.
            if (todo.trashed) return;
            todo.status = 'completed';
            todo.completedAt = new Date().toISOString();
            const spawned = nextRepeatCopy(todo, newId);
            if (spawned) db.todos.push(spawned);
          }),

        uncompleteTodo: (ids) =>
          mutateEach(ids, (todo, db) => {
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
          }),

        emptyTrash: () =>
          mutateAndKeepListValid((db) => {
            db.todos = db.todos.filter((t) => !t.trashed);
            db.projects = db.projects.filter((p) => !p.trashed);
          }),

        moveTodo: (ids, target) =>
          mutateEach(ids, (todo) => {
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
              if (!source) continue;
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
            if (!todo) return;
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
            const item = findTodo(db, todoId)?.checklist.find((c) => c.id === itemId);
            if (item) Object.assign(item, patch);
          }),

        removeChecklistItem: (todoId, itemId) =>
          mutate((db) => {
            const todo = findTodo(db, todoId);
            if (todo) todo.checklist = todo.checklist.filter((c) => c.id !== itemId);
          }),

        freshListId: undefined,
        clearFreshList: () => set((state) => void (state.freshListId = undefined)),
        focusListTitle: (id) => set((state) => void (state.freshListId = id)),

        createProject: (options) => {
          const id = newId('prj');
          set((state) => void (state.freshListId = id));
          mutate((db) => {
            db.projects.push({
              id,
              title: options?.title ?? 'Новый проект',
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

        updateProject: (id, patch) =>
          mutate((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (project) Object.assign(project, patch);
          }),

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
            for (const todo of db.todos) {
              if (todo.projectId !== id || todo.trashed) continue;
              if (completing) {
                if (todo.status === 'open') {
                  todo.status = 'completed';
                  todo.completedAt = stamp;
                }
              } else if (previousStamp && todo.completedAt === previousStamp) {
                todo.status = 'open';
                todo.completedAt = undefined;
              }
            }
          }),

        trashProject: (id) =>
          mutateAndKeepListValid((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (project) project.trashed = true;
            for (const todo of db.todos) {
              if (todo.projectId === id) todo.trashed = true;
            }
          }),

        restoreProject: (id) =>
          mutate((db) => {
            const project = db.projects.find((p) => p.id === id);
            if (project) project.trashed = false;
            for (const todo of db.todos) {
              if (todo.projectId === id) todo.trashed = false;
            }
          }),

        createArea: (title = 'Новая область') => {
          const id = newId('area');
          set((state) => void (state.freshListId = id));
          mutate((db) => {
            db.areas.push({ id, title, tagIds: [], index: nextIndex(db.areas), collapsed: false });
          });
          return id;
        },

        updateArea: (id, patch) =>
          mutate((db) => {
            const area = db.areas.find((a) => a.id === id);
            if (area) Object.assign(area, patch);
          }),

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
          const { past, db } = get();
          if (!past.length) return;
          const previous = past[past.length - 1];
          set((state) => {
            state.past.pop();
            state.future.push(db);
            state.db = previous;
            state.editingTodoId = undefined;
            state.selection = [];
            state.selectedTodoId = undefined;
            state.selectedList = validList(previous, state.selectedList);
          });
        },

        redo: () => {
          const { future, db } = get();
          if (!future.length) return;
          const next = future[future.length - 1];
          set((state) => {
            state.future.pop();
            state.past.push(db);
            state.db = next;
            state.editingTodoId = undefined;
            state.selection = [];
            state.selectedTodoId = undefined;
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

        resetToSeed: () =>
          set((state) => {
            state.db = createSeedDatabase();
            state.past = [];
            state.future = [];
            state.selectedList = validList(state.db, state.selectedList);
            state.selectedTodoId = undefined;
            state.selectionAnchor = undefined;
            state.selection = [];
            state.editingTodoId = undefined;
            state.tagFilter = [];
          }),
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

        const loaded = loadDatabase({ version: from, db: state.db });
        if (!loaded.ok) {
          return {
            ...state,
            db: createSeedDatabase(),
            selectedList: 'today',
            storageError: 'Файл базы не удалось разобрать, открыты демонстрационные данные.',
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
        const pending = drainStorageErrors()[0];
        // No database in the snapshot: either a first run, or `migrate` refused
        // to open the file and only passed the message through.
        if (!state.db) {
          return {
            ...current,
            ...state,
            storageError: state.storageError ?? pending ?? current.storageError,
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
            storageError:
              pending ??
              'Файл базы повреждён и не был загружен. Открыты демонстрационные данные; прежний файл сохранится рядом как database.json.bak, из него можно восстановить данные через настройки.',
          };
        }
        return {
          ...current,
          ...state,
          db: loaded.db,
          // A stored list may point at a project that the file no longer has.
          selectedList: validList(loaded.db, state.selectedList ?? current.selectedList),
          storageError: state.storageError ?? pending ?? current.storageError,
          storageIssues: [...(state.storageIssues ?? []), ...loaded.issues],
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
