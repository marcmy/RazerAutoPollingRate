param(
    [Parameter(Mandatory = $true)]
    [string]$DevicePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('CrazyLightHidCapsNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class CrazyLightHidCapsNative
{
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

    public static int[] GetCaps(string path)
    {
        // HID descriptor/caps inspection does not require read/write access. Opening
        // with desiredAccess=0 avoids exclusive-access failures on unrelated TLCs.
        using (SafeFileHandle handle = CreateFile(
            path,
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            0,
            IntPtr.Zero))
        {
            if (handle.IsInvalid)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateFile failed for HID caps inspection");
            }

            IntPtr preparsedData = IntPtr.Zero;
            if (!HidD_GetPreparsedData(handle, out preparsedData))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "HidD_GetPreparsedData failed");
            }

            try
            {
                HIDP_CAPS caps;
                int status = HidP_GetCaps(preparsedData, out caps);
                if (status != HIDP_STATUS_SUCCESS)
                {
                    throw new InvalidOperationException(
                        String.Format("HidP_GetCaps failed with NTSTATUS 0x{0:X8}", status));
                }

                return new int[] {
                    caps.UsagePage,
                    caps.Usage,
                    caps.InputReportByteLength,
                    caps.OutputReportByteLength,
                    caps.FeatureReportByteLength
                };
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

$caps = [CrazyLightHidCapsNative]::GetCaps($DevicePath)
[pscustomobject]@{
    usagePage = $caps[0]
    usage = $caps[1]
    inputReportByteLength = $caps[2]
    outputReportByteLength = $caps[3]
    featureReportByteLength = $caps[4]
} | ConvertTo-Json -Compress
