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
    private const int HIDP_STATUS_SUCCESS = 0x00110000;

    [StructLayout(LayoutKind.Sequential)]
    private struct HIDP_CAPS
    {
        public ushort Usage;
        public ushort UsagePage;
        public ushort InputReportByteLength;
        public ushort OutputReportByteLength;
        public ushort FeatureReportByteLength;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
        public ushort[] Reserved;

        public ushort NumberLinkCollectionNodes;
        public ushort NumberInputButtonCaps;
        public ushort NumberInputValueCaps;
        public ushort NumberInputDataIndices;
        public ushort NumberOutputButtonCaps;
        public ushort NumberOutputValueCaps;
        public ushort NumberOutputDataIndices;
        public ushort NumberFeatureButtonCaps;
        public ushort NumberFeatureValueCaps;
        public ushort NumberFeatureDataIndices;
    }

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
    private static extern bool HidD_GetPreparsedData(
        SafeFileHandle HidDeviceObject,
        out IntPtr PreparsedData);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool HidD_FreePreparsedData(IntPtr PreparsedData);

    [DllImport("hid.dll")]
    private static extern int HidP_GetCaps(
        IntPtr PreparsedData,
        out HIDP_CAPS Capabilities);

    [DllImport("hid.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool HidD_SetOutputReport(
        SafeFileHandle HidDeviceObject,
        byte[] lpReportBuffer,
        uint ReportBufferLength);

    private static string DescribeCaps(HIDP_CAPS caps, int originalLength, int sentLength)
    {
        return String.Format(
            "UsagePage=0x{0:X4}; Usage=0x{1:X4}; InputReportByteLength={2}; OutputReportByteLength={3}; FeatureReportByteLength={4}; OriginalReportLength={5}; SentReportLength={6}",
            caps.UsagePage,
            caps.Usage,
            caps.InputReportByteLength,
            caps.OutputReportByteLength,
            caps.FeatureReportByteLength,
            originalLength,
            sentLength);
    }

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

            IntPtr preparsedData = IntPtr.Zero;
            if (!HidD_GetPreparsedData(handle, out preparsedData))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "HidD_GetPreparsedData failed");
            }

            try
            {
                HIDP_CAPS caps;
                int capsStatus = HidP_GetCaps(preparsedData, out caps);
                if (capsStatus != HIDP_STATUS_SUCCESS)
                {
                    throw new InvalidOperationException(
                        String.Format("HidP_GetCaps failed with NTSTATUS 0x{0:X8}", capsStatus));
                }

                if (caps.OutputReportByteLength == 0)
                {
                    throw new InvalidOperationException(
                        "Selected HID collection exposes no output reports (" +
                        DescribeCaps(caps, report.Length, 0) + ")");
                }

                // Windows requires ReportBufferLength to be at least the collection's
                // OutputReportByteLength. This mirrors hidapi's hid_send_output_report
                // behavior: preserve the report ID/data and zero-pad short reports.
                int sendLength = Math.Max(report.Length, (int)caps.OutputReportByteLength);
                byte[] sendBuffer = new byte[sendLength];
                Array.Copy(report, sendBuffer, report.Length);

                if (!HidD_SetOutputReport(handle, sendBuffer, (uint)sendBuffer.Length))
                {
                    int win32Error = Marshal.GetLastWin32Error();
                    string details = DescribeCaps(caps, report.Length, sendBuffer.Length);
                    throw new Win32Exception(
                        win32Error,
                        String.Format(
                            "HidD_SetOutputReport failed (Win32Error={0}; {1})",
                            win32Error,
                            details));
                }
            }
            finally
            {
                if (preparsedData != IntPtr.Zero)
                {
                    HidD_FreePreparsedData(preparsedData);
                }
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
