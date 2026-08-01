const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');

const BACKEND_HOST = '127.0.0.1';

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, BACKEND_HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEndpoint(url, { timeoutMs, onAttempt }) {
  const started = Date.now();
  let attempts = 0;
  while (Date.now() - started < timeoutMs) {
    attempts += 1;
    if (onAttempt) onAttempt(attempts, Date.now() - started);
    try {
      const response = await fetch(url);
      if (response.ok) {
        return { ok: true, status: response.status, attempts, elapsedMs: Date.now() - started };
      }
    } catch (err) {
      // keep polling until timeout or process exit
    }
    await sleep(250);
  }
  return { ok: false, attempts, elapsedMs: Date.now() - started };
}

function startBackend({ app, projectRoot, port, logDir, logger }) {
  const backendUrl = `http://${BACKEND_HOST}:${port}`;
  const exePath = path.join(process.resourcesPath, 'backend', 'PackLab3DBackend.exe');

  let command;
  let args;
  let cwd;

  if (app.isPackaged) {
    if (!fs.existsSync(exePath)) {
      const err = new Error(`Backend executable not found: ${exePath}`);
      err.code = 'BACKEND_NOT_FOUND';
      throw err;
    }
    command = exePath;
    args = ['--host', BACKEND_HOST, '--port', String(port)];
    cwd = path.dirname(exePath);
  } else {
    command = 'python';
    args = ['-m', 'uvicorn', 'packlab3d.backend.api.main:app', '--host', BACKEND_HOST, '--port', String(port)];
    cwd = projectRoot;
  }

  const stdoutPath = path.join(logDir, 'backend.log');
  const stderrPath = path.join(logDir, 'backend-stderr.log');
  const stdout = fs.createWriteStream(stdoutPath, { flags: 'a' });
  const stderr = fs.createWriteStream(stderrPath, { flags: 'a' });

  logger.info('spawning backend', {
    command,
    args,
    cwd,
    backendUrl,
    packaged: app.isPackaged,
    stdoutPath,
    stderrPath,
  });

  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      PACKLAB_BACKEND_HOST: BACKEND_HOST,
      PACKLAB_BACKEND_PORT: String(port),
      PACKLAB_LOG_DIR: logDir,
      PACKLAB_PACKAGED: app.isPackaged ? '1' : '0',
    },
  });

  child.stdout?.on('data', (data) => stdout.write(data));
  child.stderr?.on('data', (data) => stderr.write(data));
  child.on('error', (err) => {
    logger.error('backend process error', { code: err.code, stack: err.stack, message: err.message });
  });
  child.on('exit', (code, signal) => {
    logger.warn('backend exited', { code, signal });
    stdout.end();
    stderr.end();
  });

  return {
    child,
    backendUrl,
    exePath: app.isPackaged ? exePath : null,
    command,
    cwd,
    port,
  };
}

function stopBackend(child, logger) {
  if (!child || child.killed || child.exitCode !== null) return Promise.resolve();
  logger.info('stopping backend', { pid: child.pid });
  child.kill('SIGTERM');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (err) => {
          if (err) logger.warn('backend forced stop failed', { message: err.message });
          resolve();
        });
      } else {
        try {
          child.kill('SIGKILL');
        } catch (err) {
          logger.warn('backend SIGKILL failed', { message: err.message });
        }
        resolve();
      }
    }, 3000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

module.exports = {
  BACKEND_HOST,
  findAvailablePort,
  startBackend,
  stopBackend,
  waitForEndpoint,
};
