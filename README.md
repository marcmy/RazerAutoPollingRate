# Automatic Razer HyperPolling Dongle Polling Rate Changer

Maintained fork of `RazerAutoPollingRate` with safer per-process polling-rate configuration, automated tests, CI, and Windows release packaging.

Original project credit is preserved for Philip B and the upstream fork by Neil C / nchaudhury. This fork keeps the nchaudhury per-process polling-rate behavior: each configured executable can request its own polling rate while it is running.

## Behavior

The app runs in the Windows tray and checks the configured process list. If one or more configured processes are running, the first matching entry in `processlist.cfg` wins. When no configured process is running, the app targets the inactive polling rate selected from the tray menu.

Foreground-window detection is the default for new installs. Running-process detection remains available from the tray menu. In foreground mode, the app only matches the currently focused process and switches to the inactive polling rate when the focused process does not match a configured rule.

Rules can match either a bare executable name or a full executable path. Full path matches beat bare process-name matches. When rules have the same specificity, config order remains the priority. Windows path matching is case-insensitive.

Razer Synapse does not need to be running. Synapse may display stale polling-rate information while this app is controlling the dongle. If Synapse is running and also tries to control polling rate, the two apps may fight over the current setting.

The app does not include telemetry, analytics, auto-update networking, or remote calls.

## Process Config

Use `Edit polling rules` from the tray menu to add, edit, delete, reorder, browse for `.exe` files, choose polling rates, and save the rule list. The config file remains the backend storage, but normal use does not require opening it manually.

The config file is:

```text
%APPDATA%\RazerAutoPollingRate\cfg\processlist.cfg
```

Each non-comment entry uses either a bare process name:

```text
process.exe pollingRate
```

or a quoted full path:

```text
"C:\Program Files (x86)\Steam\steamapps\common\Apex Legends\r5apex_dx12.exe" pollingRate
```

Valid polling rates are:

```text
125 250 500 1000 2000 4000 8000
```

Example config:

```text
# Apex Legends
r5apex.exe 1000
r5apex_dx12.exe 4000
"C:\Program Files (x86)\Steam\steamapps\common\Apex Legends\r5apex_dx12.exe" 4000

# Counter-Strike
cs2.exe 4000

# Arc Raiders
"C:\Program Files (x86)\Steam\steamapps\common\Arc Raiders\PioneerGame.exe" 1000
```

Blank lines are allowed. Comments beginning with `#` are allowed. Extra spaces and tabs are allowed. Full paths containing spaces must be quoted. Invalid entries are ignored and logged instead of silently becoming `undefined` or falling back to 500 Hz.

If 8000 Hz is requested on unsupported hardware, the app falls back to 4000 Hz and logs/shows a warning.

## Install And Development

Install from a release build, then launch the tray app.

For development:

```powershell
npm ci
npm test
npm run package
npm run make
```

## Troubleshooting

Dongle not found:
Make sure the Razer HyperPolling Wireless Dongle is connected and not blocked by another process. The tray tooltip should show an error instead of crashing the app.

Synapse fighting with the app:
Close Razer Synapse or stop changing polling rate in Synapse while this app is running. Synapse does not need to be running for this app to work.

8000 Hz unsupported:
Some dongle/mouse combinations or drivers may not support 8000 Hz. The app will not blindly write 8000 Hz when the detected device is not compatible; it falls back to 4000 Hz.

App stuck or error tray icon:
Check the tray tooltip and the app log at:

```text
%APPDATA%\RazerAutoPollingRate\error.log
```

Invalid config entries, dongle access failures, and USB cleanup warnings are logged there.

## Manual Hardware Test Checklist

Automated tests mock the parsing, matching, rate-selection, and compatibility logic. Real Razer dongle behavior still needs manual hardware verification:

- Start the app with the dongle unplugged and confirm it stays running with a useful tray error.
- Plug in a supported dongle and confirm the tray shows current and target polling rate.
- Configure `processlist.cfg` with a known running process and confirm the app switches to that process polling rate.
- Close the configured process and confirm the app returns to the inactive polling rate.
- Add an invalid config line and confirm it is ignored and logged.
- Request 8000 Hz on unsupported hardware, if available, and confirm it falls back safely.
- Run with Razer Synapse open and confirm any conflict is understandable from tray/log status.
- Enable foreground mode and confirm a configured game only matches while its window is focused, then returns to the inactive polling rate when another app is focused.

## License

ISC. See `package.json` for project metadata.
