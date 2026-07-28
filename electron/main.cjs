const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

/** Set when running against the Vite dev server. */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
/** Global hotkey for Quick Entry; Things uses ⌃Space by default. */
const QUICK_ENTRY_SHORTCUT = 'Control+Alt+Space';

let mainWindow = null;
let quickWindow = null;

function send(command) {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  target?.webContents.send('menu:command', command);
}

/** Set by the renderer once its command listener is mounted. */
let rendererReady = false;
let waitingForRenderer = [];

ipcMain.on('renderer:ready', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    rendererReady = true;
    for (const resolve of waitingForRenderer.splice(0)) resolve();
  }
});

function whenRendererReady() {
  if (rendererReady) return Promise.resolve();
  return new Promise((resolve) => {
    waitingForRenderer.push(resolve);
    // Never hang forever: after this the renderer is almost certainly listening.
    setTimeout(resolve, 8000);
  });
}

/**
 * Delivers a command to the main window, creating and showing it first when the
 * user has closed it. Waits for the renderer, otherwise the message arrives
 * before anything is listening and the todo silently disappears.
 */
async function deliverToMainWindow(command, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    rendererReady = false;
    createWindow();
  }
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  await whenRendererReady();
  mainWindow.webContents.send('menu:command', command, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 720,
    minHeight: 460,
    show: false,
    backgroundColor: '#eaecf1',
    // Traffic lights float over the sidebar, like Things does.
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 13, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Links never open inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL);
    if (!allowed) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    waitingForRenderer = [];
    // The hidden Quick Entry window must not keep the app alive on Windows.
    if (!isMac) app.quit();
  });
}

function appUrl(hash) {
  if (DEV_SERVER_URL) return `${DEV_SERVER_URL}${hash}`;
  return `file://${path.join(__dirname, '..', 'dist', 'index.html')}${hash}`;
}

/** Small always-on-top window that captures one to-do and disappears. */
function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: 560,
    height: 96,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  quickWindow.loadURL(appUrl('#quick'));
  quickWindow.on('blur', () => quickWindow?.hide());
  quickWindow.on('closed', () => {
    quickWindow = null;
  });
}

function toggleQuickEntry() {
  if (!quickWindow) createQuickWindow();
  if (!quickWindow) return;
  if (quickWindow.isVisible()) {
    quickWindow.hide();
    return;
  }
  quickWindow.center();
  quickWindow.show();
  quickWindow.focus();
}

/**
 * The database lives as a single JSON file in the user data directory.
 * localStorage was losing the newest changes whenever the process was killed
 * instead of quit, because Chromium flushes it lazily.
 */
function databasePath() {
  return path.join(app.getPath('userData'), 'database.json');
}

/** Data directories used by earlier builds, before the app was renamed. */
const LEGACY_APP_DIRS = ['things-clone'];

/**
 * Electron derives the user data directory from the package name, so renaming
 * the package moves the app to a fresh empty folder. Carry the old database
 * over once, before anything tries to read it.
 */
async function migrateUserData() {
  const target = databasePath();
  try {
    await fs.access(target);
    return; // Already migrated or a normal start.
  } catch {
    // No database yet: look for one left by an earlier name.
  }

  for (const dir of LEGACY_APP_DIRS) {
    const source = path.join(app.getPath('appData'), dir, 'database.json');
    try {
      const json = await fs.readFile(source, 'utf8');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, json, 'utf8');
      // The old copy stays put as a safety net; it is small and harmless.
      console.log(`База перенесена из ${source}`);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Перенос базы не удался:', error);
    }
  }
}

ipcMain.handle('storage:load', async () => {
  const file = databasePath();
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Не удалось прочитать базу:', error);
    // A half-written file would have been replaced by the backup below, but try
    // it anyway as a last resort.
    try {
      return await fs.readFile(`${file}.bak`, 'utf8');
    } catch {
      return null;
    }
  }
});

/**
 * Saves never overlap: two writes sharing one temp file could rename it in the
 * wrong order and put an older snapshot on disk.
 */
let saveQueue = Promise.resolve();

ipcMain.handle('storage:save', (_event, json) => {
  if (typeof json !== 'string') return false;
  const result = saveQueue.then(() => writeDatabase(json));
  // A rejected write must not poison the queue for the next save.
  saveQueue = result.catch(() => {});
  return result;
});

async function writeDatabase(json) {
  const file = databasePath();
  if (!json) {
    await fs.rm(file, { force: true });
    return true;
  }
  // A unique temp name per write, so nothing can clash even across windows.
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.writeFile(temp, json, 'utf8');
    await fs.copyFile(file, `${file}.bak`).catch(() => {});
    await fs.rename(temp, file);
    return true;
  } catch (error) {
    console.error('Не удалось сохранить базу:', error);
    await fs.rm(temp, { force: true }).catch(() => {});
    return false;
  }
}

ipcMain.handle('storage:path', () => databasePath());

ipcMain.handle('storage:load-backup', async () => {
  try {
    return await fs.readFile(`${databasePath()}.bak`, 'utf8');
  } catch {
    return null;
  }
});

/**
 * Renames an unreadable database instead of letting the app overwrite it, so a
 * broken file can still be repaired by hand later.
 */
