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
  storage: {
    /** Whole database as JSON, or null on the very first run. */
    load() {
      return ipcRenderer.invoke('storage:load');
    },
    save(json) {
      return ipcRenderer.invoke('storage:save', typeof json === 'string' ? json : '');
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
