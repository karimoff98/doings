import { createJSONStorage } from 'zustand/middleware';
import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';
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
  // A permanent block must never turn into one the user can wave away.
  blockIsChoice = false;
}

/**
 * A block the user is allowed to lift. A file written by a newer version stays
 * blocked no matter what — overwriting it would destroy fields we cannot read —
 * but a missing backup is a risk they may knowingly accept.
 */
let blockIsChoice = false;

/**
 * The snapshot a block turned away. Without it there would be nothing left to
 * save once the user agrees to go on: the debounce had already handed it over.
 */
let blockedWrite: string | null = null;

/** Set by whichever storage is active, so a withheld snapshot can be re-queued. */
let performWrite: ((json: string) => Promise<void>) | null = null;

export function blockWritesPendingChoice(reason: string): void {
  writesBlocked = reason;
  blockIsChoice = true;
}

/**
 * Writes the snapshot a block turned away, after the user chose to continue
 * without a backup. On failure the block and the snapshot stay, so they can try
 * again instead of losing the change.
 */
export async function retryBlockedWrite(): Promise<FlushResult> {
  const block = writeBlock();
  if (!block?.canContinue) {
    return { ok: false, error: block?.reason ?? 'Запись не заблокирована' };
  }

  const json = blockedWrite;
  allowWrites();

  // Nothing was withheld (or there is no file storage): a normal flush is enough.
  if (!json || !performWrite) return flushPendingWrites();

  await performWrite(json);
  if (lastWriteFailure) {
    blockWritesPendingChoice(block.reason);
    return { ok: false, error: lastWriteFailure };
  }
  blockedWrite = null;
  return { ok: true };
}

/** Whether writing is currently refused, and whether the user may allow it. */
export function writeBlock(): { reason: string; canContinue: boolean } | null {
  return writesBlocked ? { reason: writesBlocked, canContinue: blockIsChoice } : null;
}

/**
 * Lifts a block after the user decided to go on. Only they can make that call:
 * everything the old file holds is at stake.
 */
export function allowWrites(): void {
  if (!blockIsChoice) return;
  writesBlocked = null;
  blockIsChoice = false;
  lastWriteFailure = null;
  forgetReportedErrors();
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
 * Work that must finish before the file may be replaced — right now that is the
 * backup taken before a schema migration. Writes wait for it instead of racing
 * it, so the previous version's data is copied before anything overwrites it.
 */
let writeGate: Promise<unknown> = Promise.resolve();

export function holdWrites(work: Promise<unknown>): void {
  writeGate = writeGate.then(() => work).catch(() => {});
}

/** Pushes a message to the banner from outside the storage layer. */
export function reportStorageIssue(message: string): void {
  report(message);
}

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

/** Marker of a finished onboarding, kept separately from the database. */
const ONBOARDING_KEY = 'doings.onboarding.completed.v1';

/** What the initial read found. Decided once, while loading. */
type LoadOutcome = 'unknown' | 'empty' | 'existing' | 'failed';
let loadOutcome: LoadOutcome = 'unknown';

/** The Quick Entry window shares the bundle but must stay a plain input box. */
function isQuickEntryWindow(): boolean {
  return globalThis.location?.hash === '#quick';
}

export function isOnboardingComplete(): boolean {
  try {
    const storage = globalThis.localStorage;
    // Without storage the answer cannot be remembered, and an introduction that
    // returns on every launch is worse than one nobody sees.
    if (!storage) return true;
    return storage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * Remembered separately from the database: the file may not exist yet when the
 * user finishes reading, and closing the app right away must not bring the
 * introduction back.
 */
export function markOnboardingComplete(): void {
  try {
    globalThis.localStorage?.setItem(ONBOARDING_KEY, '1');
  } catch {
    // Nothing to do: the worst case is showing the introduction once more.
  }
}

/**
 * Zustand calls persistence after every store update, including opening a menu
 * or moving the selection. Those updates keep the persisted slice by reference,
 * so avoid serialising the entire database when nothing saved has changed.
 */
export function skipUnchangedWrites<S>(
  storage: PersistStorage<S>,
  equal: (previous: S, next: S) => boolean,
): PersistStorage<S> {
  const last = new Map<string, StorageValue<S>>();
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      const previous = last.get(name);
      if (previous && previous.version === value.version && equal(previous.state, value.state)) {
        return;
      }
      last.set(name, value);
      try {
        return storage.setItem(name, value);
      } catch (error) {
        if (previous) last.set(name, previous);
        else last.delete(name);
        throw error;
      }
    },
    removeItem: (name) => {
      last.delete(name);
      return storage.removeItem(name);
    },
  };
}

/**
 * True only for someone who has never used the app: no database, nothing to
 * migrate, no read error to explain, and not the Quick Entry window. An update
 * from an earlier version finds a database, so the introduction stays hidden.
 */
export function isFirstRun(): boolean {
  if (isQuickEntryWindow()) return false;
  if (isOnboardingComplete()) return false;
  // Before the first read finishes we simply do not know yet.
  return loadOutcome === 'empty';
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

      // Nothing may replace the file while a pre-migration copy is being made.
      await writeGate;

      if (writesBlocked) {
        // Held back rather than dropped: the user may still choose to save it.
        blockedWrite = json;
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
  // Lets `retryBlockedWrite` put a withheld snapshot back into this queue.
  performWrite = write;

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
        ? `Файл базы не читается. Он отложен в ${quarantined}, список пока пуст — испорченный файл можно попробовать починить и загрузить через настройки.`
        : 'Файл базы не читается, данные не загружены.',
    );
    return null;
  };

  return {
    async getItem(name) {
      let stored: string | null = null;
      try {
        stored = await api.load();
      } catch (error) {
        // A read that failed is not an empty profile: there may well be data we
        // could not reach, so the introduction must not hide the warning.
        loadOutcome = 'failed';
        report(`Не удалось прочитать базу: ${String(error)}`);
        return null;
      }

      if (stored) {
        // Broken JSON must never reach zustand: it would abort hydration and
        // leave the window empty.
        const usable = readableJson(stored) ?? (await rescue());
        loadOutcome = usable ? 'existing' : 'failed';
        baseRevision = usable ? revisionOf(usable) : 0;
        return usable;
      }
      baseRevision = 0;

      // Databases created before the switch to a file still live in localStorage.
      const legacy = readableJson(legacyValue(name));
      if (legacy) {
        loadOutcome = 'existing';
        await write(legacy);
        dropLegacy();
        return legacy;
      }
      // Nothing here and nothing to migrate: a genuinely new profile.
      loadOutcome = 'empty';
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
        report('Сохранённые данные в браузере повреждены и не были загружены.');
      }
      loadOutcome = usable ? 'existing' : stored ? 'failed' : 'empty';
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
