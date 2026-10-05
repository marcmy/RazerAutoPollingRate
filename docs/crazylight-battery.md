# CrazyLight battery and cable status

RAPR displays the mouse-reported percentage, charging flag and wired/wireless
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

Battery reads run inside the serialized polling check after rate changes, at
most once per minute. The cache is specific to the device/path and resets on
disconnect or transport change. A failed read clears the displayed percentage
and charging state, backs off until the next minute and leaves rate switching
operational. No independent HID reader is started for battery polling.

The tray retains its usual rate-only image for mice without battery support or
when a reading is unavailable. Valid CrazyLight readings use two rows: rate on
top, percentage below. The icon includes normal and 2x DPI representations and
uses a bounded image cache. Settings exposes the same power information.

## Evidence

- [Capture-backed Nordic protocol documentation](https://github.com/packerlschupfer/pulsar-mouse-linux/blob/main/docs/protocol-x2-crazylight.md)
  describes command `0x04`, original wired ID `3414`, and the wired 1K limit.
- [Pulsar's configurator device list](https://bbb.pulsar.gg/cMouse/cfg.json)
  includes `3524` in its wired mouse IDs. Its
  [protocol implementation](https://bbb.pulsar.gg/cMouse/js/app.6842ab2c.js)
  reads the percentage and charging flag from the same report fields (WebHID
  omits the leading report ID in its data view). It also smooths percentage
  readings, so its displayed percentage may differ from the raw device value
  shown by RAPR.
- A read-only Windows hardware check on 2026-10-05 identified `3710:3524`,
  product `X2 CrazyLight Medium`, firmware descriptor `0x0407`, interface 1 /
  Col05, 17-byte input and output reports. The device returned **95%, charging,
  125 Hz**. No memory writes or profile changes were performed.

- A second read-only check through `3710:5406`, `8K Dongle Gen.2`, returned
  **95%, not charging, 4000 Hz** after the cable was unplugged. Interface 1 /
  Col05 again had 17-byte input/output reports. No settings were changed.

The new display and cable reconnect behavior in the rebuilt app still require
validation. Prior wireless polling-rate and Turbo validation remains unchanged.
This feature does not add Razer battery protocol commands.
