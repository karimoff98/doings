import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { formatDayLong, formatDayShort, formatWeekday, tomorrow } from '../domain/dates';
import { shortcutLabel } from '../domain/platform';
import {
  COMPLETED_SECTION_ID,
  SMART_LIST_META,
  listTitle,
  projectProgress,
  projectStats,
  projectTitle,
  selectSectionsKeepingCompleted,
  separateCompletedSection,
} from '../domain/lists';
import { parseListKey } from '../domain/types';
import type { Area, Database, Id, ItemStatus, Project, Section, Tag, Todo } from '../domain/types';
import { useStore } from '../store/store';
import { BulkBar } from './BulkBar';
import { AutoTextarea } from './AutoTextarea';
import { ProgressRing } from './Checkbox';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuTarget } from './ContextMenu';
import { Menu } from './Menu';
import type { MenuPosition } from './Menu';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Popover } from './Popover';
import { TaskEditor } from './TaskEditor';
import { TaskRow } from './TaskRow';
import type { DropEdge } from './TaskRow';
import { UpcomingMonth } from './UpcomingMonth';
import { DeadlinePopover, WhenPopover } from './WhenPopover';

/**
 * One line per list. A clean installation must read as empty on purpose, not as
 * broken, so the lists a newcomer sees first also say what to press.
 */
function emptyText(kind: string): string {
  switch (kind) {
    case 'inbox':
      return `Входящие пусты — нажмите ${shortcutLabel('N')}, чтобы добавить задачу.`;
    case 'today':
      return 'На сегодня ничего не запланировано.';
    case 'important':
      return 'Важных задач пока нет.';
    case 'upcoming':
      return 'Нет предстоящих задач.';
    case 'anytime':
      return 'Нет задач, готовых к работе.';
    case 'someday':
      return 'Здесь живут идеи на потом.';
    case 'logbook':
      return 'Пока нечего вспомнить.';
    case 'trash':
      return 'Корзина пуста.';
    case 'project':
      return 'В проекте пока нет задач.';
    case 'area':
      return 'В этой области пока пусто.';
    case 'tag':
      return 'С этим тегом задач нет.';
    default:
      return 'Пусто';
  }
}

/** Which extra columns rows should show, per list. */
function rowOptions(kind: string): { showWhen: boolean; showContainer: boolean } {
  switch (kind) {
    case 'today':
    case 'important':
    case 'upcoming':
    case 'logbook':
    case 'trash':
      return { showWhen: false, showContainer: true };
    default:
      return { showWhen: true, showContainer: false };
  }
}

interface DropState {
  sectionId: string;
  /** Undefined means "drop at the end of the section". */
  targetId?: Id;
  edge: DropEdge;
}

/** Scroll belongs to a list, not to the shared content pane. */
const scrollByList = new Map<string, number>();

/** Tags worn by the todos of a list, in the order tags were created. */
function tagsInSections(db: Database, sections: Section[]): Tag[] {
  const used = new Set<Id>();
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.kind === 'todo') for (const id of row.todo.tagIds) used.add(id);
    }
  }
  return db.tags.filter((tag) => used.has(tag.id));
}

/** Keeps only the rows carrying at least one of the selected tags. */
function applyTagFilter(sections: Section[], tagFilter: Id[]): Section[] {
  if (!tagFilter.length) return sections;
  const selectedTags = new Set(tagFilter);
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) => row.kind === 'todo' && row.todo.tagIds.some((id) => selectedTags.has(id)),
      ),
    }))
    .filter((section) => section.rows.length > 0);
}

/** Keeps the same array reference while list membership and order stay equal. */
function useStableIds(ids: Id[]): Id[] {
  const stable = useRef(ids);
  if (
    stable.current.length !== ids.length ||
    stable.current.some((id, index) => id !== ids[index])
  ) {
    stable.current = ids;
  }
  return stable.current;
}

