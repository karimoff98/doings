import { createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

/** How long we wait after the last change before touching the disk. */
const WRITE_DELAY_MS = 250;

/** Keys used before the app was renamed from `things-clone` to `doings`. */
const LEGACY_KEYS = ['things-clone.v1'];

type ErrorHandler = (message: string) => void;

let reportError: ErrorHandler | null = null;
const queuedErrors: string[] = [];
const alreadyReported = new Set<string>();
let reporting = false;

/**
 * Storage runs before the store exists, so early messages wait in a queue.
 *
 * Reporting writes to the store, and any store update asks the storage to save
 * again — which can fail again. Without the guard below that becomes infinite
 * recursion that kills the whole app, so a message is delivered once and never
 * re-entrantly.
 */
function report(message: string): void {
  if (reporting || alreadyReported.has(message)) return;
  alreadyReported.add(message);
  reporting = true;
  try {
    // The queue is the reliable channel: problems found while loading happen
    // before hydration finishes, and hydration replaces the whole state.
    queuedErrors.push(message);
    reportError?.(message);
  } finally {
    reporting = false;
  }
}

/**
 * Messages collected so far. The store drains them while merging the loaded
 * state, which is the only moment guaranteed not to be overwritten.
 */
export function drainStorageErrors(): string[] {
  return queuedErrors.splice(0);
}

/**
 * The store registers a handler here after it is created. A failed write has to
 * reach the user, otherwise the app silently stops saving.
 */
export function setStorageErrorHandler(handler: ErrorHandler): void {
  reportError = handler;
}

let writesBlocked: string | null = null;

/**
 * Refusing to write is the only way to protect a file we could not understand,
 * for example one written by a newer version of the app.
 */
export function blockWrites(reason: string): void {
  writesBlocked = reason;
}

/** Text that survives `JSON.parse`, or null. Guards against a truncated file. */
function readableJson(text: string | null): string | null {
  if (!text) return null;
  try {
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
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
    if (writesBlocked) {
      report(writesBlocked);
      return;
    }
    try {
      const ok = await api.save(json);
      if (!ok) {
        report('Не удалось сохранить базу на диск. Проверьте свободное место и права доступа.');
      }
    } catch (error) {
      report(`Не удалось сохранить базу: ${String(error)}`);
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

  /** A file that is not JSON at all: try the backup, then set it aside. */
  const rescue = async (): Promise<string | null> => {
    let backup: string | null = null;
    try {
      backup = (await api.loadBackup?.()) ?? null;
    } catch {
      backup = null;
    }
    const usable = readableJson(backup);
    if (usable) {
      report('Файл базы был повреждён, данные восстановлены из резервной копии.');
      return usable;
    }

    let quarantined: string | null = null;
    try {
      quarantined = (await api.quarantine?.()) ?? null;
    } catch {
      quarantined = null;
    }
    report(
      quarantined
        ? `Файл базы не читается. Он отложен в ${quarantined}, приложение открыто с демонстрационными данными — испорченный файл можно попробовать починить и загрузить через настройки.`
        : 'Файл базы не читается, приложение открыто с демонстрационными данными.',
    );
    return null;
  };

  return {
    async getItem(name) {
      let stored: string | null = null;
      try {
        stored = await api.load();
      } catch (error) {
        report(`Не удалось прочитать базу: ${String(error)}`);
        return null;
      }

      if (stored) {
        // Broken JSON must never reach zustand: it would abort hydration and
        // leave the window empty.
        return readableJson(stored) ?? (await rescue());
      }

      // Databases created before the switch to a file still live in localStorage.
      const legacy = readableJson(legacyValue(name));
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
    getItem: (name) => {
      const stored = legacyValue(name);
      const usable = readableJson(stored);
      if (stored && !usable) {
        report('Сохранённые данные в браузере повреждены, открыты демонстрационные данные.');
      }
      return usable;
    },
    setItem: (name, value) => {
      if (writesBlocked) {
        report(writesBlocked);
        return;
      }
      try {
        globalThis.localStorage.setItem(name, value);
        dropLegacy();
      } catch (error) {
        // Usually the quota: tell the user instead of losing changes quietly.
        report(`Не удалось сохранить данные в браузере: ${String(error)}`);
      }
    },
    removeItem: (name) => globalThis.localStorage.removeItem(name),
  };
}

/** File on the desktop, localStorage in the browser. */
export const appStorage = createJSONStorage(() => fileStorage() ?? browserStorage());