ipcMain.handle('storage:quarantine', async () => {
  const file = databasePath();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.corrupt-${stamp}.json`;
  try {
    await fs.rename(file, target);
    return target;
  } catch (error) {
    console.error('Не удалось отложить повреждённый файл:', error);
    return null;
  }
});

ipcMain.handle('storage:export', async (_event, json) => {
  if (typeof json !== 'string' || !json) return null;
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: 'Сохранить копию базы',
    defaultPath: `doings-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, json, 'utf8');
  return result.filePath;
});

ipcMain.handle('storage:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Выбрать файл базы',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  const file = result.filePaths?.[0];
  if (result.canceled || !file) return null;
  return fs.readFile(file, 'utf8');
});

ipcMain.on('quick:submit', async (_event, title) => {
  if (typeof title !== 'string' || !title.trim()) return;
  quickWindow?.hide();
  // On macOS the app keeps running with no windows, so the main window may have
  // to be recreated before it can accept the todo.
  await deliverToMainWindow('quick-add', title.trim());
});

ipcMain.on('quick:close', () => quickWindow?.hide());

ipcMain.on('window:focus', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    rendererReady = false;
    createWindow();
  }
  mainWindow?.show();
  mainWindow?.focus();
});

function buildMenu() {
  const command = (label, accelerator, id) => ({
    label,
    accelerator,
    click: () => send(id),
  });

  const template = [
    ...(isMac
      ? [
          {
            role: 'appMenu',
          },
        ]
      : []),
    {
      label: 'Файл',
      submenu: [
        command('Настройки…', 'CmdOrCtrl+,', 'settings'),
        { type: 'separator' },
        command('Новая задача', 'CmdOrCtrl+N', 'new-todo'),
        command('Новый проект', 'Shift+CmdOrCtrl+N', 'new-project'),
        { type: 'separator' },
        command('Быстрый поиск', 'CmdOrCtrl+F', 'quick-find'),
        {
          label: 'Быстрый ввод',
          accelerator: QUICK_ENTRY_SHORTCUT,
          click: () => toggleQuickEntry(),
        },
        { type: 'separator' },
        command('Переместить…', 'Shift+CmdOrCtrl+M', 'move'),
        command('Дублировать', 'CmdOrCtrl+D', 'duplicate'),
        command('В корзину', 'CmdOrCtrl+Backspace', 'delete'),
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Выход' }]),
      ],
    },
    {
      label: 'Правка',
      submenu: [
        command('Отменить', 'CmdOrCtrl+Z', 'undo'),
        command('Повторить', 'Shift+CmdOrCtrl+Z', 'redo'),
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        command('Выбрать всё', 'CmdOrCtrl+A', 'select-all'),
      ],
    },
    {
      label: 'Задача',
      submenu: [
        command('Сегодня', 'CmdOrCtrl+T', 'today'),
        command('Сегодня вечером', 'CmdOrCtrl+E', 'evening'),
        command('Когда-нибудь', 'CmdOrCtrl+O', 'someday'),
        command('Убрать дату', 'CmdOrCtrl+R', 'anytime'),
        command('Выбрать дату…', 'CmdOrCtrl+S', 'when'),
        { type: 'separator' },
        command('Срок сдачи…', 'Shift+CmdOrCtrl+D', 'deadline'),
        command('Теги…', 'Shift+CmdOrCtrl+T', 'tags'),
        command('Повтор…', 'Shift+CmdOrCtrl+R', 'repeat'),
        command('Напоминание…', 'Alt+CmdOrCtrl+R', 'reminder'),
        { type: 'separator' },
        command('Выполнено', 'CmdOrCtrl+.', 'complete'),
        command('Отменено', 'Alt+CmdOrCtrl+.', 'cancel'),
      ],
    },
    {
      label: 'Вид',
      submenu: [
        command('Входящие', 'CmdOrCtrl+1', 'list:inbox'),
        command('Сегодня', 'CmdOrCtrl+2', 'list:today'),
        command('Планы', 'CmdOrCtrl+3', 'list:upcoming'),
        command('В любое время', 'CmdOrCtrl+4', 'list:anytime'),
        command('Когда-нибудь', 'CmdOrCtrl+5', 'list:someday'),
        command('Журнал', 'CmdOrCtrl+6', 'list:logbook'),
        command('Корзина', 'CmdOrCtrl+7', 'list:trash'),
        { type: 'separator' },
        command('Сменить тему', 'Shift+CmdOrCtrl+L', 'theme-toggle'),
        { type: 'separator' },
        { role: 'reload', label: 'Обновить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { role: 'resetZoom', label: 'Обычный размер' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: 'Справка',
      submenu: [command('Горячие клавиши', 'CmdOrCtrl+/', 'shortcuts')],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window per app instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await migrateUserData();
    buildMenu();
    createWindow();
    createQuickWindow();

    // Works even when the app is in the background.
    if (!globalShortcut.register(QUICK_ENTRY_SHORTCUT, toggleQuickEntry)) {
      console.warn(`Quick Entry shortcut ${QUICK_ENTRY_SHORTCUT} is taken by another app`);
    }

    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().filter((w) => w !== quickWindow).length) createWindow();
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
