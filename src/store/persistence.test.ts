// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The storage layer is the last line of defence: whatever the file contains,
 * hydration must not throw, because zustand then never finishes and the window
 * stays empty.
 */

interface DesktopStorageMock {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  path: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
  import: ReturnType<typeof vi.fn>;
  loadBackup: ReturnType<typeof vi.fn>;
  quarantine: ReturnType<typeof vi.fn>;
}

function mockDesktop(overrides: Partial<DesktopStorageMock> = {}): DesktopStorageMock {
  const storage: DesktopStorageMock = {
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(true),
    path: vi.fn().mockResolvedValue('/tmp/database.json'),
    export: vi.fn().mockResolvedValue(null),
    import: vi.fn().mockResolvedValue(null),
    loadBackup: vi.fn().mockResolvedValue(null),
    quarantine: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  (window as unknown as { desktop: unknown }).desktop = { platform: 'darwin', storage };
  return storage;
}

/** Fresh module instance per test: the layer keeps state in module scope. */
async function loadModule() {
  vi.resetModules();
  const module = await import('./persistence');
  if (!module.appStorage) throw new Error('appStorage не создан');
  return { ...module, appStorage: module.appStorage };
}

const errors: string[] = [];

/**
 * Node 25 provides its own incomplete localStorage that shadows the jsdom one,
 * so tests that need it install a working stub.
 */
function fakeLocalStorage(): void {
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
}

beforeEach(() => {
  errors.length = 0;
  fakeLocalStorage();
});

afterEach(() => {
  delete (window as unknown as { desktop?: unknown }).desktop;
});

describe('файловое хранилище', () => {
  it('читает нормальный файл как есть', async () => {
    const payload = JSON.stringify({ state: { db: { todos: [] } }, version: 1 });
    mockDesktop({ load: vi.fn().mockResolvedValue(payload) });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    const value = await appStorage.getItem('doings.v1');
    expect(value).toEqual({ state: { db: { todos: [] } }, version: 1 });
    expect(errors).toEqual([]);
  });

  it('на сломанном JSON берёт резервную копию', async () => {
    const good = JSON.stringify({ state: { db: 'из копии' }, version: 1 });
    mockDesktop({
      load: vi.fn().mockResolvedValue('{ это не json'),
      loadBackup: vi.fn().mockResolvedValue(good),
    });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    const value = await appStorage.getItem('doings.v1');
    expect(value).toEqual({ state: { db: 'из копии' }, version: 1 });
    expect(errors.join(' ')).toContain('восстановлены из резервной копии');
  });

  it('если и копия сломана, откладывает файл и отдаёт null без исключения', async () => {
    const quarantine = vi.fn().mockResolvedValue('/tmp/database.json.corrupt-2026.json');
    mockDesktop({
      load: vi.fn().mockResolvedValue('{ сломано'),
      loadBackup: vi.fn().mockResolvedValue('тоже сломано'),
      quarantine,
    });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    // Главное: не throw. Иначе гидратация zustand не завершается.
    await expect(appStorage.getItem('doings.v1')).resolves.toBeNull();
    expect(quarantine).toHaveBeenCalled();
    expect(errors.join(' ')).toContain('corrupt-2026');
  });

  it('ошибка чтения не роняет гидратацию', async () => {
    mockDesktop({ load: vi.fn().mockRejectedValue(new Error('диск отвалился')) });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    await expect(appStorage.getItem('doings.v1')).resolves.toBeNull();
    expect(errors.join(' ')).toContain('диск отвалился');
  });

  it('сообщает, когда запись не удалась', async () => {
    const save = vi.fn().mockResolvedValue(false);
    mockDesktop({ save });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    appStorage.setItem('doings.v1', { state: {}, version: 1 } as never);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    await vi.waitFor(() => expect(errors.join(' ')).toContain('Не удалось сохранить'));
  });

  it('второе сохранение ждёт, пока идёт первое', async () => {
    // Запись длится дольше, чем задержка перед сохранением (250 мс), поэтому
    // второй вызов гарантированно пытается начаться, пока первый ещё в полёте.
    const SAVE_MS = 500;
    const порядок: string[] = [];
    let активных = 0;
    let максимумОдновременно = 0;
    const save = vi.fn().mockImplementation(async (json: string) => {
      активных += 1;
      максимумОдновременно = Math.max(максимумОдновременно, активных);
      порядок.push(`начало ${json}`);
      await new Promise((resolve) => setTimeout(resolve, SAVE_MS));
      порядок.push(`конец ${json}`);
      активных -= 1;
      return true;
    });
    mockDesktop({ save });
    const { appStorage } = await loadModule();

    appStorage.setItem('doings.v1', { snapshot: 'первый' } as never);
    // 300 мс: задержка истекла, первая запись уже началась и продлится ещё 200.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(порядок).toEqual(['начало {"snapshot":"первый"}']);

    appStorage.setItem('doings.v1', { snapshot: 'второй' } as never);
    // 250 мс: задержка второй записи истекла, первая ещё не закончилась.
    await new Promise((resolve) => setTimeout(resolve, 250));
    // Без очереди здесь уже шли бы две записи в один временный файл.
    expect(активных).toBe(1);
    expect(порядок).toEqual(['начало {"snapshot":"первый"}']);

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await vi.waitFor(() => expect(порядок).toHaveLength(4), { timeout: 3000 });

    expect(максимумОдновременно).toBe(1);
    expect(порядок).toEqual([
      'начало {"snapshot":"первый"}',
      'конец {"snapshot":"первый"}',
      'начало {"snapshot":"второй"}',
      'конец {"snapshot":"второй"}',
    ]);
  });

  it('после удачного сохранения та же ошибка снова показывается', async () => {
    let удача = false;
    const save = vi.fn().mockImplementation(async () => udacha());
    const udacha = () => удача;
    mockDesktop({ save });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    appStorage.setItem('doings.v1', { state: { a: 1 }, version: 1 } as never);
    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 3000 });

    удача = true;
    appStorage.setItem('doings.v1', { state: { a: 2 }, version: 1 } as never);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 3000 });

    удача = false;
    appStorage.setItem('doings.v1', { state: { a: 3 }, version: 1 } as never);
    // Подавление на весь сеанс скрывало бы повторную поломку навсегда.
    await vi.waitFor(() => expect(errors).toHaveLength(2), { timeout: 3000 });
  });

  it('заблокированная запись не трогает файл', async () => {
    const save = vi.fn().mockResolvedValue(true);
    mockDesktop({ save });
    const { appStorage, blockWrites, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));
    blockWrites('Файл сделан более новой версией');

    appStorage.setItem('doings.v1', { state: {}, version: 1 } as never);
    await vi.waitFor(() => expect(errors.join(' ')).toContain('более новой версией'));
    expect(save).not.toHaveBeenCalled();
  });

  it('запоминает ревизию файла и пишет от неё', async () => {
    const stored = JSON.stringify({ state: { db: 1 }, version: 1, revision: 7 });
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 8 });
    mockDesktop({ load: vi.fn().mockResolvedValue(stored), save });
    const { appStorage } = await loadModule();

    await appStorage.getItem('doings.v1');
    appStorage.setItem('doings.v1', { state: { db: 2 }, version: 1 } as never);

    // The revision read from disk travels with the write so the main process
    // can detect an older copy trying to clobber a newer file.
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(String), 7));
  });

  it('на конфликте ревизий блокирует запись и сообщает', async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, reason: 'conflict', revision: 99 });
    mockDesktop({ save });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    await appStorage.getItem('doings.v1');
    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    await vi.waitFor(() => expect(errors.join(' ')).toContain('другой копией'));

    // Once a conflict is seen, further writes stay blocked rather than fighting
    // the other copy over the file.
    save.mockClear();
    appStorage.setItem('doings.v1', { state: { db: 2 }, version: 1 } as never);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(save).not.toHaveBeenCalled();
  });

  it('принимает старый булев ответ save()', async () => {
    const save = vi.fn().mockResolvedValue(true);
    mockDesktop({ save });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    await appStorage.getItem('doings.v1');
    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(errors).toEqual([]);
  });

  it('обработчик, который сам пишет в хранилище, не вызывает рекурсию', async () => {
    // Так ведёт себя стор: сообщение об ошибке кладётся в состояние, а любое
    // изменение состояния просит хранилище сохраниться снова.
    const save = vi.fn().mockResolvedValue(false);
    mockDesktop({ save });
    const { appStorage, setStorageErrorHandler } = await loadModule();

    let handled = 0;
    setStorageErrorHandler((message) => {
      handled += 1;
      errors.push(message);
      appStorage.setItem('doings.v1', { state: {}, version: 1 } as never);
    });

    appStorage.setItem('doings.v1', { state: {}, version: 1 } as never);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 400));

    // До исправления это уходило в бесконечный цикл и валило приложение.
    expect(handled).toBe(1);
  });

  it('одна и та же ошибка не повторяется', async () => {
    mockDesktop({ save: vi.fn().mockResolvedValue(true) });
    const { appStorage, blockWrites, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));
    blockWrites('Файл сделан более новой версией');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      appStorage.setItem('doings.v1', { state: { attempt }, version: 1 } as never);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(errors).toHaveLength(1);
  });

  it('сообщения, найденные при чтении, забирает стор при слиянии состояния', async () => {
    mockDesktop({ load: vi.fn().mockRejectedValue(new Error('рано')) });
    const { appStorage, drainStorageErrors } = await loadModule();

    await appStorage.getItem('doings.v1');
    // Гидратация заменяет состояние целиком, поэтому сообщение должно ждать
    // в очереди, а не выставляться в стор до слияния.
    const drained = drainStorageErrors();
    expect(drained.join(' ')).toContain('рано');
    expect(drainStorageErrors()).toEqual([]);
  });

  it('переносит базу из localStorage прежнего имени', async () => {
    const legacy = JSON.stringify({ state: { db: 'старое' }, version: 1 });
    localStorage.setItem('things-clone.v1', legacy);
    const save = vi.fn().mockResolvedValue(true);
    mockDesktop({ save });
    const { appStorage } = await loadModule();

    const value = await appStorage.getItem('doings.v1');
    expect(value).toEqual({ state: { db: 'старое' }, version: 1 });
    // A fresh file has no revision yet, so the migration writes from base 0.
    expect(save).toHaveBeenCalledWith(legacy, 0);
    expect(localStorage.getItem('things-clone.v1')).toBeNull();
  });
});

