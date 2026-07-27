import { createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

/** How long we wait after the last change before touching the disk. */
const WRITE_DELAY_MS = 250;

/** Keys used before the app was renamed from `things-clone` to `doings`. */
const LEGACY_KEYS = ['things-clone.v1'];

type ErrorHandler = (message: string) => void;

let reportError: ErrorHandler = () => {};

/**
 * The store registers a handler here after it is created. A failed write has to
 * reach the user, otherwise the app silently stops saving.
 */
export function setStorageErrorHandler(handler: ErrorHandler): void {
  reportError = handler;
}

function legacyValue(name: string): string | null {
  try {
    for (const key of [name, ...LEGACY_KEYS]) {
      const value = globalThis.localStorage?.getItem(key);
      if (value) return value;
    }
  } catch {
    // Storage may be unavailable; nothing to migrate then.
  }
  return null;
}

function dropLegacy(): void {
  try {
    for (const key of LEGACY_KEYS) globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore: failing to clean up the old key is harmless.
  }
}

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

  const write = async (json: string) => {
    try {
      const ok = await api.save(json);
      if (!ok) {
        reportError(
          'Не удалось сохранить базу на диск. Проверьте свободное место и права доступа.',
        );
      }
    } catch (error) {
      reportError(`Не удалось сохранить базу: ${String(error)}`);
    }
  };

  const flush = () => {
    if (pending === null) return;
    const json = pending;
    pending = null;
    if (timer) window.clearTimeout(timer);
    timer = undefined;
    void write(json);
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return {
    async getItem(name) {
      try {
        const stored = await api.load();
        if (stored) return stored;
      } catch (error) {
        reportError(`Не удалось прочитать базу: ${String(error)}`);
        return null;
      }
      // Databases created before the switch to a file still live in localStorage.
      const legacy = legacyValue(name);
      if (legacy) {
        await write(legacy);
        dropLegacy();
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
      void write('');
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
    const probe = '__doings_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
  } catch {
    console.warn('localStorage недоступен, изменения не сохранятся между запусками');
    return memoryStorage();
  }

  return {
    getItem: (name) => legacyValue(name),
    setItem: (name, value) => {
      try {
        globalThis.localStorage.setItem(name, value);
        dropLegacy();
      } catch (error) {
        // Usually the quota: tell the user instead of losing changes quietly.
        reportError(`Не удалось сохранить данные в браузере: ${String(error)}`);
      }
    },
    removeItem: (name) => globalThis.localStorage.removeItem(name),
  };
}

/** File on the desktop, localStorage in the browser. */
export const appStorage = createJSONStorage(() => fileStorage() ?? browserStorage());
