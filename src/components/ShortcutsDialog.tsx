import {
  comboLabel,
  isMacPlatform,
  keyLabel,
  modifierSymbol,
  quickEntryLabel,
  shiftSymbol,
} from '../domain/platform';
import { useStore } from '../store/store';

/**
 * Combinations are described once and rendered for the running platform: the
 * handlers accept ⌘ or Ctrl, so the sheet must not insist on macOS glyphs.
 */
const GROUPS: { title: string; items: [string, (mac: boolean) => string][] }[] = [
  {
    title: 'Создание и навигация',
    items: [
      ['Новая задача', (mac) => comboLabel('mod+N', mac)],
      ['Новый проект', (mac) => comboLabel('shift+mod+N', mac)],
      ['Быстрый поиск', (mac) => comboLabel('mod+F', mac)],
      ['Списки 1–7', (mac) => `${comboLabel('mod+1', mac)}…${comboLabel('mod+7', mac)}`],
      ['Вверх / вниз по списку', () => '↑ ↓'],
      ['Расширить выделение', (mac) => `${shiftSymbol(mac)}↑ ${shiftSymbol(mac)}↓`],
      ['Выделить точечно', (mac) => `${modifierSymbol(mac)}-клик`],
      ['Выделить диапазон', (mac) => `${shiftSymbol(mac)}-клик`],
      ['Выбрать всё в списке', (mac) => comboLabel('mod+A', mac)],
      ['Открыть задачу', (mac) => `${keyLabel('Enter', mac)} или Space`],
      ['Закрыть, снять выделение', () => 'Esc'],
      ['Быстрый ввод (глобально)', (mac) => quickEntryLabel(mac)],
      ['Настройки', (mac) => comboLabel('mod+,', mac)],
      ['Эта справка', (mac) => comboLabel('mod+/', mac)],
    ],
  },
  {
    title: 'Работа с задачей',
    items: [
      ['Сегодня', (mac) => comboLabel('mod+T', mac)],
      ['Сегодня вечером', (mac) => comboLabel('mod+E', mac)],
      ['Когда-нибудь', (mac) => comboLabel('mod+O', mac)],
      ['Убрать дату', (mac) => comboLabel('mod+R', mac)],
      ['Выбрать дату', (mac) => comboLabel('mod+S', mac)],
      ['Срок сдачи', (mac) => comboLabel('shift+mod+D', mac)],
      ['Теги', (mac) => comboLabel('shift+mod+T', mac)],
      ['Повтор', (mac) => comboLabel('shift+mod+R', mac)],
      ['Напоминание', (mac) => comboLabel('alt+mod+R', mac)],
      ['Переместить', (mac) => comboLabel('shift+mod+M', mac)],
      ['Дублировать', (mac) => comboLabel('mod+D', mac)],
      ['Меню действий', () => 'правый клик'],
      ['Выполнено', (mac) => comboLabel('mod+.', mac)],
      ['Отменено', (mac) => comboLabel('alt+mod+.', mac)],
      ['В корзину', (mac) => comboLabel('mod+Backspace', mac)],
      ['Отменить действие', (mac) => comboLabel('mod+Z', mac)],
      ['Повторить действие', (mac) => comboLabel('shift+mod+Z', mac)],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsOpen);
  const setShortcuts = useStore((s) => s.setShortcuts);
  const mac = isMacPlatform();
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
                  <span className="shortcuts__keys">{keys(mac)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
