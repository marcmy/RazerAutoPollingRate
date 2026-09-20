'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { getDefaultPowerShellPath } = require('./windowsHidCaps');

const RESTART_DELAY_MS = 1000;

function getDefaultScriptPath() {
  return path.resolve(__dirname, '../../../scripts/watch-raw-mouse-input.ps1');
}

function parseRawMouseDevicePath(devicePath) {
  const text = String(devicePath || '');
  const vendorMatch = text.match(/(?:^|[#&])VID_([0-9A-F]{4})(?=[&#\\]|$)/i);
  const productMatch = text.match(/(?:^|[#&])PID_([0-9A-F]{4})(?=[&#\\]|$)/i);
  if (!vendorMatch || !productMatch) return null;

  return {
    devicePath: text,
    vendorId: Number.parseInt(vendorMatch[1], 16),
    productId: Number.parseInt(productMatch[1], 16),
  };
}

function createWindowsRawMouseMonitor(options = {}) {
  const spawnImpl = options.spawn || spawn;
  const log = options.log || (() => {});
  const onActivity = options.onActivity || (() => {});
  const onDiagnostic = options.onDiagnostic || (() => {});
  const executable = options.powershellPath || getDefaultPowerShellPath(options.env);
  const scriptPath = options.scriptPath || getDefaultScriptPath();
  const restartDelayMs = Number.isFinite(options.restartDelayMs)
    ? Math.max(0, options.restartDelayMs)
    : RESTART_DELAY_MS;

  let child = null;
  let lines = null;
  let restartTimer = null;
  let closed = false;
  const exitHandler = () => close();

  function stopChild() {
    if (lines) {
      lines.close();
      lines = null;
    }
    if (child) {
      try {
        child.kill();
      } catch {
        // Best effort during shutdown/restart.
      }
      child = null;
    }
  }

  function scheduleRestart() {
    if (closed || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, restartDelayMs);
    if (typeof restartTimer.unref === 'function') restartTimer.unref();
  }

  function handleLine(line) {
    const text = String(line || '').trim();
    if (!text) return;

    if (text === 'READY') {
      onDiagnostic('raw_mouse_monitor_ready', {});
      return;
    }

    if (!text.startsWith('MOUSE\t')) return;
    const parsed = parseRawMouseDevicePath(text.slice(6));
    if (!parsed) {
      onDiagnostic('raw_mouse_unknown_device_path', { devicePath: text.slice(6) });
      return;
    }

    onActivity(parsed);
  }

  function start() {
    if (closed || child) return;

    try {
      const spawned = spawnImpl(executable, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = spawned;

      if (child.stdout) {
        child.stdout.setEncoding('utf8');
        lines = readline.createInterface({ input: child.stdout });
        lines.on('line', handleLine);
        if (typeof child.stdout.unref === 'function') child.stdout.unref();
      }

      if (child.stderr) {
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
          const detail = String(chunk || '').trim();
          if (detail) log(`Raw mouse monitor: ${detail}`, true);
        });
        if (typeof child.stderr.unref === 'function') child.stderr.unref();
      }

      child.once('error', (error) => {
        onDiagnostic('raw_mouse_monitor_error', {
          error: error && error.message ? error.message : String(error),
        });
      });

      child.once('exit', (code, signal) => {
        if (lines) {
          lines.close();
          lines = null;
        }
        child = null;
        if (!closed) {
          onDiagnostic('raw_mouse_monitor_exit', { code, signal: signal || null });
          scheduleRestart();
        }
      });

      if (typeof child.unref === 'function') child.unref();
    } catch (error) {
      onDiagnostic('raw_mouse_monitor_error', {
        error: error && error.message ? error.message : String(error),
      });
      child = null;
      scheduleRestart();
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    process.removeListener('exit', exitHandler);
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    stopChild();
  }

  process.once('exit', exitHandler);
  start();
  return { close };
}

module.exports = {
  RESTART_DELAY_MS,
  createWindowsRawMouseMonitor,
  getDefaultScriptPath,
  parseRawMouseDevicePath,
};
