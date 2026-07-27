import { useStore } from '../store/store';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Создание и навигация',
    items: [
      ['Новая задача', '⌘N'],
      ['Новый проект', '⇧⌘N'],
      ['Быстрый поиск', '⌘F'],
      ['Списки 1–7', '⌘1…⌘7'],
      ['Вверх / вниз по списку', '↑ ↓'],
      ['Расширить выделение', '⇧↑ ⇧↓'],
      ['Выделить точечно', '⌘-клик'],
      ['Выделить диапазон', '⇧-клик'],
      ['Выбрать всё в списке', '⌘A'],
      ['Открыть задачу', '⏎ или Space'],
      ['Закрыть, снять выделение', 'Esc'],
      ['Быстрый ввод (в приложении)', '⌃⌥Space'],
      ['Настройки', '⌘,'],
      ['Эта справка', '⌘/'],
    ],
  },
  {
    title: 'Работа с задачей',
    items: [
      ['Сегодня', '⌘T'],
      ['Сегодня вечером', '⌘E'],
      ['Когда-нибудь', '⌘O'],
      ['Убрать дату', '⌘R'],
      ['Выбрать дату', '⌘S'],
      ['Срок сдачи', '⇧⌘D'],
      ['Теги', '⇧⌘T'],
      ['Повтор', '⇧⌘R'],
      ['Напоминание', '⌥⌘R'],
      ['Переместить', '⇧⌘M'],
      ['Дублировать', '⌘D'],
      ['Меню действий', 'правый клик'],
      ['Выполнено', '⌘.'],
      ['Отменено', '⌥⌘.'],
      ['В корзину', '⌘⌫'],
      ['Отменить действие', '⌘Z'],
      ['Повторить действие', '⇧⌘Z'],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsOpen);
  const setShortcuts = useStore((s) => s.setShortcuts);
  if (!open) return null;

  return (
    <div className="dialog__scrim" onMouseDown={() => setShortcuts(false)}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Горячие клавиши"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shortcuts">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="shortcuts__title" style={{ padding: '0 0 6px' }}>
                {group.title}
              </div>
              {group.items.map(([label, keys]) => (
                <div key={label} className="shortcuts__row">
                  <span>{label}</span>
                  <span className="shortcuts__keys">{keys}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
