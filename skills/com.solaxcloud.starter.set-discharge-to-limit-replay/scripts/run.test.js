const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractPercent,
  parsePercentArg,
  shouldAttemptFreshVerificationFallback,
} = require("./run.js");

test("parsePercentArg accepts named --limit input", () => {
  assert.deepStrictEqual(
    parsePercentArg(["node", "run.js", "device-123", "--limit", "33"]),
    { deviceId: "device-123", percentArg: "33" }
  );
});

test("parsePercentArg accepts canonical named --percent input", () => {
  assert.deepStrictEqual(
    parsePercentArg(["node", "run.js", "device-123", "--percent", "33"]),
    { deviceId: "device-123", percentArg: "33" }
  );
});

test("parsePercentArg accepts positional legacy input", () => {
  assert.deepStrictEqual(
    parsePercentArg(["node", "run.js", "device-123", "33"]),
    { deviceId: "device-123", percentArg: "33" }
  );
});

test("extractPercent reads the discharge row percentage", () => {
  assert.strictEqual(extractPercent("Discharge to 33% \ue640"), "33");
  assert.strictEqual(extractPercent("nothing useful here"), null);
});

test("shouldAttemptFreshVerificationFallback retries on missing-node verification failures", () => {
  const result = {
    ok: false,
    envelope: {
      envelope: {
        error: "Task execution failed: No UI node found matching criteria: NodeMatcher(textContains=Discharge to)",
      },
    },
  };
  assert.strictEqual(shouldAttemptFreshVerificationFallback(result), true);
});

test("shouldAttemptFreshVerificationFallback retries on timeout-style verification failures", () => {
  const result = {
    ok: false,
    envelope: {
      envelope: {
        error: "Task execution failed: Timeout waiting for node matching: NodeMatcher(textContains=Discharge to) (timeoutMs=8000)",
      },
    },
  };
  assert.strictEqual(shouldAttemptFreshVerificationFallback(result), true);
});

test("shouldAttemptFreshVerificationFallback retries on daemon proxy errors", () => {
  const result = {
    ok: false,
    envelope: {
      code: "DAEMON_PROXY_ERROR",
    },
  };
  assert.strictEqual(shouldAttemptFreshVerificationFallback(result), true);
});

test("shouldAttemptFreshVerificationFallback does not retry unrelated failures", () => {
  const result = {
    ok: false,
    envelope: {
      envelope: {
        error: "Task execution failed: selector for Confirm button was missing",
      },
    },
  };
  assert.strictEqual(shouldAttemptFreshVerificationFallback(result), false);
});
