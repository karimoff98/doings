// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store/store';
import { GuidedTour } from './GuidedTour';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function target(name: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.dataset.tour = name;
  document.body.appendChild(node);
  return node;
}

function render(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<GuidedTour />));
}

beforeEach(() => {
  useStore.setState({ tourOpen: false, tourStep: 0, editingTodoId: undefined });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 20,
    y: 100,
    top: 100,
    left: 20,
    right: 180,
    bottom: 140,
    width: 160,
    height: 40,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('интерактивное знакомство', () => {
  it('подсвечивает реальную кнопку первого шага', () => {
    target('list-inbox');
    useStore.getState().startTour();
    render();

    expect(host.querySelector('[data-testid="guided-tour"]')).not.toBeNull();
    expect(host.textContent).toContain('Входящие');
    expect(host.querySelector('.tour__focus')).not.toBeNull();
  });

  it('клик по целевой кнопке переводит к следующему шагу', async () => {
    const inbox = target('list-inbox');
    target('list-today');
    useStore.getState().startTour();
    render();

    await act(async () => {
      inbox.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useStore.getState().tourStep).toBe(1);
    expect(host.textContent).toContain('Сегодня');
  });

  it('фон перекрыт, а обязательный клик нельзя заменить кнопкой «Далее»', () => {
    target('list-inbox');
    useStore.getState().startTour();
    render();

    expect(host.querySelectorAll('.tour__shade').length).toBe(4);
    expect(host.textContent).toContain('Нажмите подсвеченную кнопку');
    expect(
      [...host.querySelectorAll('button')].some((node) => node.textContent?.includes('Далее')),
    ).toBe(false);
  });

  it('можно пропустить без изменения пользовательской базы', () => {
    target('list-inbox');
    const before = useStore.getState().db.todos.length;
    useStore.getState().startTour();
    render();
    const skip = [...host.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Пропустить',
    );

    act(() => skip?.click());

    expect(useStore.getState().tourOpen).toBe(false);
    expect(useStore.getState().db.todos).toHaveLength(before);
  });

  it('отсутствующий элемент не ломает экскурсию', async () => {
    useStore.getState().startTour();
    render();

    await act(async () => {
      for (let frame = 0; frame < 14; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });

    expect(host.textContent).toContain('Элемент сейчас недоступен');
    const next = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Далее'),
    );
    expect(next).toBeDefined();
  });
});
