/** API exposed by the Electron preload script. Absent in the browser. */
interface DesktopBridge {
  platform: string;
  onCommand: (callback: (command: string, payload?: string) => void) => () => void;
  /** Only available inside the Quick Entry window. */
  submitQuickEntry?: (title: string) => void;
  closeQuickEntry?: () => void;
  storage?: {
    load: () => Promise<string | null>;
    save: (json: string) => Promise<boolean>;
    path: () => Promise<string>;
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
