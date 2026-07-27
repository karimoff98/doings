import { useStore } from '../store/store';
import { Icon } from './Icon';

function plural(count: number): string {
  const tail = count % 10;
  const hundred = count % 100;
  if (tail === 1 && hundred !== 11) return 'задача';
  if (tail >= 2 && tail <= 4 && (hundred < 12 || hundred > 14)) return 'задачи';
  return 'задач';
}

/** Appears when more than one row is selected, mirroring Things' batch actions. */
export function BulkBar() {
  const selection = useStore((s) => s.selection);
  const setWhen = useStore((s) => s.setWhen);
  const completeTodo = useStore((s) => s.completeTodo);
  const trashTodo = useStore((s) => s.trashTodo);
  const setMoveDialog = useStore((s) => s.setMoveDialog);
  const selectTodo = useStore((s) => s.selectTodo);

  if (selection.length < 2) return null;

  return (
    <div className="bulkbar" role="toolbar" aria-label="Действия над выбранными задачами">
      <span className="bulkbar__count">
        {selection.length} {plural(selection.length)}
      </span>
      <button
        type="button"
        className="tool"
        title="Сегодня"
        aria-label="Сегодня"
        onClick={() => setWhen(selection, { kind: 'today' })}
      >
        <Icon name="star" size={15} />
      </button>
      <button
        type="button"
        className="tool"
        title="Когда-нибудь"
        aria-label="Когда-нибудь"
        onClick={() => setWhen(selection, { kind: 'someday' })}
      >
        <Icon name="box" size={15} />
      </button>
      <button
        type="button"
        className="tool"
        title="Переместить"
        aria-label="Переместить"
        onClick={() => setMoveDialog(true)}
      >
        <Icon name="move" size={15} />
      </button>
      <button
        type="button"
        className="tool"
        title="Выполнено"
        aria-label="Выполнено"
        onClick={() => completeTodo(selection)}
      >
        <Icon name="check" size={15} />
      </button>
      <button
        type="button"
        className="tool tool--danger"
        title="В корзину"
        aria-label="В корзину"
        onClick={() => trashTodo(selection)}
      >
        <Icon name="trash" size={15} />
      </button>
      <button
        type="button"
        className="tool"
        title="Снять выделение"
        aria-label="Снять выделение"
        onClick={() => selectTodo(undefined)}
      >
        <Icon name="cross" size={14} />
      </button>
    </div>
  );
}