describe('задержка записи до важной работы', () => {
  it('ничего не пишется, пока копия перед миграцией не готова', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 1 });
    mockDesktop({ save });
    const { appStorage, holdWrites } = await loadModule();

    let finishBackup: () => void = () => {};
    holdWrites(new Promise<void>((resolve) => (finishBackup = resolve)));

    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // The old file must survive until the copy of it exists.
    expect(save).not.toHaveBeenCalled();

    finishBackup();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('сорвавшаяся работа не блокирует запись навсегда', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 1 });
    mockDesktop({ save });
    const { appStorage, holdWrites } = await loadModule();

    holdWrites(Promise.reject(new Error('копия не удалась')));

    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    // A failed backup is reported elsewhere; the user's data still gets saved.
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});

describe('первый запуск и онбординг', () => {
  const DB = JSON.stringify({ state: { db: { todos: [] } }, version: 1, revision: 4 });

  it('новая установка без базы считается первым запуском', async () => {
    mockDesktop({ load: vi.fn().mockResolvedValue(null) });
    const { appStorage, isFirstRun } = await loadModule();

    // Nothing is known until the first read finishes.
    expect(isFirstRun()).toBe(false);
    await appStorage.getItem('doings.v1');
    expect(isFirstRun()).toBe(true);
  });

  it('существующая база 0.1.6 не считается первым запуском', async () => {
    mockDesktop({ load: vi.fn().mockResolvedValue(DB) });
    const { appStorage, isFirstRun } = await loadModule();

    await appStorage.getItem('doings.v1');
    // Updating from an earlier version must not show the introduction.
    expect(isFirstRun()).toBe(false);
  });

  it('база прежнего имени тоже не первый запуск', async () => {
    localStorage.setItem('things-clone.v1', JSON.stringify({ state: { db: 1 }, version: 1 }));
    mockDesktop({ load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(true) });
    const { appStorage, isFirstRun } = await loadModule();

    await appStorage.getItem('doings.v1');
    expect(isFirstRun()).toBe(false);
  });

  it('после завершения онбординга он больше не первый запуск', async () => {
    mockDesktop({ load: vi.fn().mockResolvedValue(null) });
    const { appStorage, isFirstRun, markOnboardingComplete, isOnboardingComplete } =
      await loadModule();

    await appStorage.getItem('doings.v1');
    expect(isFirstRun()).toBe(true);

    markOnboardingComplete();
    expect(isOnboardingComplete()).toBe(true);
    // The marker lives outside the database, so a restart before the file
    // appears still counts as "already seen".
    expect(isFirstRun()).toBe(false);

    const restarted = await loadModule();
    await restarted.appStorage.getItem('doings.v1');
    expect(restarted.isFirstRun()).toBe(false);
  });

  it('повреждённая база не выдаётся за первый запуск', async () => {
    mockDesktop({
      load: vi.fn().mockResolvedValue('{ это не json'),
      loadBackup: vi.fn().mockResolvedValue(null),
      quarantine: vi.fn().mockResolvedValue('/tmp/database.corrupt.json'),
    });
    const { appStorage, isFirstRun, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    await appStorage.getItem('doings.v1');

    // The warning is what matters here; the introduction would only hide it.
    expect(isFirstRun()).toBe(false);
    expect(errors.join(' ')).toContain('не читается');
  });

  it('ошибка чтения не выдаётся за первый запуск', async () => {
    mockDesktop({ load: vi.fn().mockRejectedValue(new Error('диск отвалился')) });
    const { appStorage, isFirstRun } = await loadModule();

    await appStorage.getItem('doings.v1');
    expect(isFirstRun()).toBe(false);
  });

  it('в окне быстрого ввода онбординга нет', async () => {
    mockDesktop({ load: vi.fn().mockResolvedValue(null) });
    const { appStorage, isFirstRun } = await loadModule();
    await appStorage.getItem('doings.v1');
    expect(isFirstRun()).toBe(true);

    window.location.hash = '#quick';
    try {
      // Quick Entry shares the bundle but is just an input box.
      expect(isFirstRun()).toBe(false);
    } finally {
      window.location.hash = '';
    }
  });
});

describe('повреждённая база не выдаётся за успешную загрузку', () => {
  it('возвращает null, предупреждает и не перезаписывает файл', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 1 });
    const quarantine = vi.fn().mockResolvedValue('/tmp/database.corrupt-2026.json');
    mockDesktop({
      load: vi.fn().mockResolvedValue('{ это не json'),
      loadBackup: vi.fn().mockResolvedValue(null),
      quarantine,
      save,
    });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    const value = await appStorage.getItem('doings.v1');

    // Nothing is invented in place of the file, and the user is told why.
    expect(value).toBeNull();
    expect(errors.join(' ')).toContain('не читается');
    // The broken file is set aside rather than overwritten in place.
    expect(quarantine).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    // The message must not promise example data any more.
    expect(errors.join(' ')).not.toContain('демонстрационными данными');
  });

  it('сначала пробует резервную копию', async () => {
    const good = JSON.stringify({ state: { db: { todos: [] } }, version: 1 });
    const quarantine = vi.fn().mockResolvedValue(null);
    mockDesktop({
      load: vi.fn().mockResolvedValue('{ битый'),
      loadBackup: vi.fn().mockResolvedValue(good),
      quarantine,
    });
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    const value = await appStorage.getItem('doings.v1');

    expect(value).toEqual({ state: { db: { todos: [] } }, version: 1 });
    expect(errors.join(' ')).toContain('резервной копии');
    // A usable backup means there is nothing to quarantine.
    expect(quarantine).not.toHaveBeenCalled();
  });
});

