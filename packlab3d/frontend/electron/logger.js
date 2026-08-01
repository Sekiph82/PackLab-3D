const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const ROTATED_FILES = 5;

function getLogDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'PackLab3D', 'logs');
}

function ensureLogDir(logDir = getLogDir()) {
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}

function rotateLog(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_LOG_BYTES) return;
    for (let i = ROTATED_FILES - 1; i >= 1; i -= 1) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      if (fs.existsSync(to)) fs.rmSync(to, { force: true });
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (err) {
    console.error('[logger] rotation failed:', err);
  }
}

function createLogger(name, metadata = {}) {
  const logDir = ensureLogDir();
  const filePath = path.join(logDir, name);
  rotateLog(filePath);

  function write(level, message, fields = {}) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      pid: process.pid,
      ...metadata,
      message,
      ...fields,
    };
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    return payload;
  }

  return {
    filePath,
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

module.exports = {
  createLogger,
  ensureLogDir,
  getLogDir,
  rotateLog,
};
