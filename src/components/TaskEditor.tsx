import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDayShort } from '../domain/dates';
import { projectTitle } from '../domain/lists';
import { describeRepeat } from '../domain/repeat';
import type { Todo } from '../domain/types';
import { registerPendingEdit } from '../store/pendingEdits';
import { useStore } from '../store/store';
import { AutoTextarea } from './AutoTextarea';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';
import { ReminderPopover, RepeatPopover } from './RepeatPopover';
import { TagPopover } from './TagPopover';
import { DeadlinePopover, WhenPopover } from './WhenPopover';

interface TaskEditorProps {
  todo: Todo;
}

type OpenPanel = 'none' | 'when' | 'deadline' | 'tags' | 'repeat' | 'reminder';

function whenLabel(
  todo: Todo,
): { text: string; icon: 'star' | 'moon' | 'calendar' | 'box' } | null {
  switch (todo.when.kind) {
    case 'today':
      return { text: 'Сегодня', icon: 'star' };
    case 'evening':
      return { text: 'Сегодня вечером', icon: 'moon' };
    case 'scheduled':
      return todo.when.date ? { text: formatDayShort(todo.when.date), icon: 'calendar' } : null;
    case 'someday':
      return { text: 'Когда-нибудь', icon: 'box' };
    case 'unscheduled':
      return null;
  }
}

