const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { parseOBJ } = require('./obj-parser');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'OBJ Polygon Clipper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allow loading local texture files
    },
  });

  mainWindow.loadFile('app.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── IPC Handlers ──

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'OBJ Files', extensions: ['obj'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('load-obj', async (_event, filePath) => {
  try {
    const data = await parseOBJ(filePath, (progress) => {
      mainWindow.webContents.send('load-progress', progress);
    });
    return data;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('export-clipped-obj', async (_event, { originalPath, polygon, yMin, yMax }) => {
  const { clipAndExport } = require('./obj-clipper');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: originalPath.replace('.obj', '_clipped.obj'),
    filters: [{ name: 'OBJ Files', extensions: ['obj'] }],
  });
  if (result.canceled) return null;
  await clipAndExport(originalPath, polygon, result.filePath, (progress) => {
    mainWindow.webContents.send('export-progress', progress);
  }, yMin, yMax);
  return result.filePath;
});
