import { useEffect, useMemo, useRef, useState } from 'react';
import { dailyReviewTodos } from '../domain/dailyReview';
import { formatDayShort, today, tomorrow } from '../domain/dates';
import type { Id, When } from '../domain/types';
import {
  isOnboardingComplete,
  markDailyReviewShown,
  wasDailyReviewShown,
} from '../store/persistence';
import { useStore } from '../store/store';
import { Icon } from './Icon';

type ReviewChoice = 'today' | 'tomorrow' | 'unscheduled' | 'someday';

const CHOICES: { value: ReviewChoice; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'tomorrow', label: 'Завтра' },
  { value: 'unscheduled', label: 'Без даты' },
  { value: 'someday', label: 'Когда-нибудь' },
];

function choiceWhen(choice: ReviewChoice): When {
  if (choice === 'tomorrow') return { kind: 'scheduled', date: tomorrow() };
  if (choice === 'unscheduled') return { kind: 'unscheduled' };
  if (choice === 'someday') return { kind: 'someday' };
  return { kind: 'today' };
}

function taskCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun =
    lastTwo >= 11 && lastTwo <= 14
      ? 'задач'
      : last === 1
        ? 'задача'
        : last >= 2 && last <= 4
          ? 'задачи'
          : 'задач';
  return `${count} ${noun} ${last === 1 && lastTwo !== 11 ? 'ждёт' : 'ждут'} решения`;
}

/** A short, deliberate pass over work that has reached Today. */
export function DailyReview() {
  const open = useStore((state) => state.dailyReviewOpen);
  const enabled = useStore((state) => state.dailyReviewEnabled);
  const onboardingOpen = useStore((state) => state.onboardingOpen);
  const tourOpen = useStore((state) => state.tourOpen);
  const db = useStore((state) => state.db);
  const setOpen = useStore((state) => state.setDailyReview);
  const apply = useStore((state) => state.applyDailyReview);
  const candidates = useMemo(() => dailyReviewTodos(db), [db]);
  const projectTitles = useMemo(
    () => new Map(db.projects.map((project) => [project.id, project.title])),
    [db.projects],
  );
  const [choices, setChoices] = useState<Record<Id, ReviewChoice>>({});
  const autoChecked = useRef(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoChecked.current || onboardingOpen || tourOpen) return;
    autoChecked.current = true;
    if (!enabled || !isOnboardingComplete() || candidates.length === 0) return;
    const day = today();
    if (wasDailyReviewShown(day)) return;
    markDailyReviewShown(day);
    setOpen(true);
  }, [candidates.length, enabled, onboardingOpen, setOpen, tourOpen]);

  useEffect(() => {
    if (!open) return;
    setChoices(Object.fromEntries(candidates.map((todo) => [todo.id, 'today'])));
  }, [candidates, open]);

  useEffect(() => {
    if (!open) return;
    card.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !card.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="dialog__scrim review__scrim" onMouseDown={() => setOpen(false)}>
      <div
        ref={card}
        className="dialog review"
        role="dialog"
        aria-modal="true"
        aria-label="Планирование дня"
        data-testid="daily-review"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review__header">
          <span className="review__mark">
            <Icon name="star" size={20} />
          </span>
          <div>
            <h2>Планирование дня</h2>
            <p>
              {candidates.length ? taskCountLabel(candidates.length) : 'На сегодня всё разобрано'}
            </p>
          </div>
        </header>

        {candidates.length > 0 && (
          <div className="review__list">
            {candidates.map((todo) => (
              <article className="review__item" key={todo.id}>
                <div className="review__task">
                  <span className="review__title">{todo.title || 'Без названия'}</span>
                  <span className="review__meta">
                    {todo.projectId && projectTitles.get(todo.projectId)}
                    {todo.when.kind === 'scheduled' &&
                      todo.when.date &&
                      `${todo.projectId ? ' · ' : ''}${formatDayShort(todo.when.date)}`}
                  </span>
                </div>
                <div className="review__choices" role="radiogroup" aria-label={todo.title}>
                  {CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={(choices[todo.id] ?? 'today') === choice.value}
                      className={`review__choice${
                        (choices[todo.id] ?? 'today') === choice.value ? ' review__choice--on' : ''
                      }`}
                      onClick={() =>
                        setChoices((current) => ({ ...current, [todo.id]: choice.value }))
                      }
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        <footer className="review__footer">
          <button
            type="button"
            className="settings__button settings__button--quiet"
            onClick={() => setOpen(false)}
          >
            {candidates.length ? 'Не сейчас' : 'Закрыть'}
          </button>
          {candidates.length > 0 && (
            <button
              type="button"
              className="settings__button review__apply"
              data-autofocus
              onClick={() =>
                apply(
                  candidates.map((todo) => ({
                    id: todo.id,
                    when: choiceWhen(choices[todo.id] ?? 'today'),
                  })),
                )
              }
            >
              Применить план
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