describe('сохранение перед выходом', () => {
  it('успевает записать текст, который ещё печатали в редакторе', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 1 });
    mockDesktop({ save });
    const { appStorage, flushPendingWrites } = await loadModule();
    // Same module graph as the storage under test, so the registry is shared.
    const { registerPendingEdit } = await import('./pendingEdits');

    // The editor holds the newest characters in local state: pressing ⌘Q right
    // after typing must commit them and only then write the database.
    registerPendingEdit(() => {
      appStorage.setItem('doings.v1', { state: { db: 'напечатано' }, version: 1 } as never);
    });

    const result = await flushPendingWrites();

    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(String(save.mock.calls[0][0])).toContain('напечатано');
  });

  it('на ошибке записи не докладывает об успехе', async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, reason: 'io' });
    mockDesktop({ save });
    const { appStorage, flushPendingWrites, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    const result = await flushPendingWrites();

    // Reporting success here would let the app quit and lose the changes.
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Не удалось сохранить базу');
  });

  it('на конфликте базы не докладывает об успехе', async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, reason: 'conflict', revision: 9 });
    mockDesktop({ save });
    const { appStorage, flushPendingWrites, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    const result = await flushPendingWrites();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('другой копией');
  });

  it('после удачной записи снова докладывает об успехе', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'io' })
      .mockResolvedValue({ ok: true, revision: 1 });
    mockDesktop({ save });
    const { appStorage, flushPendingWrites } = await loadModule();

    appStorage.setItem('doings.v1', { state: { db: 1 }, version: 1 } as never);
    expect((await flushPendingWrites()).ok).toBe(false);

    // A stale failure must not block quitting forever once the disk recovers.
    appStorage.setItem('doings.v1', { state: { db: 2 }, version: 1 } as never);
    expect((await flushPendingWrites()).ok).toBe(true);
  });
});

describe('браузерное хранилище', () => {
  it('повреждённое значение не роняет запуск', async () => {
    localStorage.setItem('doings.v1', 'не json');
    const { appStorage, setStorageErrorHandler } = await loadModule();
    setStorageErrorHandler((message) => errors.push(message));

    // Браузерный путь синхронный, поэтому значение приходит без промиса.
    expect(await appStorage.getItem('doings.v1')).toBeNull();
    expect(errors.join(' ')).toContain('повреждены');
  });
});
