import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { formatDayShort } from '../domain/dates';
import { shortcutLabel } from '../domain/platform';
import {
  SMART_LIST_META,
  listTitle,
  projectProgress,
  projectTitle,
  selectSections,
} from '../domain/lists';
import { parseListKey } from '../domain/types';
import type { Database, Id, Section, Tag } from '../domain/types';
import { useStore } from '../store/store';
import { BulkBar } from './BulkBar';
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
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) => row.kind === 'todo' && row.todo.tagIds.some((id) => tagFilter.includes(id)),
      ),
    }))
    .filter((section) => section.rows.length > 0);
}

export function ListView() {
  const db = useStore((s) => s.db);
  const selectedList = useStore((s) => s.selectedList);
  const selection = useStore((s) => s.selection);
  const selectedTodoId = useStore((s) => s.selectedTodoId);
  const selectionAnchor = useStore((s) => s.selectionAnchor);
  const editingTodoId = useStore((s) => s.editingTodoId);
  const draggingIds = useStore((s) => s.draggingIds);
  const selectTodo = useStore((s) => s.selectTodo);
  const selectList = useStore((s) => s.selectList);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const selectRange = useStore((s) => s.selectRange);
  const openEditor = useStore((s) => s.openEditor);
  const completeTodo = useStore((s) => s.completeTodo);
  const uncompleteTodo = useStore((s) => s.uncompleteTodo);
  const restoreTodo = useStore((s) => s.restoreTodo);
  const createTodo = useStore((s) => s.createTodo);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const dropTodos = useStore((s) => s.dropTodos);
  const setDragging = useStore((s) => s.setDragging);
  const endDrag = useStore((s) => s.endDrag);
  const tagFilter = useStore((s) => s.tagFilter);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const clearTagFilter = useStore((s) => s.clearTagFilter);
  const renameTag = useStore((s) => s.renameTag);
  const removeTag = useStore((s) => s.removeTag);

  const [drop, setDrop] = useState<DropState | null>(null);
  const [menuAt, setMenuAt] = useState<ContextMenuTarget | null>(null);
  const [tagMenu, setTagMenu] = useState<{ at: MenuPosition; tag: Tag } | null>(null);

  const list = parseListKey(selectedList);
  // Deriving the sections walks the whole database, so it must not run on every
  // click or drag — only when the data or the chosen list actually changes.
  const allSections = useMemo<Section[]>(
    () => selectSections(db, selectedList),
    [db, selectedList],
  );
  const availableTags = useMemo(() => tagsInSections(db, allSections), [db, allSections]);
  const activeFilter = useMemo(
    () => tagFilter.filter((id) => availableTags.some((tag) => tag.id === id)),
    [tagFilter, availableTags],
  );
  const sections = useMemo(
    () => applyTagFilter(allSections, activeFilter),
    [allSections, activeFilter],
  );
  const options = rowOptions(list.kind);
  const hasRows = sections.some((section) => section.rows.length > 0);
  const visibleIds = sections.flatMap((section) =>
    section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
  );

  const handleClick = (id: Id, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(id);
      return;
    }
    if (event.shiftKey) {
      const anchor = selectionAnchor ?? selectedTodoId;
      const from = anchor ? visibleIds.indexOf(anchor) : -1;
      const to = visibleIds.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        // Merge, so rows picked earlier with ⌘-click survive.
        selectRange(visibleIds.slice(start, end + 1), id, true);
        return;
      }
    }
    if (selection.length === 1 && selection[0] === id) openEditor(id);
    else selectTodo(id);
  };

  const beginDrag = (id: Id, event: DragEvent) => {
    const ids = selection.includes(id) ? selection : [id];
    if (!selection.includes(id)) selectTodo(id);
    setDragging(ids);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
  };

  const allowDrop = (event: DragEvent, next: DropState) => {
    if (!draggingIds.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (
      drop?.sectionId !== next.sectionId ||
      drop?.targetId !== next.targetId ||
      drop?.edge !== next.edge
    ) {
      setDrop(next);
    }
  };

  /** Applies a drop: re-home, re-schedule and reorder in one step. */
  const commitDrop = (section: Section, targetId: Id | undefined, edge: DropEdge) => {
    const ids = draggingIds;
    setDrop(null);
    endDrag();
    if (!ids.length) return;

    const sectionIds = section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : []));
    const kept = sectionIds.filter((id) => !ids.includes(id));
    let position = kept.length;
    if (targetId && !ids.includes(targetId)) {
      const at = kept.indexOf(targetId);
      if (at !== -1) position = edge === 'top' ? at : at + 1;
    }
    const order = [...kept.slice(0, position), ...ids, ...kept.slice(position)];

    dropTodos(ids, {
      container: section.container,
      when: section.when,
      order,
    });
  };

  return (
    <main
      className="app__content"
      onClick={(event) => {
        if (event.target === event.currentTarget) selectTodo(undefined);
      }}
    >
      <div className="app__inner">
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

        {!hasRows && (
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

        {sections.map((section) => {
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
                      commitDrop(section, drop?.targetId, drop?.edge ?? 'bottom');
                    }
                  : undefined
              }
            >
              {section.title && section.container?.headingId ? (
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
              )}
              <div>
                {section.rows.map((row) => {
                  if (row.kind === 'project') {
                    return (
                      <ProjectRow
                        key={row.project.id}
                        title={projectTitle(row.project)}
                        progress={projectProgress(db, row.project.id)}
                        openCount={row.openCount}
                        projectId={row.project.id}
                        trashed={row.project.trashed}
                      />
                    );
                  }
                  const todo = row.todo;
                  if (todo.id === editingTodoId) {
                    return <TaskEditor key={todo.id} todo={todo} />;
                  }
                  const isDropTarget =
                    droppable && drop?.sectionId === section.id && drop.targetId === todo.id;
                  return (
                    <TaskRow
                      key={todo.id}
                      todo={todo}
                      db={db}
                      selected={selection.includes(todo.id)}
                      draggable={Boolean(section.reorderable)}
                      dragging={draggingIds.includes(todo.id)}
                      dropEdge={isDropTarget ? drop?.edge : undefined}
                      muted={section.muted}
                      showWhen={options.showWhen}
                      showContainer={options.showContainer}
                      onClick={(event) => handleClick(todo.id, event)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        // Right-clicking outside the selection selects that row first.
                        if (!selection.includes(todo.id)) selectTodo(todo.id);
                        setMenuAt({ x: event.clientX, y: event.clientY });
                      }}
                      onTagClick={(tagId) => selectList(`tag:${tagId}`)}
                      onOpen={() => openEditor(todo.id)}
                      onToggle={() => {
                        if (todo.trashed) restoreTodo(todo.id);
                        else if (todo.status === 'open') completeTodo(todo.id);
                        else uncompleteTodo(todo.id);
                      }}
                      onDragStart={(event) => beginDrag(todo.id, event)}
                      onDragOver={(event, edge) => {
                        if (!droppable) return;
                        event.stopPropagation();
                        allowDrop(event, { sectionId: section.id, targetId: todo.id, edge });
                      }}
                      onDrop={(event, edge) => {
                        if (!droppable) return;
                        event.preventDefault();
                        event.stopPropagation();
                        commitDrop(section, todo.id, edge);
                      }}
                      onDragEnd={() => {
                        setDrop(null);
                        endDrag();
                      }}
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
          aria-label="Новая задача"
          title="Новая задача (⌘N)"
          onClick={() => createTodo()}
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
  trashed,
}: {
  title: string;
  progress: number;
  openCount: number;
  projectId: string;
  trashed?: boolean;
}) {
  const selectList = useStore((s) => s.selectList);
  const restoreProject = useStore((s) => s.restoreProject);
  return (
    <div
      className="row"
      role="button"
      tabIndex={0}
      onClick={() => selectList(`project:${projectId}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') selectList(`project:${projectId}`);
      }}
    >
      <span className="checkbox checkbox--project">
        <ProgressRing progress={progress} />
      </span>
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
          />
          <textarea
            className="listhead__notes"
            rows={1}
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
            aria-label="Завершить проект"
            title="Завершить проект"
            onClick={() => completeProject(project.id)}
          >
            <Icon name="check" size={15} />
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
