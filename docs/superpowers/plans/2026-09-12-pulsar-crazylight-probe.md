# Pulsar X2 CrazyLight Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, read-only Pulsar X2 CrazyLight probe behind a small mouse-backend boundary while preserving current Razer auto-polling behavior.

**Architecture:** Keep game/process selection vendor-independent. Extract the current Razer USB lifecycle/read/write logic into a backend with the same behavior, add a separate CrazyLight backend using the documented 17-byte Nordic protocol, and let `main.js` select a writable Razer backend for automation or a read-only CrazyLight backend for probing/status only. Unknown Pulsar VID `0x3710` devices are diagnostics-only and receive no protocol traffic.

**Tech Stack:** Electron 42, Node.js CommonJS, `usb`/WebUSB, Node built-in test runner (`node:test`).

**Spec:** `docs/superpowers/specs/2026-09-12-pulsar-crazylight-backend-design.md`

## Global Constraints

- Existing Razer polling behavior must remain unchanged.
- Known CrazyLight wireless identity for this phase is VID:PID `0x3710:0x5406`, interface `1`, IN endpoint `0x82`, report ID `0x08`, report size `17`.
- CrazyLight writes, profile switches, and automatic rate changes remain disabled until hardware validation.
- Unknown `0x3710` PIDs are diagnostic-only and receive no configuration commands.
- CrazyLight reply handling must skip stale/unsolicited reports whose command byte does not match the awaited command.
- No application rebrand in this phase.

---

### Task 1: CrazyLight protocol primitives

**Files:**
- Create: `src/lib/mouseBackends/pulsarCrazyLightProtocol.js`
- Create: `test/pulsarCrazyLightProtocol.test.js`

**Interfaces:**
- Produces: `buildPacket(command, address = 0, payload = []) -> Buffer`
- Produces: `decodePollingRate(value) -> number|null`
- Produces: `parseActiveProfileReply(report) -> number`
- Produces: `parseMemoryReadReply(report, expectedAddress, expectedLength) -> Buffer`
- Produces constants `REPORT_ID`, `REPORT_SIZE`, `CMD_READ_MEMORY`, `CMD_GET_ACTIVE_PROFILE`, `POLLING_RATE_BY_VALUE`.

- [ ] **Step 1: Write failing protocol tests**

Create tests using `node:test` and `assert/strict` that verify:

```js
const packet = buildPacket(0x08, 0x0000, [0x02]);
assert.equal(packet.length, 17);
assert.equal(packet[0], 0x08);
assert.equal(packet[1], 0x08);
assert.equal(packet[3], 0x00);
assert.equal(packet[4], 0x00);
assert.equal(packet[5], 0x01);
assert.equal(packet[6], 0x02);
assert.equal(packet[16], (0x55 - packet.subarray(0, 16).reduce((sum, value) => sum + value, 0)) & 0xff);
```

Also assert all seven decodings: `0x08->125`, `0x04->250`, `0x02->500`, `0x01->1000`, `0x10->2000`, `0x20->4000`, `0x40->8000`, and unknown values return `null`. Add malformed reply tests for wrong report ID, wrong command, short reports, wrong address, and insufficient payload length.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/pulsarCrazyLightProtocol.test.js`

Expected: FAIL because `pulsarCrazyLightProtocol.js` does not exist.

- [ ] **Step 3: Implement protocol primitives**

Implement packet creation as exactly 17 bytes:

```js
function buildPacket(command, address = 0, payload = []) {
  const packet = Buffer.alloc(17);
  packet[0] = 0x08;
  packet[1] = command & 0xff;
  packet[2] = 0x00;
  packet[3] = (address >> 8) & 0xff;
  packet[4] = address & 0xff;
  packet[5] = payload.length & 0xff;
  Buffer.from(payload).copy(packet, 6, 0, 10);
  let sum = 0;
  for (let i = 0; i < 16; i += 1) sum += packet[i];
  packet[16] = (0x55 - sum) & 0xff;
  return packet;
}
```

Reply parsers validate `Buffer`/typed-array length >= 17, report ID `0x08`, expected command, address where applicable, and return clear errors instead of coercing malformed data.

- [ ] **Step 4: Run focused test**

Run: `node --test test/pulsarCrazyLightProtocol.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/mouseBackends/pulsarCrazyLightProtocol.js test/pulsarCrazyLightProtocol.test.js
git commit -m "test: add CrazyLight protocol primitives"
```

### Task 2: Backend boundary and Razer extraction

**Files:**
- Create: `src/lib/mouseBackends/razer.js`
- Create: `src/lib/mouseBackends/index.js`
- Create: `test/mouseBackends.test.js`
- Modify: `src/main.js:12-70, 925-1110, 1220-1395`

**Interfaces:**
- Produces: `createRazerBackend(options) -> backend`
- Produces backend fields/methods: `id`, `name`, `canWrite`, `deviceInfo`, `is8kCompatible()`, `discover()`, `open()`, `getPollingRate()`, `setPollingRate(rate)`, `close()`.
- Produces selector helpers: `isKnownCrazyLightDevice(device)`, `isKnownRazerDevice(device)`, `selectKnownBackend(device)`.

- [ ] **Step 1: Write failing backend-selection tests**

Test that Razer VID `0x1532` + an existing supported product ID selects Razer, `0x3710:0x5406` selects CrazyLight, an unknown `0x3710` PID selects no active backend, and unrelated devices select none. Use simple objects like `{ vendorId: 0x3710, productId: 0x5406 }`; no real USB access.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/mouseBackends.test.js`

