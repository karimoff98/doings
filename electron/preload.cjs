const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, sandboxed bridge: the renderer can listen for menu commands and,
 * from the Quick Entry window, hand a single string back to the app.
 * No node APIs, no file access, no arbitrary IPC.
 */
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  onCommand(callback) {
    const handler = (_event, command, payload) => callback(command, payload);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  },
  submitQuickEntry(title) {
    if (typeof title === 'string' && title.trim()) {
      ipcRenderer.send('quick:submit', title.trim().slice(0, 500));
    }
  },
  closeQuickEntry() {
    ipcRenderer.send('quick:close');
  },
  /** Tells the main process that the command listener is mounted. */
  notifyReady() {
    ipcRenderer.send('renderer:ready');
  },
  /** Brings the app window forward, used when a reminder fires. */
  focusWindow() {
    ipcRenderer.send('window:focus');
  },
  /** Version, architecture and packaging of the running build. */
  appInfo() {
    return ipcRenderer.invoke('app:info');
  },
  notifications: {
    show(payload) {
      return ipcRenderer.invoke('notification:show', {
        title: typeof payload?.title === 'string' ? payload.title.trim().slice(0, 200) : 'Doings',
        body: typeof payload?.body === 'string' ? payload.body.trim().slice(0, 1000) : '',
        todoId:
          typeof payload?.todoId === 'string' ? payload.todoId.trim().slice(0, 200) : undefined,
      });
    },
  },
  /**
   * The main process asks for a flush before quitting; the renderer must answer
   * with `reportFlushed`, otherwise the app waits for the timeout.
   */
  onFlushRequest(callback) {
    const handler = () => callback();
    ipcRenderer.on('storage:flush', handler);
    return () => ipcRenderer.removeListener('storage:flush', handler);
  },
  reportFlushed(ok, error) {
    ipcRenderer.send('storage:flushed', {
      ok: Boolean(ok),
      error: typeof error === 'string' ? error.slice(0, 500) : undefined,
    });
  },
  /**
   * Dated copies of the database. The renderer names a reason or an existing
   * file; paths stay in the main process, which keeps everything inside the
   * backups folder.
   */
  backups: {
    list() {
      return ipcRenderer.invoke('backup:list');
    },
    create(reason) {
      return ipcRenderer.invoke('backup:create', String(reason));
    },
    read(name) {
      return ipcRenderer.invoke('backup:restore', String(name));
    },
    remove(name) {
      return ipcRenderer.invoke('backup:delete', String(name));
    },
  },
  storage: {
    /** Whole database as JSON, or null on the very first run. */
    load() {
      return ipcRenderer.invoke('storage:load');
    },
    save(json, baseRevision) {
      return ipcRenderer.invoke(
        'storage:save',
        typeof json === 'string' ? json : '',
        typeof baseRevision === 'number' ? baseRevision : undefined,
      );
    },
    /** Opens the data folder in Finder/Explorer with the database selected. */
    reveal() {
      ipcRenderer.send('storage:reveal');
    },
    /** Path of the database file, shown in the settings. */
    path() {
      return ipcRenderer.invoke('storage:path');
    },
    /** Native save dialog; resolves to the chosen path or null. */
    export(json) {
      return ipcRenderer.invoke('storage:export', typeof json === 'string' ? json : '');
    },
    /** Native open dialog; resolves to the file contents or null. */
    import() {
      return ipcRenderer.invoke('storage:import');
    },
    /** Contents of the automatic backup written beside the database. */
    loadBackup() {
      return ipcRenderer.invoke('storage:load-backup');
    },
    /** Moves an unreadable database aside and resolves to its new path. */
    quarantine() {
      return ipcRenderer.invoke('storage:quarantine');
    },
  },
});
