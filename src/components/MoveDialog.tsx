import { useMemo, useState } from 'react';
import { projectTitle } from '../domain/lists';
import { useStore } from '../store/store';
import type { MoveTarget } from '../store/store';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface Destination {
  key: string;
  title: string;
  sub?: string;
  icon: IconName;
  color?: string;
  target: MoveTarget;
}

/** ⌘⇧M: pick a new home for the selected todo. */
export function MoveDialog() {
  const open = useStore((s) => s.moveDialogOpen);
  const setMoveDialog = useStore((s) => s.setMoveDialog);
  const db = useStore((s) => s.db);
  const selection = useStore((s) => s.selection);
  const moveTodo = useStore((s) => s.moveTodo);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const destinations = useMemo<Destination[]>(() => {
    const items: Destination[] = [
      { key: 'inbox', title: 'Входящие', icon: 'inbox', color: 'var(--c-inbox)', target: {} },
    ];
    for (const area of [...db.areas].sort((a, b) => a.index - b.index)) {
      items.push({
        key: `area:${area.id}`,
        title: area.title,
        icon: 'area',
        color: 'var(--text-secondary)',
        target: { areaId: area.id },
      });
      const projects = db.projects
        .filter((p) => p.areaId === area.id && p.status === 'open' && !p.trashed)
        .sort((a, b) => a.index - b.index);
      for (const project of projects) {
        items.push({
          key: `project:${project.id}`,
          title: projectTitle(project),
          sub: area.title,
          icon: 'project',
          color: 'var(--c-project)',
          target: { projectId: project.id },
        });
        for (const heading of db.headings
          .filter((h) => h.projectId === project.id)
          .sort((a, b) => a.index - b.index)) {
          items.push({
            key: `heading:${heading.id}`,
            title: heading.title,
            sub: projectTitle(project),
            icon: 'notes',
            target: { projectId: project.id, headingId: heading.id },
          });
        }
      }
    }
    for (const project of db.projects
      .filter((p) => !p.areaId && p.status === 'open' && !p.trashed)
      .sort((a, b) => a.index - b.index)) {
      items.push({
        key: `project:${project.id}`,
        title: projectTitle(project),
        icon: 'project',
        color: 'var(--c-project)',
        target: { projectId: project.id },
      });
      for (const standaloneHeading of db.headings
        .filter((item) => item.projectId === project.id)
        .sort((a, b) => a.index - b.index)) {
        items.push({
          key: `heading:${standaloneHeading.id}`,
          title: standaloneHeading.title,
          sub: projectTitle(project),
          icon: 'notes',
          target: { projectId: project.id, headingId: standaloneHeading.id },
        });
      }
    }
    return items;
  }, [db]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter(
      (item) => item.title.toLowerCase().includes(q) || (item.sub ?? '').toLowerCase().includes(q),
    );
  }, [destinations, query]);

  if (!open) return null;

  const close = () => {
    setMoveDialog(false);
    setQuery('');
    setCursor(0);
  };

  const apply = (destination: Destination) => {
    if (selection.length) moveTodo(selection, destination.target);
    close();
  };

  return (
    <div className="dialog__scrim" onMouseDown={close}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Переместить в"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          className="dialog__input"
          autoFocus
          placeholder="Переместить в…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(filtered.length - 1, c + 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const target = filtered[cursor];
              if (target) apply(target);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
        <div className="dialog__list">
          {filtered.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={`popitem${index === cursor ? ' popitem--active' : ''}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => apply(item)}
            >
              <span className="popitem__icon" style={{ color: item.color }}>
                <Icon name={item.icon} size={14} />
              </span>
              <span className="popitem__title">{item.title}</span>
              {item.sub && <span className="popitem__hint">{item.sub}</span>}
            </button>
          ))}
          {!filtered.length && <div className="dialog__empty">Ничего не найдено</div>}
        </div>
      </div>
    </div>
  );
}
