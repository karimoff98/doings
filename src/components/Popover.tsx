import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  /** Open upwards when the trigger sits near the bottom of the window. */
  up?: boolean;
  width?: number;
}

/**
 * Absolutely positioned panel anchored to its parent (which must carry `.anchor`).
 * Closes on outside mousedown and on Escape.
 */
export function Popover({ open, onClose, children, align = 'left', up, width }: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [autoUp, setAutoUp] = useState(false);
  const [offsetX, setOffsetX] = useState(0);

  useLayoutEffect(() => {
    if (!open) return;
    const node = panel.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const anchorBox = node.parentElement?.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = anchorBox ? window.innerHeight - anchorBox.bottom : window.innerHeight;
    const spaceAbove = anchorBox?.top ?? 0;
    setAutoUp(Boolean(!up && box.height > spaceBelow - margin && spaceAbove > spaceBelow));

    const naturalLeft = box.left - offsetX;
    const naturalRight = box.right - offsetX;
    if (naturalRight > window.innerWidth - margin) {
      setOffsetX(window.innerWidth - margin - naturalRight);
    } else if (naturalLeft < margin) {
      setOffsetX(margin - naturalLeft);
    } else {
      setOffsetX(0);
    }
  }, [open, up, children, offsetX]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="popover__scrim"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={panel}
        className={`popover${up || autoUp ? ' popover--up' : ''}`}
        role="dialog"
        style={{
          left: align === 'left' ? 0 : undefined,
          right: align === 'right' ? 0 : undefined,
          minWidth: width,
          marginLeft: offsetX,
        }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}
