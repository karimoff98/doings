import { useDeferredValue, useMemo, useState } from 'react';
import { SMART_LIST_META, projectTitle } from '../domain/lists';
import { SMART_LISTS } from '../domain/types';
import type { ListKey } from '../domain/types';
import { useStore } from '../store/store';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface Hit {
  key: string;
  title: string;
  sub?: string;
  icon: IconName;
  color?: string;
  list: ListKey;
  todoId?: string;
}

interface IndexedHit extends Hit {
  search: string;
  /** Tasks stay hidden until the user starts typing. */
  task: boolean;
}

function searchHits(index: IndexedHit[], query: string): Hit[] {
  const q = query.trim().toLocaleLowerCase();
  const result: Hit[] = [];
  for (const hit of index) {
    if ((!q && hit.task) || (q && !hit.search.includes(q))) continue;
    result.push(hit);
    if (result.length === 40) break;
  }
  return result;
}

/** ⌘F: one field to jump to any list, project or todo. */
export function QuickFind() {
  const open = useStore((s) => s.quickFindOpen);
  const setQuickFind = useStore((s) => s.setQuickFind);
  const db = useStore((s) => s.db);
  const selectList = useStore((s) => s.selectList);
  const selectTodo = useStore((s) => s.selectTodo);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const deferredQuery = useDeferredValue(query);

  /**
   * Titles and notes are normalized only when the database changes. Previously
   * every keypress rebuilt maps and lowercased every task before filtering.
   */
  const searchIndex = useMemo<IndexedHit[]>(() => {
    const result: IndexedHit[] = [];
    const areasById = new Map(db.areas.map((area) => [area.id, area]));
    const projectsById = new Map(db.projects.map((project) => [project.id, project]));

    for (const key of SMART_LISTS) {
      const meta = SMART_LIST_META[key];
      result.push({
        key: `list:${key}`,
        title: meta.title,
        search: meta.title.toLocaleLowerCase(),
        task: false,
        icon: meta.icon as IconName,
        color: meta.accent,
        list: key,
      });
    }

    for (const area of db.areas) {
      result.push({
        key: `area:${area.id}`,
        title: area.title,
        search: area.title.toLocaleLowerCase(),
        task: false,
        icon: 'area',
        list: `area:${area.id}`,
      });
    }

    for (const project of db.projects.filter((p) => !p.trashed)) {
      const name = projectTitle(project);
      result.push({
        key: `project:${project.id}`,
        title: name,
        search: name.toLocaleLowerCase(),
        task: false,
        sub: project.areaId ? areasById.get(project.areaId)?.title : undefined,
        icon: 'project',
        color: 'var(--c-project)',
        list: `project:${project.id}`,
      });
    }

    for (const tag of db.tags) {
      result.push({
        key: `tag:${tag.id}`,
        title: tag.title,
        search: tag.title.toLocaleLowerCase(),
        task: false,
        sub: 'тег',
        icon: 'tag',
        list: `tag:${tag.id}`,
      });
    }

    for (const todo of db.todos) {
      if (todo.trashed) continue;
      const project = todo.projectId ? projectsById.get(todo.projectId) : undefined;
      const area = todo.areaId ? areasById.get(todo.areaId) : undefined;
      result.push({
        key: `todo:${todo.id}`,
        title: todo.title || 'Без названия',
        search: `${todo.title} ${todo.notes}`.toLocaleLowerCase(),
        task: true,
        sub: project ? projectTitle(project) : (area?.title ?? 'Входящие'),
        icon: 'check',
        list: project
          ? `project:${project.id}`
          : area
            ? `area:${area.id}`
            : todo.status === 'open'
              ? 'inbox'
              : 'logbook',
        todoId: todo.id,
      });
    }

    return result;
  }, [db]);

  const hits = useMemo(() => searchHits(searchIndex, deferredQuery), [deferredQuery, searchIndex]);

  if (!open) return null;

  const close = () => {
    setQuickFind(false);
    setQuery('');
    setCursor(0);
  };

  const go = (hit: Hit) => {
    selectList(hit.list);
    if (hit.todoId) selectTodo(hit.todoId);
    close();
  };

  return (
    <div className="dialog__scrim" onMouseDown={close}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Быстрый поиск"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          className="dialog__input"
          autoFocus
          placeholder="Быстрый поиск"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(hits.length - 1, c + 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              // Deferred results may still show the previous query for a frame.
              // Enter must always use what is visibly typed in the field.
              const currentHits = query === deferredQuery ? hits : searchHits(searchIndex, query);
              const hit = currentHits[cursor];
              if (hit) go(hit);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
        <div className="dialog__list">
          {hits.map((hit, index) => (
            <button
              key={hit.key}
              type="button"
              className={`popitem${index === cursor ? ' popitem--active' : ''}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => go(hit)}
            >
              <span className="popitem__icon" style={{ color: hit.color }}>
                <Icon name={hit.icon} size={14} />
              </span>
              <span className="popitem__title">{hit.title}</span>
              {hit.sub && <span className="popitem__hint">{hit.sub}</span>}
            </button>
          ))}
          {!hits.length && <div className="dialog__empty">Ничего не найдено</div>}
        </div>
      </div>
    </div>
  );
}
