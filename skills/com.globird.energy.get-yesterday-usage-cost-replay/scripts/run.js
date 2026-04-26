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

const { ok, result, error, raw } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  console.error(`Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const readStep = stepResults.find((step) => step.id === "read-yesterday");
const snapshotText = readStep && readStep.data ? readStep.data.text : null;

if (!snapshotText) {
  console.error("Could not read GloBird Yesterday usage cost text.");
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
}));
