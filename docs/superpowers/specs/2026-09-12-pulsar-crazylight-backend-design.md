# Pulsar X2 CrazyLight backend design

## Goal

Prepare RazerAutoPollingRate for safe support of the Pulsar X2 CrazyLight before the user's mouse arrives, without changing the behavior of existing Razer devices and without allowing Pulsar writes until the new hardware is validated locally.

## Scope

This change introduces a small mouse-backend abstraction, preserves the existing Razer transport and polling logic, and adds a read-only Pulsar X2 CrazyLight backend/probe. The Pulsar backend will detect known CrazyLight hardware, read the active profile and its stored polling rate, expose device identity and probe diagnostics, and explicitly refuse polling-rate writes.

Out of scope for this phase: enabling automatic Pulsar polling-rate changes, editing Pulsar profiles, changing DPI/LOD/debounce/LED/button settings, rebranding the application, and attempting support for arbitrary Pulsar models.

## Architecture

The current process/game-selection logic remains vendor-agnostic. It continues to compute a requested target polling rate exactly as it does today. USB/device-specific operations move behind a minimal backend contract.

Each backend exposes equivalent lifecycle and polling operations:

- `id` / `name`
- device discovery/matching
- `open()` / preparation
- `getPollingRate()`
- `setPollingRate()` when supported
- `close()` / cleanup
- capability metadata such as `canWrite`, supported polling rates, vendor/model, VID/PID, interface, and transport details

The Razer backend is an extraction of the existing `main.js` behavior rather than a rewrite. The Pulsar backend is independently implemented from the documented CrazyLight Nordic protocol.

A small selector chooses the backend for a discovered supported device. During this phase, the normal automatic polling-rate loop will continue to use only writable backends; a detected CrazyLight will be probed read-only and reported in runtime diagnostics.

## Razer backend

Move the existing Razer-specific code from `src/main.js` into `src/lib/mouseBackends/razer.js` with behavior preserved:

- VID `0x1532` device matching via the existing `devices.js` table
- interface selection based on the existing model metadata
- open/configure/claim/release/close lifecycle
- current Razer 90-byte request construction and CRC behavior
- existing polling-rate read, write, retry, and readback verification
- current 8K compatibility behavior

No Razer wire-format changes are part of this work.

## Pulsar X2 CrazyLight backend

Add `src/lib/mouseBackends/pulsarCrazyLight.js` for the known wireless dongle:

- known VID:PID `0x3710:0x5406`
- interface `1`
- HID report ID `0x08`
- report size `17` bytes
- host-to-device control SET_REPORT: request type class/interface, request `0x09`, value `0x0208`, index `1`
- device-to-host interrupt IN endpoint `0x82`
- checksum `(0x55 - sum(bytes[0:16])) & 0xff`

The backend implements only commands required for a safe probe:

- active profile query, command `0x0e`
- memory read, command `0x08`
- read polling-rate value from memory address `0x0000`

Polling-rate decoding:

- `0x08` -> 125 Hz
- `0x04` -> 250 Hz
- `0x02` -> 500 Hz
- `0x01` -> 1000 Hz
- `0x10` -> 2000 Hz
- `0x20` -> 4000 Hz
- `0x40` -> 8000 Hz

The backend advertises `canWrite: false`. `setPollingRate()` must fail closed with an explicit read-only/probe error rather than merely being unused.

The transport must ignore stale/unsolicited reports whose command byte does not match the command being awaited, because CrazyLight hardware can emit unsolicited `0x0a` reports.

## Unknown Gen.2 dongle handling

Because newer CrazyLight bundles may enumerate differently, discovery should not silently assume that every Pulsar device is compatible.

In addition to the exact known `3710:5406` match, the probe will enumerate/log visible USB devices with vendor `0x3710` and record their PID, product string where available, interfaces, endpoints, and report-related metadata. Unknown `0x3710` devices remain unsupported and read-only; no protocol commands are sent to them.

This gives an immediate diagnostic path when the user's mouse arrives if the Gen.2 dongle uses a different PID or interface layout.

## Runtime behavior

Existing Razer users should observe no behavioral change.

When a known CrazyLight is present, runtime status and diagnostics should expose at least:

- backend ID/name
- vendor/model
- VID/PID
- selected interface and endpoint
- detected active profile
- current polling rate
- `canWrite: false`
- probe/read errors if any

The tray/application should not imply that the Pulsar rate was changed. If a CrazyLight is the only supported mouse present, it may report its current rate and read-only status, but the automatic target-changing path remains disabled for that backend in this phase.

If both a supported Razer device and a CrazyLight are connected, the existing Razer writable path remains authoritative for automatic switching. The CrazyLight may still be surfaced in diagnostics, but there must be no ambiguity about which backend owns the active automatic polling operation.

## Error handling and safety

The Pulsar backend is fail-closed:

- no writes
- no profile switches
- no speculative commands to unknown Pulsar PIDs
- short or malformed reports produce explicit probe errors
- unknown polling-rate bytes are reported rather than coerced
- device/interface claim failures are logged and cleaned up
- cleanup runs in `finally` paths

Opening the CrazyLight's configuration interface may temporarily make Pulsar's browser configurator lose access; this is expected while the interface is claimed. The probe should keep the claim duration as short as practical.

## Files

Expected implementation files:

- `src/lib/mouseBackends/razer.js`
- `src/lib/mouseBackends/pulsarCrazyLight.js`
- `src/lib/mouseBackends/index.js` or equivalent selector
- `src/main.js` for integration and runtime-status plumbing
- tests under `test/` for backend matching/protocol behavior
- optional small updates to README/CHANGELOG documenting experimental read-only CrazyLight probing

Existing `src/lib/devices.js`, `src/lib/rates.js`, and `src/lib/razerReports.js` may remain and be imported by the Razer backend rather than moved unless moving them materially improves clarity.

## Testing

Tests should be hardware-independent and deterministic.

Pulsar tests cover:

- checksum generation
- 17-byte packet construction
- active-profile request construction/parsing
- memory-read request for address `0x0000`
- polling-rate byte decoding for all seven supported rates
- rejection of unknown rate bytes
- stale/unsolicited reply filtering
- exact VID/PID match for `3710:5406`
- unknown `0x3710` PIDs are diagnostic-only and receive no protocol traffic
- write attempts fail because the backend is read-only

Razer regression tests cover backend selection and preserve existing rate/device tests. The complete existing test suite must pass unchanged apart from intentional additions.

## Tomorrow's hardware-validation gate

Before enabling Pulsar writes:

1. Confirm the arriving dongle's actual VID/PID and interface descriptors.
2. Run the read-only probe and verify the reported current rate matches Pulsar's configurator at multiple manually selected rates, preferably 1000, 4000, and 8000 Hz.
3. Verify the active profile returned by the probe matches the user's selected profile.
4. Only after those checks pass, implement/enable a reversible polling write with immediate readback verification.
5. Validate a manual `1000 -> 8000 -> 1000` cycle before connecting the Pulsar backend to automatic game switching.

## Success criteria for this phase

- Razer automatic polling behavior is unchanged.
- The codebase has a clear backend boundary instead of adding Pulsar-specific branches throughout `main.js`.
- Known CrazyLight wireless hardware can be detected and queried for active-profile polling rate without changing device state.
- Unknown Pulsar/Gen.2 USB identities produce useful diagnostics without receiving configuration commands.
- There is no executable path that can write CrazyLight settings before hardware validation.
