const path = require('node:path');

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSquirrelInstallScript({
  parentPid,
  installerPath,
  localAppData,
  packageName,
  executableName,
}) {
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error('A valid parent process id is required');
  }
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

module.exports = {
  buildSquirrelInstallScript,
  quotePowerShellLiteral,
};
