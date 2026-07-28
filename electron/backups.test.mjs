import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The backup rules run in the main process, so they are exercised here against
 * real files: retention, safe names and the once-per-interval throttle are the
 * kind of thing that only breaks on disk.
 */
const require = createRequire(import.meta.url);
const backups = require('./backups.cjs');

let dir;

/** Database file contents as the renderer would have written them. */
function payload(todos = 1, revision = 1) {
  return JSON.stringify({
    state: {
      db: {
        todos: Array.from({ length: todos }, (_, index) => ({ id: `td_${index}` })),
        projects: [{ id: 'prj_1' }],
        areas: [],
        headings: [],
        tags: [],
      },
    },
    version: 1,
    revision,
  });
}

const at = (iso) => new Date(iso);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'doings-backups-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('создание копий', () => {
  it('копия создаётся из корректной базы и содержит метаданные', async () => {
    const result = await backups.createBackup({
      dir,
      payloadText: payload(3),
      reason: 'manual',
      now: at('2026-07-28T18:10:30.000Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.name).toBe('database-2026-07-28T18-10-30.json');

    const { items } = await backups.listBackups(dir);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      reason: 'manual',
      schemaVersion: 1,
      revision: 1,
      corrupt: false,
    });
    expect(items[0].counts).toMatchObject({ todos: 3, projects: 1 });
    expect(items[0].size).toBeGreaterThan(0);
  });

  it('повреждённая рабочая база не копируется', async () => {
    const result = await backups.createBackup({
      dir,
      payloadText: '{ это не json',
      reason: 'clear',
    });

    expect(result).toEqual({ ok: false, reason: 'unreadable-database' });
    // A wasted retention slot is worse than no copy at all.
    expect(await readdir(dir).catch(() => [])).toHaveLength(0);
  });

  it('корректный JSON неправильной структуры не копируется', async () => {
    // All of these parse cleanly and hold no database at all.
    for (const text of [
      '[]',
      '{"foo":1}',
      '42',
      '"строка"',
      'null',
      '{"state":{}}',
      '{"state":{"db":{}}}',
    ]) {
      expect(
        await backups.createBackup({ dir, payloadText: text, reason: 'manual' }),
        text,
      ).toEqual({ ok: false, reason: 'unexpected-shape' });
    }
    expect(await readdir(dir).catch(() => [])).toHaveLength(0);
  });

  it('пустая база не копируется', async () => {
    expect(await backups.createBackup({ dir, payloadText: '', reason: 'clear' })).toEqual({
      ok: false,
      reason: 'empty-database',
    });
  });

  it('две копии в одну секунду не затирают друг друга', async () => {
    const now = at('2026-07-28T18:10:30.000Z');
    const first = await backups.createBackup({
      dir,
      payloadText: payload(1),
      reason: 'manual',
      now,
    });
    const second = await backups.createBackup({
      dir,
      payloadText: payload(2),
      reason: 'manual',
      now,
    });

    expect(first.name).not.toBe(second.name);
    expect((await backups.listBackups(dir)).items).toHaveLength(2);
  });
});

describe('безопасность имён', () => {
  it('имя нельзя использовать для выхода из папки', () => {
    for (const name of [
      '../database.json',
      '../../etc/passwd',
      'backups/../../database.json',
      '/etc/passwd',
      'database-2026-07-28T18-10-30.json/../../x',
      'сюрприз.json',
      'database.json',
    ]) {
      expect(backups.isSafeBackupName(name), name).toBe(false);
      expect(backups.backupPath(dir, name), name).toBeNull();
    }
  });

  it('своё же имя принимается', () => {
    const name = 'database-2026-07-28T18-10-30.json';
    expect(backups.isSafeBackupName(name)).toBe(true);
    expect(backups.backupPath(dir, name)).toBe(path.join(dir, name));
  });

  it('чтение и удаление по небезопасному имени отклоняются', async () => {
    expect(await backups.readBackup(dir, '../database.json')).toEqual({
      ok: false,
      reason: 'bad-name',
    });
    expect(await backups.deleteBackup(dir, '../database.json')).toEqual({
      ok: false,
      reason: 'bad-name',
    });
  });
});

