// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION } from '../domain/validate';
import {
  backupsAvailable,
  createBackup,
  deleteBackup,
  describeBackup,
  formatSize,
  guardBeforeDanger,
  isRestorable,
  listBackups,
  restoreBackup,
} from './backups';
import type { BackupItem } from './backups';

/**
 * Renderer side: the order around dangerous steps (write pending changes, copy,
 * only then act) and the refusal to restore anything unreadable or newer.
 */

interface BridgeMock {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/** Database payload as it is stored on disk. */
function payload(todos = 2, projects = 1, version: number = SCHEMA_VERSION) {
  return JSON.stringify({
    state: {
      db: {
        todos: Array.from({ length: todos }, (_, index) => ({
          id: `td_${index}`,
          title: `Задача ${index}`,
          notes: '',
          checklist: [],
          when: { kind: 'unscheduled' },
          tagIds: [],
          status: 'open',
          trashed: false,
          createdAt: '2026-07-01T00:00:00.000Z',
          index,
        })),
        projects: Array.from({ length: projects }, (_, index) => ({
          id: `prj_${index}`,
          title: `Проект ${index}`,
          notes: '',
          when: { kind: 'unscheduled' },
          tagIds: [],
          status: 'open',
          trashed: false,
          createdAt: '2026-07-01T00:00:00.000Z',
          index,
        })),
        areas: [],
        headings: [],
        tags: [],
      },
    },
    version,
    revision: 3,
  });
}

function item(patch: Partial<BackupItem> = {}): BackupItem {
  return {
    name: 'database-2026-07-28T18-10-30.json',
    createdAt: '2026-07-28T18:10:30.000Z',
    reason: 'automatic',
    schemaVersion: SCHEMA_VERSION,
    revision: 3,
    counts: { todos: 2, projects: 1, areas: 0, headings: 0, tags: 0 },
    size: 2048,
    corrupt: false,
    ...patch,
  };
}

function mockBridge(overrides: Partial<BridgeMock> = {}): BridgeMock {
  const bridge: BridgeMock = {
    list: vi.fn().mockResolvedValue({ ok: true, items: [item()] }),
    create: vi.fn().mockResolvedValue({ ok: true, name: 'database-new.json' }),
    read: vi.fn().mockResolvedValue({ ok: true, payload: payload() }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  (window as unknown as { desktop: unknown }).desktop = {
    platform: 'darwin',
    backups: bridge,
    storage: {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ ok: true, revision: 1 }),
      path: vi.fn().mockResolvedValue('/tmp/database.json'),
      export: vi.fn(),
      import: vi.fn(),
    },
  };
  return bridge;
}

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: () => null,
      length: 0,
    },
  });
});

afterEach(() => {
  delete (window as unknown as { desktop?: unknown }).desktop;
});

