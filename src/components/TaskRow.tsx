import type { DragEvent, MouseEvent } from 'react';
import { formatDayShort, isPast, isToday } from '../domain/dates';
import { describeRepeat } from '../domain/repeat';
import type { Area, Id, Project, Tag, Todo } from '../domain/types';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';

export type DropEdge = 'top' | 'bottom';

interface TaskRowProps {
  todo: Todo;
  projectsById: ReadonlyMap<Id, Project>;
  areasById: ReadonlyMap<Id, Area>;
  tagsById: ReadonlyMap<Id, Tag>;
  selected: boolean;
  /** Trash and Logbook rows cannot be dragged anywhere useful. */
  draggable?: boolean;
  dragging?: boolean;
  dropEdge?: DropEdge;
  muted?: boolean;
  /** Show which project/area the todo belongs to (smart lists only). */
  showContainer?: boolean;
  /** Show the scheduled day (hidden in Today/Upcoming where it is implied). */
  showWhen?: boolean;
  onClick: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  /** Clicking a tag chip jumps to the list of everything wearing that tag. */
  onTagClick: (tagId: string) => void;
  onOpen: () => void;
  onToggle: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent, edge: DropEdge) => void;
  onDrop: (event: DragEvent, edge: DropEdge) => void;
  onDragEnd: () => void;
}

/** Which half of the row the pointer is in, for the insertion line. */
function edgeOf(event: DragEvent<HTMLElement>): DropEdge {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY - box.top < box.height / 2 ? 'top' : 'bottom';
}

export function TaskRow({
  todo,
  projectsById,
  areasById,
  tagsById,
  selected,
  draggable,
  dragging,
  dropEdge,
  muted,
  showContainer,
  showWhen,
  onClick,
  onContextMenu,
  onTagClick,
  onOpen,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TaskRowProps) {
  const project = todo.projectId ? projectsById.get(todo.projectId) : undefined;
  const area = todo.areaId ? areasById.get(todo.areaId) : undefined;
  const container = project?.title ?? area?.title;
  const tags = todo.tagIds
    .map((id) => tagsById.get(id))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
  const checklistDone = todo.checklist.filter((item) => item.done).length;

  const scheduled = todo.when.kind === 'scheduled' && todo.when.date ? todo.when.date : undefined;
  const showTodayStar = showWhen && (todo.when.kind === 'today' || todo.when.kind === 'evening');

  return (
    <div
      className={[
        'row',
        selected && 'row--selected',
        muted && 'row--muted',
        dragging && 'row--dragging',
        dropEdge === 'top' && 'row--drop-top',
        dropEdge === 'bottom' && 'row--drop-bottom',
        todo.status === 'canceled' && 'row--canceled',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      draggable={draggable}
      data-testid="task-row"
      data-todo-id={todo.id}
      aria-label={todo.title || 'Новая задача'}
      aria-selected={selected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      onDragStart={onDragStart}
      onDragOver={(event) => onDragOver(event, edgeOf(event))}
      onDrop={(event) => onDrop(event, edgeOf(event))}
      onDragEnd={onDragEnd}
    >
      <Checkbox
        status={todo.status}
        label={todo.trashed ? `Восстановить: ${todo.title}` : `Отметить: ${todo.title}`}
        onToggle={onToggle}
      />

      <div className="row__body">
        <span className={`row__title${todo.title ? '' : ' row__title--empty'}`}>
          {todo.title || 'Новая задача'}
        </span>

        {showTodayStar && (
          <span className="row__meta row__meta--today" title="Сегодня">
            <Icon name={todo.when.kind === 'evening' ? 'moon' : 'star'} size={11} />
          </span>
        )}

        {showWhen && scheduled && (
          <span className="row__meta">
            <Icon name="calendar" size={11} />
            {formatDayShort(scheduled)}
          </span>
        )}

        {todo.reminder && (
          <span className="row__meta" title="Напоминание">
            <Icon name="clock" size={11} />
            {todo.reminder}
          </span>
        )}

        {todo.deadline && (
          <span
            className={`row__meta${
              isPast(todo.deadline) || isToday(todo.deadline) ? ' row__meta--deadline' : ''
            }`}
            title="Срок сдачи"
          >
            <Icon name="flag" size={11} />
            {formatDayShort(todo.deadline)}
          </span>
        )}

        {showContainer && container && <span className="chip">{container}</span>}

        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="chip chip--tag"
            title={`Показать всё с тегом «${tag.title}»`}
            onClick={(event) => {
              // A tag on a row is the shortest path to "everything with this tag".
              event.stopPropagation();
              onTagClick(tag.id);
            }}
          >
            {tag.title}
          </button>
        ))}

        <span className="row__indicators">
          {todo.repeat && (
            <span title={describeRepeat(todo.repeat)}>
              <Icon name="repeat" size={11} />
            </span>
          )}
          {todo.notes.trim() && <Icon name="notes" size={11} />}
          {todo.checklist.length > 0 && (
            <span style={{ fontSize: 'var(--size-meta)' }}>
              {checklistDone}/{todo.checklist.length}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
