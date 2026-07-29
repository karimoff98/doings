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
  automatic: 5,
  guard: 5,
  total: 30,
};

/** An automatic copy at most once per this window. */
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Every copy has a small sidecar with just the facts the list needs, so opening
 * the settings never reads a single database.
 */
function metaNameFor(name) {
  return name.replace(/\.json$/, '.meta.json');
}

function isMetaName(name) {
  return name.endsWith('.meta.json');
}

const REQUIRED_LISTS = ['todos', 'projects', 'areas', 'headings', 'tags'];

/**
 * Shape check for the snapshot as the renderer writes it. Anything missing means
 * we are looking at something else, and copying it would waste a retention slot
 * on a file nobody can restore. Field-level validation stays in the renderer.
 */
function looksLikeDatabase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.version !== 'number') return false;

  const state = value.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;

  const db = state.db;
  if (!db || typeof db !== 'object' || Array.isArray(db)) return false;

  return REQUIRED_LISTS.every((key) => Array.isArray(db[key]));
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
  if (!dir) return { ok: false, reason: 'no-folder' };
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

  // Valid JSON is not enough: `[]` or `{"foo":1}` parse fine and hold no database.
  if (!looksLikeDatabase(parsed)) return { ok: false, reason: 'unexpected-shape' };

  const body = {
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

  const text = JSON.stringify(body);
  const written = await writeAtomic(file, text);
  if (!written.ok) return written;

  // The sidecar comes second: a copy without it is still restorable, and the
  // list rebuilds the missing file on its own. The size is counted in bytes, the
  // same unit `stat` reports, so the two can be compared later.
  await writeMeta(dir, name, metaFrom(body, Buffer.byteLength(text, 'utf8')));

  const pruned = await prune(dir);
  return { ok: true, name, createdAt: body.createdAt, reason, removed: pruned.removed };
}

/** The facts the settings list needs, without the database itself. */
function metaFrom(body, size) {
  return {
    kind: 'doings-backup-meta',
    createdAt: body.createdAt,
    reason: body.reason,
    schemaVersion: body.schemaVersion,
    revision: body.revision,
    counts: body.counts,
    payloadHash: body.payloadHash,
    size,
  };
}

async function writeMeta(dir, name, meta) {
  return writeAtomic(path.join(dir, metaNameFor(name)), JSON.stringify(meta));
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
    // Sidecars are not entries of their own.
    if (isMetaName(name) || !name.endsWith('.json') || !isSafeBackupName(name)) continue;
    const file = path.join(dir, name);
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }

    const meta = await readMeta(dir, name, stat);
    items.push(
      meta ?? {
        // Neither the sidecar nor the copy could be read: still listed, so the
        // user can see the problem and delete the file.
        name,
        createdAt: stat.mtime.toISOString(),
        reason: 'automatic',
        schemaVersion: null,
        revision: 0,
        counts: null,
        payloadHash: null,
        size: stat.size,
        corrupt: true,
      },
    );
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { ok: true, items };
}

/**
 * Reads one sidecar. A missing or damaged sidecar is rebuilt from the copy
 * itself — that is the only case where the database is read for the list, and it
 * happens once per file.
 */
async function readMeta(dir, name, stat) {
  const metaFile = path.join(dir, metaNameFor(name));
  try {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    if (meta?.kind !== 'doings-backup-meta' || typeof meta.createdAt !== 'string') {
      throw new Error('чужой формат');
    }
    // The sidecar describes a file of a certain size. A different size means the
    // copy changed underneath it, and the metadata can no longer be trusted.
    if (meta.size !== stat.size) throw new Error('размер не совпадает');
    return {
      name,
      createdAt: meta.createdAt,
      reason: REASONS.has(meta.reason) ? meta.reason : 'automatic',
      schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : null,
      revision: typeof meta.revision === 'number' ? meta.revision : 0,
      counts: meta.counts ?? null,
      payloadHash: typeof meta.payloadHash === 'string' ? meta.payloadHash : null,
      size: typeof meta.size === 'number' ? meta.size : stat.size,
      corrupt: false,
    };
  } catch {
    return rebuildMeta(dir, name, stat);
  }
}

async function rebuildMeta(dir, name, stat) {
  let body;
  let text;
  try {
    text = await fs.readFile(path.join(dir, name), 'utf8');
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body?.kind !== 'doings-backup' || !looksLikeDatabase(body.payload)) return null;

  const meta = metaFrom(
    {
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : stat.mtime.toISOString(),
      reason: REASONS.has(body.reason) ? body.reason : 'automatic',
      schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : null,
      revision: typeof body.revision === 'number' ? body.revision : 0,
      counts: body.counts ?? countEntities(body.payload),
      payloadHash:
        typeof body.payloadHash === 'string'
          ? body.payloadHash
          : hashPayload(JSON.stringify(body.payload)),
    },
    Buffer.byteLength(text, 'utf8'),
  );
  // Written back, so the next list is cheap again.
  await writeMeta(dir, name, meta);
  const { kind: _kind, ...facts } = meta;
  return { name, ...facts, corrupt: false };
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
    // The sidecar goes with it, otherwise the folder fills up with orphans.
    await fs.rm(path.join(dir, metaNameFor(name)), { force: true });
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
  looksLikeDatabase,
  metaNameFor,
  prune,
  readBackup,
  shouldAutoBackup,
};
