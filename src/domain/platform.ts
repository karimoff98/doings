/**
 * Shortcut labels differ between platforms: macOS writes ⌘⇧N, Windows writes
 * Ctrl+Shift+N. Hints that show the wrong keys are worse than no hints.
 */
export function isMacPlatform(): boolean {
  const platform = globalThis.window?.desktop?.platform ?? globalThis.navigator?.platform ?? '';
  return platform.toLowerCase().includes('mac') || platform === 'darwin';
}

/** `⌘N` on macOS, `Ctrl+N` elsewhere. */
export function shortcutLabel(key: string, mac = isMacPlatform()): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** `⇧⌘N` on macOS, `Ctrl+Shift+N` elsewhere. */
export function shiftShortcutLabel(key: string, mac = isMacPlatform()): string {
  return mac ? `⇧⌘${key}` : `Ctrl+Shift+${key}`;
}

/** The global Quick Entry combination, spelled for this platform. */
export function quickEntryLabel(mac = isMacPlatform()): string {
  return mac ? '⌃⌥Space' : 'Ctrl+Alt+Space';
}
