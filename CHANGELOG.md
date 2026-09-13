# Changelog

## Unreleased

### Added

- Added Heroic Games Launcher discovery from current and legacy Legendary installed-game metadata, including games installed in custom locations on non-system drives.
- Added regression coverage confirming known game libraries are discovered on non-system drives.

## v1.3.5

### What's Changed
* Harden Electron navigation and routine CI by @marcmy in https://github.com/marcmy/RazerAutoPollingRate/pull/60
* Bump anchore/sbom-action from 0.24.0 to 0.24.2 by @dependabot[bot] in https://github.com/marcmy/RazerAutoPollingRate/pull/61
* Bump github/codeql-action/upload-sarif from 4.37.8 to 4.37.9 by @dependabot[bot] in https://github.com/marcmy/RazerAutoPollingRate/pull/62
* build(deps): bump the npm_and_yarn group across 1 directory with 2 updates by @dependabot[bot] in https://github.com/marcmy/RazerAutoPollingRate/pull/63
* feat: single instance and Synapse tray colors by @marcmy in https://github.com/marcmy/RazerAutoPollingRate/pull/64

## v1.3.4

### Fixed

- Improved automatic executable selection so crash/reporting helpers such as `crashmsg.exe` are ignored in favor of real game binaries.
- Treat launcher executables as fallback-only candidates so short-lived launchers do not beat persistent game processes such as `r5apex_dx12.exe`.
- Prefer rerelease/remastered/enhanced binaries over legacy root executables when both are present in one game install.
- Explicit executables inside an auto-detected game folder now merge into that game card and retain the parent game name instead of a build subfolder such as `rerelease`.
- Filter standalone provider launcher/client entries from automatic game discovery while keeping custom folders permissive for community clients and alternate engines.
- Added a Windows embedded-icon fallback when Electron returns the generic executable icon for a game binary.
- Updated Electron and replaced the vulnerable transitive `extract-zip` build dependency with Electron's maintained internal package without moving to a Forge prerelease.

### Added

- Added automatic game-library discovery for Steam libraries plus common Xbox, Epic, EA, GOG, Ubisoft, Riot, Rockstar, Amazon Games, itch.io, and HoYoPlay locations, with custom game folders and rescanning.
- Added automatic foreground game matching under detected library roots without generating permanent polling rules.
- Added per-game polling-rate and detection-mode overrides, including inherited defaults and running-process fallback for elevated games.
- Added editable per-game display names so manually added games and unusual folder layouts can use a friendly name without changing detection.
- Added Hide / ignore game support plus a Hidden filter for restoring ignored entries; ignored games do not activate automatic or explicit polling rules.
- Added executable icons, searchable game cards, source badges, customized indicators, and live running/polling status.

### Changed

- Rebuilt Settings into General, Games, Game Libraries, and Diagnostics views with a card grid and per-game configuration dialog.
- Made game cards denser so more titles fit in the Games view at once.
- Existing polling rules remain compatible and now appear as game overrides instead of a large editable table.
- Store custom display names and ignored-game state separately from polling rules so cosmetic/ignore changes do not create fake rate overrides.
- Moved diagnostic and advanced controls into a dedicated Diagnostics page.
- Hardened CI/release packaging by prefetching and SHA256-verifying the exact Electron Windows ZIP before handing it to Electron Packager.

## v1.3.3

### Added

- Added support for the Razer DeathAdder V4 Pro wired (`VID_1532&PID_00BE`) and wireless (`VID_1532&PID_00BF`) at up to 8000 Hz.

## v1.3.2

### Added

- Added support for the Razer Viper V3 Pro wireless (`VID_1532&PID_00C1`).
- Added support for the Razer Viper V4 Pro wired (`VID_1532&PID_00E5`) and wireless (`VID_1532&PID_00E6`).
- Added per-device USB interface selection so Viper V4 Pro polling-rate commands use interface index `0x03` while existing devices continue using `0x00`.
- Added the debug-only `polling_check_interval_ms` config value, defaulting to `1500` ms with an accepted range of `200`–`60000` ms.
- Added per-probe verbose diagnostics for comparing polling-check intervals and investigating transient dongle responses.

### Fixed

- Restored continuous dongle verification while detection is enabled so polling-rate changes from Razer Synapse are corrected promptly.
- Removed the v1.3.0 target-change gating, five-minute health checks, and exponential USB backoff that delayed recovery and weakened continuous enforcement.
- Added three immediate polling-rate query attempts within the same open USB session before reporting a check failure.
- Kept USB access fully disabled while the runtime detection toggle is off.
- Suppressed repeated identical error notifications while normal recovery checks continue.

### Contributors

