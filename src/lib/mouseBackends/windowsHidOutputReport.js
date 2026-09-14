'use strict';

const { spawn } = require('child_process');
const path = require('path');

const OUTPUT_REPORT_TIMEOUT_MS = 5000;
const OUTPUT_REPORT_IDLE_TIMEOUT_MS = 30_000;
const OUTPUT_REPORT_CLOSE_TIMEOUT_MS = 1000;

function getDefaultPowerShellPath(env = process.env) {
  if (env.SystemRoot) {
    return path.join(
      env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
  }
  return 'powershell.exe';
}

function getDefaultScriptPath() {
  return path.resolve(__dirname, '../../../scripts/send-hid-output-report.ps1');
}

function bridgeError(detail, cause = null) {
  const error = new Error(`HidD_SetOutputReport failed: ${detail}`);
  if (cause) error.cause = cause;
  return error;
}

function decodeHelperError(line) {
  const encoded = line.slice(4);
  try {
    return Buffer.from(encoded, 'base64').toString('utf8') || 'unknown native bridge error';
  } catch {
    return line;
  }
}

function createSession(devicePath, options, callbacks) {
  const spawnImpl = options.spawn || spawn;
  const executable = options.powershellPath || getDefaultPowerShellPath(options.env);
  const scriptPath = options.scriptPath || getDefaultScriptPath();
  const timeoutMs = options.timeout || OUTPUT_REPORT_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs === undefined
    ? OUTPUT_REPORT_IDLE_TIMEOUT_MS
    : options.idleTimeoutMs;
  const closeTimeoutMs = options.closeTimeoutMs || OUTPUT_REPORT_CLOSE_TIMEOUT_MS;
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-DevicePath',
    devicePath,
    '-Server',
  ];
  const child = spawnImpl(executable, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!child || !child.stdin || !child.stdout || !child.stderr) {
    throw bridgeError('persistent PowerShell helper did not expose stdio pipes');
  }
  if (typeof child.unref === 'function') {
    child.unref();
  }

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let ready = false;
  let readySettled = false;
  let closing = false;
  let exited = false;
  let pending = null;
  let idleTimer = null;
  let tail = Promise.resolve();

  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleClose() {
    clearIdleTimer();
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0 || closing || exited) {
      return;
    }
    idleTimer = setTimeout(() => callbacks.onIdle(), idleTimeoutMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function settlePending(error = null) {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve();
  }

  function failReady(error) {
    if (readySettled) return;
    readySettled = true;
    rejectReady(error);
  }

  function handleLine(rawLine) {
    const line = rawLine.trim();
    if (!line) return;

    if (!ready) {
      if (line === 'READY') {
        ready = true;
        readySettled = true;
        resolveReady();
        return;
      }
      failReady(bridgeError(`unexpected helper startup response: ${line}`));
      return;
    }

    if (!pending) {
      return;
    }

    if (line === 'OK') {
      settlePending();
      return;
    }

    if (line.startsWith('ERR:')) {
      settlePending(bridgeError(decodeHelperError(line)));
      return;
    }

    settlePending(bridgeError(`unexpected helper response: ${line}`));
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      handleLine(line);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString('utf8');
    if (stderrBuffer.length > 64 * 1024) {
      stderrBuffer = stderrBuffer.slice(-64 * 1024);
    }
  });

  const startupTimer = setTimeout(() => {
    const error = bridgeError(`persistent helper did not become ready within ${timeoutMs} ms`);
    failReady(error);
    settlePending(error);
    try { child.kill(); } catch { /* best effort */ }
  }, timeoutMs);
  if (typeof startupTimer.unref === 'function') startupTimer.unref();

  readyPromise.then(
    () => {
      clearTimeout(startupTimer);
      scheduleIdleClose();
    },
    () => clearTimeout(startupTimer),
  );

  function handleTermination(error) {
    clearIdleTimer();
    if (!readySettled) failReady(error);
    settlePending(error);
    callbacks.onTerminated();
  }

  child.on('error', (cause) => {
    handleTermination(bridgeError(cause.message || 'persistent helper process error', cause));
  });

  child.on('exit', (code, signal) => {
    if (exited) return;
    exited = true;
    const stderr = stderrBuffer.trim();
    const detail = closing
      ? 'persistent helper closed'
      : (stderr || `persistent helper exited (code=${code}, signal=${signal || 'none'})`);
    handleTermination(bridgeError(detail));
  });

  async function sendOne(report) {
    clearIdleTimer();
    await readyPromise;

    if (closing || exited) {
      throw bridgeError('persistent helper is not running');
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending) return;
        pending = null;
        reject(bridgeError(`persistent helper timed out after ${timeoutMs} ms`));
        try { child.kill(); } catch { /* best effort */ }
      }, timeoutMs);

      pending = { resolve, reject, timer };
      child.stdin.write(`${report.toString('hex')}\n`, 'utf8', (error) => {
        if (!error || !pending) return;
        settlePending(bridgeError(`failed to write to persistent helper stdin: ${error.message}`, error));
      });
    });

    scheduleIdleClose();
  }

  function send(report) {
    const operation = tail.then(() => sendOne(report));
    tail = operation.catch(() => {});
    return operation;
  }

  async function close() {
    if (closing || exited) return;
    closing = true;
    clearIdleTimer();
    const closedError = bridgeError('persistent helper closed');
    if (!readySettled) failReady(closedError);
    settlePending(closedError);

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try { child.kill(); } catch { /* best effort */ }
        finish();
      }, closeTimeoutMs);

      child.once('exit', finish);
      try {
        child.stdin.end();
      } catch {
        try { child.kill(); } catch { /* best effort */ }
        finish();
      }
    });
  }

  return { send, close };
}

