#!/usr/bin/env node
const { runClawperator, resolveOperatorPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const operatorPkg = resolveOperatorPackage(process.argv[3]);
const skillId = "com.solaxcloud.starter.get-battery";
const SKILL_RESULT_FRAME_PREFIX = "[Clawperator-Skill-Result]";
const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";

if (!deviceId) {
  console.error("Usage: node get_solax_battery.js <device_id> [operator_package]");
  process.exit(1);
}

const commandId = `skill-solax-battery-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.solaxcloud.starter" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.solaxcloud.starter" } },
    { id: "wait_load", type: "sleep", params: { durationMs: 12000 } },
    { id: "read-battery-value", type: "read_text", params: { matcher: { resourceId: "com.solaxcloud.starter:id/tv_pb_title" } } },
    { id: "read-battery-unit", type: "read_text", params: { matcher: { resourceId: "com.solaxcloud.starter:id/tv_pb_unit" } } }
  ]
};

function writeSkillResult(payload) {
  console.log(SKILL_RESULT_FRAME_PREFIX);
  console.log(JSON.stringify(payload));
}

function buildSkillResult({
  status,
  appOpenedStatus,
  appOpenedNote,
  batteryLevelText,
  batteryUnitText,
  terminalVerification,
  diagnostics = {},
  result = null,
}) {
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: "read_battery_level",
    },
    inputs: {},
    status,
    checkpoints: [
      {
        id: "app_opened",
        status: appOpenedStatus,
        note: appOpenedNote,
      },
      {
        id: "battery_level_read",
        status: batteryLevelText ? "ok" : "failed",
        evidence: batteryLevelText
          ? {
              kind: "text",
              text: `${batteryLevelText}${batteryUnitText || ""}`,
            }
          : undefined,
        note: batteryLevelText
          ? "Read the battery level text from the SolaX dashboard."
          : "Failed to read the battery level text from the SolaX dashboard.",
      },
    ],
    terminalVerification,
    diagnostics,
    result,
  };
}

logSkillProgress(skillId, "Launching SolaX app...");
logSkillProgress(skillId, "Waiting for data to load (12s)...");
const { ok, result, error, raw } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  writeSkillResult(buildSkillResult({
    status: "failed",
    appOpenedStatus: "failed",
    appOpenedNote: "Clawperator execution failed before the SolaX dashboard could be confirmed open.",
    terminalVerification: {
      status: "failed",
      expected: {
        kind: "text",
        text: "Readable SolaX battery level",
      },
      observed: {
        kind: "text",
        text: error,
      },
      note: "Clawperator execution failed before the battery level could be read.",
    },
    diagnostics: {
      error,
    },
  }));
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const valStep = stepResults.find(s => s.id === "read-battery-value");
const unitStep = stepResults.find(s => s.id === "read-battery-unit");
const val = valStep && valStep.data ? valStep.data.text : null;
const unit = unitStep && unitStep.data ? unitStep.data.text : null;

if (val) {
  logSkillProgress(skillId, "Reading battery level...");
  console.log(`✅ SolaX battery level: ${val}${unit || ""}`);
  writeSkillResult(buildSkillResult({
    status: "success",
    appOpenedStatus: "ok",
    appOpenedNote: "Opened SolaX Cloud in a fresh app session.",
    batteryLevelText: val,
    batteryUnitText: unit || "",
    terminalVerification: {
      status: "verified",
      expected: {
        kind: "text",
        text: "Readable SolaX battery level",
      },
      observed: {
        kind: "text",
        text: `✅ SolaX battery level: ${val}${unit || ""}`,
      },
      note: "The recorded battery value was read from the dashboard and formatted for output.",
    },
    result: {
      batteryLevelText: val,
      batteryLevel: Number.parseFloat(val),
      unit: unit || null,
      displayText: `${val}${unit || ""}`,
    },
  }));
} else {
  console.error("⚠️ Could not parse SolaX battery level");
  console.error(`Raw result: ${raw}`);
  writeSkillResult(buildSkillResult({
    status: "failed",
    appOpenedStatus: "ok",
    appOpenedNote: "Opened SolaX Cloud in a fresh app session.",
    terminalVerification: {
      status: "failed",
      expected: {
        kind: "text",
        text: "Readable SolaX battery level",
      },
      observed: {
        kind: "text",
        text: "Could not parse SolaX battery level",
      },
      note: "The dashboard was opened, but the battery value text could not be parsed.",
    },
    diagnostics: {
      raw,
      batteryLevelText: val,
      batteryUnitText: unit,
      readBatteryValueStepId: valStep ? valStep.id : null,
      readBatteryUnitStepId: unitStep ? unitStep.id : null,
    },
  }));
  process.exit(2);
}
