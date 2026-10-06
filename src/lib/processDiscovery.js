const { execFileSync, spawn } = require('child_process');
const { parseTasklistCsv } = require('./processes');

let foregroundWatcher = null;
let foregroundBuffer = '';
let latestForegroundProcess = null;
let foregroundMissStartedAt = null;
const FOREGROUND_WATCH_INTERVAL_MS = 1000;
const FOREGROUND_MISS_GRACE_MS = 5000;

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

function getRunningLookupCommand() {
  return `${getWindowsProcessHelpersCommand()}
Get-CimInstance Win32_Process | ForEach-Object {
  $path = $_.ExecutablePath
  if (-not $path) {
    try { $path = [Win32ForegroundWindow]::GetExecutablePath($_.ProcessId) } catch {}
  }
  [pscustomobject]@{ Name = $_.Name; ExecutablePath = $path }
} | ConvertTo-Json -Compress
`;
}

function getRunningProcesses(commandRunner = execFileSync) {
  try {
    const output = commandRunner('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      getRunningLookupCommand(),
    ], { encoding: 'utf8', windowsHide: true });

    return parseJsonOutput(output)
      .map(normalizeDiscoveredProcess)
      .filter(Boolean);
  } catch (error) {
    const output = commandRunner('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
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

function getWindowsProcessHelpersCommand() {
  return `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder path, ref uint size);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);

  public static string GetExecutablePath(uint processId) {
    // Only query the image name; protected games may deny broader WMI queries.
    IntPtr handle = OpenProcess(0x1000, false, processId);
    if (handle == IntPtr.Zero) return null;
    try {
      StringBuilder path = new StringBuilder(32768);
      uint size = (uint)path.Capacity;
      return QueryFullProcessImageName(handle, 0, path, ref size) ? path.ToString() : null;
    } finally {
      CloseHandle(handle);
    }
  }
}
"@

function Get-ProcessJsonById($processId) {
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
  if (-not $path) {
    try { $path = [Win32ForegroundWindow]::GetExecutablePath($processId) } catch {}
  }
  if (-not $name -and $path) { $name = [IO.Path]::GetFileName($path) }
  if (-not $name) { return $null }
  [pscustomobject]@{ Name = $name; ExecutablePath = $path } | ConvertTo-Json -Compress
}
`;
}

function getForegroundLookupCommand() {
  return `${getWindowsProcessHelpersCommand()}
$handle = [Win32ForegroundWindow]::GetForegroundWindow()
$processId = 0
[void][Win32ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
Get-ProcessJsonById $processId
`;
}

function getForegroundWatcherCommand(pollMilliseconds = FOREGROUND_WATCH_INTERVAL_MS) {
  return `${getWindowsProcessHelpersCommand()}
function Get-ForegroundProcessId {
  $handle = [Win32ForegroundWindow]::GetForegroundWindow()
  $processId = 0
  [void][Win32ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  return $processId
}

$lastProcessId = -1
$lastJson = $null

while ($true) {
  try {
    $processId = Get-ForegroundProcessId
    if ($processId -eq 0) {
      if ($lastProcessId -ne 0) {
        [Console]::Out.WriteLine("{}")
      }
      $lastProcessId = 0
      $lastJson = "{}"
    } elseif ($processId -ne $lastProcessId -or [string]::IsNullOrWhiteSpace($lastJson)) {
      $json = Get-ProcessJsonById $processId
      if ([string]::IsNullOrWhiteSpace($json)) {
        [Console]::Out.WriteLine("{}")
        $lastProcessId = -1
        $lastJson = $null
      } else {
        [Console]::Out.WriteLine($json)
        $lastProcessId = $processId
        $lastJson = $json
      }
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

function resetForegroundProcessCache() {
  latestForegroundProcess = null;
  foregroundMissStartedAt = null;
}

function getLatestForegroundProcess(now = Date.now()) {
  if (foregroundMissStartedAt !== null && now - foregroundMissStartedAt >= FOREGROUND_MISS_GRACE_MS) {
    resetForegroundProcessCache();
  }

  return latestForegroundProcess;
}

function handleForegroundWatcherLine(line, now = Date.now()) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }

  try {
    const foregroundProcess = parseForegroundProcessOutput(trimmed);
    if (foregroundProcess) {
      latestForegroundProcess = foregroundProcess;
      foregroundMissStartedAt = null;
      return;
    }

    if (latestForegroundProcess && foregroundMissStartedAt === null) {
      foregroundMissStartedAt = now;
      return;
    }

    if (!latestForegroundProcess) {
      resetForegroundProcessCache();
    }
  } catch (error) {
    if (latestForegroundProcess) {
      if (foregroundMissStartedAt === null) {
        foregroundMissStartedAt = now;
      }
      return;
    }

    resetForegroundProcessCache();
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
    resetForegroundProcessCache();
  });

  watcher.on('exit', () => {
    if (foregroundWatcher !== watcher) {
      return;
    }

    foregroundWatcher = null;
    foregroundBuffer = '';
    resetForegroundProcessCache();
  });
}

function stopForegroundProcessWatcher() {
  if (!foregroundWatcher) {
    return;
  }

  const watcher = foregroundWatcher;
  foregroundWatcher = null;
  foregroundBuffer = '';
  resetForegroundProcessCache();

  if (!watcher.killed) {
    watcher.kill();
  }
}

function getForegroundProcess() {
  startForegroundProcessWatcher();
  return getLatestForegroundProcess();
}

module.exports = {
  FOREGROUND_MISS_GRACE_MS,
  getForegroundProcess,
  getForegroundProcessSnapshot,
  getLatestForegroundProcess,
  getRunningProcesses,
  getForegroundLookupCommand,
  getForegroundWatcherCommand,
  getWindowsProcessHelpersCommand,
  handleForegroundWatcherLine,
  parseForegroundProcessOutput,
  parseJsonOutput,
  resetForegroundProcessCache,
  startForegroundProcessWatcher,
  stopForegroundProcessWatcher,
};
