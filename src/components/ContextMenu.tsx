import { comboLabel } from '../domain/platform';
import { useStore } from '../store/store';
import { Menu } from './Menu';
import type { MenuItem, MenuPosition } from './Menu';

export type ContextMenuTarget = MenuPosition;

interface ContextMenuProps {
  at: MenuPosition;
  onClose: () => void;
}

/** Right-click menu for the selected todos, mirroring the keyboard shortcuts. */
export function ContextMenu({ at, onClose }: ContextMenuProps) {
  const db = useStore((s) => s.db);
  const selection = useStore((s) => s.selection);
  const anchor = useStore((s) => s.selectedTodoId);
  const setWhen = useStore((s) => s.setWhen);
  const setImportant = useStore((s) => s.setImportant);
  const openEditorPanel = useStore((s) => s.openEditorPanel);
  const setMoveDialog = useStore((s) => s.setMoveDialog);
  const duplicateTodo = useStore((s) => s.duplicateTodo);
  const completeTodo = useStore((s) => s.completeTodo);
  const uncompleteTodo = useStore((s) => s.uncompleteTodo);
  const cancelTodo = useStore((s) => s.cancelTodo);
  const trashTodo = useStore((s) => s.trashTodo);
  const restoreTodo = useStore((s) => s.restoreTodo);

  const todos = selection
    .map((id) => db.todos.find((todo) => todo.id === id))
    .filter((todo): todo is NonNullable<typeof todo> => Boolean(todo));
  if (!todos.length) return null;

  const inTrash = todos.every((todo) => todo.trashed);
  const allDone = todos.every((todo) => todo.status === 'completed');
  const allImportant = todos.every((todo) => todo.important);

  const groups: MenuItem[][] = inTrash
    ? [
        [
          {
            key: 'restore',
            label: 'Восстановить',
            icon: 'undo',
            run: () => restoreTodo(selection),
          },
        ],
      ]
    : [
        [
          {
            key: 'today',
            label: 'Сегодня',
            icon: 'star',
            color: 'var(--c-today)',
            hint: comboLabel('mod+T'),
            run: () => setWhen(selection, { kind: 'today' }),
          },
          {
            key: 'evening',
            label: 'Сегодня вечером',
            icon: 'moon',
            hint: comboLabel('mod+E'),
            run: () => setWhen(selection, { kind: 'evening' }),
          },
          {
            key: 'someday',
            label: 'Когда-нибудь',
            icon: 'box',
            color: 'var(--c-someday)',
            hint: comboLabel('mod+O'),
            run: () => setWhen(selection, { kind: 'someday' }),
          },
          {
            key: 'anytime',
            label: 'Убрать дату',
            icon: 'cross',
            hint: comboLabel('mod+R'),
            run: () => setWhen(selection, { kind: 'unscheduled' }),
          },
        ],
        [
          {
            key: 'important',
            label: allImportant ? 'Убрать из важных' : 'Отметить как важное',
            icon: 'important',
            color: 'var(--c-important)',
            run: () => setImportant(selection, !allImportant),
          },
          {
            key: 'when',
            label: 'Выбрать дату…',
            icon: 'calendar',
            hint: comboLabel('mod+S'),
            run: () => anchor && openEditorPanel(anchor, 'when'),
          },
          {
            key: 'deadline',
            label: 'Срок сдачи…',
            icon: 'flag',
            color: 'var(--c-deadline)',
            hint: comboLabel('shift+mod+D'),
            run: () => anchor && openEditorPanel(anchor, 'deadline'),
          },
          {
            key: 'tags',
            label: 'Теги…',
            icon: 'tag',
            hint: comboLabel('shift+mod+T'),
            run: () => anchor && openEditorPanel(anchor, 'tags'),
          },
          {
            key: 'repeat',
            label: 'Повтор…',
            icon: 'repeat',
            hint: comboLabel('shift+mod+R'),
            run: () => anchor && openEditorPanel(anchor, 'repeat'),
          },
        ],
        [
          {
            key: 'move',
            label: 'Переместить…',
            icon: 'move',
            hint: comboLabel('shift+mod+M'),
            run: () => setMoveDialog(true),
          },
          {
            key: 'duplicate',
            label: 'Дублировать',
            icon: 'moved',
            hint: comboLabel('mod+D'),
            run: () => duplicateTodo(selection),
          },
        ],
        [
          {
            key: 'complete',
            label: allDone ? 'Снять отметку' : 'Выполнено',
            icon: 'check',
            hint: comboLabel('mod+.'),
            run: () => (allDone ? uncompleteTodo(selection) : completeTodo(selection)),
          },
          {
            key: 'cancel',
            label: 'Отменено',
            icon: 'cross',
            hint: comboLabel('alt+mod+.'),
            run: () => cancelTodo(selection),
          },
          {
            key: 'trash',
            label: 'В корзину',
            icon: 'trash',
            color: 'var(--c-deadline)',
            hint: comboLabel('mod+Backspace'),
            run: () => trashTodo(selection),
          },
        ],
      ];

  return (
    <Menu
      at={at}
      groups={groups}
      title={selection.length > 1 ? `Выбрано: ${selection.length}` : undefined}
      onClose={onClose}
    />
  );
}
