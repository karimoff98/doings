import { daysFromToday } from './dates';
import { selectSections } from './lists';
import type { Database, Todo } from './types';

/**
 * Open tasks that have already reached Today. A task that appears in Today only
 * because of its deadline is deliberately excluded: moving its start date
 * would not resolve the overdue deadline and would make the review misleading.
 */
export function dailyReviewTodos(db: Database): Todo[] {
  const seen = new Set<string>();
  return selectSections(db, 'today')
    .flatMap((section) => section.rows)
    .flatMap((row) => (row.kind === 'todo' ? [row.todo] : []))
    .filter((todo) => {
      if (seen.has(todo.id)) return false;
      seen.add(todo.id);
      if (todo.status !== 'open' || todo.trashed) return false;
      if (todo.when.kind === 'today' || todo.when.kind === 'evening') return true;
      return (
        todo.when.kind === 'scheduled' &&
        todo.when.date !== undefined &&
        daysFromToday(todo.when.date) <= 0
      );
    });
}
