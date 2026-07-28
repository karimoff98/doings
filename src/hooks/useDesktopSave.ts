import { useEffect } from 'react';
import { flushPendingWrites } from '../store/persistence';

/**
 * The main process holds back ⌘Q until the renderer confirms that the text being
 * typed reached the store and the debounced write finished. A failed write must
 * be reported as such: the shell then cancels the quit and warns the user.
 */
export function useDesktopSave() {
  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.onFlushRequest) return;

    return bridge.onFlushRequest(() => {
      void flushPendingWrites().then(
        (result) => bridge.reportFlushed?.(result.ok, result.error),
        (error: unknown) => bridge.reportFlushed?.(false, String(error)),
      );
    });
  }, []);
}
