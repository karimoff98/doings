import { useEffect } from 'react';
import { flushPendingWrites } from '../store/persistence';

/**
 * The main process holds back ⌘Q until the renderer confirms that the debounced
 * write finished. Without this answer the quit waits for the timeout instead.
 */
export function useDesktopSave() {
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.onFlushRequest) return;

    return bridge.onFlushRequest(() => {
      void flushPendingWrites().then(
        () => bridge.reportFlushed?.(true),
        (error: unknown) => bridge.reportFlushed?.(false, String(error)),
      );
    });
  }, []);
}
