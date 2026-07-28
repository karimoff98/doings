// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageNotice } from './StorageNotice';
import { useStore } from '../store/store';

/**
 * While writing is on hold the warning must stay put: hiding it would hide the
 * fact that nothing is being saved.
 */
const block = vi.hoisted(() => ({
  value: null as { reason: string; canContinue: boolean } | null,
  retry: { ok: true } as { ok: boolean; error?: string },
  retries: 0,
}));

vi.mock('../store/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  return {
    ...actual,
    writeBlock: () => block.value,
    retryBlockedWrite: () => {
      block.retries += 1;
      if (block.retry.ok) block.value = null;
      return Promise.resolve(block.retry);
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<StorageNotice />));
}

const notice = () => container.querySelector('[data-testid="storage-notice"]');
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === label);

beforeEach(() => {
  block.value = null;
  block.retry = { ok: true };
  block.retries = 0;
  useStore.setState({ storageError: undefined, storageIssues: [] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('баннер хранилища', () => {
  it('молчит, когда всё в порядке', () => {
    render();
    expect(notice()).toBeNull();
  });

  it('обычное предупреждение можно скрыть', () => {
    useStore.setState({ storageError: 'Не удалось сохранить базу' });
    render();

    const close = container.querySelector('.notice__close');
    expect(close).not.toBeNull();
    act(() => (close as HTMLButtonElement).click());
    expect(notice()).toBeNull();
  });

  it('активную блокировку нельзя закрыть', () => {
    block.value = { reason: 'Копия перед обновлением схемы не создана', canContinue: true };
    render();

    expect(notice()).not.toBeNull();
    // No cross, and no second button that would just hide the problem.
    expect(container.querySelector('.notice__close')).toBeNull();
    expect(button('Не перезаписывать базу')).toBeUndefined();
    expect(container.textContent).toContain('Новые изменения не сохраняются');
  });

  it('показывается даже без сообщения в сторе', () => {
    // The banner may have been dismissed earlier; the block still speaks for itself.
    block.value = { reason: 'Копия не создана', canContinue: true };
    render();
    expect(container.querySelector('.notice__title')?.textContent).toBe('Копия не создана');
  });

  it('кнопка повторяет отклонённую запись и закрывает баннер', async () => {
    block.value = { reason: 'Копия не создана', canContinue: true };
    render();

    await act(async () => {
      button('Продолжить без резервной копии')?.click();
    });

    expect(block.retries).toBe(1);
    expect(notice()).toBeNull();
  });

  it('при неудаче повтора баннер остаётся и объясняет причину', async () => {
    block.value = { reason: 'Копия не создана', canContinue: true };
    block.retry = { ok: false, error: 'диск переполнен' };
    render();

    await act(async () => {
      button('Продолжить без резервной копии')?.click();
    });

    expect(notice()).not.toBeNull();
    expect(container.textContent).toContain('диск переполнен');
    expect(container.querySelector('.notice__close')).toBeNull();
  });

  it('постоянную блокировку тоже нельзя закрыть', () => {
    block.value = { reason: 'Файл сделан более новой версией', canContinue: false };
    useStore.setState({ storageError: 'Файл сделан более новой версией' });
    render();

    expect(notice()).not.toBeNull();
    // Lifting it is impossible, so there is nothing to offer...
    expect(button('Продолжить без резервной копии')).toBeUndefined();
    // ...but hiding the warning would hide that nothing is being saved.
    expect(container.querySelector('.notice__close')).toBeNull();
    expect(container.textContent).toContain('Новые изменения не сохраняются');
  });

  it('постоянная блокировка видна и без сообщения в сторе', () => {
    block.value = { reason: 'Файл сделан более новой версией', canContinue: false };
    render();

    expect(container.querySelector('.notice__title')?.textContent).toBe(
      'Файл сделан более новой версией',
    );
    expect(container.querySelector('.notice__close')).toBeNull();
    expect(container.textContent).toContain('Сохраните копию данных через настройки');
  });
});
