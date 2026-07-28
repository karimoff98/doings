/**
 * Shortcut labels differ between platforms: macOS writes ⇧⌘N, Windows writes
 * Ctrl+Shift+N. Hints and the help sheet must show the keys that actually work,
 * so every label is built from the same spec here instead of being typed twice.
 */
export function isMacPlatform(): boolean {
  const platform = globalThis.window?.desktop?.platform ?? globalThis.navigator?.platform ?? '';
  return platform.toLowerCase().includes('mac') || platform === 'darwin';
}

/** The main modifier: ⌘ on macOS, Ctrl elsewhere. Handlers accept either. */
export function modifierSymbol(mac = isMacPlatform()): string {
  return mac ? '⌘' : 'Ctrl';
}

export function shiftSymbol(mac = isMacPlatform()): string {
  return mac ? '⇧' : 'Shift';
}

/** Keys with a macOS glyph but a spelled-out name on Windows. */
const KEY_NAMES: Record<string, { mac: string; other: string }> = {
  Backspace: { mac: '⌫', other: 'Backspace' },
  Enter: { mac: '⏎', other: 'Enter' },
};

export function keyLabel(key: string, mac = isMacPlatform()): string {
  const known = KEY_NAMES[key];
  if (!known) return key;
  return mac ? known.mac : known.other;
}

/** macOS prints ⌃⌥⇧⌘; Windows and Linux write Ctrl+Alt+Shift first. */
const MAC_ORDER = ['ctrl', 'alt', 'shift', 'mod'] as const;
const OTHER_ORDER = ['ctrl', 'mod', 'alt', 'shift'] as const;
type Modifier = (typeof MAC_ORDER)[number];

const MAC_SYMBOLS: Record<Modifier, string> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  mod: '⌘',
};

const OTHER_NAMES: Record<Modifier, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  // Everything bound to ⌘ is bound to Ctrl on Windows and Linux.
  mod: 'Ctrl',
};

/**
 * Renders a combination from a spec like `shift+mod+N` or `ctrl+alt+Space`.
 * The last segment is the key; the rest are modifiers.
 */
export function comboLabel(spec: string, mac = isMacPlatform()): string {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  const used = new Set(parts as Modifier[]);

  if (mac) {
    return (
      MAC_ORDER.filter((name) => used.has(name))
        .map((name) => MAC_SYMBOLS[name])
        .join('') + keyLabel(key, true)
    );
  }
  // `ctrl` and `mod` both become Ctrl here, so the name must not repeat.
  const names: string[] = [];
  for (const name of OTHER_ORDER.filter((item) => used.has(item))) {
    const label = OTHER_NAMES[name];
    if (!names.includes(label)) names.push(label);
  }
  return [...names, keyLabel(key, false)].join('+');
}

/** `⌘N` on macOS, `Ctrl+N` elsewhere. */
export function shortcutLabel(key: string, mac = isMacPlatform()): string {
  return comboLabel(`mod+${key}`, mac);
}

/** `⇧⌘N` on macOS, `Ctrl+Shift+N` elsewhere. */
export function shiftShortcutLabel(key: string, mac = isMacPlatform()): string {
  return comboLabel(`shift+mod+${key}`, mac);
}

/** The global Quick Entry combination, spelled for this platform. */
export function quickEntryLabel(mac = isMacPlatform()): string {
  return comboLabel('ctrl+alt+Space', mac);
}
