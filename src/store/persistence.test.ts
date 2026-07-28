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
    expect(save).toHaveBeenCalledWith(legacy);
    expect(localStorage.getItem('things-clone.v1')).toBeNull();
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
