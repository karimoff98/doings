import { useEffect, useState } from 'react';
import { ListView } from './components/ListView';
import { MoveDialog } from './components/MoveDialog';
import { QuickFind } from './components/QuickFind';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Sidebar } from './components/Sidebar';
import { StorageNotice } from './components/StorageNotice';
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
/** Last resort in case hydration neither finishes nor reports an error. */
const HYDRATION_TIMEOUT_MS = 4000;

function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  const failed = useStore((s) => s.hydrationFailed);

  useEffect(() => {
    if (hydrated) return;
    const stop = useStore.persist.onFinishHydration(() => setHydrated(true));
    const timer = window.setTimeout(() => setHydrated(true), HYDRATION_TIMEOUT_MS);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [hydrated]);

  return hydrated || failed;
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
      <StorageNotice />
    </div>
  );
}
