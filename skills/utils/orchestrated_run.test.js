const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareRun } = require('./orchestrated_run');

test('run configuration requires an explicit model and validates directories and deadlines', () => {
  assert.throws(() => prepareRun({}), /VERSION_CODEX_MODEL/);
  const env = { VERSION_CODEX_MODEL: 'fixture-model', CLAWPERATOR_DEVICE_ID: 'fixture-device' };
  assert.throws(() => prepareRun({ ...env, VERSION_RUN_DIR: '' }), /VERSION_RUN_DIR/);
  assert.throws(() => prepareRun({ ...env, VERSION_RUN_DIR: 'relative' }), /absolute/);
  assert.throws(() => prepareRun({ ...env, CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS: 'bad' }), /timeout/);
});

test('device reservation excludes another run and a failed run directory cannot be reused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrated-test-'));
  const env = { VERSION_CODEX_MODEL: 'fixture-model', CLAWPERATOR_DEVICE_ID: root };
  let first, second;
  try {
    first = prepareRun({ ...env, VERSION_RUN_DIR: path.join(root, 'first') });
    assert.throws(() => prepareRun({ ...env, VERSION_RUN_DIR: path.join(root, 'blocked') }), /reserved/);
    first.release(); first = null;
    assert.throws(() => prepareRun({ ...env, VERSION_RUN_DIR: path.join(root, 'blocked') }), /EEXIST/);
    second = prepareRun({ ...env, VERSION_RUN_DIR: path.join(root, 'second') });
    assert.equal(second.model, 'fixture-model');
    assert.equal(second.effort, 'high');
  } finally {
    first?.release(); second?.release(); fs.rmSync(root, { recursive: true, force: true });
  }
});
