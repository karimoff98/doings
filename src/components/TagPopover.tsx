import { useEffect, useState } from 'react';
import type { Id, Tag } from '../domain/types';
import { Icon } from './Icon';
import { Popover } from './Popover';

interface TagPopoverProps {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  selected: Id[];
  onToggle: (tagId: Id) => void;
  onCreate: (title: string) => void;
  up?: boolean;
}

export function TagPopover({
  open,
  onClose,
  tags,
  selected,
  onToggle,
  onCreate,
  up,
}: TagPopoverProps) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const visible = tags.filter((tag) => tag.title.toLowerCase().includes(trimmed.toLowerCase()));
  const exists = tags.some((tag) => tag.title.toLowerCase() === trimmed.toLowerCase());

  // A search from the previous opening must not make tags appear to be missing.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const submit = () => {
    if (!trimmed) return;
    if (exists) {
      const tag = tags.find((t) => t.title.toLowerCase() === trimmed.toLowerCase());
      if (tag) onToggle(tag.id);
    } else {
      onCreate(trimmed);
    }
    setQuery('');
  };

  return (
    <Popover open={open} onClose={onClose} up={up} width={230}>
      <input
        className="popover__search"
        placeholder="Тег или новый тег"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />
      {visible.map((tag) => (
        <button key={tag.id} type="button" className="popitem" onClick={() => onToggle(tag.id)}>
          <span className="popitem__icon" style={{ color: 'var(--text-tertiary)' }}>
            <Icon name="tag" size={13} />
          </span>
          <span className="popitem__title">{tag.title}</span>
          {selected.includes(tag.id) && (
            <span className="popitem__icon" style={{ color: 'var(--accent)' }}>
              <Icon name="check" size={12} />
            </span>
          )}
        </button>
      ))}
      {trimmed && !exists && (
        <button type="button" className="popitem" onClick={submit}>
          <span className="popitem__icon">
            <Icon name="plus" size={12} />
          </span>
          <span className="popitem__title">Создать «{trimmed}»</span>
        </button>
      )}
      {!visible.length && !trimmed && (
        <div className="popitem__sub" style={{ padding: '6px 8px' }}>
          Тегов пока нет
        </div>
      )}
    </Popover>
  );
}
