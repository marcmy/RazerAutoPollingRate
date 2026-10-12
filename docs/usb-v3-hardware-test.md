# USB v3 test build

The migration uses `usb.getDevices()` for asynchronous enumeration and keeps
the current selection rules and hardware transports. Windows CrazyLight
communication continues through the existing HID bridge. Razer devices using
Windows' HID driver send the same feature reports through node-hid; devices
bound to WinUSB retain WebUSB. USB enumeration returns only vendor/product IDs,
without invoking native getters that open devices. No USB v2 fallback is shipped.

## Run the portable build

Download the `RazerAutoPollingRate-Windows-portable-<commit>` artifact from the
PR's successful CI run. Exit the installed app from its tray menu, extract the
ZIP completely, and run `razerautopollingrate.exe` in the extracted directory.
It uses the existing saved settings. Run only one copy at a time.

## Pulsar X2 CrazyLight checks

1. Wireless: verify the receiver and active mouse are recognized; read the
   profile, polling rate, battery and Turbo status. Confirm no `listDevices`
   or native-module load error appears.
2. Exercise an existing game rule, then return to the desktop. Verify the
   polling rate changes and reads back correctly, and Turbo behaves as before.
   Record the starting rate and restore it after testing.
3. Disconnect and reconnect the receiver. Confirm background checks recover
   and the tray reflects the mouse again after movement.
4. Sleep and wake the mouse and the PC. Confirm detection and automation resume.
5. Wired: confirm the wired mouse takes priority over its attached receiver;
   its reported rate and battery remain visible, with the existing read-only
   behavior. Unplug the cable and confirm wireless selection resumes.

If a Razer mouse is available, also check its discovery, rate readback, rate
changes, reconnect and sleep/wake. CI cannot validate physical USB transfers.

To return to the stable build, exit the portable copy and start the installed
app again. Report the tested commit, connection mode and diagnostic log if any
check fails. Keep the PR unmerged until hardware testing succeeds.
