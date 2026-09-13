param(
    [Parameter(Mandatory = $true)]
    [string]$DevicePath,

    [Parameter(Mandatory = $true)]
    [string]$ReportHex
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (($ReportHex.Length % 2) -ne 0 -or $ReportHex -notmatch '^[0-9a-fA-F]+$') {
    throw 'ReportHex must contain an even number of hexadecimal characters.'
}

if (-not ('CrazyLightHidNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class CrazyLightHidNative
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool HidD_SetOutputReport(
        SafeFileHandle HidDeviceObject,
        byte[] lpReportBuffer,
        uint ReportBufferLength);

    public static void SendOutputReport(string path, byte[] report)
    {
        using (SafeFileHandle handle = CreateFile(
            path,
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            0,
            IntPtr.Zero))
        {
            if (handle.IsInvalid)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateFile failed for HID device");
            }

            if (!HidD_SetOutputReport(handle, report, (uint)report.Length))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "HidD_SetOutputReport failed");
            }
        }
    }
}
'@
}

$report = New-Object byte[] ($ReportHex.Length / 2)
for ($index = 0; $index -lt $report.Length; $index++) {
    $report[$index] = [Convert]::ToByte($ReportHex.Substring($index * 2, 2), 16)
}

[CrazyLightHidNative]::SendOutputReport($DevicePath, $report)