Expected: FAIL because backend selector modules do not exist.

- [ ] **Step 3: Extract current Razer transport with behavior preserved**

Move the existing `getDongle`, `prepareDongle`, `cleanupDongle`, `getPollingRateOnce`, `getPollingRate`, and `setPollingRate` semantics from `main.js` into `createRazerBackend`. Inject callbacks/dependencies needed for logging and diagnostics rather than importing Electron state. Preserve request values, delays, retry count, report lengths, interface selection, and two-stage write/readback sequence exactly.

The backend owns its `currentModel`, device, and claimed interface state. `is8kCompatible()` returns `Boolean(currentModel && currentModel.is8kCompatible)`.

- [ ] **Step 4: Implement selector module**

`index.js` exports exact matching helpers. The CrazyLight selector match is exact VID/PID only. Unknown Pulsar devices are intentionally not returned as active backends.

- [ ] **Step 5: Adapt `main.js` to use the Razer backend without changing behavior**

Replace direct USB helpers with backend creation and lifecycle calls. Keep target selection, rate resolution, tray state, and diagnostics unchanged. `checkPollingRate()` should still discover/open/read/set/verify/close one Razer backend exactly as before when a supported Razer device is present.

- [ ] **Step 6: Run backend and existing regression tests**

Run: `npm test`

Expected: all existing tests plus `mouseBackends.test.js` PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/lib/mouseBackends/razer.js src/lib/mouseBackends/index.js src/main.js test/mouseBackends.test.js
git commit -m "refactor: add mouse backend boundary"
```

### Task 3: Read-only CrazyLight USB probe

**Files:**
- Create: `src/lib/mouseBackends/pulsarCrazyLight.js`
- Create: `test/pulsarCrazyLightBackend.test.js`
- Modify: `src/lib/mouseBackends/index.js`

**Interfaces:**
- Produces: `createPulsarCrazyLightBackend(options) -> backend`
- Backend fields: `id: 'pulsar-x2-crazylight'`, `name: 'Pulsar X2 CrazyLight'`, `canWrite: false`, `supportedRates: [125,250,500,1000,2000,4000,8000]`.
- Backend methods: `discover()`, `open()`, `getActiveProfile()`, `getPollingRate()`, `setPollingRate()`, `close()`.
- `setPollingRate()` always throws `Pulsar X2 CrazyLight backend is read-only until hardware validation`.

- [ ] **Step 1: Write failing backend tests with a fake WebUSB device**

Create a fake device implementing `open`, `selectConfiguration`, `claimInterface`, `controlTransferOut`, `transferIn`, `releaseInterface`, and `close`. Verify:

```js
assert.equal(backend.canWrite, false);
await assert.rejects(() => backend.setPollingRate(8000), /read-only/);
```

Simulate an unsolicited `0x0a` report followed by the requested `0x0e` or `0x08` report and assert the backend skips the stale report. Assert `getPollingRate()` reads memory address `0x0000` and decodes the first returned value byte. Assert cleanup releases interface `1` and closes the device.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --test test/pulsarCrazyLightBackend.test.js`

Expected: FAIL because the backend does not exist.

- [ ] **Step 3: Implement safe transport**

Use WebUSB control SET_REPORT:

```js
await device.controlTransferOut({
  requestType: 'class',
  recipient: 'interface',
  request: 0x09,
  value: 0x0208,
  index: 0x0001,
}, packet);
```

