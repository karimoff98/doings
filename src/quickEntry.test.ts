// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Quick Entry window loads the same bundle with a `#quick` hash. It must stay
 * a plain input box: two renderers writing the same persisted state could clobber
 * each other, and an introduction has no business appearing there.
 */
// Paths are relative to the project root, which is where vitest runs.
const entry = readFileSync('src/main.tsx', 'utf8');
const quickEntry = readFileSync('src/components/QuickEntry.tsx', 'utf8');

describe('окно быстрого ввода', () => {
  it('не тянет стор и онбординг в свой модуль', () => {
    // No static import of the app: the store and the introduction come with it.
    expect(entry).not.toMatch(/^import .*['"]\.\/App['"]/m);
    expect(entry).toMatch(/await import\(['"]\.\/App['"]\)/);
    expect(quickEntry).not.toMatch(/from ['"]\.\.\/store\//);
    expect(quickEntry).not.toMatch(/Onboarding/);
  });

  it('решает по хешу, что показывать', () => {
    expect(entry).toContain("window.location.hash === '#quick'");
  });

  it('первый запуск в окне быстрого ввода не определяется', async () => {
    window.location.hash = '#quick';
    try {
      const { isFirstRun } = await import('./store/persistence');
      expect(isFirstRun()).toBe(false);
    } finally {
      window.location.hash = '';
    }
  });
});
