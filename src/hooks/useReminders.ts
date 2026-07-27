import { useEffect } from 'react';
import { today } from '../domain/dates';
import type { Todo } from '../domain/types';
import { useStore } from '../store/store';

const FIRED_KEY = 'things-clone.reminders-fired';
const CHECK_INTERVAL_MS = 30_000;
const STALE_AFTER_MINUTES = 30;

/** Minutes between an `HH:mm` time today and now. Negative means the future. */
function minutesSince(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  const now = new Date();
  return (now.getHours() - hours) * 60 + (now.getMinutes() - minutes);
}

function loadFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveFired(fired: Set<string>, day: string) {
  // Keys carry their day, so yesterday's entries can be dropped.
  const kept = [...fired].filter((key) => key.includes(`:${day}:`));
  localStorage.setItem(FIRED_KEY, JSON.stringify(kept));
}

function currentTime(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** The day a reminder belongs to, or undefined when it cannot fire. */
function reminderDay(todo: Todo): string | undefined {
  if (!todo.reminder || todo.status !== 'open' || todo.trashed) return undefined;
  if (todo.when.kind === 'scheduled') return todo.when.date;
  if (todo.when.kind === 'today' || todo.when.kind === 'evening') return today();
  return undefined;
}

/**
 * Checks reminders twice a minute and fires a system notification once per
 * todo per day. Works in the browser too, if notifications are allowed.
 */
export function useReminders() {
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }

    const fired = loadFired();

    const tick = () => {
      if (Notification.permission !== 'granted') return;
      const { db } = useStore.getState();
      const day = today();
      const now = currentTime();
      let changed = false;

      for (const todo of db.todos) {
        if (reminderDay(todo) !== day) continue;
        const key = `${todo.id}:${day}:${todo.reminder}`;
        if (fired.has(key)) continue;
        if ((todo.reminder ?? '') > now) continue;

        fired.add(key);
        changed = true;

        // Long-past reminders are swallowed, so opening the app in the evening
        // does not fire a burst of notifications from the morning.
        if (minutesSince(todo.reminder ?? now) > STALE_AFTER_MINUTES) continue;

        const notification = new Notification(todo.title || 'Задача', {
          body: todo.notes.trim() || `Напоминание на ${todo.reminder}`,
          tag: key,
        });
        notification.onclick = () => {
          useStore.getState().selectTodo(todo.id);
          window.focus();
        };
      }

      if (changed) saveFired(fired, day);
    };

    tick();
    const timer = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
}
