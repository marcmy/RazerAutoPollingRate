param(
    [switch]$CompileOnly
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public sealed class RaprRawMouseWindow : NativeWindow, IDisposable
{
    private const int WM_INPUT = 0x00FF;
    private const uint RID_INPUT = 0x10000003;
    private const uint RIDI_DEVICENAME = 0x20000007;
    private const uint RIDEV_INPUTSINK = 0x00000100;
    private const uint RIM_TYPEMOUSE = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public uint dwFlags;
        public IntPtr hwndTarget;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTHEADER
    {
        public uint dwType;
        public uint dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(
        [In] RAWINPUTDEVICE[] pRawInputDevices,
        uint uiNumDevices,
        uint cbSize
    );

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(
        IntPtr hRawInput,
        uint uiCommand,
        IntPtr pData,
        ref uint pcbSize,
        uint cbSizeHeader
    );

    [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetRawInputDeviceInfoSize(
        IntPtr hDevice,
        uint uiCommand,
        IntPtr pData,
        ref uint pcbSize
    );

    [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetRawInputDeviceInfoName(
        IntPtr hDevice,
        uint uiCommand,
        StringBuilder pData,
        ref uint pcbSize
    );

    private string lastDeviceName;

    public RaprRawMouseWindow()
    {
        CreateParams parameters = new CreateParams();
        parameters.Caption = "RAPR Raw Mouse Input";
        parameters.X = 0;
        parameters.Y = 0;
        parameters.Width = 0;
        parameters.Height = 0;
        parameters.Style = 0;
        CreateHandle(parameters);

        RAWINPUTDEVICE[] devices = new RAWINPUTDEVICE[1];
        devices[0].usUsagePage = 0x01;
        devices[0].usUsage = 0x02;
        devices[0].dwFlags = RIDEV_INPUTSINK;
        devices[0].hwndTarget = Handle;

        if (!RegisterRawInputDevices(
            devices,
            (uint)devices.Length,
            (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "RegisterRawInputDevices failed");
        }
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WM_INPUT)
        {
            ProcessRawInput(message.LParam);
        }
        base.WndProc(ref message);
    }

    private void ProcessRawInput(IntPtr rawInputHandle)
    {
        uint headerSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
        uint size = 0;
        uint queryResult = GetRawInputData(rawInputHandle, RID_INPUT, IntPtr.Zero, ref size, headerSize);
        if (queryResult == UInt32.MaxValue || size < headerSize)
        {
            return;
        }

        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            uint readSize = size;
            uint bytesRead = GetRawInputData(rawInputHandle, RID_INPUT, buffer, ref readSize, headerSize);
            if (bytesRead == UInt32.MaxValue || bytesRead < headerSize)
            {
                return;
            }

            RAWINPUTHEADER header = (RAWINPUTHEADER)Marshal.PtrToStructure(buffer, typeof(RAWINPUTHEADER));
            if (header.dwType != RIM_TYPEMOUSE || header.hDevice == IntPtr.Zero)
            {
                return;
            }

            string deviceName = GetDeviceName(header.hDevice);
            if (String.IsNullOrWhiteSpace(deviceName))
            {
                return;
            }

            if (!String.Equals(lastDeviceName, deviceName, StringComparison.OrdinalIgnoreCase))
            {
                lastDeviceName = deviceName;
                Console.WriteLine("MOUSE\t" + deviceName);
                Console.Out.Flush();
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string GetDeviceName(IntPtr deviceHandle)
    {
        uint characterCount = 0;
        uint first = GetRawInputDeviceInfoSize(deviceHandle, RIDI_DEVICENAME, IntPtr.Zero, ref characterCount);
        if (first == UInt32.MaxValue || characterCount == 0)
        {
            return null;
        }

        StringBuilder builder = new StringBuilder((int)characterCount + 1);
        uint capacity = (uint)builder.Capacity;
        uint second = GetRawInputDeviceInfoName(deviceHandle, RIDI_DEVICENAME, builder, ref capacity);
        if (second == UInt32.MaxValue)
        {
            return null;
        }

        return builder.ToString();
    }

    public void Dispose()
    {
        if (Handle != IntPtr.Zero)
        {
            DestroyHandle();
        }
    }
}

public static class RaprRawMouseMonitor
{
    public static void Run()
    {
        using (RaprRawMouseWindow window = new RaprRawMouseWindow())
        {
            Console.WriteLine("READY");
            Console.Out.Flush();
            Application.Run();
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.dll', 'System.Windows.Forms.dll') -Language CSharp

if ($CompileOnly) {
    Write-Output 'COMPILED'
    exit 0
}

[RaprRawMouseMonitor]::Run()
