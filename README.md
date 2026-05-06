# Razer Auto Polling Rate

A Windows tray app for automatically switching a Razer HyperPolling dongle's polling rate based on the app or game you are using.

This maintained fork adds foreground-window switching, full executable path rules, a tray GUI rule editor, safer config parsing, tests, CI, and Windows release packaging.

Original project credit is preserved for Philip B and the upstream fork by Neil C / nchaudhury.

## Download

Get the latest Windows build from the Releases page:

- [v1.2.7-maintained](https://github.com/marcmy/RazerAutoPollingRate/releases/tag/v1.2.7-maintained)

The Windows build is unsigned, so SmartScreen may warn on first run.

## What It Does

Razer Synapse can switch polling rates by app profile, but profiles can sometimes get stuck at high polling rates after a game closes or loses focus. This app gives you a small tray-based controller that can automatically move the dongle between a low inactive rate and higher per-game rates.

Default behavior for new installs:

- **Detection mode:** Foreground window
- **Inactive polling rate:** 500 Hz, unless the app can safely adopt the dongle's current 500 Hz or 1000 Hz rate on first launch
- **Rule editing:** Tray menu GUI, no manual text editing required

Razer Synapse does **not** need to be running. Synapse may show stale polling-rate information while this app controls the dongle.

The app does not include telemetry, analytics, auto-update networking, or remote calls.

## Supported Hardware

This app is intended for Razer HyperPolling dongle-style devices supported by the included USB report logic. It has been tested with a Razer HyperPolling Wireless Dongle.

Other brands are not supported.

## Tray Menu

Right-click or click the tray icon to access:

- **Inactive polling rate** — choose the fallback polling rate used when no rule matches
- **Detection mode**
  - **Foreground window** — default; only the focused app/game can match
  - **Running processes** — legacy behavior; any running configured process can match
- **Edit polling rules** — open the GUI rule editor
- **Open config folder** — open the backend config location
- **Autostart** — launch app at Windows login
- **Quit** — exit the tray app

The tray tooltip shows the current rate, target rate, detection mode, and matched rule/process.

## Polling Rules

Use **Edit polling rules** from the tray menu to add, edit, delete, reorder, browse for `.exe` files, choose polling rates, and save the rule list.

The config file remains the backend storage, but normal use does not require opening it manually:

```text
%APPDATA%\RazerAutoPollingRate\cfg\processlist.cfg
```

Rules can match either a bare executable name or a quoted full executable path.

Bare process-name rule:

```text
process.exe pollingRate
```

Full-path rule:

```text
"C:\Program Files (x86)\Steam\steamapps\common\Apex Legends\r5apex_dx12.exe" pollingRate
```

Valid polling rates:

```text
125 250 500 1000 2000 4000 8000
```

Example:

```text
# Generic Apex DX12 rule
r5apex_dx12.exe 2000

# Specific Steam Apex DX12 install path wins over the generic rule
"C:\Program Files (x86)\Steam\steamapps\common\Apex Legends\r5apex_dx12.exe" 4000

# Quake Live
quake_live_x64.exe 1000
```

Matching rules:

- Full executable path matches beat bare process-name matches.
- When rules have the same specificity, config order wins.
- Windows path matching is case-insensitive.
- Paths with spaces must be quoted.
- Invalid entries are ignored and logged instead of crashing the app.

## Detection Modes

### Foreground Window

This is the default for new installs. The app checks the currently focused window, resolves the owning process, and matches that process against your rules.

When the focused app does not match any rule, the app switches to the inactive polling rate.

This behaves closer to Synapse app-profile switching and avoids keeping the mouse at a high polling rate just because a game is still running in the background.

### Running Processes

This keeps the older behavior. If any configured process is running, it can match even if it is minimized or unfocused.

Use this only when you specifically want background-running processes to hold their configured polling rate.

## Notes And Limitations

- Foreground-window detection depends on Windows exposing the focused process path.
- Some elevated or protected apps may only be matchable by bare process name.
- Razer Synapse may display stale polling-rate values while this app controls the dongle.
- If Synapse also tries to change polling rate, the two apps may fight over the setting.
- If 8000 Hz is requested on unsupported hardware, the app falls back to 4000 Hz and logs/shows a warning.
- The app currently checks for changes every 1500 ms, so switching is not instant but should feel responsive.

## Troubleshooting

### Dongle not found

Make sure the Razer HyperPolling Wireless Dongle is connected and not blocked by another process. The tray tooltip should show an error instead of crashing the app.

### Synapse shows the wrong rate

This can be stale Synapse UI state. Use the app tray tooltip or an external polling-rate tester to confirm the real active rate.

### Synapse fights with the app

Close Razer Synapse or stop changing polling rate in Synapse while this app is running.

### App stuck or error tray icon

Check the tray tooltip and the app log:

```text
%APPDATA%\RazerAutoPollingRate\error.log
```

Invalid config entries, dongle access failures, and USB cleanup warnings are logged there.

## Development

```powershell
npm ci
npm test
npm run package
npm run make
```

The project includes Node test coverage for config parsing, process/path matching, foreground-process lookup behavior, rate mapping, 8 kHz compatibility fallback, and polling-check overlap protection.

## Manual Hardware Test Checklist

Automated tests mock parsing, matching, rate-selection, and compatibility logic. Real dongle behavior still needs manual hardware verification:

- Start the app with the dongle unplugged and confirm it stays running with a useful tray error.
- Plug in a supported dongle and confirm the tray shows current and target polling rate.
- Add a foreground-window rule for a game and confirm focusing the game switches to the configured rate.
- Alt-tab away and confirm the app returns to the inactive polling rate.
- Add both a bare process rule and a full-path rule and confirm the full-path rule wins.
- Save rules in the GUI and confirm the editor closes without exiting the tray app.
- Add an invalid config line and confirm it is ignored and logged.
- Request 8000 Hz on unsupported hardware, if available, and confirm it falls back safely.
- Run with Razer Synapse open and confirm any conflict is understandable from tray/log status.

## License

ISC. See `package.json` for project metadata.
