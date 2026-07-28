'use strict';

/**
 * Automatic and guard backups of the database.
 *
 * Kept as a separate module so the rules — safe names, retention, the
 * once-per-interval throttle — can be tested without launching Electron. The
 * renderer never touches these files directly: it only asks the main process,
 * which is why every name coming from outside is validated here.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

/** Why a copy was made. Anything else is refused. */
const REASONS = new Set([
  'automatic',
  'manual',
  'import',
  'clear',
  'demo',
  'migration',
  'before-restore',
]);

const AUTO_REASON = 'automatic';

/** Retention: automatic copies are plentiful, the ones before risky steps are not. */
const LIMITS = {
  automatic: 10,
  guard: 5,
  total: 30,
};

/** An automatic copy at most once per this window. */
const AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000;

const NAME_PATTERN = /^database-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?\.json$/;

function backupsDirFor(userDataDir) {
  return path.join(userDataDir, 'backups');
}

/**
 * Only names this module could have produced are accepted: no separators, no
 * `..`, nothing absolute. A renderer must not be able to reach outside.
 */
function isSafeBackupName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return false;
  return path.basename(name) === name;
}

/** Absolute path inside `dir`, or null when the name is not acceptable. */
function backupPath(dir, name) {
  if (!isSafeBackupName(name)) return null;
  const resolved = path.resolve(dir, name);
  // Belt and braces: the resolved path must still sit directly in the folder.
  if (path.dirname(resolved) !== path.resolve(dir)) return null;
  return resolved;
}

function hashPayload(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function nameFor(date) {
  const stamp = date.toISOString().slice(0, 19).replace(/:/g, '-');
  return `database-${stamp}.json`;
}

function countEntities(parsed) {
  const db = parsed?.state?.db ?? {};
  const size = (value) => (Array.isArray(value) ? value.length : 0);
  return {
    todos: size(db.todos),
    projects: size(db.projects),
    areas: size(db.areas),
    headings: size(db.headings),
    tags: size(db.tags),
  };
}

/** Atomic write: a half-written backup is worse than no backup. */
async function writeAtomic(file, text) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, file);
    return { ok: true };
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    return { ok: false, reason: 'io', detail: String(error) };
  }
}

/**
 * Writes a copy of `payloadText`, which must be the exact contents of
 * database.json. An unreadable database is never copied: it would only take the
 * place of a good backup.
 */
async function createBackup({ dir, payloadText, reason, now = new Date() }) {
  if (!REASONS.has(reason)) return { ok: false, reason: 'bad-reason' };
  if (typeof payloadText !== 'string' || !payloadText.trim()) {
    return { ok: false, reason: 'empty-database' };
  }

  let parsed;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    // Copying a broken file would waste a retention slot on garbage.
    return { ok: false, reason: 'unreadable-database' };
  }

  const meta = {
    kind: 'doings-backup',
    createdAt: now.toISOString(),
    reason,
    schemaVersion: typeof parsed.version === 'number' ? parsed.version : null,
    revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
    counts: countEntities(parsed),
    payloadHash: hashPayload(payloadText),
    payload: parsed,
  };

  await fs.mkdir(dir, { recursive: true });

  // Two copies within the same second still get their own file.
  let name = nameFor(now);
  let file = path.join(dir, name);
  for (let suffix = 1; suffix < 100; suffix += 1) {
    try {
      await fs.access(file);
    } catch {
      break;
    }
    name = nameFor(now).replace(/\.json$/, `-${suffix}.json`);
    file = path.join(dir, name);
  }

  const written = await writeAtomic(file, JSON.stringify(meta));
  if (!written.ok) return written;

  const pruned = await prune(dir);
  return { ok: true, name, createdAt: meta.createdAt, reason, removed: pruned.removed };
}

/**
 * Metadata for every file in the folder, newest first. One call is enough to
 * draw the whole list: the payloads stay on disk until a restore asks for one.
 */