describe('доступность и список', () => {
  it('в браузере копий нет', async () => {
    expect(backupsAvailable()).toBe(false);
    expect(await listBackups()).toEqual([]);
    expect(await createBackup('manual')).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('список приходит одним вызовом и обновляется после операций', async () => {
    const bridge = mockBridge();

    expect(await listBackups()).toHaveLength(1);
    expect(bridge.list).toHaveBeenCalledTimes(1);

    bridge.list.mockResolvedValue({ ok: true, items: [item(), item({ name: 'database-2.json' })] });
    expect(await listBackups()).toHaveLength(2);
    expect(bridge.list).toHaveBeenCalledTimes(2);
  });

  it('сломанный мост не валит список', async () => {
    mockBridge({ list: vi.fn().mockRejectedValue(new Error('нет связи')) });
    expect(await listBackups()).toEqual([]);
  });

  it('удаление сообщает результат', async () => {
    mockBridge({ remove: vi.fn().mockResolvedValue({ ok: false, reason: 'io' }) });
    expect(await deleteBackup('database-2026-07-28T18-10-30.json')).toBe(false);
  });
});

describe('защита перед опасными действиями', () => {
  it('перед очисткой создаётся копия', async () => {
    const bridge = mockBridge();
    const confirm = vi.fn();

    expect(await guardBeforeDanger('clear', { confirm })).toBe(true);
    expect(bridge.create).toHaveBeenCalledWith('clear');
    // Nothing to ask about when the copy succeeded.
    expect(confirm).not.toHaveBeenCalled();
  });

  it('перед импортом создаётся копия', async () => {
    const bridge = mockBridge();
    expect(await guardBeforeDanger('import', { confirm: vi.fn() })).toBe(true);
    expect(bridge.create).toHaveBeenCalledWith('import');
  });

  it('перед загрузкой примеров создаётся копия', async () => {
    const bridge = mockBridge();
    expect(await guardBeforeDanger('demo', { confirm: vi.fn() })).toBe(true);
    expect(bridge.create).toHaveBeenCalledWith('demo');
  });

  it('ошибка копирования отменяет операцию, если пользователь не согласился', async () => {
    mockBridge({ create: vi.fn().mockResolvedValue({ ok: false, reason: 'io' }) });
    const confirm = vi.fn().mockReturnValue(false);

    expect(await guardBeforeDanger('clear', { confirm })).toBe(false);
    // The user must see why, and choose.
    expect(confirm.mock.calls[0][0]).toContain('не удалось записать файл');
  });

  it('пользователь может явно продолжить без копии', async () => {
    mockBridge({ create: vi.fn().mockResolvedValue({ ok: false, reason: 'no-database' }) });
    const confirm = vi.fn().mockReturnValue(true);

    expect(await guardBeforeDanger('clear', { confirm })).toBe(true);
    expect(confirm.mock.calls[0][0]).toContain('файл базы ещё не создан');
  });

  it('в браузере опасное действие не блокируется отсутствием копий', async () => {
    const confirm = vi.fn();
    expect(await guardBeforeDanger('clear', { confirm })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('восстановление', () => {
  it('возвращает задачи и проекты из копии', async () => {
    const bridge = mockBridge();

    const result = await restoreBackup(item());

    expect(result.ok).toBe(true);
    expect(result.db?.todos).toHaveLength(2);
    expect(result.db?.projects).toHaveLength(1);
    expect(result.message).toContain('Восстановлено задач: 2');
    expect(bridge.read).toHaveBeenCalledWith('database-2026-07-28T18-10-30.json');
  });

  it('перед восстановлением сохраняется текущая база', async () => {
    const bridge = mockBridge();

    await restoreBackup(item());

    // The copy of today's data comes first, then the chosen file is read.
    expect(bridge.create).toHaveBeenCalledWith('before-restore');
    expect(bridge.create.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.read.mock.invocationCallOrder[0],
    );
  });

  it('повреждённая копия не восстанавливается', async () => {
    const bridge = mockBridge();

    const result = await restoreBackup(item({ corrupt: true }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('повреждена');
    // Nothing is touched: no copy, no read.
    expect(bridge.create).not.toHaveBeenCalled();
    expect(bridge.read).not.toHaveBeenCalled();
  });

  it('нечитаемый файл копии не восстанавливается', async () => {
    mockBridge({ read: vi.fn().mockResolvedValue({ ok: false, reason: 'corrupt' }) });

    const result = await restoreBackup(item());
    expect(result.ok).toBe(false);
    expect(result.message).toContain('повреждена');
  });

  it('копия с более новой схемой не восстанавливается', async () => {
    const bridge = mockBridge();
    const newer = item({ schemaVersion: SCHEMA_VERSION + 1 });

    expect(isRestorable(newer)).toBe(false);
    const result = await restoreBackup(newer);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('более новой версией');
    expect(bridge.read).not.toHaveBeenCalled();
  });

  it('более новая схема внутри файла тоже отклоняется', async () => {
    // Metadata may lie or be missing; the payload itself is checked too.
    mockBridge({
      read: vi.fn().mockResolvedValue({ ok: true, payload: payload(2, 1, SCHEMA_VERSION + 5) }),
    });

    const result = await restoreBackup(item({ schemaVersion: null }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('более новой версией');
  });

  it('содержимое не похоже на базу — восстановление отклоняется', async () => {
    mockBridge({ read: vi.fn().mockResolvedValue({ ok: true, payload: '{"что-то":1}' }) });

    const result = await restoreBackup(item());
    expect(result.ok).toBe(false);
    expect(result.message).toContain('не похожа на базу');
  });

  it('отказ создать копию отменяет восстановление', async () => {
    const bridge = mockBridge({ create: vi.fn().mockResolvedValue({ ok: false, reason: 'io' }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const result = await restoreBackup(item());

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Восстановление отменено');
    expect(bridge.read).not.toHaveBeenCalled();
  });
});

describe('подписи в списке', () => {
  // Local time, because «сегодня» is a calendar day where the user sits.
  const local = (day: number, hour: number, minute: number) =>
    new Date(2026, 6, day, hour, minute).toISOString();
  const now = new Date(2026, 6, 28, 20, 0);

  it('называет причину и время', () => {
    expect(describeBackup(item({ createdAt: local(28, 18, 10) }), now)).toBe(
      'Автоматическая — сегодня, 18:10',
    );
    expect(describeBackup(item({ reason: 'clear', createdAt: local(27, 12, 43) }), now)).toBe(
      'Перед очисткой — вчера, 12:43',
    );
    expect(describeBackup(item({ reason: 'import', createdAt: local(26, 20, 15) }), now)).toBe(
      'Перед импортом — 26 июля, 20:15',
    );
  });

  it('битую дату не превращает в мусор', () => {
    expect(describeBackup(item({ createdAt: 'не дата' }), now)).toBe('Автоматическая');
  });

  it('повреждённую копию не выдаёт за автоматическую', () => {
    // The reason inside an unreadable file is unknown.
    expect(describeBackup(item({ corrupt: true, createdAt: local(28, 9, 0) }), now)).toBe(
      'Повреждённая копия — сегодня, 09:00',
    );
  });

  it('размер округляется', () => {
    expect(formatSize(512)).toBe('512 Б');
    expect(formatSize(4096)).toBe('4 КБ');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 МБ');
  });
});