function createWindowsHidOutputReportManager(options = {}) {
  const sessions = new Map();

  function removeIfCurrent(devicePath, session) {
    if (sessions.get(devicePath) === session) {
      sessions.delete(devicePath);
    }
  }

  function createManagedSession(devicePath) {
    let session;
    session = createSession(devicePath, options, {
      onIdle: () => {
        removeIfCurrent(devicePath, session);
        session.close().catch(() => {});
      },
      onTerminated: () => removeIfCurrent(devicePath, session),
    });
    sessions.set(devicePath, session);
    return session;
  }

  async function send(devicePath, packet) {
    if (typeof devicePath !== 'string' || devicePath.length === 0) {
      throw new Error('CrazyLight HID output report requires a device path');
    }

    const report = Buffer.from(packet || []);
    if (report.length === 0) {
      throw new Error('CrazyLight HID output report cannot be empty');
    }

    const session = sessions.get(devicePath) || createManagedSession(devicePath);
    try {
      await session.send(report);
    } catch (error) {
      removeIfCurrent(devicePath, session);
      await session.close().catch(() => {});
      throw error;
    }
  }

  async function closePath(devicePath) {
    const session = sessions.get(devicePath);
    if (!session) return;
    sessions.delete(devicePath);
    await session.close();
  }

  async function closeAll() {
    const active = Array.from(sessions.values());
    sessions.clear();
    await Promise.all(active.map((session) => session.close().catch(() => {})));
  }

  function getActivePaths() {
    return Array.from(sessions.keys());
  }

  return {
    send,
    closePath,
    closeAll,
    getActivePaths,
  };
}

const defaultManager = createWindowsHidOutputReportManager();

async function sendWindowsHidOutputReport(devicePath, packet) {
  return defaultManager.send(devicePath, packet);
}

async function closeAllWindowsHidOutputBridges() {
  return defaultManager.closeAll();
}

module.exports = {
  OUTPUT_REPORT_CLOSE_TIMEOUT_MS,
  OUTPUT_REPORT_IDLE_TIMEOUT_MS,
  OUTPUT_REPORT_TIMEOUT_MS,
  closeAllWindowsHidOutputBridges,
  createWindowsHidOutputReportManager,
  getDefaultPowerShellPath,
  getDefaultScriptPath,
  sendWindowsHidOutputReport,
};
