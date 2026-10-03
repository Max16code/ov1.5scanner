const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const fs = require('fs');

const PORT = 3456;
let nextServer = null;
let mainWindow = null;

function findServerScript() {
  // In packaged apps with asarUnpack, the file lives at:
  //   resources/app.asar.unpacked/.next/standalone/server.js
  // In dev, it lives at:
  //   projectRoot/.next/standalone/server.js
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', '.next', 'standalone', 'server.js'),
    path.join(__dirname, '.next', 'standalone', 'server.js'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

function startNextServer() {
  const serverScript = findServerScript();

  if (!serverScript) {
    console.error('Could not find Next standalone server. Checked both packaged and dev paths.');
    return;
  }

  console.log('Starting Next server from', serverScript);

  nextServer = fork(serverScript, [], {
    cwd: path.dirname(serverScript),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      HOSTNAME: 'localhost',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    execPath: process.execPath,
  });

  nextServer.on('error', (err) => {
    console.error('Failed to start Next server:', err);
  });

  nextServer.on('exit', (code) => {
    console.error('Next server exited with code', code);
  });
}

function waitForServer(callback) {
  const req = http.get(`http://localhost:${PORT}`, () => {
    console.log('Next server is ready');
    callback();
  });
  req.on('error', () => {
    setTimeout(() => waitForServer(callback), 500);
  });
  req.end();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Over 1.5 Scanner',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  startNextServer();
  waitForServer(createWindow);
});

app.on('window-all-closed', () => {
  if (nextServer) nextServer.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (nextServer) nextServer.kill();
});