interface ListTaskRowProps {
  todo: Todo;
  projectsById: ReadonlyMap<Id, Project>;
  areasById: ReadonlyMap<Id, Area>;
  tagsById: ReadonlyMap<Id, Tag>;
  visibleIds: Id[];
  sectionId: string;
  reorderable: boolean;
  muted?: boolean;
  showContainer: boolean;
  showWhen: boolean;
  dropEdge?: DropEdge;
  onOpenMenu: (at: MenuPosition) => void;
  onAllowDrop: (event: DragEvent, next: DropState) => void;
  onCommitDrop: (sectionId: string, targetId: Id, edge: DropEdge) => void;
  onFinishDrag: () => void;
}

/**
 * A selection change used to render every task in a long list because all row
 * handlers were recreated inside ListView. This memoized boundary subscribes
 * only to the two booleans that can visually change for its own task. Event
 * handlers read the latest store state at click time, so they stay correct
 * without making every sibling render.
 */
const ListTaskRow = memo(function ListTaskRow({
  todo,
  projectsById,
  areasById,
  tagsById,
  visibleIds,
  sectionId,
  reorderable,
  muted,
  showContainer,
  showWhen,
  dropEdge,
  onOpenMenu,
  onAllowDrop,
  onCommitDrop,
  onFinishDrag,
}: ListTaskRowProps) {
  const selected = useStore((state) => state.selection.includes(todo.id));
  const dragging = useStore((state) => state.draggingIds.includes(todo.id));
  const editing = useStore((state) => state.editingTodoId === todo.id);

  if (editing) return <TaskEditor todo={todo} />;

  return (
    <TaskRow
      todo={todo}
      projectsById={projectsById}
      areasById={areasById}
      tagsById={tagsById}
      selected={selected}
      draggable={reorderable && todo.status === 'open'}
      dragging={dragging}
      dropEdge={dropEdge}
      muted={muted}
      showWhen={showWhen}
      showContainer={showContainer}
      onClick={(event) => {
        const state = useStore.getState();
        if (event.metaKey || event.ctrlKey) {
          state.toggleSelection(todo.id);
          return;
        }
        if (event.shiftKey) {
          const anchor = state.selectionAnchor ?? state.selectedTodoId;
          const from = anchor ? visibleIds.indexOf(anchor) : -1;
          const to = visibleIds.indexOf(todo.id);
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from];
            state.selectRange(visibleIds.slice(start, end + 1), todo.id, true);
            return;
          }
        }
        if (state.selection.length === 1 && state.selection[0] === todo.id) {
          state.openEditor(todo.id);
        } else {
          state.selectTodo(todo.id);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const state = useStore.getState();
        if (!state.selection.includes(todo.id)) state.selectTodo(todo.id);
        onOpenMenu({ x: event.clientX, y: event.clientY });
      }}
      onTagClick={(tagId) => useStore.getState().selectList(`tag:${tagId}`)}
      onOpen={() => useStore.getState().openEditor(todo.id)}
      onToggle={() => {
        const state = useStore.getState();
        if (todo.trashed) state.restoreTodo(todo.id);
        else if (todo.status === 'open') state.completeTodo(todo.id);
        else state.uncompleteTodo(todo.id);
      }}
      onDragStart={(event) => {
        const state = useStore.getState();
        const ids = state.selection.includes(todo.id) ? state.selection : [todo.id];
        if (!state.selection.includes(todo.id)) state.selectTodo(todo.id);
        state.setDragging(ids);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', ids.join(','));
      }}
      onDragOver={(event, edge) => {
        if (!reorderable) return;
        event.stopPropagation();
        onAllowDrop(event, { sectionId, targetId: todo.id, edge });
      }}
      onDrop={(event, edge) => {
        if (!reorderable) return;
        event.preventDefault();
        event.stopPropagation();
        onCommitDrop(sectionId, todo.id, edge);
      }}
      onDragEnd={onFinishDrag}
    />
  );
});

