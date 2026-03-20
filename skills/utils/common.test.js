const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveClawBin, resolveReceiverPackage } = require('./common');

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

test('resolveClawBin splits a combined command string into cmd and args', () => {
  const original = process.env.CLAWPERATOR_BIN;
  process.env.CLAWPERATOR_BIN = 'node "/tmp/clawperator/apps/node/dist/cli/index.js"';

  try {
    assert.deepStrictEqual(resolveClawBin(), {
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

test('resolveClawBin preserves a plain executable path as cmd only', () => {
  const original = process.env.CLAWPERATOR_BIN;
  process.env.CLAWPERATOR_BIN = process.execPath;

  try {
    assert.deepStrictEqual(resolveClawBin(), {
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
