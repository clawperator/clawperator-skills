const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { normalizeTimeoutMs, resolveClawperatorBin, resolveOperatorPackage } = require('./common');

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