export function ListView() {
  const db = useStore((s) => s.db);
  const selectedList = useStore((s) => s.selectedList);
  const selection = useStore((s) => s.selection);
  const retainedCompletedIds = useStore((s) => s.retainedCompletedIds);
  const completionLogging = useStore((s) => s.completionLogging);
  const collapsedCompletedLists = useStore((s) => s.collapsedCompletedLists ?? []);
  const toggleCompletedSection = useStore((s) => s.toggleCompletedSection);
  const draggingIds = useStore((s) => s.draggingIds);
  const selectList = useStore((s) => s.selectList);
  const logCompleted = useStore((s) => s.logCompleted);
  const restoreTodo = useStore((s) => s.restoreTodo);
  const createTodo = useStore((s) => s.createTodo);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const dropTodos = useStore((s) => s.dropTodos);
  const endDrag = useStore((s) => s.endDrag);
  const tagFilter = useStore((s) => s.tagFilter);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const clearTagFilter = useStore((s) => s.clearTagFilter);
  const renameTag = useStore((s) => s.renameTag);
  const removeTag = useStore((s) => s.removeTag);

  const [drop, setDrop] = useState<DropState | null>(null);
  const [menuAt, setMenuAt] = useState<ContextMenuTarget | null>(null);
  const [tagMenu, setTagMenu] = useState<{ at: MenuPosition; tag: Tag } | null>(null);
  const [upcomingView, setUpcomingView] = useState<'list' | 'month'>('list');
  const [calendarDay, setCalendarDay] = useState(() => tomorrow());
  const content = useRef<HTMLElement>(null);
  const sectionsRef = useRef<Section[]>([]);

  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    node.scrollTop = scrollByList.get(selectedList) ?? 0;
    return () => {
      scrollByList.set(selectedList, node.scrollTop);
    };
  }, [selectedList]);

  const list = parseListKey(selectedList);
  const projectsById = useMemo(
    () => new Map(db.projects.map((project) => [project.id, project])),
    [db.projects],
  );
  const areasById = useMemo(() => new Map(db.areas.map((area) => [area.id, area])), [db.areas]);
  const tagsById = useMemo(() => new Map(db.tags.map((tag) => [tag.id, tag])), [db.tags]);
  const statsByProject = useMemo(() => projectStats(db), [db]);
  // Deriving the sections walks the whole database, so it must not run on every
  // click or drag — only when the data or the chosen list actually changes.
  const allSections = useMemo<Section[]>(
    () => selectSectionsKeepingCompleted(db, selectedList, retainedCompletedIds),
    [db, selectedList, retainedCompletedIds],
  );
  const availableTags = useMemo(() => tagsInSections(db, allSections), [db, allSections]);
  const activeFilter = useMemo(
    () => tagFilter.filter((id) => availableTags.some((tag) => tag.id === id)),
    [tagFilter, availableTags],
  );
  const filteredSections = useMemo(
    () => applyTagFilter(allSections, activeFilter),
    [allSections, activeFilter],
  );
  const sections = useMemo(
    () =>
      list.kind === 'logbook' || list.kind === 'trash'
        ? filteredSections
        : separateCompletedSection(filteredSections),
    [filteredSections, list.kind],
  );
  const monthView = list.kind === 'upcoming' && upcomingView === 'month';
  const visibleSections = useMemo(
    () => (monthView ? sections.filter((section) => section.id === calendarDay) : sections),
    [monthView, sections, calendarDay],
  );
  const completedCollapsed = collapsedCompletedLists.includes(selectedList);
  const completedCount =
    visibleSections.find((section) => section.id === COMPLETED_SECTION_ID)?.rows.length ?? 0;
  const renderedSections = useMemo(
    () =>
      completedCollapsed
        ? visibleSections.map((section) =>
            section.id === COMPLETED_SECTION_ID ? { ...section, rows: [] } : section,
          )
        : visibleSections,
    [completedCollapsed, visibleSections],
  );
  sectionsRef.current = renderedSections;
  const options = rowOptions(list.kind);
  const hasRows = sections.some((section) => section.rows.length > 0);
  const selectedDayHasRows = visibleSections.some((section) => section.rows.length > 0);
  const nextVisibleIds = useMemo(
    () =>
      renderedSections.flatMap((section) =>
        section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
      ),
    [renderedSections],
  );
  const visibleIds = useStableIds(nextVisibleIds);
  const waitingForLogIds = useMemo(
    () =>
      visibleSections.flatMap((section) =>
        section.rows.flatMap((row) =>
          row.kind === 'todo' && row.todo.status === 'completed' && !row.todo.loggedAt
            ? [row.todo.id]
            : [],
        ),
      ),
    [visibleSections],
  );

  const allowDrop = useCallback((event: DragEvent, next: DropState) => {
    if (!useStore.getState().draggingIds.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDrop((current) =>
      current?.sectionId === next.sectionId &&
      current.targetId === next.targetId &&
      current.edge === next.edge
        ? current
        : next,
    );
  }, []);

  /** Applies a drop: re-home, re-schedule and reorder in one step. */
  const commitDrop = useCallback(
    (sectionId: string, targetId: Id | undefined, edge: DropEdge) => {
      const section = sectionsRef.current.find((item) => item.id === sectionId);
      const ids = useStore.getState().draggingIds;
      setDrop(null);
      endDrag();
      if (!section || !ids.length) return;

      const sectionIds = section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : []));
      const moved = new Set(ids);
      const kept = sectionIds.filter((id) => !moved.has(id));
      let position = kept.length;
      if (targetId && !moved.has(targetId)) {
        const at = kept.indexOf(targetId);
        if (at !== -1) position = edge === 'top' ? at : at + 1;
      }
      const order = [...kept.slice(0, position), ...ids, ...kept.slice(position)];

      dropTodos(ids, {
        container: section.container,
        when: section.when,
        order,
      });
    },
    [dropTodos, endDrag],
  );

  const finishDrag = useCallback(() => {
    setDrop(null);
    endDrag();
  }, [endDrag]);

  const openTodoMenu = useCallback((at: MenuPosition) => setMenuAt(at), []);

  return (
    <main
      ref={content}
      className="app__content"
      onClick={(event) => {
        if (event.target === event.currentTarget) useStore.getState().selectTodo(undefined);
      }}
    >
      <div className="app__inner app__inner--enter" key={selectedList}>
        <ListHeader />

        {/* In a tag list the bar would just repeat the title. */}
        {availableTags.length > 0 && list.kind !== 'tag' && (
          <div className="tagbar" role="group" aria-label="Фильтр по тегам">
            {availableTags.map((tag) => {
              const on = activeFilter.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`tagbar__chip${on ? ' tagbar__chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleTagFilter(tag.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setTagMenu({ at: { x: event.clientX, y: event.clientY }, tag });
                  }}
                >
                  {tag.title}
                </button>
              );
            })}
            {activeFilter.length > 0 && (
              <button type="button" className="tagbar__clear" onClick={clearTagFilter}>
                сбросить
              </button>
            )}
          </div>
        )}

        {list.kind === 'upcoming' && (
          <div className="upcoming__toolbar">
            <div className="segmented" role="group" aria-label="Вид предстоящих задач">
              <button
                type="button"
                className={`segmented__item${upcomingView === 'list' ? ' segmented__item--on' : ''}`}
                aria-pressed={upcomingView === 'list'}
                onClick={() => setUpcomingView('list')}
              >
                Список
              </button>
              <button
                type="button"
                className={`segmented__item${upcomingView === 'month' ? ' segmented__item--on' : ''}`}
                aria-pressed={upcomingView === 'month'}
                onClick={() => setUpcomingView('month')}
              >
                Месяц
              </button>
            </div>
          </div>
        )}

        {monthView && (
          <>
            <UpcomingMonth sections={sections} value={calendarDay} onPick={setCalendarDay} />
            <header className="monthview__selection">
              <span className="monthview__selection-title">{formatDayLong(calendarDay)}</span>
              <span className="monthview__selection-subtitle">{formatWeekday(calendarDay)}</span>
            </header>
          </>
        )}

        {!hasRows && !monthView && (
          <p className="empty" data-testid="empty-state">
            {activeFilter.length ? 'Нет задач с этими тегами.' : emptyText(list.kind)}
            {/* One optional action, only where pressing something is the point. */}
            {!activeFilter.length && (list.kind === 'inbox' || list.kind === 'today') && (
              <button type="button" className="empty__action" onClick={() => createTodo()}>
                Новая задача
              </button>
            )}
          </p>
        )}

        {monthView && !selectedDayHasRows && (
          <p className="empty monthview__empty">
            На этот день задач нет.
            <button
              type="button"
              className="empty__action"
              onClick={() => createTodo({ when: { kind: 'scheduled', date: calendarDay } })}
            >
              Новая задача
            </button>
          </p>
        )}

        {renderedSections.map((section) => {
          const droppable = Boolean(section.reorderable && draggingIds.length);
          // Drop-target-only groups stay out of the way until something is dragged.
          if (section.placeholder && !draggingIds.length) return null;
          return (
            <section
              key={section.id}
              className={`section${
                droppable && drop?.sectionId === section.id && !drop.targetId
                  ? ' section--drop'
                  : ''
              }`}
              onDragOver={
                droppable
                  ? (event) => allowDrop(event, { sectionId: section.id, edge: 'bottom' })
                  : undefined
              }
              onDrop={
                droppable
                  ? (event) => {
                      event.preventDefault();
                      commitDrop(section.id, drop?.targetId, drop?.edge ?? 'bottom');
                    }
                  : undefined
              }
            >
              {!monthView &&
                (section.id === COMPLETED_SECTION_ID ? (
                  <button
                    type="button"
                    className="section__head section__head--toggle"
                    aria-expanded={!completedCollapsed}
                    onClick={() => toggleCompletedSection(selectedList)}
                  >
                    <span className="section__title">
                      <Icon
                        name="chevron-right"
                        size={13}
                        className={completedCollapsed ? '' : 'section__disclosure--open'}
                      />
                      {section.title}
                      <span className="section__count">{completedCount}</span>
                    </span>
                  </button>
                ) : section.title && section.container?.headingId ? (
                  <HeadingRow id={section.container.headingId} title={section.title} />
                ) : (
                  section.title && (
                    <header className="section__head">
                      <span className="section__title">{section.title}</span>
                      {section.subtitle && (
                        <span className="section__subtitle">{section.subtitle}</span>
                      )}
                    </header>
                  )
                ))}
              <div>
                {section.rows.map((row) => {
                  if (row.kind === 'project') {
                    return (
                      <ProjectRow
                        key={row.project.id}
                        title={projectTitle(row.project)}
                        progress={statsByProject.get(row.project.id)?.progress ?? 0}
                        openCount={row.openCount}
                        projectId={row.project.id}
                        status={row.project.status}
                        trashed={row.project.trashed}
                      />
                    );
                  }
                  const todo = row.todo;
                  const isDropTarget =
                    droppable && drop?.sectionId === section.id && drop.targetId === todo.id;
                  return (
                    <ListTaskRow
                      key={todo.id}
                      todo={todo}
                      projectsById={projectsById}
                      areasById={areasById}
                      tagsById={tagsById}
                      visibleIds={visibleIds}
                      sectionId={section.id}
                      reorderable={Boolean(section.reorderable)}
                      dropEdge={isDropTarget ? drop?.edge : undefined}
                      muted={section.muted}
                      showWhen={options.showWhen}
                      showContainer={options.showContainer}
                      onOpenMenu={openTodoMenu}
                      onAllowDrop={allowDrop}
                      onCommitDrop={commitDrop}
                      onFinishDrag={finishDrag}
                    />
                  );
                })}
                {droppable && !section.rows.length && (
                  <div className="section__dropzone">Перенести сюда</div>
                )}
              </div>
            </section>
          );
        })}

        {completionLogging === 'manual' && waitingForLogIds.length > 0 && (
          <div className="log-completed">
            <button
              type="button"
              className="sidebar__action"
              onClick={() => logCompleted(waitingForLogIds)}
            >
              <Icon name="book" size={13} />
              Перенести выполненные в Журнал
            </button>
          </div>
        )}

        {list.kind === 'trash' && hasRows && (
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            {selection.length > 0 && (
              <button
                type="button"
                className="sidebar__action"
                onClick={() => restoreTodo(selection)}
              >
                <Icon name="undo" size={13} />
                Восстановить выбранное
              </button>
            )}
            <button
              type="button"
              className="sidebar__action"
              onClick={() => {
                if (window.confirm('Удалить содержимое корзины навсегда?')) emptyTrash();
              }}
            >
              <Icon name="trash" size={13} />
              Очистить корзину
            </button>
          </div>
        )}
      </div>

      {menuAt && <ContextMenu at={menuAt} onClose={() => setMenuAt(null)} />}

      {tagMenu && (
        <Menu
          at={tagMenu.at}
          title={`Тег «${tagMenu.tag.title}»`}
          onClose={() => setTagMenu(null)}
          groups={[
            [
              {
                key: 'open',
                label: 'Показать всё с этим тегом',
                icon: 'tag',
                run: () => selectList(`tag:${tagMenu.tag.id}`),
              },
              {
                key: 'filter',
                label: activeFilter.includes(tagMenu.tag.id)
                  ? 'Снять фильтр'
                  : 'Фильтровать этот список',
                icon: 'search',
                run: () => toggleTagFilter(tagMenu.tag.id),
              },
            ],
            [
              {
                key: 'rename',
                label: 'Переименовать тег…',
                icon: 'notes',
                run: () => {
                  const next = window.prompt('Новое имя тега', tagMenu.tag.title);
                  if (next?.trim()) renameTag(tagMenu.tag.id, next.trim());
                },
              },
              {
                key: 'remove',
                label: 'Удалить тег',
                icon: 'trash',
                color: 'var(--c-deadline)',
                run: () => {
                  if (window.confirm(`Удалить тег «${tagMenu.tag.title}» со всех задач?`)) {
                    removeTag(tagMenu.tag.id);
                  }
                },
              },
            ],
          ]}
        />
      )}

      <BulkBar />

      {list.kind !== 'logbook' && list.kind !== 'trash' && selection.length < 2 && (
        <button
          type="button"
          className="magic-plus"
          data-testid="magic-plus"
          data-tour="new-todo"
          aria-label="Новая задача"
          title={`Новая задача (${shortcutLabel('N')})`}
          onClick={() =>
            createTodo(monthView ? { when: { kind: 'scheduled', date: calendarDay } } : undefined)
          }
        >
          <Icon name="plus" size={20} />
        </button>
      )}
    </main>
  );
}

/** Section header of a project heading: renamable and removable in place. */
function HeadingRow({ id, title }: { id: Id; title: string }) {
  const updateHeading = useStore((s) => s.updateHeading);
  const removeHeading = useStore((s) => s.removeHeading);
  const [menuAt, setMenuAt] = useState<MenuPosition | null>(null);
  const field = useRef<HTMLInputElement>(null);

  return (
    <header
      className="section__head"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      {menuAt && (
        <Menu
          at={menuAt}
          title={`Заголовок «${title}»`}
          onClose={() => setMenuAt(null)}
          groups={[
            [
              {
                key: 'rename',
                label: 'Переименовать',
                icon: 'notes',
                run: () => {
                  field.current?.focus();
                  field.current?.select();
                },
              },
              {
                key: 'remove',
                label: 'Удалить заголовок',
                icon: 'trash',
                color: 'var(--c-deadline)',
                run: () => removeHeading(id),
              },
            ],
          ]}
        />
      )}
      <input
        ref={field}
        className="section__title section__title-input"
        value={title}
        aria-label="Название заголовка"
        placeholder="Заголовок"
        onChange={(event) => updateHeading(id, { title: event.target.value })}
      />
      <button
        type="button"
        className="section__remove"
        aria-label={`Удалить заголовок ${title}`}
        title="Удалить заголовок"
        onClick={() => removeHeading(id)}
      >
        <Icon name="cross" size={11} />
      </button>
    </header>
  );
}

function ProjectRow({
  title,
  progress,
  openCount,
  projectId,
  status,
  trashed,
}: {
  title: string;
  progress: number;
  openCount: number;
  projectId: string;
  status: ItemStatus;
  trashed?: boolean;
}) {
  const selectList = useStore((s) => s.selectList);
  const restoreProject = useStore((s) => s.restoreProject);
  return (
    <div
      className="row"
      role="button"
      tabIndex={trashed ? -1 : 0}
      aria-disabled={trashed}
      onClick={() => {
        if (!trashed) selectList(`project:${projectId}`);
      }}
      onKeyDown={(event) => {
        if (!trashed && event.key === 'Enter') selectList(`project:${projectId}`);
      }}
    >
      {status === 'open' ? (
        <span className="checkbox checkbox--project">
          <ProgressRing progress={progress} />
        </span>
      ) : (
        <span
          className={`checkbox ${status === 'canceled' ? 'checkbox--canceled' : 'checkbox--done'}`}
          aria-label={status === 'canceled' ? 'Отменённый проект' : 'Завершённый проект'}
        >
          <Icon name={status === 'canceled' ? 'cross' : 'check'} size={11} />
        </span>
      )}
      <div className="row__body">
        <span className="row__title">{title}</span>
        {openCount > 0 && <span className="row__meta">{openCount}</span>}
      </div>
      {trashed && (
        <button
          type="button"
          className="tool"
          aria-label={`Восстановить проект ${title}`}
          title="Восстановить проект"
          onClick={(event) => {
            event.stopPropagation();
            restoreProject(projectId);
          }}
        >
          <Icon name="undo" size={14} />
        </button>
      )}
    </div>
  );
}

/** Big title block. Projects and areas get inline-editable titles and notes. */
function ListHeader() {
  const db = useStore((s) => s.db);
  const selectedList = useStore((s) => s.selectedList);
  const updateProject = useStore((s) => s.updateProject);
  const updateArea = useStore((s) => s.updateArea);
  const completeProject = useStore((s) => s.completeProject);
  const trashProject = useStore((s) => s.trashProject);
  const trashArea = useStore((s) => s.trashArea);
  const createHeading = useStore((s) => s.createHeading);
  const selectList = useStore((s) => s.selectList);
  const freshListId = useStore((s) => s.freshListId);
  const clearFreshList = useStore((s) => s.clearFreshList);
  const [panel, setPanel] = useState<'none' | 'when' | 'deadline' | 'area'>('none');
  const titleField = useRef<HTMLInputElement>(null);

  const list = parseListKey(selectedList);
  const title = listTitle(db, selectedList);
  const isFresh = (list.kind === 'project' || list.kind === 'area') && freshListId === list.id;

  // A brand new project or area opens with its name selected, ready to type over.
  useEffect(() => {
    if (!isFresh) return;
    titleField.current?.focus();
    titleField.current?.select();
    clearFreshList();
  }, [isFresh, clearFreshList]);

  if (list.kind === 'project') {
    const project = db.projects.find((p) => p.id === list.id);
    if (!project) return null;
    return (
      <header className="listhead">
        <span className="listhead__icon">
          <ProgressRing progress={projectProgress(db, project.id)} size={22} />
        </span>
        <div className="listhead__main">
          <input
            ref={titleField}
            className="listhead__title-input"
            value={project.title}
            aria-label="Название проекта"
            placeholder="Новый проект"
            onChange={(event) => updateProject(project.id, { title: event.target.value })}
            onBlur={(event) => {
              const projectName = event.currentTarget.value.trim();
              if (projectName !== project.title) updateProject(project.id, { title: projectName });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                selectList('today');
              }
            }}
          />
          <AutoTextarea
            className="listhead__notes"
            value={project.notes}
            placeholder="Заметки"
            aria-label="Заметки проекта"
            onChange={(event) => updateProject(project.id, { notes: event.target.value })}
          />
          <div className="listhead__meta">
            <span className="anchor">
              <button
                type="button"
                className="attr"
                aria-label="Область проекта"
                onClick={() => setPanel(panel === 'area' ? 'none' : 'area')}
              >
                <Icon name="area" size={11} />
                {db.areas.find((a) => a.id === project.areaId)?.title ?? 'Без области'}
              </button>
              <Popover open={panel === 'area'} onClose={() => setPanel('none')} width={210}>
                <div className="popover__label">Область</div>
                {db.areas.map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className="popitem"
                    onClick={() => {
                      updateProject(project.id, { areaId: area.id });
                      setPanel('none');
                    }}
                  >
                    <span className="popitem__icon">
                      <Icon name="area" size={13} />
                    </span>
                    <span className="popitem__title">{area.title}</span>
                    {project.areaId === area.id && (
                      <span className="popitem__icon" style={{ color: 'var(--accent)' }}>
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </button>
                ))}
                {project.areaId && (
                  <>
                    <div className="popover__divider" />
                    <button
                      type="button"
                      className="popitem"
                      onClick={() => {
                        updateProject(project.id, { areaId: undefined });
                        setPanel('none');
                      }}
                    >
                      <span className="popitem__icon">
                        <Icon name="cross" size={13} />
                      </span>
                      <span className="popitem__title">Без области</span>
                    </button>
                  </>
                )}
              </Popover>
            </span>
            {project.when.kind === 'someday' && (
              <span>
                <Icon name="box" size={11} color="var(--c-someday)" /> Когда-нибудь
              </span>
            )}
            {project.when.kind === 'scheduled' && project.when.date && (
              <span>
                <Icon name="calendar" size={11} /> {formatDayShort(project.when.date)}
              </span>
            )}
            {project.deadline && (
              <span style={{ color: 'var(--c-deadline)' }}>
                <Icon name="flag" size={11} /> {formatDayShort(project.deadline)}
              </span>
            )}
          </div>
        </div>
        <div className="listhead__tools">
          <span className="anchor">
            <button
              type="button"
              className="tool"
              aria-label="Когда"
              onClick={() => setPanel(panel === 'when' ? 'none' : 'when')}
            >
              <Icon name="calendar" size={15} />
            </button>
            <WhenPopover
              open={panel === 'when'}
              onClose={() => setPanel('none')}
              when={project.when}
              onPick={(when) => updateProject(project.id, { when })}
            />
          </span>
          <span className="anchor">
            <button
              type="button"
              className="tool"
              aria-label="Срок сдачи"
              onClick={() => setPanel(panel === 'deadline' ? 'none' : 'deadline')}
            >
              <Icon name="flag" size={15} />
            </button>
            <DeadlinePopover
              open={panel === 'deadline'}
              onClose={() => setPanel('none')}
              deadline={project.deadline}
              onPick={(deadline) => updateProject(project.id, { deadline })}
            />
          </span>
          <button
            type="button"
            className="tool"
            aria-label="Добавить заголовок"
            title="Заголовок"
            onClick={() => createHeading(project.id)}
          >
            <Icon name="notes" size={15} />
          </button>
          <button
            type="button"
            className="tool"
            aria-label={project.status === 'open' ? 'Завершить проект' : 'Возобновить проект'}
            title={project.status === 'open' ? 'Завершить проект' : 'Возобновить проект'}
            onClick={() => completeProject(project.id)}
          >
            <Icon name={project.status === 'open' ? 'check' : 'undo'} size={15} />
          </button>
          <button
            type="button"
            className="tool tool--danger"
            aria-label="Удалить проект"
            title="Удалить проект"
            onClick={() => {
              const label = project.title || 'проект';
              if (
                !window.confirm(`Удалить «${label}» вместе с задачами? Проект окажется в корзине.`)
              ) {
                return;
              }
              trashProject(project.id);
              selectList('today');
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </header>
    );
  }

  if (list.kind === 'area') {
    const area = db.areas.find((a) => a.id === list.id);
    if (!area) return null;
    return (
      <header className="listhead">
        <span className="listhead__icon">
          <Icon name="area" size={20} color="var(--text-secondary)" />
        </span>
        <div className="listhead__main">
          <input
            ref={titleField}
            className="listhead__title-input"
            value={area.title}
            aria-label="Название области"
            placeholder="Новая область"
            onChange={(event) => updateArea(area.id, { title: event.target.value })}
            onBlur={(event) => {
              const areaTitle = event.currentTarget.value.trim();
              if (areaTitle !== area.title) updateArea(area.id, { title: areaTitle });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                selectList('today');
              }
            }}
          />
        </div>
        <div className="listhead__tools">
          <button
            type="button"
            className="tool tool--danger"
            aria-label="Удалить область"
            onClick={() => {
              const label = area.title || 'область';
              if (
                !window.confirm(
                  `Удалить «${label}»? Её задачи уйдут во Входящие, проекты станут самостоятельными.`,
                )
              ) {
                return;
              }
              trashArea(area.id);
              selectList('today');
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </header>
    );
  }

  const meta = list.kind === 'tag' ? null : SMART_LIST_META[list.kind];

  return (
    <header className="listhead">
      <span className="listhead__icon">
        <Icon
          name={(meta?.icon ?? 'tag') as IconName}
          size={21}
          color={meta?.accent ?? 'var(--text-secondary)'}
        />
      </span>
      <div className="listhead__main">
        <h1 className="listhead__title">{title}</h1>
      </div>
    </header>
  );
}