Receive from endpoint number `2` (WebUSB endpoint corresponding to `0x82`) with length `17`. Loop over a small bounded number of received reports, accepting only a report whose byte 1 equals the awaited command; skip `0x0a` and other stale command replies. Throw on timeout/exhaustion.

`getActiveProfile()` sends command `0x0e`. `getPollingRate()` sends memory-read command `0x08` for address `0x0000`, length `1`, then decodes the returned rate byte using Task 1 helpers. No profile-switch command and no write-memory command are implemented.

- [ ] **Step 4: Run focused test**

Run: `node --test test/pulsarCrazyLightBackend.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/lib/mouseBackends/pulsarCrazyLight.js src/lib/mouseBackends/index.js test/pulsarCrazyLightBackend.test.js
git commit -m "feat: add read-only CrazyLight probe backend"
```

### Task 4: Runtime integration and unknown-Pulsar diagnostics

**Files:**
- Modify: `src/main.js`
- Modify: `src/lib/mouseBackends/index.js`
- Create: `test/pulsarDiscovery.test.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces runtime status field `mouse` with `{ backend, name, vendorId, productId, interfaceNumber, endpoint, canWrite, activeProfile }` or `null`.
- Produces diagnostic event `mouse_probe` for a known CrazyLight.
- Produces diagnostic event `pulsar_usb_detected` for visible VID `0x3710` devices, including PID and descriptor metadata available without sending protocol commands.

- [ ] **Step 1: Write discovery/safety tests**

Test a helper that partitions enumerated USB devices into known CrazyLight, known Razer, and unknown Pulsar diagnostics. Verify unknown `0x3710` devices never instantiate or invoke the CrazyLight backend. Verify when Razer and CrazyLight are both present, Razer remains the writable automatic backend.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --test test/pulsarDiscovery.test.js`

Expected: FAIL until discovery helper is implemented.

- [ ] **Step 3: Integrate discovery into `main.js`**

At each enabled polling check, enumerate visible USB devices. Record any VID `0x3710` identities for diagnostics. Selection rules:

```text
supported Razer present -> use Razer backend for normal automatic read/write flow; optionally probe CrazyLight only when safe/available for diagnostics
no supported Razer + known 3710:5406 -> open CrazyLight briefly, read active profile and current rate, update runtime/tray as read-only, do not resolve/apply target rate, close immediately
unknown 3710 only -> diagnostics only; no configuration command
nothing supported -> preserve the existing not-found error behavior, broadened to mention supported Razer/CrazyLight probe devices
```

For CrazyLight-only status, set `runtimeStatus.currentRate` to the probed rate, preserve `requestedTarget` for informational purposes, set `runtimeStatus.mouse.canWrite = false`, and set the tray tooltip to include `Pulsar X2 CrazyLight (read-only probe)` and the current rate. Never call `setPollingRate()` on the Pulsar backend.

- [ ] **Step 4: Document experimental probe**

README: add an experimental support note stating the branch recognizes X2 CrazyLight wireless `3710:5406` read-only, reports active profile/current stored polling rate, and intentionally cannot change Pulsar settings yet.

CHANGELOG: under an unreleased section, note backend abstraction + experimental read-only CrazyLight probe.

- [ ] **Step 5: Run complete tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/main.js src/lib/mouseBackends/index.js test/pulsarDiscovery.test.js README.md CHANGELOG.md
git commit -m "feat: integrate CrazyLight read-only diagnostics"
```

### Task 5: Verification before hardware arrival

**Files:**
- No code changes unless verification exposes a defect.

**Interfaces:**
- Verifies the full branch against the design spec.

- [ ] **Step 1: Run full unit suite**

Run: `npm test`

Expected: exit code 0.

- [ ] **Step 2: Run packaging/build smoke test**

Run: `npm run package`

Expected: Electron Forge packages successfully for the current platform with no missing-module/runtime bundling error.

- [ ] **Step 3: Review branch diff against `main`**

Confirm no Pulsar write command exists, no unknown Pulsar PID receives protocol traffic, Razer wire-format constants remain unchanged, and docs/spec/plan agree with implementation.

- [ ] **Step 4: Prepare tomorrow's validation checklist**

Record these exact steps in the PR/branch summary:

1. Plug in the CrazyLight 8K dongle and mouse.
2. Capture actual VID/PID/interface/endpoint descriptors.
3. Run the app and confirm the read-only probe reports a current rate matching Bibimbap at 1000, 4000, and 8000 Hz.
4. Confirm active profile matches the selected profile.
5. Only then implement a separate write-enable change and validate `1000 -> 8000 -> 1000` with readback.
