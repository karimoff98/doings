interface AppInfo {
  version: string;
  /** `arm64` on Apple Silicon, `x64` on Intel. */
  arch: string;
  platform: string;
  packaged: boolean;
}

interface SaveOutcome {
  ok: boolean;
  /** Monotonic revision now on disk. */
  revision?: number;
  /** `conflict` when another copy of the app has written since we loaded. */
  reason?: string;
  detail?: string;
}

/** API exposed by the Electron preload script. Absent in the browser. */
interface DesktopBridge {
  platform: string;
  onCommand: (callback: (command: string, payload?: string) => void) => () => void;
  /** Only available inside the Quick Entry window. */
  submitQuickEntry?: (title: string) => void;
  closeQuickEntry?: () => void;
  /** Reports that the renderer is listening for menu commands. */
  notifyReady?: () => void;
  /** Brings the app window forward, used when a reminder fires. */
  focusWindow?: () => void;
  /** Version, architecture and packaging of the running build. */
  appInfo?: () => Promise<AppInfo>;
  /** Called before quitting; answer with `reportFlushed`. Returns an unsubscribe. */
  onFlushRequest?: (callback: () => void) => () => void;
  reportFlushed?: (ok: boolean, error?: string) => void;
  storage?: {
    load: () => Promise<string | null>;
    /** Resolves to the write outcome; older builds answered with a boolean. */
    save: (json: string, baseRevision?: number) => Promise<SaveOutcome | boolean>;
    path: () => Promise<string>;
    /** Shows the database file in Finder/Explorer. */
    reveal?: () => void;
    /** Resolves to the saved path, or null when the user cancelled. */
    export: (json: string) => Promise<string | null>;
    /** Resolves to the file contents, or null when the user cancelled. */
    import: () => Promise<string | null>;
    /** Automatic backup written beside the database, if any. */
    loadBackup?: () => Promise<string | null>;
    /** Moves an unreadable database aside; resolves to its new path. */
    quarantine?: () => Promise<string | null>;
  };
}

interface Window {
  desktop?: DesktopBridge;
}
