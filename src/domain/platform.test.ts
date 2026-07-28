import { describe, expect, it } from 'vitest';
import {
  comboLabel,
  keyLabel,
  modifierSymbol,
  quickEntryLabel,
  shiftShortcutLabel,
  shiftSymbol,
  shortcutLabel,
} from './platform';

/**
 * The handlers accept ⌘ or Ctrl, so the only thing that can be wrong here is the
 * label. On Windows a sheet full of ⌘ glyphs is simply misleading.
 */
describe('подписи комбинаций', () => {
  it('macOS собирает глифы без разделителей', () => {
    expect(comboLabel('mod+N', true)).toBe('⌘N');
    expect(comboLabel('shift+mod+N', true)).toBe('⇧⌘N');
    expect(comboLabel('alt+mod+R', true)).toBe('⌥⌘R');
    expect(comboLabel('mod+Backspace', true)).toBe('⌘⌫');
    expect(comboLabel('ctrl+alt+Space', true)).toBe('⌃⌥Space');
  });

  it('Windows называет клавиши словами', () => {
    expect(comboLabel('mod+N', false)).toBe('Ctrl+N');
    expect(comboLabel('shift+mod+N', false)).toBe('Ctrl+Shift+N');
    expect(comboLabel('alt+mod+R', false)).toBe('Ctrl+Alt+R');
    expect(comboLabel('mod+Backspace', false)).toBe('Ctrl+Backspace');
  });

  it('Ctrl не повторяется, когда ⌃ и ⌘ совпали в одну клавишу', () => {
    // ⌃⌥Space: on Windows both `ctrl` and the main modifier map to Ctrl.
    expect(comboLabel('ctrl+alt+Space', false)).toBe('Ctrl+Alt+Space');
    expect(comboLabel('ctrl+mod+K', false)).toBe('Ctrl+K');
  });

  it('порядок модификаторов соответствует платформе', () => {
    expect(comboLabel('mod+shift+alt+ctrl+K', true)).toBe('⌃⌥⇧⌘K');
    expect(comboLabel('mod+shift+alt+ctrl+K', false)).toBe('Ctrl+Alt+Shift+K');
  });

  it('отдельные клавиши подписаны по платформе', () => {
    expect(keyLabel('Enter', true)).toBe('⏎');
    expect(keyLabel('Enter', false)).toBe('Enter');
    expect(keyLabel('Backspace', true)).toBe('⌫');
    expect(keyLabel('Space', false)).toBe('Space');
    expect(modifierSymbol(true)).toBe('⌘');
    expect(modifierSymbol(false)).toBe('Ctrl');
    expect(shiftSymbol(true)).toBe('⇧');
    expect(shiftSymbol(false)).toBe('Shift');
  });

  it('готовые помощники остались совместимыми', () => {
    expect(shortcutLabel('N', true)).toBe('⌘N');
    expect(shortcutLabel('N', false)).toBe('Ctrl+N');
    expect(shiftShortcutLabel('N', true)).toBe('⇧⌘N');
    expect(shiftShortcutLabel('N', false)).toBe('Ctrl+Shift+N');
    expect(quickEntryLabel(true)).toBe('⌃⌥Space');
    expect(quickEntryLabel(false)).toBe('Ctrl+Alt+Space');
  });
});
