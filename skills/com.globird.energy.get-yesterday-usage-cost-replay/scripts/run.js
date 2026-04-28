#!/usr/bin/env node

const {
  runClawperator,
  resolveOperatorPackage,
  logSkillProgress,
} = require("../../utils/common");

const SKILL_RESULT_FRAME_PREFIX = "[Clawperator-Skill-Result]";
const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const operatorPkg = resolveOperatorPackage(process.argv[3]);
const skillId = "com.globird.energy.get-yesterday-usage-cost-replay";

if (!deviceId) {
  console.error("Usage: node run.js <device_id> [operator_package]");
  process.exit(1);
}

function writeFramedSkillResult(payload) {
  console.log(SKILL_RESULT_FRAME_PREFIX);
  console.log(JSON.stringify(payload));
}

function exitWithFramedFailure({ message, checkpoints, terminalVerification, diagnostics = {} }) {
  console.error(message);
  writeFramedSkillResult({
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: "read_yesterday_usage_cost",
    },
    inputs: {},
    result: null,
    status: "failed",
    checkpoints,
    terminalVerification,
    diagnostics: { runtimeState: "unknown", ...diagnostics },
  });
  process.exit(2);
}

function exitWithNoDataAvailable({ observedText = "Yesterday usage is not available yet." } = {}) {
  const displayText = "No result available yet.";
  console.log(displayText);
  writeFramedSkillResult({
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: "read_yesterday_usage_cost",
    },
    inputs: {},
    result: {
      kind: "json",
      value: {
        available: false,
        displayText,
      },
    },
    status: "success",
    checkpoints: [
      {
        id: "opened-energy-screen",
        status: "ok",
        note: "Opened GloBird and reached the Energy read path.",
      },
      {
        id: "yesterday-usage-available",
        status: "ok",
        note: "The Yesterday usage section is not available yet.",
      },
    ],
    terminalVerification: {
      status: "verified",
      expected: {
        kind: "text",
        text: "Yesterday usage cost or an expected no-data state",
      },
      observed: {
        kind: "text",
        text: observedText,
      },
      note: "GloBird did not expose a YESTERDAY USAGE section, which is an expected no-data state.",
    },
    diagnostics: {
      runtimeState: "unavailable",
      noDataReason: "missing_yesterday_usage_node",
    },
  });
  process.exit(0);
}

function parseYesterdayUsageCost(rawText) {
  const normalizedText = String(rawText || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedText) {
    return {
      ok: false,
      error: 'Could not capture a GloBird Yesterday usage text block.',
    };
  }

  const yesterdayMatch = normalizedText.match(/YESTERDAY USAGE[\s\S]*?\bCost\b\s*,\s*([+-]?\$\d+(?:\.\d+)?)/i);
  if (!yesterdayMatch) {
    return {
      ok: false,
      error: 'Could not find the "YESTERDAY USAGE" section in the GloBird text block.',
    };
  }

  const amount = yesterdayMatch[1].trim();
  if (!amount) {
    return {
      ok: false,
      error: 'Could not find a signed dollar amount after "YESTERDAY USAGE" -> "Cost".',
    };
  }

  return { ok: true, amount: amount.trim() };
}

