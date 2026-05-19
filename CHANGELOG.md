# Changelog

## v1.2.9

- Replaced the growing tray menu with a compact menu for Settings, Enabled/Disabled, Pick Window, and Exit.
- Added a combined Settings window for inactive polling rate, default game polling rate, detection mode, autostart, polling rules, and opening `config.ini` in Notepad.
- Moved settings and polling rules into a single `config.ini` file, with migration from the old `processlist.cfg` rule file.
- Added a runtime detection toggle that is always enabled on app startup.
- Added Pick Window mode: choose it from the tray, focus an app/game, press F3, and the focused process is added with the default game polling rate.
- Added a default game polling rate setting, defaulting to 1000 Hz.
- Improved autostart enablement by also updating the Windows Startup Apps approved state.

## v1.2.8

- Improved foreground-window detection for elevated or protected apps so bare process-name rules can still match when Windows does not expose the executable path.
- Documented that elevated/protected games may need bare `.exe` rules because Windows can hide the full executable path from unelevated apps.
- Simplified GitHub Actions: CI now verifies tests only, while the manual draft release workflow is the single path that builds Windows release assets, SHA256 hashes, and tags/releases.
- Updated the draft release workflow default tag to `v1.2.8-maintained`.

## v1.2.7

- Added foreground-window detection mode as the default for new installs while keeping running-process detection available from the tray menu.
- Added full executable path rules, including quoted paths with spaces.
- Added deterministic matching priority: full path rules beat bare process-name rules, and equal specificity keeps config order priority.
- Added a tray-launched GUI rule editor for adding, editing, deleting, browsing, reordering, and safely saving polling rules.
- Added tests for full-path parsing, case-insensitive path matching, specificity priority, and foreground-window selection.
- Known limitation: foreground-window detection is Windows process based and depends on Windows exposing the focused process path.

## v1.2.6-maintained

- Hardened `processlist.cfg` parsing while preserving per-process polling rates from the nchaudhury fork.
- Added support for CRLF/LF line endings, blank lines, comments, and extra whitespace.
- Added validation for polling rates: `125`, `250`, `500`, `1000`, `2000`, `4000`, and `8000`.
- Added deterministic config-order priority when multiple configured processes are running.
- Added automated `node:test` coverage for config parsing, process matching, rate selection, 8 kHz compatibility gating, and polling-check locking.
- Added GitHub Actions CI and a manual draft-release workflow for Windows x64 artifacts and SHA256 hashes.
- Updated the packaged Electron runtime and `node-abi` support while preserving native `usb` rebuild compatibility.
- Improved USB error handling and cleanup so missing, busy, unplugged, or unavailable dongles should not crash the tray app.
- Improved tray status text to show current rate, target rate, matched process, or error state.
- Real hardware smoke tested on a Razer HyperPolling Wireless Dongle (`VID_1532&PID_00B3`): read 1000 Hz, wrote the same 1000 Hz rate back, read back 1000 Hz, then released the interface and closed the USB handle.
- Known limitation: detection is based on running processes, not the foreground window.
- Known limitation: hardware smoke was a conservative USB smoke test, not extended gameplay or focused-window validation.
