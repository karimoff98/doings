import type { MouseEvent } from 'react';
import type { ItemStatus } from '../domain/types';
import { Icon } from './Icon';

interface CheckboxProps {
  status: ItemStatus;
  onToggle: () => void;
  label: string;
}

/** Rounded square, filled blue when done, gray with a cross when canceled. */
export function Checkbox({ status, onToggle, label }: CheckboxProps) {
  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    onToggle();
  };

  return (
    <button
      type="button"
      className={[
        'checkbox',
        status === 'completed' && 'checkbox--done',
        status === 'canceled' && 'checkbox--canceled',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={status !== 'open'}
      aria-label={label}
      onClick={handleClick}
    >
      <Icon name={status === 'canceled' ? 'cross' : 'check'} size={11} />
    </button>
  );
}

interface ProgressRingProps {
  progress: number;
  size?: number;
  color?: string;
}

/** Project marker: a ring that fills up as the project's todos get done. */
export function ProgressRing({
  progress,
  size = 15,
  color = 'var(--c-project)',
}: ProgressRingProps) {
  const stroke = 1.6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <svg className="ring" width={size} height={size} aria-hidden="true" style={{ color }}>
      <circle
        className="ring__track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
      />
      {clamped > 0 && clamped < 1 && (
        <circle cx={size / 2} cy={size / 2} r={radius / 2.6} fill="currentColor" opacity="0.35" />
      )}
    </svg>
  );
}
