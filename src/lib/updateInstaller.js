const fs = require('node:fs');
const path = require('node:path');

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function requireValidParentPid(parentPid) {
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error('A valid parent process id is required');
  }
}

function isSquirrelInstall(executablePath, existsSync = fs.existsSync) {
  if (!executablePath) {
    return false;
  }

  const executableDirectory = path.win32.dirname(executablePath);
  if (!/^app-[^\\/]+$/i.test(path.win32.basename(executableDirectory))) {
    return false;
  }

  const updateExecutable = path.win32.join(path.win32.dirname(executableDirectory), 'Update.exe');
  return Boolean(existsSync(updateExecutable));
}

function validateStagedAppPackage(stagedAppDirectory, expectedDisplayVersion, executableName) {
  if (!stagedAppDirectory || !expectedDisplayVersion || !executableName) {
    throw new Error('Staged app directory, target version, and executable name are required');
  }

  const packagePath = path.join(stagedAppDirectory, 'resources', 'app', 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error('Staged update is missing its packaged application metadata');
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`Staged update metadata is invalid: ${error.message}`);
  }

  if (String(metadata.buildDisplayVersion || '') !== String(expectedDisplayVersion)) {
    throw new Error(`Staged update version ${metadata.buildDisplayVersion || 'unknown'} does not match ${expectedDisplayVersion}`);
  }

  const executablePath = path.join(stagedAppDirectory, executableName);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Staged update is missing ${executableName}`);
  }

  return { metadata, executablePath };
}

function buildSquirrelInstallScript({
  parentPid,
  installerPath,
  localAppData,
  packageName,
  executableName,
}) {
  requireValidParentPid(parentPid);
  if (!installerPath || !localAppData || !packageName || !executableName) {
    throw new Error('Installer path, local app data path, package name, and executable name are required');
  }

  const installRoot = path.win32.join(localAppData, packageName);
  const updateExecutable = path.win32.join(installRoot, 'Update.exe');

  return [
    `$parentId = ${parentPid}`,
    'while (Get-Process -Id $parentId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }',
    `$installerProcess = Start-Process -FilePath ${quotePowerShellLiteral(installerPath)} -ArgumentList '--silent' -Wait -PassThru`,
    'if ($installerProcess.ExitCode -ne 0) { exit $installerProcess.ExitCode }',
    `$updateExe = ${quotePowerShellLiteral(updateExecutable)}`,
    'if (!(Test-Path -LiteralPath $updateExe)) { exit 2 }',
    `Start-Process -FilePath $updateExe -ArgumentList '--processStart', ${quotePowerShellLiteral(executableName)}`,
  ].join('; ');
}

function buildInPlaceInstallScript({
  parentPid,
  stagedAppDirectory,
  installDirectory,
  executablePath,
  logPath,
}) {
  // Preserve the current install location so fixed, portable, and package-manager installs update in place.
  requireValidParentPid(parentPid);
  if (!stagedAppDirectory || !installDirectory || !executablePath || !logPath) {
    throw new Error('Staged app directory, install directory, executable path, and log path are required');
  }

  return [
    "$ErrorActionPreference = 'Stop'",
    `$parentId = ${parentPid}`,
    `$stagedAppDirectory = ${quotePowerShellLiteral(stagedAppDirectory)}`,
    `$installDirectory = ${quotePowerShellLiteral(installDirectory)}`,
    `$executablePath = ${quotePowerShellLiteral(executablePath)}`,
    `$logPath = ${quotePowerShellLiteral(logPath)}`,
    '$backupDirectory = "$installDirectory.update-backup-$parentId"',
    'function Write-UpdaterLog { param([string]$Message) try { Add-Content -LiteralPath $logPath -Value ("[{0:o}] {1}" -f [DateTimeOffset]::UtcNow, $Message) -Encoding UTF8 } catch {} }',
    '$payloadEntries = @()',
    'try {',
    "  Write-UpdaterLog 'Waiting for application to exit.'",
    '  while (Get-Process -Id $parentId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }',
    '  if (!(Test-Path -LiteralPath $stagedAppDirectory)) { throw "Staged application payload is missing" }',
    '  if (!(Test-Path -LiteralPath $installDirectory)) { throw "Current installation directory is missing" }',
    '  if (Test-Path -LiteralPath $backupDirectory) { Remove-Item -LiteralPath $backupDirectory -Recurse -Force }',
    '  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null',
    '  $payloadEntries = @(Get-ChildItem -LiteralPath $stagedAppDirectory -Force)',
    '  foreach ($entry in $payloadEntries) {',
    '    $target = Join-Path $installDirectory $entry.Name',
    '    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backupDirectory -Force }',
    '  }',
    '  foreach ($entry in $payloadEntries) { Copy-Item -LiteralPath $entry.FullName -Destination $installDirectory -Recurse -Force }',
    '  if (!(Test-Path -LiteralPath $executablePath)) { throw "Updated executable is missing after payload copy" }',
    "  Write-UpdaterLog 'Application payload replaced; relaunching.'",
    '  $launched = Start-Process -FilePath $executablePath -PassThru',
    '  Start-Sleep -Seconds 2',
    '  if ($launched.HasExited) { throw "Updated application exited immediately with code $($launched.ExitCode)" }',
    '  Remove-Item -LiteralPath $backupDirectory -Recurse -Force',
    "  Write-UpdaterLog 'Update completed and application relaunched.'",
    '  exit 0',
    '}',
    'catch {',
    '  $failure = $_.Exception.Message',
    '  Write-UpdaterLog ("Update failed: $failure")',
    '  $rollbackSucceeded = $true',
    '  try {',
    '    foreach ($entry in $payloadEntries) {',
    '      $target = Join-Path $installDirectory $entry.Name',
    '      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }',
    '    }',
    '    if (Test-Path -LiteralPath $backupDirectory) {',
    '      foreach ($entry in @(Get-ChildItem -LiteralPath $backupDirectory -Force)) { Move-Item -LiteralPath $entry.FullName -Destination $installDirectory -Force }',
    '      Remove-Item -LiteralPath $backupDirectory -Recurse -Force',
    '    }',
    '  }',
    '  catch {',
    '    $rollbackSucceeded = $false',
    '    Write-UpdaterLog ("Rollback failed: $($_.Exception.Message)")',
    '  }',
    '  if ($rollbackSucceeded -and (Test-Path -LiteralPath $executablePath)) {',
    '    try { Start-Process -FilePath $executablePath | Out-Null } catch { Write-UpdaterLog ("Relaunch after rollback failed: $($_.Exception.Message)") }',
    '  }',
    '  exit 1',
    '}',
  ].join('\r\n');
}

module.exports = {
  buildInPlaceInstallScript,
  buildSquirrelInstallScript,
  isSquirrelInstall,
  quotePowerShellLiteral,
  validateStagedAppPackage,
};