- Thanks to [@jacky50403](https://github.com/jacky50403) for the hardware-tested Viper V3 Pro and Viper V4 Pro support in [PR #21](https://github.com/marcmy/RazerAutoPollingRate/pull/21).

## v1.3.1

> Superseded almost immediately by v1.3.2. These hardware-support changes are also included in the v1.3.2 notes.

- Added support for the Razer Viper V3 Pro wireless (`VID_1532&PID_00C1`).
- Added support for the Razer Viper V4 Pro wired (`VID_1532&PID_00E5`) and wireless (`VID_1532&PID_00E6`).
- Added per-device USB interface selection so Viper V4 Pro polling-rate commands use interface index `0x03` while existing devices continue using `0x00`.
- Thanks to [@jacky50403](https://github.com/jacky50403) for the hardware-tested contribution in PR #21.

## v1.3.0

### Added

- Added support for the Razer DeathAdder V3 Pro wired (`VID_1532&PID_00B4`) and wireless (`VID_1532&PID_00B5`) at up to 8000 Hz.
- Added support for the Razer Viper V2 Pro wired (`VID_1532&PID_00A5`) and wireless (`VID_1532&PID_00A6`) at up to 8000 Hz.
- Added support for the Razer Viper V3 HyperSpeed wireless (`VID_1532&PID_00B7`) at up to 4000 Hz.
- Added support for the Razer DeathAdder V3 HyperSpeed wireless (`VID_1532&PID_00C2`) at up to 8000 Hz.
- Added native 125 Hz and 250 Hz polling-rate support in addition to the existing 500/1000/2000/4000/8000 Hz rates.
- Added automatic device capability filtering so each mouse only exposes polling rates it actually supports.
- Added foreground-window detection as the default mode, so polling rate only increases while a configured game is focused.
- Kept running-process detection available as an optional legacy mode.
- Added full executable path rules with quoted config syntax, so games sharing the same `.exe` name can be distinguished safely.
- Added a tray-menu flow for picking the current foreground application and adding it directly to `config.ini`.
- Added a `Configuration...` shortcut that opens `config.ini` in the default editor.
- Added tray status text for current polling rate, target polling rate, matched process and the latest error.
- Added global hotkeys: `Ctrl+Shift+F6` toggles detection and `Ctrl+Shift+F7` opens `config.ini`.
- Added continuous polling-rate verification with target-change checks, periodic health checks and read-after-write confirmation.
- Added retry and exponential-backoff behavior for transient USB communication failures.
- Added diagnostic logging with process start/stop tracking, foreground-window transitions, polling target changes and errors.
- Added optional verbose diagnostic logging for per-check probe events.
- Added automatic cleanup for old diagnostic logs.
- Added self-healing `config.ini` creation so malformed or missing configuration can be regenerated.

### Changed

- Reworked polling-rate selection to use pure matching logic with explicit inactive fallback behavior.
- Replaced per-loop process spawning with a persistent foreground watcher plus cached process details for lower overhead.
- Added an overlap guard so polling checks cannot run concurrently.
- Centralized device VID/PID metadata and polling-rate capabilities.
- Moved hardware report-byte mapping into a dedicated module and added round-trip validation.
- Refactored configuration parsing/serialization and diagnostic logging into testable modules.
- Added automated tests for config parsing, process matching, polling-rate resolution, device capability filtering and retry behavior.
- Added CI syntax checks and Node test execution.

### Fixed

- Fixed elevated/protected app matching when Windows hides the executable path by safely falling back to a unique process-name match.
- Preserved exact full-path matching when executable paths are available.
- Prevented invalid polling rates from reaching the USB report-byte writer.
- Improved handling of temporary foreground-process lookup failures with a short cache grace period.

## v1.2.8

### Added

- Added fallback matching by process name for elevated/protected apps when Windows does not expose their executable path.
- Added config.ini parsing tests for full executable paths, comments, CRLF/LF line endings, invalid rates and optional per-game detection overrides.
- Added polling target tests for foreground/running modes, path-vs-name precedence, inherited game rates and device rate capability checks.

### Changed

- Added foreground-process lookup fallback through `tasklist` when the primary process query cannot return a name.
- Added a persistent foreground watcher command and process-detail cache to reduce process-spawn overhead during polling checks.
- Added immediate retry logic for polling-rate reads before surfacing transient USB errors.
- Added diagnostic logger support for process-specific log files and automatic pruning.

### Fixed

- Fixed path-based foreground rules failing when Windows hides protected/elevated executable paths.
- Prevented duplicate process entries from changing rule precedence.
- Prevented polling check overlap from issuing concurrent USB operations.

## v1.2.7

- Added tray status text and global shortcuts.
- Added device-rate filtering and 125/250 Hz support.
- Added foreground-window detection and full-path rules.

## v1.2.6

- Added initial automatic device capability filtering.

## v1.2.5

- Added retry/backoff handling for USB polling-rate checks.

## v1.2.4

- Added diagnostic logging and config self-healing.

## v1.2.3

- Added full executable-path process matching.

## v1.2.2

- Added process-selection precedence tests.

## v1.2.1

- Added foreground process detection.

## v1.2.0

- Added automatic polling-rate switching based on configured game processes.

## v1.1.0

- Added configuration support for game-specific polling rates.

## v1.0.0

- Initial maintained release.
