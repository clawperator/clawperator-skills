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

function extractTexts(snapshotText) {
  return [...snapshotText.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function parseYesterdayUsageCost(snapshotText) {
  const texts = extractTexts(snapshotText);
  const yesterdayIndex = texts.findIndex(
    (text) => text.trim().toUpperCase() === "YESTERDAY USAGE"
  );
  if (yesterdayIndex === -1) {
    return {
      ok: false,
      error: 'Could not find the "YESTERDAY USAGE" section in the GloBird snapshot.',
    };
  }

  const sectionTexts = texts.slice(yesterdayIndex + 1, yesterdayIndex + 8);
  const costIndex = sectionTexts.findIndex((text) => text.trim() === "Cost");
  if (costIndex === -1) {
    return {
      ok: false,
      error: 'Could not find the "Cost" label under "YESTERDAY USAGE".',
    };
  }

  const amountPattern = /^-?\$\d+(?:\.\d+)?$/;
  const amount = sectionTexts
    .slice(costIndex + 1)
    .find((text) => amountPattern.test(text.trim()));
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
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.globird.energy" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 8000 } },
    { id: "open-energy-tab", type: "click", params: { matcher: { textEquals: "Energy" } } },
    { id: "wait-energy", type: "sleep", params: { durationMs: 4000 } },
    { id: "snap", type: "snapshot_ui" }
  ]
};

logSkillProgress(skillId, "Launching GloBird for a fresh replay run...");
logSkillProgress(skillId, "Opening the Energy tab...");
logSkillProgress(skillId, "Capturing a snapshot for Yesterday usage cost...");

const { ok, result, error, raw } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  console.error(`Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find((step) => step.id === "snap");
const snapshotText = snapStep && snapStep.data ? snapStep.data.text : null;

if (!snapshotText) {
  console.error("Could not capture a GloBird snapshot for Yesterday usage cost.");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}

const parsed = parseYesterdayUsageCost(snapshotText);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(2);
}

logSkillProgress(skillId, "Parsed Yesterday usage cost.");
console.log(`GloBird yesterday usage cost: ${parsed.amount}`);
console.log(SKILL_RESULT_FRAME_PREFIX);
console.log(JSON.stringify({
  contractVersion: SKILL_RESULT_CONTRACT_VERSION,
  skillId,
  goal: {
    kind: "read_yesterday_usage_cost",
  },
  inputs: {},
  status: "success",
  checkpoints: [
    {
      id: "opened-energy-screen",
      status: "ok",
      note: "Opened GloBird and captured the Energy screen snapshot.",
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
}));
