const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { normalizeTimeoutMs, resolveClawperatorBin, resolveOperatorPackage, runClawperatorCommand, setExecFileSyncForTest } = require('./common');

test('resolveOperatorPackage prefers an explicit package over env var', () => {
  const original = process.env.CLAWPERATOR_OPERATOR_PACKAGE;
  process.env.CLAWPERATOR_OPERATOR_PACKAGE = 'com.clawperator.operator.dev';

  try {
    assert.strictEqual(resolveOperatorPackage('com.explicit.package'), 'com.explicit.package');
    assert.strictEqual(resolveOperatorPackage('com.clawperator.operator'), 'com.clawperator.operator');
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_OPERATOR_PACKAGE;
    } else {
      process.env.CLAWPERATOR_OPERATOR_PACKAGE = original;
    }
  }
});

test('resolveOperatorPackage falls back to env var when explicit package is absent', () => {
  const original = process.env.CLAWPERATOR_OPERATOR_PACKAGE;
  process.env.CLAWPERATOR_OPERATOR_PACKAGE = 'com.clawperator.operator.dev';

  try {
    assert.strictEqual(resolveOperatorPackage(undefined), 'com.clawperator.operator.dev');
    assert.strictEqual(resolveOperatorPackage(null), 'com.clawperator.operator.dev');
    assert.strictEqual(resolveOperatorPackage(''), 'com.clawperator.operator.dev');
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_OPERATOR_PACKAGE;
    } else {
      process.env.CLAWPERATOR_OPERATOR_PACKAGE = original;
    }
  }
});

test('resolveOperatorPackage falls back to the release default', () => {
  const original = process.env.CLAWPERATOR_OPERATOR_PACKAGE;
  delete process.env.CLAWPERATOR_OPERATOR_PACKAGE;

  try {
    assert.strictEqual(resolveOperatorPackage(undefined), 'com.clawperator.operator');
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_OPERATOR_PACKAGE;
    } else {
      process.env.CLAWPERATOR_OPERATOR_PACKAGE = original;
    }
  }
});

test('resolveClawperatorBin splits a combined command string into cmd and args', () => {
  const original = process.env.CLAWPERATOR_BIN;
  process.env.CLAWPERATOR_BIN = 'node "/tmp/clawperator/apps/node/dist/cli/index.js"';

  try {
    assert.deepStrictEqual(resolveClawperatorBin(), {
      cmd: 'node',
      args: ['/tmp/clawperator/apps/node/dist/cli/index.js'],
    });
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_BIN;
    } else {
      process.env.CLAWPERATOR_BIN = original;
    }
  }
});

test('resolveClawperatorBin preserves a plain executable path as cmd only', () => {
  const original = process.env.CLAWPERATOR_BIN;
  process.env.CLAWPERATOR_BIN = process.execPath;

  try {
    assert.deepStrictEqual(resolveClawperatorBin(), {
      cmd: process.execPath,
      args: [],
    });
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_BIN;
    } else {
      process.env.CLAWPERATOR_BIN = original;
    }
  }
});

test('resolveClawperatorBin launches a .js entrypoint through node when set explicitly', async () => {
  const originalBin = process.env.CLAWPERATOR_BIN;
  const tempDir = await mkdtemp(join(tmpdir(), 'clawperator-bin-'));
  const scriptPath = join(tempDir, 'index.js');
  await writeFile(scriptPath, 'console.log("hello from temp script");\n');
  process.env.CLAWPERATOR_BIN = scriptPath;

  try {
    assert.deepStrictEqual(resolveClawperatorBin(), {
      cmd: process.execPath,
      args: [scriptPath],
    });
  } finally {
    if (originalBin === undefined) {
      delete process.env.CLAWPERATOR_BIN;
    } else {
      process.env.CLAWPERATOR_BIN = originalBin;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('resolveClawperatorBin falls back to the global binary when canonical overrides are absent', () => {
  const originalBin = process.env.CLAWPERATOR_BIN;
  const originalCliPath = process.env.CLAWPERATOR_CLI_PATH;
  delete process.env.CLAWPERATOR_BIN;
  process.env.CLAWPERATOR_CLI_PATH = '/definitely/missing/sibling-build.js';

  try {
    assert.deepStrictEqual(resolveClawperatorBin(), {
      cmd: 'clawperator',
      args: [],
    });
  } finally {
    if (originalBin === undefined) {
      delete process.env.CLAWPERATOR_BIN;
    } else {
      process.env.CLAWPERATOR_BIN = originalBin;
    }
    if (originalCliPath === undefined) {
      delete process.env.CLAWPERATOR_CLI_PATH;
    } else {
      process.env.CLAWPERATOR_CLI_PATH = originalCliPath;
    }
  }
});

test('normalizeTimeoutMs only accepts finite positive timeout values', () => {
  assert.strictEqual(normalizeTimeoutMs(30000), 30000);
  assert.strictEqual(normalizeTimeoutMs(0), null);
  assert.strictEqual(normalizeTimeoutMs(-1), null);
  assert.strictEqual(normalizeTimeoutMs(Number.NaN), null);
  assert.strictEqual(normalizeTimeoutMs('30000'), null);
  assert.strictEqual(normalizeTimeoutMs(undefined), null);
});

test('runClawperatorCommand forwards normalized timeoutMs to execFileSync', () => {
  const calls = [];
  setExecFileSyncForTest((cmd, args, options) => {
    calls.push({ cmd, args, options });
    return Buffer.from('ok');
  });

  try {
    const result = runClawperatorCommand('snapshot', ['--json'], { timeoutMs: 30000 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.timeout, 30000);
    assert.deepStrictEqual(calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  } finally {
    setExecFileSyncForTest(null);
  }
});

test('runClawperatorCommand returns a bounded error when execFileSync times out', () => {
  setExecFileSyncForTest(() => {
    const error = new Error('spawnSync clawperator --device device-123 /Users/admin/tmp ETIMEDOUT');
    error.stderr = Buffer.from('timed out for /Users/admin/device-logs');
    error.stdout = Buffer.from('partial output from --device device-123');
    throw error;
  });

  try {
    const result = runClawperatorCommand('snapshot', ['--json'], { timeoutMs: 1 });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /ETIMEDOUT/);
    assert.match(result.error, /--device <device_serial>/);
    assert.match(result.error, /\/Users\/<local_user>/);
    assert.match(result.error, /STDERR: \[redacted \d+ bytes\]/);
    assert.match(result.error, /STDOUT: \[redacted \d+ bytes\]/);
    assert.doesNotMatch(result.error, /partial output/);
    assert.doesNotMatch(result.error, /device-123/);
  } finally {
    setExecFileSyncForTest(null);
  }
});
