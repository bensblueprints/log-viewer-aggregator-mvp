require('dotenv').config();
const path = require('path');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5347;
const SYSLOG_PORT = Number(process.env.SYSLOG_PORT) || 5514;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'logbin.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const app = createApp({ dbPath: DB_PATH, adminPassword: ADMIN_PASSWORD, syslogPort: SYSLOG_PORT });

app.listen(PORT, () => {
  console.log(`Logbin listening on http://localhost:${PORT}`);
  if (ADMIN_PASSWORD === 'admin') {
    console.log('⚠ Using default admin password — set ADMIN_PASSWORD in .env for production.');
  }
});