/** The expanded card that replaces a row when a todo is opened. */
export function TaskEditor({ todo }: TaskEditorProps) {
  const [panel, setPanel] = useState<OpenPanel>('none');
  const [focusChecklistId, setFocusChecklistId] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const checklistInputs = useRef(new Map<string, HTMLInputElement>());

  // Keeps the caret inside the checklist when items are added or removed.
  useEffect(() => {
    if (!focusChecklistId) return;
    const input = checklistInputs.current.get(focusChecklistId);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    setFocusChecklistId(null);
  }, [focusChecklistId, todo.checklist.length]);
  const autoPanel = useStore((s) => s.autoPanel);
  const clearAutoPanel = useStore((s) => s.clearAutoPanel);

  // A shortcut like ⌘⇧D opens the editor and asks for a specific panel.
  useEffect(() => {
    if (!autoPanel) return;
    setPanel(autoPanel);
    clearAutoPanel();
  }, [autoPanel, clearAutoPanel]);

  // Narrow selectors: the editor must not re-render on every unrelated change
  // to the database, only when the pieces it actually shows move.
  const projects = useStore((s) => s.db.projects);
  const areas = useStore((s) => s.db.areas);
  const headings = useStore((s) => s.db.headings);
  const allTags = useStore((s) => s.db.tags);
  const isFresh = useStore((s) => s.freshTodoId === todo.id);
  const commitTodoText = useStore((s) => s.commitTodoText);
  const setWhen = useStore((s) => s.setWhen);
  const setDeadline = useStore((s) => s.setDeadline);
  const setImportant = useStore((s) => s.setImportant);
  const setRepeat = useStore((s) => s.setRepeat);
  const setReminder = useStore((s) => s.setReminder);
  const toggleTag = useStore((s) => s.toggleTag);
  const createTag = useStore((s) => s.createTag);
  const completeTodo = useStore((s) => s.completeTodo);
  const uncompleteTodo = useStore((s) => s.uncompleteTodo);
  const trashTodo = useStore((s) => s.trashTodo);
  const closeEditor = useStore((s) => s.closeEditor);
  const selectTodo = useStore((s) => s.selectTodo);
  const setMoveDialog = useStore((s) => s.setMoveDialog);
  const moveDialogOpen = useStore((s) => s.moveDialogOpen);
  const addChecklistItem = useStore((s) => s.addChecklistItem);
  const updateChecklistItem = useStore((s) => s.updateChecklistItem);
  const removeChecklistItem = useStore((s) => s.removeChecklistItem);

  /**
   * Title and notes live locally while the user types: every keystroke would
   * otherwise rewrite the whole database, serialize it and re-render the list.
   * The text lands in the store on a short debounce, on blur, and on close.
   */
  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes);
  const local = useRef({ title: todo.title, notes: todo.notes });
  local.current = { title, notes };
  // Latest committed values, so a flush knows what actually changed.
  const stored = useRef({ id: todo.id, title: todo.title, notes: todo.notes });
  stored.current = { id: todo.id, title: todo.title, notes: todo.notes };
  const debounce = useRef<number | undefined>(undefined);

  const flushText = useCallback(() => {
    if (debounce.current) {
      window.clearTimeout(debounce.current);
      debounce.current = undefined;
    }
    const patch: { title?: string; notes?: string } = {};
    if (local.current.title !== stored.current.title) patch.title = local.current.title;
    if (local.current.notes !== stored.current.notes) patch.notes = local.current.notes;
    if (patch.title !== undefined || patch.notes !== undefined) {
      commitTodoText(stored.current.id, patch);
    }
  }, [commitTodoText]);

  const scheduleFlush = useCallback(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(flushText, 350);
  }, [flushText]);

  // Whatever is pending must reach the store before the card goes away.
  useEffect(() => flushText, [flushText]);

  // Quitting asks every open editor to hand over its text before the database
  // is written, otherwise the last characters never reach the disk.
  useEffect(() => registerPendingEdit(flushText), [flushText]);

  // Adopt an external change (rare: undo closes the editor) only when the user
  // has nothing half-typed here.
  useEffect(() => {
    if (!debounce.current) setTitle(todo.title);
  }, [todo.title]);
  useEffect(() => {
    if (!debounce.current) setNotes(todo.notes);
  }, [todo.notes]);

  /** Text must be saved before closeEditor runs: it deletes a still-blank todo. */
  const commitAndClose = useCallback(() => {
    flushText();
    closeEditor();
  }, [flushText, closeEditor]);

  // Clicking anywhere outside the card commits and closes, like Things does.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (panel !== 'none' || moveDialogOpen) return;
      if (card.current && !card.current.contains(event.target as Node)) {
        // Closing the card shifts the layout, so the click that follows would
        // land on the wrong row. Pick up the intended row right here.
        const row = (event.target as HTMLElement | null)?.closest?.('[data-todo-id]');
        const id = row?.getAttribute('data-todo-id');
        commitAndClose();
        if (id && id !== todo.id) selectTodo(id);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [commitAndClose, selectTodo, todo.id, panel, moveDialogOpen]);

  const when = whenLabel(todo);
  const project = todo.projectId ? projects.find((p) => p.id === todo.projectId) : undefined;
  const area = todo.areaId ? areas.find((a) => a.id === todo.areaId) : undefined;
  const heading = todo.headingId ? headings.find((h) => h.id === todo.headingId) : undefined;
  const tags = todo.tagIds
    .map((id) => allTags.find((t) => t.id === id))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));

  const containerLabel = project
    ? heading
      ? `${projectTitle(project)} › ${heading.title}`
      : projectTitle(project)
    : area?.title;

  return (
    <div
      ref={card}
      className="editor"
      data-testid="task-editor"
      data-tour="task-editor"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          commitAndClose();
        }
      }}
    >
      <div className="editor__head">
        <Checkbox
          status={todo.status}
          label="Отметить выполненной"
          onToggle={() =>
            todo.status === 'open' ? completeTodo(todo.id) : uncompleteTodo(todo.id)
          }
        />
        <AutoTextarea
          className="editor__title"
          placeholder="Новая задача"
          value={title}
          autoFocusEnd={isFresh}
          aria-label="Название задачи"
          onChange={(event) => {
            setTitle(event.target.value);
            scheduleFlush();
          }}
          onBlur={flushText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitAndClose();
            }
          }}
        />
      </div>

      <AutoTextarea
        className="editor__notes"
        placeholder="Заметки"
        value={notes}
        aria-label="Заметки"
        onChange={(event) => {
          setNotes(event.target.value);
          scheduleFlush();
        }}
        onBlur={flushText}
      />

      {todo.checklist.length > 0 && (
        <div className="editor__checklist">
          {todo.checklist.map((item) => (
            <div key={item.id} className={`checkitem${item.done ? ' checkitem--done' : ''}`}>
              <button
                type="button"
                className={`checkitem__box${item.done ? ' checkitem__box--done' : ''}`}
                aria-pressed={item.done}
                aria-label={`Пункт: ${item.title || 'без названия'}`}
                onClick={() => updateChecklistItem(todo.id, item.id, { done: !item.done })}
              >
                {item.done && <Icon name="check" size={9} />}
              </button>
              <input
                className="checkitem__input"
                value={item.title}
                placeholder="Пункт"
                ref={(node) => {
                  if (node) checklistInputs.current.set(item.id, node);
                  else checklistInputs.current.delete(item.id);
                }}
                onChange={(event) =>
                  updateChecklistItem(todo.id, item.id, { title: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    // New item goes right below this one, not at the very end.
                    setFocusChecklistId(addChecklistItem(todo.id, { afterId: item.id }));
                  }
                  if (event.key === 'Backspace' && !item.title) {
                    event.preventDefault();
                    const position = todo.checklist.findIndex((c) => c.id === item.id);
                    const neighbour = todo.checklist[position - 1] ?? todo.checklist[position + 1];
                    removeChecklistItem(todo.id, item.id);
                    if (neighbour) setFocusChecklistId(neighbour.id);
                    else card.current?.querySelector<HTMLElement>('.editor__title')?.focus();
                  }
                }}
              />
              <button
                type="button"
                className="checkitem__remove"
                aria-label="Удалить пункт"
                onClick={() => removeChecklistItem(todo.id, item.id)}
              >
                <Icon name="cross" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(when ||
        todo.deadline ||
        todo.reminder ||
        todo.repeat ||
        tags.length > 0 ||
        containerLabel) && (
        <div className="editor__attrs">
          {when && (
            <button
              type="button"
              className={`attr${todo.when.kind === 'today' ? ' attr--today' : ''}${
                todo.when.kind === 'someday' ? ' attr--someday' : ''
              }`}
              onClick={() => setPanel('when')}
            >
              <Icon name={when.icon} size={12} />
              {when.text}
            </button>
          )}
          {todo.reminder && (
            <button type="button" className="attr" onClick={() => setPanel('reminder')}>
              <Icon name="clock" size={12} />
              {todo.reminder}
            </button>
          )}
          {todo.repeat && (
            <button type="button" className="attr" onClick={() => setPanel('repeat')}>
              <Icon name="repeat" size={12} />
              {describeRepeat(todo.repeat)}
            </button>
          )}
          {todo.deadline && (
            <button
              type="button"
              className="attr attr--deadline"
              onClick={() => setPanel('deadline')}
            >
              <Icon name="flag" size={12} />
              Срок: {formatDayShort(todo.deadline)}
            </button>
          )}
          {tags.map((tag) => (
            <button key={tag.id} type="button" className="attr" onClick={() => setPanel('tags')}>
              {tag.title}
            </button>
          ))}
          {containerLabel && (
            <button type="button" className="attr" onClick={() => setMoveDialog(true)}>
              <Icon name={project ? 'project' : 'area'} size={12} />
              {containerLabel}
            </button>
          )}
        </div>
      )}

      <div className="editor__toolbar">
        <span className="anchor">
          <button
            type="button"
            className="tool"
            aria-label="Когда"
            data-tooltip="Когда"
            onClick={() => setPanel(panel === 'when' ? 'none' : 'when')}
          >
            <Icon name="calendar" size={15} />
          </button>
          <WhenPopover
            open={panel === 'when'}
            onClose={() => setPanel('none')}
            when={todo.when}
            onPick={(next) => setWhen(todo.id, next)}
          />
        </span>

        <button
          type="button"
          className={`tool${todo.important ? ' tool--important' : ''}`}
          aria-label={todo.important ? 'Убрать из важных' : 'Отметить как важное'}
          aria-pressed={Boolean(todo.important)}
          data-tooltip={todo.important ? 'Убрать из важных' : 'Отметить как важное'}
          onClick={() => setImportant(todo.id, !todo.important)}
        >
          <Icon name="important" size={15} />
        </button>

        <span className="anchor">
          <button
            type="button"
            className="tool"
            aria-label="Срок сдачи"
            data-tooltip="Срок сдачи"
            onClick={() => setPanel(panel === 'deadline' ? 'none' : 'deadline')}
          >
            <Icon name="flag" size={15} />
          </button>
          <DeadlinePopover
            open={panel === 'deadline'}
            onClose={() => setPanel('none')}
            deadline={todo.deadline}
            onPick={(day) => setDeadline(todo.id, day)}
          />
        </span>

        <span className="anchor">
          <button
            type="button"
            className="tool"
            aria-label="Напоминание"
            data-tooltip="Напоминание"
            onClick={() => setPanel(panel === 'reminder' ? 'none' : 'reminder')}
          >
            <Icon name="clock" size={15} />
          </button>
          <ReminderPopover
            open={panel === 'reminder'}
            onClose={() => setPanel('none')}
            reminder={todo.reminder}
            onPick={(time) => setReminder(todo.id, time)}
          />
        </span>

        <span className="anchor">
          <button
            type="button"
            className="tool"
            aria-label="Повтор"
            data-tooltip="Повтор"
            onClick={() => setPanel(panel === 'repeat' ? 'none' : 'repeat')}
          >
            <Icon name="repeat" size={15} />
          </button>
          <RepeatPopover
            open={panel === 'repeat'}
            onClose={() => setPanel('none')}
            repeat={todo.repeat}
            onPick={(rule) => setRepeat(todo.id, rule)}
          />
        </span>

        <span className="anchor">
          <button
            type="button"
            className="tool"
            aria-label="Теги"
            data-tooltip="Теги"
            onClick={() => setPanel(panel === 'tags' ? 'none' : 'tags')}
          >
            <Icon name="tag" size={15} />
          </button>
          <TagPopover
            open={panel === 'tags'}
            onClose={() => setPanel('none')}
            tags={allTags}
            selected={todo.tagIds}
            onToggle={(tagId) => toggleTag(todo.id, tagId)}
            onCreate={(name) => toggleTag(todo.id, createTag(name))}
          />
        </span>

        <button
          type="button"
          className="tool"
          aria-label="Добавить пункт списка"
          data-tooltip="Добавить пункт списка"
          onClick={() => setFocusChecklistId(addChecklistItem(todo.id))}
          data-testid="add-checklist-item"
        >
          <Icon name="checklist" size={15} />
        </button>

        <button
          type="button"
          className="tool"
          aria-label="Переместить"
          data-tooltip="Переместить"
          onClick={() => setMoveDialog(true)}
        >
          <Icon name="move" size={15} />
        </button>

        <span className="editor__toolbar-spacer" />

        <button
          type="button"
          className="tool tool--danger"
          aria-label="Удалить задачу"
          data-tooltip="Удалить задачу"
          onClick={() => {
            trashTodo(todo.id);
            closeEditor();
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}
