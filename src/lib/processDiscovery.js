const { execFileSync, spawn } = require('child_process');
const { parseTasklistCsv } = require('./processes');

let foregroundWatcher = null;
let foregroundBuffer = '';
let latestForegroundProcess = null;

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

function getForegroundLookupCommand() {
  return `
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
$name = $null
$path = $null
try {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
  if ($processInfo) {
    $name = $processInfo.Name
    $path = $processInfo.ExecutablePath
  }
} catch {}
if (-not $name) {
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    $name = $process.ProcessName + ".exe"
    try {
      $path = $process.Path
    } catch {
      $path = $null
    }
  } catch {}
}
if (-not $name) {
  try {
    $rows = tasklist /FI "PID eq $processId" /FO CSV /NH 2>$null |
      ConvertFrom-Csv -Header ImageName,PID,SessionName,SessionNumber,MemUsage
    $row = $rows | Where-Object { $_.PID -eq [string]$processId } | Select-Object -First 1
    if ($row -and $row.ImageName -and $row.ImageName -notmatch '^INFO:') {
      $name = $row.ImageName
    }
  } catch {}
}
if (-not $name) { return }
[pscustomobject]@{ Name = $name; ExecutablePath = $path } | ConvertTo-Json -Compress
`;
}

function getForegroundWatcherCommand(pollMilliseconds = 500) {
  return `
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

function Get-ForegroundProcessJson {
  $handle = [Win32ForegroundWindow]::GetForegroundWindow()
  $processId = 0
  [void][Win32ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -eq 0) { return $null }
  $name = $null
  $path = $null
  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    if ($processInfo) {
      $name = $processInfo.Name
      $path = $processInfo.ExecutablePath
    }
  } catch {}
  if (-not $name) {
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
      $name = $process.ProcessName + ".exe"
      try {
        $path = $process.Path
      } catch {
        $path = $null
      }
    } catch {}
  }
  if (-not $name) {
    try {
      $rows = tasklist /FI "PID eq $processId" /FO CSV /NH 2>$null |
        ConvertFrom-Csv -Header ImageName,PID,SessionName,SessionNumber,MemUsage
      $row = $rows | Where-Object { $_.PID -eq [string]$processId } | Select-Object -First 1
      if ($row -and $row.ImageName -and $row.ImageName -notmatch '^INFO:') {
        $name = $row.ImageName
      }
    } catch {}
  }
  if (-not $name) { return $null }
  [pscustomobject]@{ Name = $name; ExecutablePath = $path } | ConvertTo-Json -Compress
}

while ($true) {
  try {
    $json = Get-ForegroundProcessJson
    if ([string]::IsNullOrWhiteSpace($json)) {
      [Console]::Out.WriteLine("{}")
    } else {
      [Console]::Out.WriteLine($json)
    }
  } catch {
    [Console]::Out.WriteLine("{}")
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${pollMilliseconds}
}
`;
}

function getForegroundProcessSnapshot(commandRunner = execFileSync) {
  const command = getForegroundLookupCommand();

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

function handleForegroundWatcherLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }

  try {
    latestForegroundProcess = parseForegroundProcessOutput(trimmed);
  } catch (error) {
    latestForegroundProcess = null;
  }
}

function startForegroundProcessWatcher(spawnRunner = spawn) {
  if (foregroundWatcher) {
    return;
  }

  foregroundBuffer = '';
  const command = getForegroundWatcherCommand();
  const watcher = spawnRunner('powershell.exe', [
    '-NoProfile',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  foregroundWatcher = watcher;

  watcher.stdout.on('data', (chunk) => {
    if (foregroundWatcher !== watcher) {
      return;
    }

    foregroundBuffer += chunk.toString('utf8');
    const lines = foregroundBuffer.split(/\r?\n/);
    foregroundBuffer = lines.pop() || '';
    lines.forEach(handleForegroundWatcherLine);
  });

  watcher.on('error', () => {
    if (foregroundWatcher !== watcher) {
      return;
    }

    foregroundWatcher = null;
    foregroundBuffer = '';
    latestForegroundProcess = null;
  });

  watcher.on('exit', () => {
    if (foregroundWatcher !== watcher) {
      return;
    }

    foregroundWatcher = null;
    foregroundBuffer = '';
    latestForegroundProcess = null;
  });
}

function stopForegroundProcessWatcher() {
  if (!foregroundWatcher) {
    return;
  }

  const watcher = foregroundWatcher;
  foregroundWatcher = null;
  foregroundBuffer = '';
  latestForegroundProcess = null;

  if (!watcher.killed) {
    watcher.kill();
  }
}

function getForegroundProcess() {
  startForegroundProcessWatcher();
  return latestForegroundProcess;
}

module.exports = {
  getForegroundProcess,
  getForegroundProcessSnapshot,
  getRunningProcesses,
  getForegroundLookupCommand,
  getForegroundWatcherCommand,
  parseForegroundProcessOutput,
  parseJsonOutput,
  startForegroundProcessWatcher,
  stopForegroundProcessWatcher,
};
