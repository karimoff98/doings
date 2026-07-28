import { SCHEMA_VERSION, loadDatabase } from '../domain/validate';
import type { Database } from '../domain/types';
import { flushPendingWrites } from './persistence';

/**
 * Renderer side of the backup feature. Everything dangerous — importing,
 * clearing, loading examples, restoring — goes through here so the order is
 * always the same: write what is pending, copy the database, only then act.
 */

export type BackupReason =
  'automatic' | 'manual' | 'import' | 'clear' | 'demo' | 'migration' | 'before-restore';

export interface BackupItem {
  name: string;
  createdAt: string;
  reason: BackupReason;
  schemaVersion: number | null;
  revision: number;
  counts: { todos: number; projects: number; areas: number; headings: number; tags: number } | null;
  size: number;
  corrupt: boolean;
}

const REASON_TITLES: Record<BackupReason, string> = {
  automatic: 'Автоматическая',
  manual: 'Вручную',
  import: 'Перед импортом',
  clear: 'Перед очисткой',
  demo: 'Перед загрузкой примеров',
  migration: 'Перед обновлением схемы',
  'before-restore': 'Перед восстановлением',
};

function api() {
  return window.desktop?.backups;
}

/** Backups only exist in the desktop build, where there is a file to copy. */
export function backupsAvailable(): boolean {
  return Boolean(api());
}

export async function listBackups(): Promise<BackupItem[]> {
  const bridge = api();
  if (!bridge) return [];
  try {
    const result = await bridge.list();
    return (result?.items ?? []) as BackupItem[];
  } catch {
    return [];
  }
}

export async function createBackup(
  reason: BackupReason,
): Promise<{ ok: boolean; reason?: string }> {
  const bridge = api();
  if (!bridge) return { ok: false, reason: 'unsupported' };
  try {
    const result = await bridge.create(reason);
    return { ok: Boolean(result?.ok), reason: result?.reason };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}

export async function deleteBackup(name: string): Promise<boolean> {
  const bridge = api();
  if (!bridge) return false;
  try {
    return Boolean((await bridge.remove(name))?.ok);
  } catch {
    return false;
  }
}

/** Why a copy could not be made, in words a person can act on. */
function explain(reason?: string): string {
  switch (reason) {
    case 'no-database':
      return 'файл базы ещё не создан';
    case 'unreadable-database':
      return 'текущий файл базы не читается';
    case 'empty-database':
      return 'база пуста';
    case 'io':
      return 'не удалось записать файл';
    case 'unsupported':
      return 'резервные копии доступны только в приложении для компьютера';
    default:
      return reason ?? 'неизвестная причина';
  }
}

export interface GuardOptions {
  /** Asks whether to go ahead without a copy. Injected so tests can answer. */
  confirm?: (message: string) => boolean;
}

/**
 * Prepares for a destructive step: pending text reaches the disk, then a dated
 * copy is made. When the copy fails the step does not happen silently — the user
 * decides whether to continue without one.
 */
export async function guardBeforeDanger(
  reason: BackupReason,
  options: GuardOptions = {},
): Promise<boolean> {
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));

  // Whatever is still in the editor belongs in the copy.
  try {
    await flushPendingWrites();
  } catch {
    // A failed flush is reported by the storage layer; the copy below still runs.
  }

  if (!backupsAvailable()) return true;

  const created = await createBackup(reason);
  if (created.ok) return true;

  return confirm(
    `Не удалось создать резервную копию: ${explain(created.reason)}. Продолжить без копии?`,
  );
}

/** A copy from a newer build would lose fields this version knows nothing about. */
export function isRestorable(item: BackupItem): boolean {
  if (item.corrupt) return false;
  return item.schemaVersion === null || item.schemaVersion <= SCHEMA_VERSION;
}

export interface RestoreOutcome {
  ok: boolean;
  db?: Database;
  message: string;
}

/**
 * Reads a copy and returns the database it holds. The current state is copied
 * first, so a restore chosen by mistake is itself undoable.
 */
export async function restoreBackup(item: BackupItem): Promise<RestoreOutcome> {
  const bridge = api();
  if (!bridge) return { ok: false, message: 'Резервные копии доступны только в приложении' };
  if (item.corrupt) return { ok: false, message: 'Копия повреждена и не может быть восстановлена' };
  if (!isRestorable(item)) {
    return {
      ok: false,
      message: `Копия сделана более новой версией приложения (схема ${item.schemaVersion}). Обновите приложение.`,
    };
  }

  // Step one: today's data must not disappear because of a restore.
  const kept = await guardBeforeDanger('before-restore');
  if (!kept) return { ok: false, message: 'Восстановление отменено' };

  const read = await bridge.read(item.name);
  if (!read?.ok || !read.payload) {
    const why = read?.reason === 'corrupt' ? 'копия повреждена' : explain(read?.reason);
    return { ok: false, message: `Не удалось прочитать копию: ${why}` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(read.payload);
  } catch {
    return { ok: false, message: 'Копия повреждена и не может быть восстановлена' };
  }

  // The same validator every loaded file goes through.
  const outcome = loadDatabase(raw);
  if (!outcome.ok) {
    return {
      ok: false,
      message:
        outcome.reason === 'newer'
          ? `Копия сделана более новой версией приложения (схема ${outcome.version}). Обновите приложение.`
          : 'Копия не похожа на базу приложения',
    };
  }

  return {
    ok: true,
    db: outcome.db,
    message: `Восстановлено задач: ${outcome.db.todos.length}, проектов: ${outcome.db.projects.length}`,
  };
}

/** Rounded size, because an exact byte count tells the user nothing. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function timeOf(date: Date): string {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** «Автоматическая — сегодня, 18:10», «Перед импортом — 26 июля, 20:15». */
export function describeBackup(item: BackupItem, now = new Date()): string {
  // The reason of an unreadable file is unknown, so do not claim one.
  const title = item.corrupt ? 'Повреждённая копия' : (REASON_TITLES[item.reason] ?? 'Копия');
  const made = new Date(item.createdAt);
  if (Number.isNaN(made.getTime())) return title;

  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((day(now).getTime() - day(made).getTime()) / 86_400_000);

  if (days === 0) return `${title} — сегодня, ${timeOf(made)}`;
  if (days === 1) return `${title} — вчера, ${timeOf(made)}`;
  const date = made.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${title} — ${date}, ${timeOf(made)}`;
}
