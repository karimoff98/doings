import { useEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  autoFocusEnd?: boolean;
};

/** Textarea that grows with its content, so the editor card has no scrollbars. */
export function AutoTextarea({ value, autoFocusEnd, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocusEnd) return;
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [autoFocusEnd]);

  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}
