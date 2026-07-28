import { useEffect } from 'react';
import { selectSections } from '../domain/lists';
import { SMART_LISTS } from '../domain/types';
import type { SmartList } from '../domain/types';
import { useStore } from '../store/store';

function editingText(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
  );
}

/**
 * Native menu commands arrive here. On macOS the menu swallows the accelerators
 * before the page sees them, so the menu is the source of truth in the desktop app
 * and `useKeyboard` covers the browser.
 */
export function useDesktopMenu() {
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    document.documentElement.dataset.desktop = 'true';
    // Windows and Linux keep their native title bar, macOS does not.
    document.documentElement.dataset.platform = bridge.platform;

    return bridge.onCommand((command, payload) => {
      const store = useStore.getState();
      const anchor = store.selectedTodoId;
      const selection = store.selection;

      // Same rule as for the keyboard: while the introduction is up, menu items
      // must not change anything behind it. Quitting, reloading and the other
      // system roles are handled by Electron itself and never arrive here.
      if (store.onboardingOpen || store.tourOpen) return;

      if (command.startsWith('list:')) {
        const key = command.slice(5) as SmartList;
        if (SMART_LISTS.includes(key)) store.selectList(key);
        return;
      }

      switch (command) {
        case 'new-todo':
          store.createTodo();
          return;
        case 'quick-add': {
          // Text captured in the Quick Entry window lands in the Inbox.
          const title = (payload ?? '').trim();
          if (!title) return;
          const id = store.createTodo({ title, target: {}, when: { kind: 'unscheduled' } });
          store.closeEditor();
          store.selectTodo(id);
          return;
        }
        case 'new-project':
          store.selectList(`project:${store.createProject()}`);
          return;
        case 'quick-find':
          store.setQuickFind(true);
          return;
        case 'shortcuts':
          store.setShortcuts(true);
          return;
        case 'settings':
          store.setSettings(true);
          return;
        case 'select-all': {
          if (editingText()) {
            document.execCommand('selectAll');
            return;
          }
          const ids = selectSections(store.db, store.selectedList).flatMap((section) =>
            section.rows.flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : [])),
          );
          if (ids.length) store.selectRange(ids, ids[ids.length - 1]);
          return;
        }
        case 'theme-toggle':
          store.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
          return;
        case 'undo':
          // Inside a text field the native text undo is what the user expects.
          if (editingText()) document.execCommand('undo');
          else store.undo();
          return;
        case 'redo':
          if (editingText()) document.execCommand('redo');
          else store.redo();
          return;
        default:
          break;
      }

      if (!selection.length || !anchor) return;

      switch (command) {
        case 'today':
          store.setWhen(selection, { kind: 'today' });
          return;
        case 'evening':
          store.setWhen(selection, { kind: 'evening' });
          return;
        case 'someday':
          store.setWhen(selection, { kind: 'someday' });
          return;
        case 'anytime':
          store.setWhen(selection, { kind: 'unscheduled' });
          return;
        case 'when':
          store.openEditorPanel(anchor, 'when');
          return;
        case 'deadline':
          store.openEditorPanel(anchor, 'deadline');
          return;
        case 'tags':
          store.openEditorPanel(anchor, 'tags');
          return;
        case 'repeat':
          store.openEditorPanel(anchor, 'repeat');
          return;
        case 'reminder':
          store.openEditorPanel(anchor, 'reminder');
          return;
        case 'move':
          store.setMoveDialog(true);
          return;
        case 'complete':
          store.completeTodo(selection);
          return;
        case 'cancel':
          store.cancelTodo(selection);
          return;
        case 'delete':
          store.trashTodo(selection);
          return;
        case 'duplicate':
          store.duplicateTodo(selection);
          return;
        default:
          break;
      }
    });
  }, []);
}
