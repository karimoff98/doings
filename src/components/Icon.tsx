import type { JSX } from 'react';

export type IconName =
  | 'inbox'
  | 'star'
  | 'calendar'
  | 'layers'
  | 'box'
  | 'book'
  | 'trash'
  | 'project'
  | 'area'
  | 'tag'
  | 'flag'
  | 'move'
  | 'check'
  | 'cross'
  | 'plus'
  | 'chevron-right'
  | 'chevron-left'
  | 'notes'
  | 'checklist'
  | 'clock'
  | 'moon'
  | 'search'
  | 'moved'
  | 'undo'
  | 'repeat'
  | 'gear'
  | 'keyboard';

const paths: Record<IconName, JSX.Element> = {
  inbox: (
    <>
      <path
        d="M2.5 9.5V5.4c0-.7.3-1.3.8-1.8l.9-.9c.3-.3.7-.5 1.1-.5h5.4c.4 0 .8.2 1.1.5l.9.9c.5.5.8 1.1.8 1.8v4.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 9.5h3l.8 1.4h3.4l.8-1.4h3v2.1c0 1.1-.9 1.9-1.9 1.9H4.4c-1 0-1.9-.8-1.9-1.9V9.5z"
        fill="currentColor"
      />
    </>
  ),
  star: (
    <path
      d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5L8 1.6z"
      fill="currentColor"
    />
  ),
  calendar: (
    <>
      <rect
        x="2.2"
        y="3.3"
        width="11.6"
        height="10.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.2 6.6h11.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.4 1.8v2.4M10.6 1.8v2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  layers: (
    <>
      <path d="M8 1.8l6 3-6 3-6-3 6-3z" fill="currentColor" />
      <path
        d="M2.6 8.2L8 10.9l5.4-2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M2.6 11.2L8 13.9l5.4-2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </>
  ),
  box: (
    <>
      <rect
        x="2.2"
        y="4.6"
        width="11.6"
        height="9.2"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M1.6 4.6h12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.4 8h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  book: (
    <>
      <path
        d="M3 2.6h4.2c.9 0 1.6.7 1.6 1.6v9c0-.7-.6-1.3-1.3-1.3H3V2.6z"
        fill="currentColor"
        opacity="0.55"
      />
      <path d="M13 2.6H8.8c-.9 0-1.6.7-1.6 1.6v9c0-.7.6-1.3 1.3-1.3H13V2.6z" fill="currentColor" />
    </>
  ),
  trash: (
    <>
      <path
        d="M3.4 4.8h9.2l-.8 8a1.6 1.6 0 01-1.6 1.4H5.8a1.6 1.6 0 01-1.6-1.4l-.8-8z"
        fill="currentColor"
      />
      <path d="M2.2 4.2h11.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M6.2 4V2.9c0-.5.4-.9.9-.9h1.8c.5 0 .9.4.9.9V4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </>
  ),
  project: <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  area: (
    <>
      <circle cx="8" cy="8" r="5.4" fill="currentColor" opacity="0.28" />
      <circle cx="8" cy="8" r="2.6" fill="currentColor" />
    </>
  ),
  tag: (
    <>
      <path
        d="M7.4 2.2H13a.8.8 0 01.8.8v5.6c0 .2-.1.4-.2.6l-5 5a.8.8 0 01-1.2 0L2.2 9.4a.8.8 0 010-1.2l4.6-5.8a.8.8 0 01.6-.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="10.8" cy="5.2" r="1.1" fill="currentColor" />
    </>
  ),
  flag: (
    <>
      <path d="M4.2 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.2 2.6h7.2l-1.6 3 1.6 3H5.2v-6z" fill="currentColor" />
    </>
  ),
  move: (
    <>
      <path d="M2.6 8h9.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M9.4 5.2L12.6 8l-3.2 2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  check: (
    <path
      d="M3.2 8.4l3 3 6.4-6.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  cross: (
    <path
      d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  plus: (
    <path
      d="M8 3.4v9.2M3.4 8h9.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  'chevron-right': (
    <path
      d="M6.2 3.8L10.4 8l-4.2 4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  'chevron-left': (
    <path
      d="M9.8 3.8L5.6 8l4.2 4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  notes: (
    <path
      d="M3 4.4h10M3 8h10M3 11.6h6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  checklist: (
    <>
      <path
        d="M7.4 4.4h5.8M7.4 11.6h5.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2.4 4.4l1.4 1.4 2-2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.4 11.4l1.4 1.4 2-2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 4.8V8l2.4 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  moon: (
    <path
      d="M9.6 2.2A5.8 5.8 0 108 13.8a5.8 5.8 0 004.4-2 4.6 4.6 0 01-2.8-9.6z"
      fill="currentColor"
    />
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.4 10.4l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  moved: (
    <>
      <rect
        x="2.2"
        y="4"
        width="11.6"
        height="9.4"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5.6 8.6h4.8M8.4 6.6l2.2 2-2.2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  undo: (
    <path
      d="M5 3.6L2.4 6.2 5 8.8M2.6 6.2h6.2a4 4 0 010 8H6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  repeat: (
    <>
      <path
        d="M3 8a5 5 0 015-5h2.6M13 8a5 5 0 01-5 5H5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9.2 1.4l1.8 1.6-1.8 1.6M6.8 14.6L5 13l1.8-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.6l.7 1.7 1.8-.5.7 1.7 1.7.7-.5 1.8 1.7.7-1.7.7.5 1.8-1.7.7-.7 1.7-1.8-.5L8 14.4l-.7-1.7-1.8.5-.7-1.7-1.7-.7.5-1.8L1.9 8l1.7-.7-.5-1.8 1.7-.7.7-1.7 1.8.5L8 1.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </>
  ),
  keyboard: (
    <>
      <rect
        x="1.6"
        y="4.2"
        width="12.8"
        height="8"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M4 7h.01M6.4 7h.01M8.8 7h.01M11.2 7h.01M5 9.6h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  className?: string;
}

export function Icon({ name, size = 16, color, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={color ? { color } : undefined}
    >
      {paths[name]}
    </svg>
  );
}