describe('автоматические копии', () => {
  it('не создаются чаще заданного интервала', () => {
    const items = [
      {
        name: 'database-2026-07-28T12-00-00.json',
        reason: 'automatic',
        createdAt: '2026-07-28T12:00:00.000Z',
        payloadHash: 'старый',
        corrupt: false,
      },
    ];

    // Two hours later: too soon.
    expect(
      backups.shouldAutoBackup({ items, hash: 'новый', now: at('2026-07-28T14:00:00.000Z') }),
    ).toBe(false);
    // Seven hours later: due.
    expect(
      backups.shouldAutoBackup({ items, hash: 'новый', now: at('2026-07-28T19:00:00.000Z') }),
    ).toBe(true);
  });

  it('одинаковая база не копируется повторно', () => {
    const items = [
      {
        name: 'database-2026-07-01T12-00-00.json',
        reason: 'automatic',
        createdAt: '2026-07-01T12:00:00.000Z',
        payloadHash: backups.hashPayload(payload(1)),
        corrupt: false,
      },
    ];

    // A month later, but the snapshot is byte-for-byte the same.
    expect(
      backups.shouldAutoBackup({
        items,
        hash: backups.hashPayload(payload(1)),
        now: at('2026-08-01T12:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('первая копия создаётся сразу', () => {
    expect(backups.shouldAutoBackup({ items: [], hash: 'что-то' })).toBe(true);
  });
});

describe('ограничение количества', () => {
  /** Writes `count` copies one minute apart. */
  async function fill(reason, count, startHour = 0) {
    for (let index = 0; index < count; index += 1) {
      const minute = String(index).padStart(2, '0');
      const hour = String(startHour).padStart(2, '0');
      await backups.createBackup({
        dir,
        payloadText: payload(index + 1),
        reason,
        now: at(`2026-07-28T${hour}:${minute}:00.000Z`),
      });
    }
  }

  it('старые автоматические копии удаляются по лимиту', async () => {
    await fill('automatic', 13);

    const { items } = await backups.listBackups(dir);
    expect(items).toHaveLength(backups.LIMITS.automatic);
    // The newest survive; the three oldest are gone.
    expect(items[items.length - 1].createdAt).toBe('2026-07-28T00:03:00.000Z');
  });

  it('ручные копии живут дольше автоматических', async () => {
    await fill('clear', 3, 1);
    await fill('automatic', 12, 2);

    const { items } = await backups.listBackups(dir);
    const guards = items.filter((item) => item.reason === 'clear');
    const auto = items.filter((item) => item.reason === 'automatic');
    // Automatic copies were trimmed; the ones taken before a wipe were not.
    expect(auto).toHaveLength(backups.LIMITS.automatic);
    expect(guards).toHaveLength(3);
  });

  it('копий перед опасными операциями хранится не больше лимита', async () => {
    await fill('import', 7, 3);
    const { items } = await backups.listBackups(dir);
    expect(items.filter((item) => item.reason === 'import')).toHaveLength(backups.LIMITS.guard);
  });
});

describe('повреждённые копии', () => {
  it('видны в списке, но не читаются', async () => {
    await backups.createBackup({ dir, payloadText: payload(2), reason: 'manual' });
    const broken = 'database-2026-07-28T09-00-00.json';
    await writeFile(path.join(dir, broken), '{ обрубок', 'utf8');

    const { items } = await backups.listBackups(dir);
    // The good copy is still listed next to the broken one.
    expect(items).toHaveLength(2);
    const corrupt = items.find((item) => item.name === broken);
    expect(corrupt?.corrupt).toBe(true);

    expect(await backups.readBackup(dir, broken)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('файл с корректным JSON чужой структуры считается повреждённым', async () => {
    const alien = 'database-2026-07-28T08-00-00.json';
    // Valid JSON, but not one of our copies: restoring it makes no sense.
    await writeFile(
      path.join(dir, alien),
      JSON.stringify({ state: { db: { todos: [] } } }),
      'utf8',
    );

    const { items } = await backups.listBackups(dir);
    expect(items.find((item) => item.name === alien)?.corrupt).toBe(true);
    expect(await backups.readBackup(dir, alien)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('чужой файл в папке не ломает список', async () => {
    await writeFile(path.join(dir, 'заметка.txt'), 'привет', 'utf8');
    await backups.createBackup({ dir, payloadText: payload(1), reason: 'manual' });

    const { items } = await backups.listBackups(dir);
    expect(items).toHaveLength(1);
  });

  it('удаление освобождает список', async () => {
    const created = await backups.createBackup({ dir, payloadText: payload(1), reason: 'manual' });
    expect((await backups.listBackups(dir)).items).toHaveLength(1);

    expect(await backups.deleteBackup(dir, created.name)).toEqual({ ok: true });
    expect((await backups.listBackups(dir)).items).toHaveLength(0);
  });
});

describe('чтение копии', () => {
  it('возвращает ровно то, что было в базе', async () => {
    const text = payload(4, 7);
    const created = await backups.createBackup({ dir, payloadText: text, reason: 'manual' });

    const read = await backups.readBackup(dir, created.name);
    expect(read.ok).toBe(true);
    expect(JSON.parse(read.payload)).toEqual(JSON.parse(text));
    expect(read.schemaVersion).toBe(1);
  });

  it('отсутствующий файл сообщает об этом', async () => {
    expect(await backups.readBackup(dir, 'database-2026-01-01T00-00-00.json')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('список пустой папки не падает', async () => {
    expect(await backups.listBackups(path.join(dir, 'нет-такой'))).toEqual({ ok: true, items: [] });
  });
});
