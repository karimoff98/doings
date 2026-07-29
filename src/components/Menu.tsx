import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  color?: string;
  hint?: string;
  run: () => void;
}

/** Where the pointer was when the menu was requested. */
export interface MenuPosition {
  x: number;
  y: number;
}

interface MenuProps {
  at: MenuPosition;
  /** Groups are separated by a divider. Empty groups are skipped. */
  groups: MenuItem[][];
  title?: string;
  onClose: () => void;
}

const MARGIN = 8;

/** Context menu anchored to the pointer. Closes on outside click, Escape or resize. */
export function Menu({ at, groups, title, onClose }: MenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);

  // Keep the menu inside the window even when opened near an edge.
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    setPosition({
      x: Math.max(MARGIN, Math.min(at.x, window.innerWidth - box.width - MARGIN)),
      y: Math.max(MARGIN, Math.min(at.y, window.innerHeight - box.height - MARGIN)),
    });
  }, [at]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const visible = groups.filter((group) => group.length > 0);
  if (!visible.length) return null;

  return (
    <>
      <div
        className="popover__scrim"
        onMouseDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panel}
        className="contextmenu"
        role="menu"
        aria-label={title ?? 'Меню действий'}
        data-testid="context-menu"
        style={{ left: position.x, top: position.y }}
      >
        {title && <div className="popover__label">{title}</div>}
        {visible.map((group, index) => (
          <div key={group[0].key}>
            {index > 0 && <div className="popover__divider" />}
            {group.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className="popitem"
                onClick={() => {
                  item.run();
                  onClose();
                }}
              >
                <span className="popitem__icon" style={{ color: item.color }}>
                  {item.icon && <Icon name={item.icon} size={13} />}
                </span>
                <span className="popitem__title">{item.label}</span>
                {item.hint && <span className="popitem__hint">{item.hint}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
