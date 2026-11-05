// Electron main process.
//
// - Reads the SmartSpectra API key from `.env` (main process only).
// - Creates the game window with a sandboxed, context-isolated renderer.
// - Wires the SmartSpectra IPC bridge for that window.
// - Grants camera access only to our own page, video only, never audio.
// - Blocks navigation and pop-up windows so remote content can never load.

import { join, resolve } from 'node:path';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';
import { GET_API_KEY_CHANNEL } from '../shared/api';

/** Dev server URL injected by electron-vite in `npm run dev`; unset in builds. */
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

function loadApiKey(): string {
  try {
    process.loadEnvFile(resolve(app.getAppPath(), '.env'));
  } catch {
    // No .env file: the game still runs in keyboard mode.
  }
  return (process.env['SMARTSPECTRA_API_KEY'] ?? '').trim();
}

/** True only for the page this app ships (or the local dev server). */
function isOwnPage(url: string): boolean {
  if (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)) return true;
  return url.startsWith('file://');
}

function restrictPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL();
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    const videoOnly = mediaTypes.length > 0 && mediaTypes.every((t) => t === 'video');
    callback(permission === 'media' && videoOnly && isOwnPage(url));
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permission === 'media' && isOwnPage(requestingOrigin);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Kuudu: Breathe the Lantern Home',
    backgroundColor: '#0b1630',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  bindSmartSpectraIpc(win);

  win.once('ready-to-show', () => win.show());

  // Never navigate away from the game or open in-app pop-ups.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  const apiKey = loadApiKey();
  ipcMain.handle(GET_API_KEY_CHANNEL, (event) => {
    // Only answer our own page.
    return isOwnPage(event.senderFrame?.url ?? '') ? apiKey : '';
  });

  restrictPermissions();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the window ends the game and releases the camera on every platform.
app.on('window-all-closed', () => {
  app.quit();
});
