# Changelog

## v1.3.0

- Decoupled the 1500 ms process-detection loop from physical dongle access so responsive app switching no longer requires opening and querying the dongle every cycle.
- Reused one WebUSB context and limited dongle access to startup, polling-target changes, retries after failures, and a five-minute health check.
- Changed the runtime Disabled mode to perform no dongle USB access until detection is enabled again.
- Added exponential retry backoff after USB access or polling-rate application failures.
- Added verbose diagnostic events explaining why each dongle access was performed or skipped.
- Added automated coverage for target-change gating, disabled-mode behavior, health checks, and retry backoff.

## v1.2.13

- Added optional diagnostic logging, controlled from Settings and disabled by default.
- Added an indented verbose diagnostic logging checkbox for lower-level process-scan and polling-loop events.
- Diagnostic logs start only while a configured executable is running, using running-process detection even when foreground-window mode is active.
- Logs capture detection selections, polling status, polling-rate change requests/results, and errors with timestamps.
- Diagnostic log files are named `MM-DD-YYYY-Program.txt`, stored under `%APPDATA%\RazerAutoPollingRate\diagnostic-logs`, and pruned to the latest 10 files.
- Changed Autostart to a checkbox and shortened the Settings dropdown widths for polling rates and detection mode.

## v1.2.12

- Added a short foreground-process miss grace period so transient empty foreground lookups do not immediately drop the mouse to the inactive polling rate while in-game.
- Kept the last known foreground process only briefly during lookup misses, then clears it after a sustained miss or replaces it immediately when a new foreground process is detected.

## v1.2.11

- Reduced foreground-mode idle CPU work by polling the foreground watcher every 1000 ms instead of 500 ms.
- Cached foreground process details by PID so WMI/tasklist process detail lookups only run when the focused process changes.

## v1.2.10

- Changed foreground-window detection to use one cached hidden watcher while foreground mode is active instead of launching a new PowerShell lookup every polling interval.
- Stopped the foreground watcher when detection is disabled, running-process mode is selected, or the app exits.
- Kept Pick Window on a one-shot foreground lookup so pressing F3 still captures the current focused process immediately.

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
- Added deterministic matching priority: full path rules beat bare process-name matches, and equal specificity keeps config order priority.
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
