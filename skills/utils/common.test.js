const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveClawperatorBin, resolveReceiverPackage } = require('./common');

test('resolveReceiverPackage prefers an explicit package over env var', () => {
  const original = process.env.CLAWPERATOR_RECEIVER_PACKAGE;
  process.env.CLAWPERATOR_RECEIVER_PACKAGE = 'com.clawperator.operator.dev';

  try {
    assert.strictEqual(resolveReceiverPackage('com.explicit.package'), 'com.explicit.package');
    assert.strictEqual(resolveReceiverPackage('com.clawperator.operator'), 'com.clawperator.operator');
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_RECEIVER_PACKAGE;
    } else {
      process.env.CLAWPERATOR_RECEIVER_PACKAGE = original;
    }
  }
});

test('resolveReceiverPackage falls back to env var when explicit package is absent', () => {
  const original = process.env.CLAWPERATOR_RECEIVER_PACKAGE;
  process.env.CLAWPERATOR_RECEIVER_PACKAGE = 'com.clawperator.operator.dev';

  try {
    assert.strictEqual(resolveReceiverPackage(undefined), 'com.clawperator.operator.dev');
    assert.strictEqual(resolveReceiverPackage(null), 'com.clawperator.operator.dev');
    assert.strictEqual(resolveReceiverPackage(''), 'com.clawperator.operator.dev');
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_RECEIVER_PACKAGE;
    } else {
      process.env.CLAWPERATOR_RECEIVER_PACKAGE = original;
    }
  }
});

test('resolveReceiverPackage falls back to the release default', () => {
  const original = process.env.CLAWPERATOR_RECEIVER_PACKAGE;
  delete process.env.CLAWPERATOR_RECEIVER_PACKAGE;

  try {
    assert.strictEqual(resolveReceiverPackage(undefined), 'com.clawperator.operator');
  } finally {
    if (original === undefined) {
      delete process.env.CLAWPERATOR_RECEIVER_PACKAGE;
    } else {
      process.env.CLAWPERATOR_RECEIVER_PACKAGE = original;
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

test('resolveClawperatorBin ignores legacy CLAW_BIN', () => {
  const originalBin = process.env.CLAWPERATOR_BIN;
  const originalLegacyBin = process.env.CLAW_BIN;
  const originalCliPath = process.env.CLAW_CLI_PATH;
  delete process.env.CLAWPERATOR_BIN;
  process.env.CLAW_BIN = '/legacy/claw/bin';
  process.env.CLAW_CLI_PATH = '/definitely/missing/sibling-build.js';

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
    if (originalLegacyBin === undefined) {
      delete process.env.CLAW_BIN;
    } else {
      process.env.CLAW_BIN = originalLegacyBin;
    }
    if (originalCliPath === undefined) {
      delete process.env.CLAW_CLI_PATH;
    } else {
      process.env.CLAW_CLI_PATH = originalCliPath;
    }
  }
});
