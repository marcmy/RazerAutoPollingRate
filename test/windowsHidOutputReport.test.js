const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const {
  createWindowsHidOutputReportManager,
} = require('../src/lib/mouseBackends/windowsHidOutputReport');

const scriptPath = path.resolve(__dirname, '../scripts/send-hid-output-report.ps1');

function loadBridgeScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

function createFakeSpawn(options = {}) {
  const calls = [];
  const children = [];
  let spawnCount = 0;

  function spawn(executable, args, spawnOptions) {
    spawnCount += 1;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.unref = () => {};
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.emit('exit', 0, null));
      return true;
    };

    calls.push([executable, args, spawnOptions]);
    children.push(child);

    let input = '';
    let sendIndex = 0;
    child.stdin.on('data', (chunk) => {
      input += chunk.toString('utf8');
      let newline;
      while ((newline = input.indexOf('\n')) !== -1) {
        const line = input.slice(0, newline).trim();
        input = input.slice(newline + 1);
        if (!line) continue;
        sendIndex += 1;
        const response = options.responseForSend
          ? options.responseForSend({ spawnCount, sendIndex, line, child })
          : 'OK';
        if (response !== null && response !== undefined) {
          const delay = options.responseDelayMs || 0;
          setTimeout(() => child.stdout.write(`${response}\n`), delay);
        }
      }
    });
    child.stdin.on('finish', () => {
      queueMicrotask(() => child.emit('exit', 0, null));
    });

    queueMicrotask(() => child.stdout.write('READY\n'));
    return child;
  }

  return { spawn, calls, children };
}

test('persistent Windows HID bridge spawns once and reuses the helper for sequential reports', async () => {
  const fake = createFakeSpawn();
  const manager = createWindowsHidOutputReportManager({
    spawn: fake.spawn,
    idleTimeoutMs: 60_000,
  });
  const first = Buffer.from([0x08, 0x0e, 0x01]);
  const second = Buffer.from([0x08, 0x08, 0x02]);

  await manager.send('hid-path', first);
  await manager.send('hid-path', second);

  assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0][1].includes('-Server'));
  assert.ok(fake.calls[0][1].includes('-DevicePath'));
  assert.ok(fake.calls[0][1].includes('hid-path'));
  assert.deepEqual(manager.getActivePaths(), ['hid-path']);

  await manager.closeAll();
});

test('persistent Windows HID bridge serializes concurrent sends in request order', async () => {
  const seen = [];
  const fake = createFakeSpawn({
    responseDelayMs: 5,
    responseForSend: ({ line }) => {
      seen.push(line);
      return 'OK';
    },
  });
  const manager = createWindowsHidOutputReportManager({
    spawn: fake.spawn,
    idleTimeoutMs: 60_000,
  });

  await Promise.all([
    manager.send('hid-path', Buffer.from([0x08, 0x01])),
    manager.send('hid-path', Buffer.from([0x08, 0x02])),
    manager.send('hid-path', Buffer.from([0x08, 0x03])),
  ]);

  assert.deepEqual(seen, ['0801', '0802', '0803']);
  assert.equal(fake.calls.length, 1);
  await manager.closeAll();
});

test('persistent Windows HID bridge decodes helper errors and restarts on the next send', async () => {
  const encoded = Buffer.from('native send failed', 'utf8').toString('base64');
  const fake = createFakeSpawn({
    responseForSend: ({ spawnCount }) => (spawnCount === 1 ? `ERR:${encoded}` : 'OK'),
  });
  const manager = createWindowsHidOutputReportManager({
    spawn: fake.spawn,
    idleTimeoutMs: 60_000,
  });

  await assert.rejects(
    () => manager.send('hid-path', Buffer.from([0x08, 0x01])),
    /native send failed/i,
  );
  assert.deepEqual(manager.getActivePaths(), []);

  await manager.send('hid-path', Buffer.from([0x08, 0x02]));
  assert.equal(fake.calls.length, 2);
  await manager.closeAll();
});

test('Windows HID output bridge server keeps one native session and reads reports from stdin', () => {
  const source = loadBridgeScript();

  assert.match(source, /\[switch\]\$Server/);
  assert.match(source, /class CrazyLightHidSession\s*:\s*IDisposable/);
  assert.match(source, /\[Console\]::In\.ReadLine\(\)/);
  assert.match(source, /\[Console\]::Out\.WriteLine\("READY"\)/);
  assert.match(source, /\[Console\]::Out\.WriteLine\("OK"\)/);
});

test('Windows HID output bridge queries HID caps before calling HidD_SetOutputReport', () => {
  const source = loadBridgeScript();

  assert.match(source, /HidD_GetPreparsedData/);
  assert.match(source, /HidP_GetCaps/);
  assert.match(source, /OutputReportByteLength/);
});

test('Windows HID output bridge pads reports to OutputReportByteLength instead of hardcoding 17 bytes', () => {
  const source = loadBridgeScript();

  assert.match(source, /Math\.Max\([^\r\n]*report\.Length[^\r\n]*OutputReportByteLength/);
  assert.match(source, /Array\.Copy\(report/);
});

test('Windows HID output bridge includes HID caps and Win32 code in SetOutputReport failures', () => {
  const source = loadBridgeScript();

  assert.match(source, /Win32Error=/);
  assert.match(source, /InputReportByteLength=/);
  assert.match(source, /OutputReportByteLength=/);
  assert.match(source, /FeatureReportByteLength=/);
});
