import { useEffect } from 'react';
import { selectSections } from '../domain/lists';
import { SMART_LISTS } from '../domain/types';
import type { Id } from '../domain/types';
import { useStore } from '../store/store';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/** Visible todo ids in display order, used for arrow navigation. */
function visibleTodoIds(): Id[] {
  const { db, selectedList } = useStore.getState();
  return selectSections(db, selectedList)
    .flatMap((section) => section.rows)
    .flatMap((row) => (row.kind === 'todo' ? [row.todo.id] : []));
}

/**
 * Global keyboard layer. Things is keyboard-first, so most actions work
 * without ever opening a menu. Everything that changes todos applies to the
 * whole selection.
 */
export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);
      const anchor = store.selectedTodoId;
      const selection = store.selection;
      const key = event.key.toLowerCase();
      // `event.key` follows the current layout: the physical Z key is "я" on
      // Russian. Shortcuts must follow the key position, like native macOS apps.
      const undoKey = key === 'z' || event.code === 'KeyZ';

      // The introduction is modal: nothing behind it may react to the keyboard,
      // not even Escape, which would otherwise dismiss it by accident.
      if (store.onboardingOpen || store.tourOpen) {
        if (mod) event.preventDefault();
        return;
      }

      // Dialogs own the keyboard while they are open.
      if (
        store.quickFindOpen ||
        store.moveDialogOpen ||
        store.shortcutsOpen ||
        store.settingsOpen ||
        store.dailyReviewOpen
      ) {
        if (event.key === 'Escape') {
          store.setQuickFind(false);
          store.setMoveDialog(false);
          store.setShortcuts(false);
          store.setSettings(false);
          store.setDailyReview(false);
        }
        if (mod && key === 'f') event.preventDefault();
        return;
      }

      // While the caret is in a text field these belong to the text, not to us:
      // ⌘Z undoes typing, ⌘A selects the text, ⌘⌫ deletes to the line start.
      if (typing && mod && (undoKey || key === 'a' || key === 'backspace')) return;

      if (mod && !event.shiftKey && !event.altKey) {
        if (undoKey) {
          event.preventDefault();
          store.undo();
          return;
        }
        switch (key) {
          case 'n':
            event.preventDefault();
            store.createTodo();
            return;
          case 'f':
            event.preventDefault();
            store.setQuickFind(true);
            return;
          case '/':
            event.preventDefault();
            store.setShortcuts(true);
            return;
          case ',':
            event.preventDefault();
            store.setSettings(true);
            return;
          case 'a': {
            event.preventDefault();
            const ids = visibleTodoIds();
            if (ids.length) store.selectRange(ids, ids[ids.length - 1]);
            return;
          }
          default:
            break;
        }

        // Digits jump between the built-in lists.
        const digit = Number(event.key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= SMART_LISTS.length) {
          event.preventDefault();
          store.selectList(SMART_LISTS[digit - 1]);
          return;
        }

        if (selection.length) {
          switch (key) {
            case 't':
              event.preventDefault();
              store.setWhen(selection, { kind: 'today' });
              return;
            case 'e':
              event.preventDefault();
              store.setWhen(selection, { kind: 'evening' });
              return;
            case 'o':
              event.preventDefault();
              store.setWhen(selection, { kind: 'someday' });
              return;
            case 'r':
              event.preventDefault();
              store.setWhen(selection, { kind: 'unscheduled' });
              return;
            case 's':
              event.preventDefault();
              if (anchor) store.openEditorPanel(anchor, 'when');
              return;
            case '.':
              event.preventDefault();
              store.completeTodo(selection);
              return;
            case 'backspace':
              event.preventDefault();
              store.trashTodo(selection);
              return;
            case 'd':
              event.preventDefault();
              store.duplicateTodo(selection);
              return;
            default:
              break;
          }
        }
      }

      if (typing && mod && event.shiftKey && undoKey) return;

      if (mod && event.shiftKey) {
        if (undoKey) {
          event.preventDefault();
          store.redo();
          return;
        }
        switch (key) {
          case 'n':
            event.preventDefault();
            store.selectList(`project:${store.createProject()}`);
            return;
          case 'i':
            if (selection.length) {
              event.preventDefault();
              const allImportant = selection.every(
                (id) => store.db.todos.find((todo) => todo.id === id)?.important,
              );
              store.setImportant(selection, !allImportant);
            }
            return;
          default:
            break;
        }
        if (selection.length && anchor) {
          switch (key) {
            case 'd':
              event.preventDefault();
              store.openEditorPanel(anchor, 'deadline');
              return;
            case 't':
              event.preventDefault();
              store.openEditorPanel(anchor, 'tags');
              return;
            case 'r':
              event.preventDefault();
              store.openEditorPanel(anchor, 'repeat');
              return;
            case 'm':
              event.preventDefault();
              store.setMoveDialog(true);
              return;
            default:
              break;
          }
        }
      }

      if (mod && event.altKey && key === '.' && selection.length) {
        event.preventDefault();
        store.cancelTodo(selection);
        return;
      }

      if (typing) return;

      if (event.key === 'Escape') {
        if (store.editingTodoId) store.closeEditor();
        else store.selectTodo(undefined);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const ids = visibleTodoIds();
        if (!ids.length) return;
        event.preventDefault();
        const current = anchor ? ids.indexOf(anchor) : -1;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next =
          current === -1
            ? event.key === 'ArrowDown'
              ? 0
              : ids.length - 1
            : Math.min(ids.length - 1, Math.max(0, current + step));

        if (event.shiftKey && current !== -1) {
          // The range always runs from the fixed anchor to the moving focus, so
          // reversing direction shrinks the selection instead of losing rows.
          const anchorIndex = ids.indexOf(store.selectionAnchor ?? ids[current]);
          const start = anchorIndex === -1 ? current : anchorIndex;
          const [from, to] = start < next ? [start, next] : [next, start];
          store.selectRange(ids.slice(from, to + 1), ids[next]);
        } else {
          store.selectTodo(ids[next]);
        }
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && anchor && !store.editingTodoId) {
        event.preventDefault();
        store.openEditor(anchor);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
