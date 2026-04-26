#!/usr/bin/env node
const { runClawperator, resolveOperatorPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const operatorPkg = resolveOperatorPackage(process.argv[3]);
const skillId = "com.solaxcloud.starter.get-battery";
const SKILL_RESULT_FRAME_PREFIX = "[Clawperator-Skill-Result]";
const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";
const APP_ID = "com.solaxcloud.starter";
const BATTERY_VALUE_RESOURCE_ID = "com.solaxcloud.starter:id/tv_pb_title";
const BATTERY_UNIT_RESOURCE_ID = "com.solaxcloud.starter:id/tv_pb_unit";
const POLL_TIMEOUT_MS = 20000;

if (!deviceId) {
  console.error("Usage: node get_solax_battery.js <device_id> [operator_package]");
  process.exit(1);
}

function buildExecution(actions, timeoutMs = 30000) {
  const commandId = `skill-solax-battery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    commandId,
    taskId: commandId,
    source: "clawperator-skill",
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  };
}

function buildOpenExecution() {
  return buildExecution([
    { id: "close", type: "close_app", params: { applicationId: APP_ID } },
    { id: "open", type: "open_app", params: { applicationId: APP_ID } },
  ]);
}

function buildReadBatteryExecution() {
  return buildExecution([
    { id: "read-battery-value", type: "read_text", params: { matcher: { resourceId: BATTERY_VALUE_RESOURCE_ID } } },
    { id: "read-battery-unit", type: "read_text", params: { matcher: { resourceId: BATTERY_UNIT_RESOURCE_ID } } },
  ], 15000);
}

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
  const evidenceResult =
    result === null || result === undefined
      ? null
      : result && typeof result === "object" && typeof result.kind === "string"
        ? result
        : { kind: "json", value: result };
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: "read_battery_level",
    },
    inputs: {},
    result: evidenceResult,
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
  };
}

function getStepResults(result) {
  return (result && result.envelope && result.envelope.stepResults) || [];
}

function getStepText(result, stepId) {
  const step = getStepResults(result).find(s => s.id === stepId);
  return step && step.data && typeof step.data.text === "string" ? step.data.text.trim() : "";
}

function parseBattery(valueText, unitText) {
  const normalizedValue = String(valueText || "").trim();
  const numeric = Number.parseFloat(normalizedValue.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const normalizedUnit = String(unitText || "").trim();
  return {
    batteryLevelText: normalizedValue,
    batteryLevel: numeric,
    unit: normalizedUnit || null,
    displayText: `${normalizedValue}${normalizedUnit}`,
  };
}

function runSkillExecution(execution) {
  const startedAt = Date.now();
  const output = runClawperator(execution, deviceId, operatorPkg);
  return {
    ...output,
    elapsedMs: Date.now() - startedAt,
  };
}

function readBatteryUntilReady() {
  const startedAt = Date.now();
  const attempts = [];
  let lastRaw = "";

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const attemptNumber = attempts.length + 1;
    const attempt = runSkillExecution(buildReadBatteryExecution());
    lastRaw = attempt.raw || lastRaw;

    const valueText = attempt.ok ? getStepText(attempt.result, "read-battery-value") : "";
    const unitText = attempt.ok ? getStepText(attempt.result, "read-battery-unit") : "";
    const parsed = parseBattery(valueText, unitText);
    attempts.push({
      attempt: attemptNumber,
      elapsedMs: attempt.elapsedMs,
      ok: attempt.ok,
      valueText: valueText || null,
      unitText: unitText || null,
      parsed: parsed !== null,
      error: attempt.ok ? undefined : attempt.error,
    });

    if (parsed) {
      return {
        ok: true,
        ...parsed,
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    attempts,
    elapsedMs: Date.now() - startedAt,
    raw: lastRaw,
  };
}

logSkillProgress(skillId, "Launching SolaX app...");
const setup = runSkillExecution(buildOpenExecution());

if (!setup.ok) {
  console.error(`⚠️ Skill execution failed: ${setup.error}`);
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
        text: setup.error,
      },
      note: "Clawperator execution failed before the battery level could be read.",
    },
    diagnostics: {
      error: setup.error,
      setupElapsedMs: setup.elapsedMs,
    },
  }));
  process.exit(2);
}

logSkillProgress(skillId, "Polling battery level until readable...");
const readResult = readBatteryUntilReady();

if (readResult.ok) {
  console.log(`✅ SolaX battery level: ${readResult.displayText}`);
  writeSkillResult(buildSkillResult({
    status: "success",
    appOpenedStatus: "ok",
    appOpenedNote: "Opened SolaX Cloud in a fresh app session, then polled the dashboard until the battery value was readable.",
    batteryLevelText: readResult.batteryLevelText,
    batteryUnitText: readResult.unit || "",
    terminalVerification: {
      status: "verified",
      expected: {
        kind: "text",
        text: "Readable SolaX battery level",
      },
      observed: {
        kind: "text",
        text: `✅ SolaX battery level: ${readResult.displayText}`,
      },
      note: "The battery value was read from the dashboard after bounded polling, without fixed sleep actions.",
    },
    diagnostics: {
      setupElapsedMs: setup.elapsedMs,
      pollElapsedMs: readResult.elapsedMs,
      attempts: readResult.attempts,
    },
    result: {
      batteryLevelText: readResult.batteryLevelText,
      batteryLevel: readResult.batteryLevel,
      unit: readResult.unit,
      displayText: readResult.displayText,
    },
  }));
} else {
  console.error("⚠️ Could not parse SolaX battery level");
  writeSkillResult(buildSkillResult({
    status: "failed",
    appOpenedStatus: "ok",
    appOpenedNote: "Opened SolaX Cloud in a fresh app session, but polling did not find a readable battery value before timeout.",
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
      raw: readResult.raw,
      setupElapsedMs: setup.elapsedMs,
      pollElapsedMs: readResult.elapsedMs,
      attempts: readResult.attempts,
    },
  }));
  process.exit(2);
}
