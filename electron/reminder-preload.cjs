const { contextBridge, ipcRenderer } = require('electron');

/** The reminder banner can only open Doings or close itself. */
contextBridge.exposeInMainWorld('reminder', {
  open() {
    ipcRenderer.send('reminder-window:open');
  },
  close() {
    ipcRenderer.send('reminder-window:close');
  },
});
