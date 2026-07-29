import { useEffect, useState } from 'react';
import { ListView } from './components/ListView';
import { GuidedTour } from './components/GuidedTour';
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

type HydrationState = 'loading' | 'ready' | 'timeout';

function useHydrated(): HydrationState {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  const [timedOut, setTimedOut] = useState(false);
  const failed = useStore((s) => s.hydrationFailed);

  useEffect(() => {
    if (hydrated) return;
    const stop = useStore.persist.onFinishHydration(() => {
      setHydrated(true);
      setTimedOut(false);
    });
    // Never expose an editable empty database while the real file may still
    // arrive and replace it. A stalled read gets a safe retry screen instead.
    const timer = window.setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT_MS);
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

  if (hydrated || failed) return 'ready';
  return timedOut ? 'timeout' : 'loading';
}

export function App() {
  useTheme();
  useKeyboard();
  useDesktopMenu();
  useDesktopSave();
  useReminders();
  const hydration = useHydrated();
  const storageError = useStore((s) => s.storageError);
  const hydrationFailed = useStore((s) => s.hydrationFailed);

  if (hydration === 'loading') return <div className="app app--loading" />;
  if (hydration === 'timeout') {
    return (
      <div className="app app--loading">
        <div className="load-failure" role="alert">
          <strong>База загружается слишком долго</strong>
          <span>Изменения пока заблокированы, чтобы не перезаписать сохранённые данные.</span>
          <button type="button" onClick={() => window.location.reload()}>
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

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
      {!troubled && <GuidedTour />}
    </div>
  );
}
