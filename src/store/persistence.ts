import { createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

/** How long we wait after the last change before touching the disk. */
const WRITE_DELAY_MS = 250;

/**
 * Desktop builds keep the database in a JSON file under the app's user data
 * directory. Writes are debounced, and flushed whenever the window is about to
 * go away, so nothing is lost on quit.
 */
function fileStorage(): StateStorage | null {
  const api = window.desktop?.storage;
  if (!api) return null;

  let pending: string | null = null;
  let timer: number | undefined;

  const flush = () => {
    if (pending === null) return;
    const json = pending;
    pending = null;
    if (timer) window.clearTimeout(timer);
    timer = undefined;
    void api.save(json);
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return {
    async getItem(name) {
      const stored = await api.load();
      if (stored) return stored;
      // Databases created before the switch still live in localStorage.
      const legacy = localStorage.getItem(name);
      if (legacy) {
        await api.save(legacy);
        localStorage.removeItem(name);
        return legacy;
      }
      return null;
    },
    setItem(_name, value) {
      pending = value;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(flush, WRITE_DELAY_MS);
    },
    removeItem() {
      pending = null;
      void api.save('');
    },
  };
}

/** Last resort: keeps the session alive even when nothing can be written. */
function memoryStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
}

/**
 * localStorage is not always usable: private windows, blocked storage and some
 * embedded contexts either miss the methods or throw on write. Probe it once.
 */
function browserStorage(): StateStorage {
  try {
    const probe = '__things_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
  } catch {
    console.warn('localStorage недоступен, изменения не сохранятся между запусками');
    return memoryStorage();
  }

  return {
    getItem: (name) => globalThis.localStorage.getItem(name),
    setItem: (name, value) => globalThis.localStorage.setItem(name, value),
    removeItem: (name) => globalThis.localStorage.removeItem(name),
  };
}

/** File on the desktop, localStorage in the browser. */
export const appStorage = createJSONStorage(() => fileStorage() ?? browserStorage());
