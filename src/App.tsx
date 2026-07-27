import { useEffect, useState } from 'react';
import { ListView } from './components/ListView';
import { MoveDialog } from './components/MoveDialog';
import { QuickFind } from './components/QuickFind';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Sidebar } from './components/Sidebar';
import { useDesktopMenu } from './hooks/useDesktopMenu';
import { useKeyboard } from './hooks/useKeyboard';
import { useReminders } from './hooks/useReminders';
import { useStore } from './store/store';

/** Applies the theme choice to the document, following the OS when set to `system`. */
function useTheme() {
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/**
 * Reading the database from disk is asynchronous, so the first paint has to wait:
 * otherwise the seed data would flash before the real lists arrive.
 */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) return;
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  return hydrated;
}

export function App() {
  useTheme();
  useKeyboard();
  useDesktopMenu();
  useReminders();
  const hydrated = useHydrated();

  if (!hydrated) return <div className="app app--loading" />;

  return (
    <div className="app">
      <Sidebar />
      <ListView />
      <QuickFind />
      <MoveDialog />
      <ShortcutsDialog />
      <SettingsDialog />
    </div>
  );
}
