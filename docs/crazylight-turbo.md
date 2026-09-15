# CrazyLight per-game Turbo Mode (hardware validation pending)

Settings shows the mouse selected by the polling backend. Razer retains priority when
both vendors are connected. Only the supported wireless X2 CrazyLight (3710:5406)
can expose Turbo Mode, and only after a valid read of its Turbo register. Unknown
Pulsar PIDs receive no protocol traffic.

Edit a game and enable **Turbo Mode for this game**. The existing game rule's detection
mode applies: foreground mode turns Turbo off on Alt-Tab to Windows; running mode
keeps it on until the game exits. Games without the option enabled use Turbo off.
Automation starts only when at least one rule opts in; an untouched installation
does not change the mouse's existing Turbo setting. Removing the last override,
pausing detection, or exiting through the tray requests Turbo off for the current
profile. The app must be running for game transitions to be applied. An abrupt
termination or device disconnect can prevent cleanup.

Changes use the active onboard profile without switching profiles. Profile drift
aborts the operation. Writes are made only on state changes and verified by readback;
Turbo errors hide the control and appear on the mouse status tooltip, while the
polling-rate loop continues. Existing rules are preserved when edited with a Razer
connected. The INI rule suffix `turbo=on` stores the per-game opt-in.

## Protocol evidence and firmware boundary

- Pulsar's public driver: https://bbb.pulsar.gg/cMouse/js/app.7df3eacb.js
  `PerformanceState` is address 181 (0xB5). The Turbo switch invokes
  `Set_MS_PerformanceState` with 0 or 1. The value is stored with its 0x55 complement.
- Capture documentation: https://github.com/packerlschupfer/pulsar-mouse-linux/blob/main/docs/protocol-x2-crazylight.md
- Pulsar support: https://support.pulsar.gg/hc/en-us/articles/58405241149209-What-is-Turbo-Mode
- Software history: https://www.pulsar.gg/pages/download

The software changelog's 1.15 is not a verified minimum mouse firmware version.
No firmware-version cutoff was established. The compatibility read requires an
exact 0/1 value and valid stored complement, but cannot prove that old firmware
implements the sensor behavior. Do not describe this as firmware certification.
Keep the PR draft pending physical verification with the intended firmware.

## Hardware test

1. Close Bibimbap before running the test app (avoid competing HID access).
2. In General, confirm the detected mouse name; edit a game to find the Turbo option.
3. Enable it with foreground detection. Check Windows -> game -> Windows gives
   Turbo off -> on -> off, alongside the configured polling rates.
4. Repeat with running detection: Alt-Tab should retain Turbo, game exit should disable it.
5. Verify the value in Pulsar software between app test sessions, and record the mouse
   and dongle firmware versions. Confirm the active onboard profile is unchanged.
6. Check pause, last-override removal, reconnect, and tray exit cleanup.
7. With only a Razer selected, Turbo controls must be absent. With an unsupported
   firmware response, the control must be absent and polling must continue.
