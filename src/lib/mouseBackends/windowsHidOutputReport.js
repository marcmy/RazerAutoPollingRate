'use strict';

const { execFile } = require('child_process');
const path = require('path');

const OUTPUT_REPORT_TIMEOUT_MS = 5000;

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

function invokePowerShell(execFileImpl, executable, args, timeout) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }

      const detail = String(stderr || stdout || error.message || '').trim();
      const wrapped = new Error(
        detail
          ? `HidD_SetOutputReport failed: ${detail}`
          : `HidD_SetOutputReport failed: ${error.message}`,
      );
      wrapped.cause = error;
      reject(wrapped);
    });
  });
}

async function sendWindowsHidOutputReport(devicePath, packet, options = {}) {
  if (typeof devicePath !== 'string' || devicePath.length === 0) {
    throw new Error('CrazyLight HID output report requires a device path');
  }

  const report = Buffer.from(packet || []);
  if (report.length === 0) {
    throw new Error('CrazyLight HID output report cannot be empty');
  }

  const execFileImpl = options.execFile || execFile;
  const executable = options.powershellPath || getDefaultPowerShellPath(options.env);
  const scriptPath = options.scriptPath || getDefaultScriptPath();
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
    '-ReportHex',
    report.toString('hex'),
  ];

  await invokePowerShell(
    execFileImpl,
    executable,
    args,
    options.timeout || OUTPUT_REPORT_TIMEOUT_MS,
  );
}

module.exports = {
  OUTPUT_REPORT_TIMEOUT_MS,
  getDefaultPowerShellPath,
  getDefaultScriptPath,
  sendWindowsHidOutputReport,
};
