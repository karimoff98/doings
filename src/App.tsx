import { useEffect, useState } from 'react';
import { ListView } from './components/ListView';
import { MoveDialog } from './components/MoveDialog';
import { Onboarding } from './components/Onboarding';
import { QuickFind } from './components/QuickFind';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Sidebar } from './components/Sidebar';
import { StorageNotice } from './components/StorageNotice';
import { useDesktopMenu } from './hooks/useDesktopMenu';
import { useDesktopSave } from './hooks/useDesktopSave';
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

  // The desktop shell holds back commands until this point: a todo created
  // before the saved data arrives would be wiped by hydration.
  useEffect(() => {
    if (hydrated || failed) window.desktop?.notifyReady?.();
  }, [hydrated, failed]);

  return hydrated || failed;
}

export function App() {
  useTheme();
  useKeyboard();
  useDesktopMenu();
  useDesktopSave();
  useReminders();
  const hydrated = useHydrated();
  const storageError = useStore((s) => s.storageError);
  const hydrationFailed = useStore((s) => s.hydrationFailed);

  if (!hydrated) return <div className="app app--loading" />;

  // A problem with the database deserves the user's full attention: the
  // introduction must not cover the warning about it.
  const troubled = Boolean(storageError) || hydrationFailed;

  return (
    <div className="app">
      <Sidebar />
      <ListView />
      <QuickFind />
      <MoveDialog />
      <ShortcutsDialog />
      <SettingsDialog />
      <StorageNotice />
      {!troubled && <Onboarding />}
    </div>
  );
}
