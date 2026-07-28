import { createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { commitPendingEdits } from './pendingEdits';
import { reportSaveStatus } from './saveStatus';

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
 * Called after a successful save: the same problem happening again later
 * deserves a fresh warning, so suppression must not last the whole session.
 */
function forgetReportedErrors(): void {
  alreadyReported.clear();
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

/**
 * Revision of the database this session started from. The main process refuses
 * to overwrite a file whose revision has moved on, which is what happens when an
 * old copy of the app is still running after an update.
 */
let baseRevision: number | null = null;

function revisionOf(text: string): number {
  try {
    const parsed = JSON.parse(text) as { revision?: unknown };
    return typeof parsed.revision === 'number' ? parsed.revision : 0;
  } catch {
    return 0;
  }
}

/** Waits until everything the user has done is on disk. Used before quitting. */
let flushAll: () => Promise<void> = async () => {};

/**
 * Reason the latest write failed, or null when the disk is up to date. Kept
 * across calls on purpose: a background write that failed while nothing new is
 * pending still means the file on disk is stale.
 */
let lastWriteFailure: string | null = null;

export interface FlushResult {
  ok: boolean;
  /** Why the data is not on disk. Only set when `ok` is false. */
  error?: string;
}

/**
 * Commits whatever is still being typed, then waits for the write to land.
 * The result must be honest: the desktop shell cancels the quit when it is not
 * `ok`, and reporting success here would silently lose the last changes.
 */
export async function flushPendingWrites(): Promise<FlushResult> {
  // Text first, disk second: an open editor holds the newest characters.
  commitPendingEdits();
  await flushAll();
  return lastWriteFailure ? { ok: false, error: lastWriteFailure } : { ok: true };
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
  /** Writes run one after another: two saves racing on one temp file lose data. */
  let queue: Promise<void> = Promise.resolve();

  const write = (json: string): Promise<void> => {
    reportSaveStatus('saving');
    queue = queue.then(async () => {
      /** Records why the data is not on disk, for the caller that waits on us. */
      const fail = (message: string) => {
        lastWriteFailure = message;
        reportSaveStatus('error');
        report(message);
      };

      if (writesBlocked) {
        fail(writesBlocked);
        return;
      }
      try {
        const raw = await api.save(json, baseRevision ?? undefined);
        // Older builds answered with a plain boolean.
        const outcome = typeof raw === 'boolean' ? { ok: raw } : (raw ?? { ok: false });
        if (outcome.ok) {
          if (typeof outcome.revision === 'number') baseRevision = outcome.revision;
          lastWriteFailure = null;
          forgetReportedErrors();
          reportSaveStatus('saved');
          return;
        }
        if (outcome.reason === 'conflict') {
          // Another copy of the app owns the file now: overwriting it would
          // silently throw away whatever that copy has saved.
          const message =
            'База изменена другой копией приложения. Изменения этой копии не сохраняются — ' +
            'закройте лишнее окно приложения и запустите его заново.';
          blockWrites(message);
          fail(message);
          return;
        }
        fail('Не удалось сохранить базу на диск. Проверьте свободное место и права доступа.');
      } catch (error) {
        fail(`Не удалось сохранить базу: ${String(error)}`);
      }
    });
    return queue;
  };

  const flush = () => {
    if (pending === null) return queue;
    const json = pending;
    pending = null;
    if (timer) window.clearTimeout(timer);
    timer = undefined;
    return write(json);
  };

  // Quitting must not outrun the debounce: the main process asks for this.
  flushAll = async () => {
    await flush();
    await queue;
  };

  /** The window going away is the same deadline as quitting: text first, then disk. */
  const flushEverything = () => {
    commitPendingEdits();
    void flush();
  };

  window.addEventListener('pagehide', flushEverything);
  window.addEventListener('beforeunload', flushEverything);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEverything();
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
        const usable = readableJson(stored) ?? (await rescue());
        baseRevision = usable ? revisionOf(usable) : 0;
        return usable;
      }
      baseRevision = 0;

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
        lastWriteFailure = writesBlocked;
        report(writesBlocked);
        reportSaveStatus('error');
        return;
      }
      try {
        globalThis.localStorage.setItem(name, value);
        dropLegacy();
        lastWriteFailure = null;
        forgetReportedErrors();
        reportSaveStatus('saved');
      } catch (error) {
        // Usually the quota: tell the user instead of losing changes quietly.
        const message = `Не удалось сохранить данные в браузере: ${String(error)}`;
        lastWriteFailure = message;
        reportSaveStatus('error');
        report(message);
      }
    },
    removeItem: (name) => globalThis.localStorage.removeItem(name),
  };
}

/** File on the desktop, localStorage in the browser. */
export const appStorage = createJSONStorage(() => fileStorage() ?? browserStorage());
