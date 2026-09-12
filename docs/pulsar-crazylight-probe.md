# Pulsar X2 CrazyLight read-only probe

This branch contains an experimental **read-only** probe for the Pulsar X2 CrazyLight wireless mouse.

## Safety boundary

The probe can identify the validated CrazyLight USB identity and read:

- active onboard profile
- polling-rate byte at memory address `0x0000`

It **cannot** write polling rate, switch profiles, change DPI, or modify any other mouse setting. Unknown Pulsar devices (VID `0x3710` with a PID other than `0x5406`) are logged only; no protocol command is sent to them.

## Known protocol identity

- VID:PID: `3710:5406`
- interface: `1`
- IN endpoint: `0x82`
- HID report ID: `0x08`
- report size: `17` bytes
- host SET_REPORT: request `0x09`, value `0x0208`, interface index `1`

Polling values:

| Byte | Rate |
| --- | ---: |
| `0x08` | 125 Hz |
| `0x04` | 250 Hz |
| `0x02` | 500 Hz |
| `0x01` | 1000 Hz |
| `0x10` | 2000 Hz |
| `0x20` | 4000 Hz |
| `0x40` | 8000 Hz |

## Automatic startup probe

Launching RazerAutoPollingRate on this branch runs the CrazyLight probe once after Electron is ready. Results are appended to:

`pulsar-probe.log`

inside Electron's normal `userData` directory.

The existing Razer automatic polling loop is unchanged. Until write support is explicitly enabled in a later hardware-validated change, the CrazyLight probe is diagnostic only.

## Manual probe

From the repository directory:

```powershell
npm run probe:pulsar
```

Possible outcomes include:

```text
[Pulsar probe] No Pulsar USB device (VID 0x3710) detected.
```

```text
[Pulsar probe] USB 3710:xxxx detected but unsupported; no protocol commands sent.
```

or, for the validated identity:

```text
[Pulsar probe] Known X2 CrazyLight 3710:5406 detected; starting read-only probe.
[Pulsar probe] Pulsar X2 CrazyLight profile 1; 1000 Hz; read-only (writes disabled).
```

If Windows exposes the device but refuses WebUSB access to interface 1, the probe logs the exact interface/open/claim error. That result is still useful: it tells us to switch the Windows transport to HIDAPI/WebHID without guessing at the CrazyLight protocol.

## Hardware validation when the mouse arrives

1. Plug in the included CrazyLight 8K dongle and mouse.
2. Run `npm run probe:pulsar` and record the reported VID/PID.
3. If the identity is `3710:5406`, set 1000 Hz in Pulsar software/Bibimbap and verify the probe reports 1000 Hz.
4. Repeat at 4000 Hz and 8000 Hz.
5. Verify the reported active profile follows the selected onboard profile.
6. If all reads match, the next change may add a reversible polling-rate write with immediate readback verification.
7. Before automatic switching is enabled, validate a manual `1000 -> 8000 -> 1000` cycle and confirm all other profile settings remain untouched.
