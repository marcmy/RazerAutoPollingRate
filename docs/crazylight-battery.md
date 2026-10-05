# CrazyLight battery and cable status

RAPR displays an estimated battery percentage, the reported charging flag and wired/wireless
connection for the X2 CrazyLight. Only these exact identities are accepted:

| USB ID | Connection | Settings writes |
| --- | --- | --- |
| `3710:5406` | Wireless, 8K dongle | Existing validated rate/Turbo automation |
| `3710:3414` | Original wired identity | Disabled; status only |
| `3710:3524` | Wired X2 CrazyLight Medium, firmware 4.07 | Disabled; status only |

Other Pulsar IDs stay diagnostics-only. Wired detection does not imply active
charging: RAPR shows Charging only when the device reports it. A full battery or
a failed battery query does not automatically mean the mouse is disconnected.

The original `3414` wired model is limited to 1K. Pulsar's current configurator
also recognizes wired firmware types supporting 8K. The maximum wired rate for
`3524` has not been validated here, so RAPR preserves its reported rate setting
without imposing the older model's cap. Both wired IDs remain status-only.

The existing caps-driven HID selection and persistent output-report helper are
reused. Battery command `0x04` uses the usual 17-byte report `0x08` on interface
1. The reply's byte 6 is percentage and byte 7 is the charging flag. Reply
command, report size, checksum, payload length and value ranges are checked;
unsolicited reports are skipped by the existing command matcher.

The battery reply's bytes 8-9 contain voltage in big-endian millivolts, even on
firmware reporting a payload length of 2. The percentage byte can be coarse and
rise sharply while charging. RAPR interpolates Pulsar's voltage calibration
points and bounds changes using the configurator's reconnect rates (0.028
percentage points/second rising, 0.014 falling). A charge-state transition retains
the previous estimate immediately. Command `0x03` supplies the mouse address,
which identifies saved battery history across the receiver and cable rather than
mixing the histories of different mice. History is bounded to 16 entries and
expires after 30 minutes without a valid reading. Persistence failures leave the
in-memory history usable.

Charging voltage is also biased upward. On a cold start while charging without a
recent baseline, no numeric percentage is invented: the tray uses a striped
battery and the tooltip says Charging / Battery percentage unavailable. A
non-charging reading establishes the baseline. Eight consecutive firmware 100%
reports confirm full while charging, without additional rapid polling. Older
firmware without usable voltage falls back to its coarse percentage when not
charging; unavailable mouse identity prevents history sharing across transports.

This is an independent estimate, so it can differ from Bibimbap's separately
saved history and display timers. It provides one-percent estimates, not a
measurement of remaining capacity to one-percent accuracy.

Battery reads run inside the serialized polling check after rate changes, at
most once per minute. The cache is specific to the device/path and resets on
disconnect or transport change. A failed read clears the displayed percentage
and charging state, backs off until the next minute and leaves rate switching
operational. No independent HID reader is started for battery polling.

The tray retains its usual rate-only image for mice without battery support or
when a reading is unavailable. Valid CrazyLight readings use two rows: rate on
top, a green battery graphic below (red for low battery when discharging). Rate
digits are 4x9 pixels rather than 3x5. The percentage is available on hover over
the tray icon or detected mouse in Settings. The icon includes normal and 2x DPI
representations and uses a bounded image cache.

## Evidence

- [Capture-backed Nordic protocol documentation](https://github.com/packerlschupfer/pulsar-mouse-linux/blob/main/docs/protocol-x2-crazylight.md)
  describes command `0x04`, original wired ID `3414`, and the wired 1K limit.
- [Pulsar's configurator device list](https://bbb.pulsar.gg/cMouse/cfg.json)
  includes `3524` in its wired mouse IDs. Its
  [protocol implementation](https://bbb.pulsar.gg/cMouse/js/app.6842ab2c.js)
  reads the percentage and charging flag from the same report fields (WebHID
  omits the leading report ID in its data view). It also smooths percentage
  readings using its saved history and timers, so the two independently
  maintained estimates can differ.
- A read-only Windows hardware check on 2026-10-05 identified `3710:3524`,
  product `X2 CrazyLight Medium`, firmware descriptor `0x0407`, interface 1 /
  Col05, 17-byte input and output reports. The device returned **95%, charging,
  125 Hz**. No memory writes or profile changes were performed.

- A second read-only check through `3710:5406`, `8K Dongle Gen.2`, returned
  **95%, not charging, 4000 Hz** after the cable was unplugged. Interface 1 /
  Col05 again had 17-byte input/output reports. No settings were changed.

- Follow-up charging-jump diagnosis read raw **95%, charging, 4172 mV** on the
  cable and raw **95%, not charging, 4092 mV** on wireless. Command `0x03` then
  confirmed the same address `1bcbc4` on both transports; the second cable read
  returned raw **95%, charging, 4184 mV**. These raw samples validate the decoder
  and history identity, not the remaining capacity of the battery.

The new display and cable reconnect behavior in the rebuilt app still require
validation. Prior wireless polling-rate and Turbo validation remains unchanged.
This feature does not add Razer battery protocol commands.
