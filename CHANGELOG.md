# Changelog

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
- Known limitation: detection is based on running processes, not the foreground window.
