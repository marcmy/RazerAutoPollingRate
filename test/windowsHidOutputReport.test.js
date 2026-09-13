const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '../scripts/send-hid-output-report.ps1');

function loadBridgeScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

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
