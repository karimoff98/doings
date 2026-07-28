import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { shortcutLabel } from '../domain/platform';
import { useStore } from '../store/store';

interface TourStep {
  id: string;
  target: string;
  title: string;
  text: string;
  placement: 'right' | 'left' | 'top' | 'bottom';
  clickToContinue?: boolean;
}

const STEPS: TourStep[] = [
  {
    id: 'inbox',
    target: '[data-tour="list-inbox"]',
    title: 'Входящие',
    text: 'Сюда удобно быстро складывать новые мысли и задачи, чтобы разобрать их позже. Нажмите «Входящие».',
    placement: 'right',
    clickToContinue: true,
  },
  {
    id: 'today',
    target: '[data-tour="list-today"]',
    title: 'Сегодня',
    text: 'Здесь собраны дела, которыми вы решили заняться сегодня. Нажмите «Сегодня».',
    placement: 'right',
    clickToContinue: true,
  },
  {
    id: 'new-todo',
    target: '[data-tour="new-todo"]',
    title: 'Создайте задачу',
    text: `Эта кнопка добавляет задачу в открытый список. То же самое делает ${shortcutLabel('N')}. Нажмите её.`,
    placement: 'left',
    clickToContinue: true,
  },
  {
    id: 'editor',
    target: '[data-tour="task-editor"]',
    title: 'Редактор задачи',
    text: 'Здесь можно написать название и заметки, назначить дату, срок, теги, чеклист, повтор и напоминание.',
    placement: 'left',
  },
  {
    id: 'shortcuts',
    target: '[data-tour="shortcuts"]',
    title: 'Горячие клавиши',
    text: `Кнопка с клавиатурой открывает полный список команд. Быстрый вызов справки — ${shortcutLabel('/')}.`,
    placement: 'top',
  },
  {
    id: 'settings',
    target: '[data-tour="settings"]',
    title: 'Настройки и данные',
    text: 'Здесь меняется тема, создаются резервные копии, выполняются импорт и восстановление. Экскурсию тоже можно запустить отсюда снова.',
    placement: 'top',
  },
];

const GAP = 14;
const CARD_WIDTH = 330;
const EDGE = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Interactive spotlight over the real controls. */
export function GuidedTour() {
  const open = useStore((s) => s.tourOpen);
  const index = useStore((s) => s.tourStep);
  const setStep = useStore((s) => s.setTourStep);
  const stop = useStore((s) => s.stopTour);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  const step = STEPS[Math.min(index, STEPS.length - 1)];

  const finish = useCallback(() => {
    const editing = useStore.getState().editingTodoId;
    if (editing) useStore.getState().closeEditor();
    stop();
  }, [stop]);

  const go = useCallback(
    (next: number) => {
      if (next >= STEPS.length) finish();
      else setStep(next);
    },
    [finish, setStep],
  );

  useLayoutEffect(() => {
    if (!open || !step) return;
    let frame = 0;
    let attempts = 0;

    const locate = () => {
      const target = document.querySelector<HTMLElement>(step.target);
      if (!target) {
        attempts += 1;
        if (attempts < 12) frame = requestAnimationFrame(locate);
        else setMissing(true);
        return;
      }
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      const next = target.getBoundingClientRect();
      setRect(next);
      setMissing(false);
    };

    locate();
    const update = () => locate();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, index, step]);

  useEffect(() => {
    if (!open || !step?.clickToContinue) return;
    const onClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest(step.target);
      if (!target) return;
      window.setTimeout(() => go(index + 1), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [open, index, step, go]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (window.confirm('Завершить знакомство с интерфейсом?')) finish();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, finish]);

  const cardStyle = useMemo(() => {
    if (!rect || missing) {
      return {
        left: `calc(50% - ${CARD_WIDTH / 2}px)`,
        top: 'calc(50% - 110px)',
      };
    }
    let left = rect.right + GAP;
    let top = rect.top;
    if (step.placement === 'left') left = rect.left - CARD_WIDTH - GAP;
    if (step.placement === 'top') {
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      top = rect.top - 210;
    }
    if (step.placement === 'bottom') {
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      top = rect.bottom + GAP;
    }
    return {
      left: clamp(left, EDGE, window.innerWidth - CARD_WIDTH - EDGE),
      top: clamp(top, EDGE, window.innerHeight - 210 - EDGE),
    };
  }, [rect, missing, step]);

  if (!open || !step) return null;

  const hole = rect && !missing ? rect : null;
  const pad = 6;
  const top = hole ? Math.max(0, hole.top - pad) : 0;
  const left = hole ? Math.max(0, hole.left - pad) : 0;
  const right = hole ? Math.min(window.innerWidth, hole.right + pad) : 0;
  const bottom = hole ? Math.min(window.innerHeight, hole.bottom + pad) : 0;

  return (
    <div className="tour" data-testid="guided-tour">
      {hole ? (
        <>
          <div className="tour__shade" style={{ inset: `0 0 auto 0`, height: top }} />
          <div
            className="tour__shade"
            style={{ top, left: 0, width: left, height: bottom - top }}
          />
          <div
            className="tour__shade"
            style={{ top, left: right, right: 0, height: bottom - top }}
          />
          <div className="tour__shade" style={{ top: bottom, right: 0, bottom: 0, left: 0 }} />
          <div
            className="tour__focus"
            style={{ top, left, width: right - left, height: bottom - top }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="tour__shade" style={{ inset: 0 }} />
      )}

      <section
        className="tour__card"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        <div className="tour__eyebrow">
          Шаг {index + 1} из {STEPS.length}
        </div>
        <h2 id="tour-title" className="tour__title" aria-live="polite">
          {step.title}
        </h2>
        <p className="tour__text">
          {missing ? 'Элемент сейчас недоступен. Можно перейти к следующему шагу.' : step.text}
        </p>
        {step.clickToContinue && !missing && (
          <p className="tour__instruction">Нажмите подсвеченную кнопку</p>
        )}
        <div className="tour__actions">
          <button type="button" className="settings__button" onClick={finish}>
            Пропустить
          </button>
          <span className="tour__spacer" />
          {index > 0 && (
            <button type="button" className="settings__button" onClick={() => go(index - 1)}>
              Назад
            </button>
          )}
          {(!step.clickToContinue || missing) && (
            <button
              type="button"
              className="settings__button onboard__primary"
              onClick={() => go(index + 1)}
            >
              {index === STEPS.length - 1 ? 'Готово' : 'Далее'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
