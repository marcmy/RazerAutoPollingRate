const { execFileSync } = require('child_process');
const { parseTasklistCsv } = require('./processes');

function parseJsonOutput(output) {
  const trimmed = String(output || '').trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeDiscoveredProcess(item) {
  const processName = item.Name || item.processName || item.name;
  if (!processName) {
    return null;
  }

  return {
    processName,
    executablePath: item.ExecutablePath || item.executablePath || null,
  };
}

function getRunningProcesses() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', windowsHide: true });

    return parseJsonOutput(output)
      .map(normalizeDiscoveredProcess)
      .filter(Boolean);
  } catch (error) {
    const output = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    return parseTasklistCsv(output);
  }
}

function parseForegroundProcessOutput(output) {
  const processes = parseJsonOutput(output);
  if (processes.length === 0) {
    return null;
  }

  return normalizeDiscoveredProcess(processes[0]);
}

function getForegroundProcess(commandRunner = execFileSync) {
  const command = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [Win32ForegroundWindow]::GetForegroundWindow()
$processId = 0
[void][Win32ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
if ($processId -eq 0) { return }
$process = Get-Process -Id $processId -ErrorAction Stop
[pscustomobject]@{ Name = ($process.ProcessName + ".exe"); ExecutablePath = $process.Path } | ConvertTo-Json -Compress
`;

  try {
    const output = commandRunner('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], { encoding: 'utf8', windowsHide: true });

    return parseForegroundProcessOutput(output);
  } catch (error) {
    return null;
  }
}

module.exports = {
  getForegroundProcess,
  getRunningProcesses,
  parseForegroundProcessOutput,
  parseJsonOutput,
};
