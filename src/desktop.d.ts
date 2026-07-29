interface AppInfo {
  version: string;
  /** `arm64` on Apple Silicon, `x64` on Intel. */
  arch: string;
  platform: string;
  packaged: boolean;
}

/** Why a backup was made; shown in the settings list. */
type BackupReason =
  'automatic' | 'manual' | 'import' | 'clear' | 'demo' | 'migration' | 'before-restore';

interface BackupEntry {
  /** File name inside the backups folder; the only handle the renderer gets. */
  name: string;
  createdAt: string;
  reason: BackupReason;
  /** Schema version of the copied database, null when unknown. */
  schemaVersion: number | null;
  revision: number;
  counts: {
    todos: number;
    projects: number;
    areas: number;
    headings: number;
    tags: number;
  } | null;
  payloadHash: string | null;
  size: number;
  /** The file could not be read; restoring is refused. */
  corrupt: boolean;
}

interface BackupWriteOutcome {
  ok: boolean;
  name?: string;
  createdAt?: string;
  reason?: string;
  detail?: string;
  removed?: string[];
}

interface BackupReadOutcome {
  ok: boolean;
  /** Exact database.json contents that were copied. */
  payload?: string;
  createdAt?: string;
  reason?: string;
  schemaVersion?: number | null;
  detail?: string;
}

interface SaveOutcome {
  ok: boolean;
  /** Monotonic revision now on disk. */
  revision?: number;
  /** `conflict` when another copy of the app has written since we loaded. */
  reason?: string;
  detail?: string;
}

interface NotificationShowOutcome {
  ok: boolean;
  /** Doings banner used because unsigned macOS apps cannot call UNNotification. */
  fallback?: boolean;
  reason?: 'unsupported' | 'failed';
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
  /** Native Electron notifications, delivered by the operating system. */
  notifications?: {
    show: (payload: {
      title: string;
      body: string;
      todoId?: string;
    }) => Promise<NotificationShowOutcome>;
  };
  /** Called before quitting; answer with `reportFlushed`. Returns an unsubscribe. */
  onFlushRequest?: (callback: () => void) => () => void;
  reportFlushed?: (ok: boolean, error?: string) => void;
  /** Dated copies of the database, managed entirely by the main process. */
  backups?: {
    list: () => Promise<{ ok: boolean; items?: BackupEntry[] }>;
    create: (reason: BackupReason) => Promise<BackupWriteOutcome>;
    read: (name: string) => Promise<BackupReadOutcome>;
    remove: (name: string) => Promise<{ ok: boolean; reason?: string }>;
  };
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
