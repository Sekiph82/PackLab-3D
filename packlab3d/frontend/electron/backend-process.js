const fs = require('fs');
const net = require('net');
const path = require('path');
const { performance } = require('perf_hooks');
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
  if (process.env.PACKLAB_FORCE_BACKEND_FAIL === '1') {
    const err = new Error('Backend startup forced to fail by PACKLAB_FORCE_BACKEND_FAIL=1');
    err.code = 'BACKEND_FORCED_FAILURE';
    throw err;
  }

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
  const usePackagedLauncher = app.isPackaged;
  const stdout = usePackagedLauncher ? null : fs.createWriteStream(stdoutPath, { flags: 'a' });
  const stderr = usePackagedLauncher ? null : fs.createWriteStream(stderrPath, { flags: 'a' });

  logger.info('spawning backend', {
    command,
    args,
    cwd,
    backendUrl,
    packaged: app.isPackaged,
    stdoutPath,
    stderrPath,
  });

  let spawnCommand = command;
  let spawnArgs = args;
  if (usePackagedLauncher) {
    const psScript = [
      `$env:PACKLAB_BACKEND_HOST='${BACKEND_HOST}'`,
      `$env:PACKLAB_BACKEND_PORT='${port}'`,
      `$env:PACKLAB_LOG_DIR='${logDir.replace(/'/g, "''")}'`,
      "$env:PACKLAB_PACKAGED='1'",
      `$p = Start-Process -FilePath '${command.replace(/'/g, "''")}' -ArgumentList @('--host','${BACKEND_HOST}','--port','${port}') -WorkingDirectory '${cwd.replace(/'/g, "''")}' -WindowStyle Hidden -RedirectStandardOutput '${stdoutPath.replace(/'/g, "''")}' -RedirectStandardError '${stderrPath.replace(/'/g, "''")}' -PassThru`,
      'Write-Output $p.Id',
    ].join('; ');
    spawnCommand = 'powershell.exe';
    spawnArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript];
  }

  const spawnStartedAt = performance.now();
  logger.info('backend spawn call started', { spawnStartedAt });
  const child = spawn(spawnCommand, spawnArgs, {
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
  child.packlabIsLauncher = usePackagedLauncher;
  child.packlabBackendPid = usePackagedLauncher ? null : child.pid;
  const spawnReturnedAt = performance.now();
  const spawnCallDurationMs = spawnReturnedAt - spawnStartedAt;
  logger.info('backend spawn call returned', {
    spawnReturnedAt,
    spawnCallDurationMs: Number(spawnCallDurationMs.toFixed(2)),
    pid: child.pid,
  });

  child.once('spawn', () => {
    logger.info('backend process spawn event', {
      pid: child.pid,
      launcher: usePackagedLauncher,
      processSpawnEventDelayMs: Number((performance.now() - spawnStartedAt).toFixed(2)),
    });
  });

  if (usePackagedLauncher) {
    child.stdout?.on('data', (data) => {
      const pid = Number(String(data).trim().split(/\s+/).find((item) => /^\d+$/.test(item)));
      if (pid) {
        child.packlabBackendPid = pid;
        logger.info('backend launcher reported pid', { pid });
      }
    });
    child.stderr?.on('data', (data) => {
      logger.warn('backend launcher stderr', { message: String(data).trim() });
    });
  } else {
    child.stdout?.on('data', (data) => stdout?.write(data));
    child.stderr?.on('data', (data) => stderr?.write(data));
  }
  child.on('error', (err) => {
    logger.error('backend process error', { code: err.code, stack: err.stack, message: err.message });
  });
  child.on('exit', (code, signal) => {
    logger.warn('backend exited', { code, signal });
    if (!usePackagedLauncher) {
      stdout?.end();
      stderr?.end();
    }
  });

  return {
    child,
    backendUrl,
    exePath: app.isPackaged ? exePath : null,
    command,
    cwd,
    port,
    spawnStartedAt,
    spawnReturnedAt,
    spawnCallDurationMs,
    backendPid: () => child.packlabBackendPid || child.pid,
    launcher: usePackagedLauncher,
  };
}

function stopBackend(child, logger) {
  if (!child) return Promise.resolve();
  const targetPid = child.packlabBackendPid || child.pid;
  if (!targetPid) return Promise.resolve();
  logger.info('stopping backend', { pid: targetPid, launcherPid: child.pid, launcher: child.packlabIsLauncher });
  if (!child.packlabIsLauncher && !child.killed && child.exitCode === null) child.kill('SIGTERM');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (process.platform === 'win32' && targetPid) {
        execFile('taskkill.exe', ['/PID', String(targetPid), '/T', '/F'], { windowsHide: true }, (err) => {
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

    if (child.packlabIsLauncher) {
      const killArgs = child.packlabBackendPid
        ? ['/PID', String(targetPid), '/T', '/F']
        : ['/IM', 'PackLab3DBackend.exe', '/T', '/F'];
      execFile('taskkill.exe', killArgs, { windowsHide: true }, (err) => {
        clearTimeout(timeout);
        if (err) logger.warn('backend forced stop failed', { message: err.message });
        resolve();
      });
      return;
    }

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