const commandId = `skill-globird-yesterday-usage-cost-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.globird.energy" } },
    { id: "open", type: "open_app", params: { applicationId: "com.globird.energy" } },
    { id: "wait_open", type: "wait_for_node", params: { matcher: { resourceId: "nav-item-energy" }, timeoutMs: 15000 } },
    { id: "open-energy-tab", type: "click", params: { matcher: { textEquals: "Energy" } } },
    { id: "wait-energy", type: "wait_for_node", params: { matcher: { textContains: "YESTERDAY USAGE" }, timeoutMs: 15000 } },
    { id: "read-yesterday", type: "read_text", params: { matcher: { textContains: "YESTERDAY USAGE" } } }
  ]
};

logSkillProgress(skillId, "Launching GloBird for a fresh replay run...");
logSkillProgress(skillId, "Opening the Energy tab...");
logSkillProgress(skillId, "Reading Yesterday usage cost...");

const { ok, result, error, raw, rawStdout } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  if (isMissingYesterdayUsageNode(rawStdout)) {
    exitWithNoDataAvailable({
      observedText: "No UI node found matching textContains=YESTERDAY USAGE.",
    });
  }

  exitWithFramedFailure({
    message: `Skill execution failed: ${error}`,
    checkpoints: [
      {
        id: "opened-energy-screen",
        status: "failed",
        note: "Clawperator execution failed before Yesterday usage cost could be read.",
      },
    ],
    terminalVerification: {
      status: "failed",
      expected: {
        kind: "text",
        text: "Signed dollar amount under Yesterday usage -> Cost",
      },
      observed: {
        kind: "text",
        text: String(error || "execution failed"),
      },
      note: "The replay run could not complete the GloBird Energy read path.",
    },
    diagnostics: { runtimeState: "poisoned" },
  });
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const readStep = stepResults.find((step) => step.id === "read-yesterday");
const snapshotText = readStep && readStep.data ? readStep.data.text : null;

if (!snapshotText) {
  exitWithFramedFailure({
    message: "Could not read GloBird Yesterday usage cost text.",
    checkpoints: [
      {
        id: "opened-energy-screen",
        status: "failed",
        note: "No Yesterday usage text block was returned from the read_text step.",
      },
    ],
    terminalVerification: {
      status: "failed",
      expected: {
        kind: "text",
        text: "Signed dollar amount under Yesterday usage -> Cost",
      },
      observed: {
        kind: "text",
        text: `Raw result: ${raw || ""}`,
      },
      note: "The read_text step did not return snapshot text for parsing.",
    },
    diagnostics: { rawHint: "missing read-yesterday step text" },
  });
}

const parsed = parseYesterdayUsageCost(snapshotText);
if (!parsed.ok) {
  if (isNoDataText(snapshotText)) {
    exitWithNoDataAvailable({
      observedText: snapshotText,
    });
  }

  exitWithFramedFailure({
    message: parsed.error,
    checkpoints: [
      {
        id: "opened-energy-screen",
        status: "ok",
        note: "Opened GloBird and reached a text block, but the parser did not find a cost.",
      },
      {
        id: "parsed-yesterday-usage-cost",
        status: "failed",
        note: "Parser could not extract a signed dollar amount from the Yesterday usage section.",
      },
    ],
    terminalVerification: {
      status: "failed",
      expected: {
        kind: "text",
        text: "Signed dollar amount under Yesterday usage -> Cost",
      },
      observed: {
        kind: "text",
        text: String(parsed.error),
      },
      note: "The GloBird Energy surface text did not match the expected Yesterday usage layout.",
    },
  });
}

logSkillProgress(skillId, "Parsed Yesterday usage cost.");
console.log(`GloBird yesterday usage cost: ${parsed.amount}`);
writeFramedSkillResult({
  contractVersion: SKILL_RESULT_CONTRACT_VERSION,
  skillId,
  goal: {
    kind: "read_yesterday_usage_cost",
  },
  inputs: {},
  result: {
    kind: "text",
    text: parsed.amount,
  },
  status: "success",
  checkpoints: [
    {
      id: "opened-energy-screen",
      status: "ok",
      note: "Opened GloBird and reached the Energy screen.",
    },
    {
      id: "parsed-yesterday-usage-cost",
      status: "ok",
      evidence: {
        kind: "text",
        text: parsed.amount,
      },
      note: "Extracted the signed dollar amount under Yesterday usage -> Cost.",
    }
  ],
  terminalVerification: {
    status: "verified",
    expected: {
      kind: "text",
      text: "Signed dollar amount under Yesterday usage -> Cost",
    },
    observed: {
      kind: "text",
      text: `GloBird yesterday usage cost: ${parsed.amount}`,
    },
    note: "The replay parser found a signed dollar amount in the recorded Yesterday usage cost slot.",
  },
  diagnostics: {
    runtimeState: "healthy",
    hints: [
      "This replay depends on the current GloBird Energy tab labels remaining stable.",
    ],
  },
});

function isMissingYesterdayUsageNode(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return false;
  return /No UI node found matching criteria/i.test(text)
    && /textContains=YESTERDAY USAGE/i.test(text);
}

function isNoDataText(rawText) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  return /no data available/i.test(text)
    || /not available yet/i.test(text)
    || /no result available yet/i.test(text);
}
