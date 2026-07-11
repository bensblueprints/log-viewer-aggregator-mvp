// Desktop mode: same Express server on a free local port (syslog listener on
// 5514), data in userData, auto-logged-in as admin. Great for local dev logs.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

let win;

app.whenReady().then(() => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const autologinToken = crypto.randomBytes(24).toString('hex');

  const { createApp } = require(path.join(__dirname, '..', 'server', 'app.js'));
  const server = createApp({
    dbPath: path.join(dataDir, 'logbin.db'),
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',
    syslogPort: Number(process.env.SYSLOG_PORT) || 5514,
    autologinToken
  });

  const listener = server.listen(0, '127.0.0.1', () => {
    const port = listener.address().port;
    win = new BrowserWindow({
      width: 1380,
      height: 900,
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      title: 'Logbin',
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.loadURL(`http://127.0.0.1:${port}/auth/auto?token=${autologinToken}`);
  });

  app.on('window-all-closed', () => {
    listener.close();
    app.quit();
  });
});
