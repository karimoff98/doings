import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickEntry } from './components/QuickEntry';
import './styles/tokens.css';
import './styles/base.css';
import './styles/sidebar.css';
import './styles/list.css';
import './styles/editor.css';
import './styles/overlay.css';
import './styles/quick.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);

/** The Quick Entry window loads the same bundle with a `#quick` hash. */
const isQuickEntry = window.location.hash === '#quick';

function QuickEntryRoot() {
  useEffect(() => {
    document.documentElement.dataset.quick = 'true';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  return <QuickEntry />;
}

if (isQuickEntry) {
  // Deliberately never imports the store: two renderers writing the same
  // persisted state could clobber each other with a stale snapshot.
  root.render(
    <StrictMode>
      <QuickEntryRoot />
    </StrictMode>,
  );
} else {
  const { App } = await import('./App');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
