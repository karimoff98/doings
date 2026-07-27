import { useMemo, useState } from 'react';
import { SMART_LIST_META } from '../domain/lists';
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

/** ⌘F: one field to jump to any list, project or todo. */
export function QuickFind() {
  const open = useStore((s) => s.quickFindOpen);
  const setQuickFind = useStore((s) => s.setQuickFind);
  const db = useStore((s) => s.db);
  const selectList = useStore((s) => s.selectList);
  const selectTodo = useStore((s) => s.selectTodo);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    const result: Hit[] = [];

    for (const key of SMART_LISTS) {
      const meta = SMART_LIST_META[key];
      if (!q || meta.title.toLowerCase().includes(q)) {
        result.push({
          key: `list:${key}`,
          title: meta.title,
          icon: meta.icon as IconName,
          color: meta.accent,
          list: key,
        });
      }
    }

    for (const area of db.areas) {
      if (q && !area.title.toLowerCase().includes(q)) continue;
      result.push({
        key: `area:${area.id}`,
        title: area.title,
        icon: 'area',
        list: `area:${area.id}`,
      });
    }

    for (const project of db.projects.filter((p) => !p.trashed)) {
      if (q && !project.title.toLowerCase().includes(q)) continue;
      result.push({
        key: `project:${project.id}`,
        title: project.title,
        sub: db.areas.find((a) => a.id === project.areaId)?.title,
        icon: 'project',
        color: 'var(--c-project)',
        list: `project:${project.id}`,
      });
    }

    for (const tag of db.tags) {
      if (q && !tag.title.toLowerCase().includes(q)) continue;
      result.push({
        key: `tag:${tag.id}`,
        title: tag.title,
        sub: 'тег',
        icon: 'tag',
        list: `tag:${tag.id}`,
      });
    }

    if (q) {
      for (const todo of db.todos.filter((t) => !t.trashed)) {
        const haystack = `${todo.title} ${todo.notes}`.toLowerCase();
        if (!haystack.includes(q)) continue;
        const project = db.projects.find((p) => p.id === todo.projectId);
        const area = db.areas.find((a) => a.id === todo.areaId);
        result.push({
          key: `todo:${todo.id}`,
          title: todo.title || 'Без названия',
          sub: project?.title ?? area?.title ?? 'Входящие',
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
    }

    return result.slice(0, 40);
  }, [db, query]);

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
              const hit = hits[cursor];
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
