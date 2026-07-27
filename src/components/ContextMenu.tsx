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
            hint: '⌘T',
            run: () => setWhen(selection, { kind: 'today' }),
          },
          {
            key: 'evening',
            label: 'Сегодня вечером',
            icon: 'moon',
            hint: '⌘E',
            run: () => setWhen(selection, { kind: 'evening' }),
          },
          {
            key: 'someday',
            label: 'Когда-нибудь',
            icon: 'box',
            color: 'var(--c-someday)',
            hint: '⌘O',
            run: () => setWhen(selection, { kind: 'someday' }),
          },
          {
            key: 'anytime',
            label: 'Убрать дату',
            icon: 'cross',
            hint: '⌘R',
            run: () => setWhen(selection, { kind: 'unscheduled' }),
          },
        ],
        [
          {
            key: 'when',
            label: 'Выбрать дату…',
            icon: 'calendar',
            hint: '⌘S',
            run: () => anchor && openEditorPanel(anchor, 'when'),
          },
          {
            key: 'deadline',
            label: 'Срок сдачи…',
            icon: 'flag',
            color: 'var(--c-deadline)',
            hint: '⇧⌘D',
            run: () => anchor && openEditorPanel(anchor, 'deadline'),
          },
          {
            key: 'tags',
            label: 'Теги…',
            icon: 'tag',
            hint: '⇧⌘T',
            run: () => anchor && openEditorPanel(anchor, 'tags'),
          },
          {
            key: 'repeat',
            label: 'Повтор…',
            icon: 'repeat',
            hint: '⇧⌘R',
            run: () => anchor && openEditorPanel(anchor, 'repeat'),
          },
        ],
        [
          {
            key: 'move',
            label: 'Переместить…',
            icon: 'move',
            hint: '⇧⌘M',
            run: () => setMoveDialog(true),
          },
          {
            key: 'duplicate',
            label: 'Дублировать',
            icon: 'moved',
            hint: '⌘D',
            run: () => duplicateTodo(selection),
          },
        ],
        [
          {
            key: 'complete',
            label: allDone ? 'Снять отметку' : 'Выполнено',
            icon: 'check',
            hint: '⌘.',
            run: () => (allDone ? uncompleteTodo(selection) : completeTodo(selection)),
          },
          {
            key: 'cancel',
            label: 'Отменено',
            icon: 'cross',
            hint: '⌥⌘.',
            run: () => cancelTodo(selection),
          },
          {
            key: 'trash',
            label: 'В корзину',
            icon: 'trash',
            color: 'var(--c-deadline)',
            hint: '⌘⌫',
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
