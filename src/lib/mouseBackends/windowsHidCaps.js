'use strict';

const { execFile } = require('child_process');
const path = require('path');

const HID_CAPS_TIMEOUT_MS = 5000;

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
  return path.resolve(__dirname, '../../../scripts/get-hid-caps.ps1');
}

function invokePowerShell(execFileImpl, executable, args, timeout) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve(String(stdout || '').trim());
        return;
      }

      const detail = String(stderr || stdout || error.message || '').trim();
      const wrapped = new Error(
        detail
          ? `HID caps inspection failed: ${detail}`
          : `HID caps inspection failed: ${error.message}`,
      );
      wrapped.cause = error;
      reject(wrapped);
    });
  });
}

function normalizeCaps(value) {
  const source = value && typeof value === 'object' ? value : {};
  const caps = {
    usagePage: Number(source.usagePage),
    usage: Number(source.usage),
    inputReportByteLength: Number(source.inputReportByteLength),
    outputReportByteLength: Number(source.outputReportByteLength),
    featureReportByteLength: Number(source.featureReportByteLength),
  };

  for (const [key, number] of Object.entries(caps)) {
    if (!Number.isInteger(number) || number < 0) {
      throw new Error(`HID caps inspection returned invalid ${key}`);
    }
  }

  return caps;
}

async function inspectWindowsHidCaps(devicePath, options = {}) {
  if (typeof devicePath !== 'string' || devicePath.length === 0) {
    throw new Error('HID caps inspection requires a device path');
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
  ];

  const stdout = await invokePowerShell(
    execFileImpl,
    executable,
    args,
    options.timeout || HID_CAPS_TIMEOUT_MS,
  );

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`HID caps inspection returned invalid JSON: ${stdout || '<empty>'}`, { cause: error });
  }

  return normalizeCaps(parsed);
}

module.exports = {
  HID_CAPS_TIMEOUT_MS,
  getDefaultPowerShellPath,
  getDefaultScriptPath,
  inspectWindowsHidCaps,
  normalizeCaps,
};