async function listBackups(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    // No folder yet simply means no backups.
    return { ok: true, items: [] };
  }

  const items = [];
  for (const name of names) {
    if (!name.endsWith('.json') || !isSafeBackupName(name)) continue;
    const file = path.join(dir, name);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }

    try {
      const meta = JSON.parse(await fs.readFile(file, 'utf8'));
      if (meta?.kind !== 'doings-backup' || !meta.payload) throw new Error('чужой формат');
      items.push({
        name,
        createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : stat.mtime.toISOString(),
        reason: REASONS.has(meta.reason) ? meta.reason : 'automatic',
        schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : null,
        revision: typeof meta.revision === 'number' ? meta.revision : 0,
        counts: meta.counts ?? countEntities(meta.payload),
        payloadHash: typeof meta.payloadHash === 'string' ? meta.payloadHash : null,
        size: stat.size,
        corrupt: false,
      });
    } catch {
      // A copy that cannot be read is still shown, so the user can delete it.
      items.push({
        name,
        createdAt: stat.mtime.toISOString(),
        reason: 'automatic',
        schemaVersion: null,
        revision: 0,
        counts: null,
        payloadHash: null,
        size: stat.size,
        corrupt: true,
      });
    }
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { ok: true, items };
}

/** Full contents of one copy, for a restore. */
async function readBackup(dir, name) {
  const file = backupPath(dir, name);
  if (!file) return { ok: false, reason: 'bad-name' };

  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { ok: false, reason: 'not-found' };
  }

  try {
    const meta = JSON.parse(text);
    if (meta?.kind !== 'doings-backup' || !meta.payload) {
      return { ok: false, reason: 'corrupt' };
    }
    return {
      ok: true,
      payload: JSON.stringify(meta.payload),
      createdAt: meta.createdAt,
      reason: meta.reason,
      schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : null,
    };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

async function deleteBackup(dir, name) {
  const file = backupPath(dir, name);
  if (!file) return { ok: false, reason: 'bad-name' };
  try {
    await fs.rm(file);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'io', detail: String(error) };
  }
}

/**
 * Applies the retention limits. Automatic copies go first: a copy taken right
 * before an import or a wipe is the one somebody will actually come back for.
 */
async function prune(dir, limits = LIMITS) {
  const { items } = await listBackups(dir);
  const doomed = [];

  const automatic = items.filter((item) => item.reason === AUTO_REASON);
  const guard = items.filter((item) => item.reason !== AUTO_REASON);
  doomed.push(...automatic.slice(limits.automatic));
  doomed.push(...guard.slice(limits.guard));

  const keeping = items.filter((item) => !doomed.includes(item));
  if (keeping.length > limits.total) {
    // Oldest automatic copies leave first, then the oldest of the rest.
    const overflow = [...keeping]
      .sort((a, b) => {
        const byKind = Number(a.reason !== AUTO_REASON) - Number(b.reason !== AUTO_REASON);
        return byKind !== 0 ? byKind : a.createdAt.localeCompare(b.createdAt);
      })
      .slice(0, keeping.length - limits.total);
    doomed.push(...overflow);
  }

  const removed = [];
  for (const item of doomed) {
    const result = await deleteBackup(dir, item.name);
    if (result.ok) removed.push(item.name);
  }
  return { ok: true, removed };
}

/**
 * An automatic copy is worth making only when enough time has passed and the
 * database really differs from what was copied last time.
 */
function shouldAutoBackup({ items, hash, now = new Date(), intervalMs = AUTO_INTERVAL_MS }) {
  if (!hash) return false;
  // The same snapshot is never copied twice, whatever the reason was.
  if (items.some((item) => item.payloadHash === hash)) return false;

  const lastAuto = items.find((item) => item.reason === AUTO_REASON && !item.corrupt);
  if (!lastAuto) return true;
  const age = now.getTime() - new Date(lastAuto.createdAt).getTime();
  return age >= intervalMs;
}

module.exports = {
  AUTO_INTERVAL_MS,
  AUTO_REASON,
  LIMITS,
  REASONS,
  backupPath,
  backupsDirFor,
  createBackup,
  deleteBackup,
  hashPayload,
  isSafeBackupName,
  listBackups,
  prune,
  readBackup,
  shouldAutoBackup,
};
