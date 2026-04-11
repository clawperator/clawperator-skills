#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function parseCommand(command) {
  const parts = (command || "clawperator").match(/(?:[^\s"]+|"[^"]*")+/g) || ["clawperator"];
  return parts.map(part => part.replace(/^"(.*)"$/, "$1"));
}

function parsePercentArg(argv) {
  const [, , deviceId, firstArg, secondArg] = argv;
  if (!deviceId) {
    return { deviceId: undefined, percentArg: undefined };
  }
  if (firstArg === "--limit") {
    return { deviceId, percentArg: secondArg };
  }
  if (typeof firstArg === "string" && firstArg.startsWith("--limit=")) {
    return { deviceId, percentArg: firstArg.slice("--limit=".length) };
  }
  return { deviceId, percentArg: firstArg };
}

const { deviceId, percentArg } = parsePercentArg(process.argv);

if (!deviceId || !percentArg) {
  console.error("Usage: node run.js <device_id> [--limit <percent>|<percent>]");
  process.exit(1);
}

const percent = Number.parseInt(percentArg, 10);

if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
  console.error(`Invalid discharge-to-limit percentage: ${percentArg}. Expected an integer from 0 to 100.`);
  process.exit(1);
}

const [rawClawperatorCmd, ...clawperatorPrefixArgs] = parseCommand(process.env.CLAWPERATOR_BIN || "clawperator");
const clawperatorCmd = rawClawperatorCmd === "node" ? process.execPath : rawClawperatorCmd;
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator";
const skillId = "com.solaxcloud.starter.set-discharge-to-limit-replay";
const targetText = String(percent);
const forceFailure = process.env.CLAWPERATOR_SOLAX_REPLAY_FORCE_FAILURE === "1";

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runClawperatorExecution(execution) {
  try {
    const stdout = execFileSync(
      clawperatorCmd,
      [
        ...clawperatorPrefixArgs,
        "exec",
        "--device",
        deviceId,
        "--operator-package",
        operatorPackage,
        "--execution",
        JSON.stringify(execution),
        "--json",
      ],
      {
        encoding: "utf8",
        timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return {
      ok: true,
      stdout,
      stderr: "",
      envelope: tryParseJson(stdout),
      exitCode: 0,
    };
  } catch (err) {
    const stdout = err?.stdout?.toString?.("utf8") ?? "";
    const stderr = err?.stderr?.toString?.("utf8") ?? "";
    return {
      ok: false,
      stdout,
      stderr,
      envelope: tryParseJson(stdout),
      exitCode: typeof err?.status === "number" ? err.status : 1,
      message: err?.message ?? "clawperator execution failed",
    };
  }
}

function exitWithExecFailure(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.stdout && !result.stderr && result.message) {
    console.error(result.message);
  }
  process.exit(typeof result.exitCode === "number" && result.exitCode !== 0 ? result.exitCode : 1);
}

function getStepText(result, stepId) {
  return result?.envelope?.envelope?.stepResults?.find(step => step.id === stepId)?.data?.text ?? "";
}

function extractPercent(text) {
  const match = String(text).match(/Discharge to\s*(\d+)%/i);
  return match ? match[1] : null;
}

function runAdb(args) {
  execFileSync("adb", ["-s", deviceId, ...args], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const navigateToInputExecution = {
  commandId: `${skillId}-${Date.now()}`,
  taskId: skillId,
  source: skillId,
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.solaxcloud.starter" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.solaxcloud.starter" } },
    {
      id: "wait_home",
      type: "wait_for_node",
      params: {
        matcher: { resourceId: "com.solaxcloud.starter:id/tab_intelligent" },
        timeoutMs: 20000,
      },
    },
    {
      id: "open_intelligence",
      type: "click",
      params: {
        matcher: { resourceId: "com.solaxcloud.starter:id/tab_intelligent" },
      },
    },
    { id: "wait_intelligence", type: "sleep", params: { durationMs: 3500 } },
    {
      id: "open_peak_export",
      type: "click",
      params: {
        coordinate: { x: 860, y: 1399 },
      },
    },
    { id: "wait_peak_export", type: "sleep", params: { durationMs: 3000 } },
    {
      id: "wait_discharge_action",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Device Discharging" },
        timeoutMs: 15000,
      },
    },
    {
      id: "open_discharge_action",
      type: "click",
      params: {
        coordinate: { x: 875, y: 1548 },
      },
    },
    { id: "wait_discharge_action_open", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "wait_discharge_row",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Discharge to" },
        timeoutMs: 10000,
      },
    },
    {
      id: "read_before",
      type: "read_text",
      params: {
        matcher: { textContains: "Discharge to" },
      },
    },
    {
      id: "open_discharge_dialog",
      type: "click",
      params: {
        matcher: { textContains: "Discharge to" },
      },
    },
    {
      id: "wait_input",
      type: "wait_for_node",
      params: {
        matcher: { resourceId: "van-field-1-input" },
        timeoutMs: 10000,
      },
    },
    {
      id: "focus_input",
      type: "click",
      params: {
        matcher: { resourceId: "van-field-1-input" },
      },
    },
    { id: "wait_keyboard", type: "sleep", params: { durationMs: 1000 } },
  ],
};

const saveExecution = {
  commandId: `${skillId}-save-${Date.now()}`,
  taskId: skillId,
  source: skillId,
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    {
      id: "confirm_dialog",
      type: "click",
      params: {
        matcher: { textEquals: "Confirm" },
      },
    },
    { id: "wait_after_confirm", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "wait_discharge_row_after_confirm",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Discharge to" },
        timeoutMs: 10000,
      },
    },
    {
      id: "save_toolbar",
      type: "click",
      params: {
        matcher: { textEquals: "Save" },
      },
    },
    {
      id: "wait_outer_save_context",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Device Discharging" },
        timeoutMs: 10000,
      },
    },
    { id: "wait_after_toolbar_save", type: "sleep", params: { durationMs: 1000 } },
    {
      id: "save_bottom_sheet",
      type: "click",
      params: {
        coordinate: { x: 540, y: 2133 },
      },
    },
    { id: "wait_after_final_save", type: "sleep", params: { durationMs: 4000 } },
  ],
};

const verifyExecution = {
  commandId: `${skillId}-verify-${Date.now()}`,
  taskId: skillId,
  source: skillId,
  expectedFormat: "android-ui-automator",
  timeoutMs: 45000,
  actions: [
    { id: "wait_before_verify_nav", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "reopen_peak_export",
      type: "click",
      params: {
        coordinate: { x: 860, y: 1399 },
      },
    },
    { id: "wait_peak_export_for_verify", type: "sleep", params: { durationMs: 3000 } },
    {
      id: "wait_discharge_action_for_verify",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Device Discharging" },
        timeoutMs: 15000,
      },
    },
    {
      id: "reopen_discharge_action",
      type: "click",
      params: {
        coordinate: { x: 875, y: 1548 },
      },
    },
    { id: "wait_discharge_action_reopened", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "wait_discharge_row_after_save",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Discharge to" },
        timeoutMs: 10000,
      },
    },
    {
      id: "read_discharge_row_after_save",
      type: "read_text",
      params: {
        matcher: { textContains: "Discharge to" },
      },
    },
  ],
};

const forceFailureExecution = {
  commandId: `${skillId}-forced-failure-${Date.now()}`,
  taskId: skillId,
  source: skillId,
  expectedFormat: "android-ui-automator",
  timeoutMs: 15000,
  actions: [
    {
      id: "force_missing_node",
      type: "wait_for_node",
      params: {
        matcher: { textEquals: "__FORCED_SOLAX_REPLAY_FAILURE__" },
        timeoutMs: 1500,
      },
    },
  ],
};

try {
  const navigateResult = runClawperatorExecution(navigateToInputExecution);
  if (!navigateResult.ok) exitWithExecFailure(navigateResult);

  const beforeRowText = getStepText(navigateResult, "read_before");
  const beforePercent = extractPercent(beforeRowText);

  for (let i = 0; i < 4; i += 1) {
    runAdb(["shell", "input", "keyevent", "67"]);
  }
  runAdb(["shell", "input", "text", targetText]);
  runAdb(["shell", "input", "keyevent", "66"]);

  if (forceFailure) {
    const forcedFailureResult = runClawperatorExecution(forceFailureExecution);
    if (!forcedFailureResult.ok) exitWithExecFailure(forcedFailureResult);
  }

  const saveResult = runClawperatorExecution(saveExecution);
  if (!saveResult.ok) exitWithExecFailure(saveResult);

  const verifyResult = runClawperatorExecution(verifyExecution);
  if (!verifyResult.ok) exitWithExecFailure(verifyResult);

  const observedRowText = getStepText(verifyResult, "read_discharge_row_after_save");
  const observedPercent = extractPercent(observedRowText);

  if (observedPercent !== targetText) {
    if (verifyResult.stdout) process.stdout.write(verifyResult.stdout);
    console.error(
      `Terminal verification failed: expected discharge-to-limit ${targetText}%, observed "${observedRowText || "<empty>"}".`
    );
    process.exit(1);
  }

  if (beforePercent === targetText) {
    console.error(
      `Terminal verification note: discharge-to-limit already showed ${targetText}% before the change, so this run proves final state but not that the value changed from a different starting value.`
    );
  }

  process.stdout.write(verifyResult.stdout);
} catch (err) {
  const stderr = err?.stderr?.toString?.("utf8") ?? "";
  console.error(stderr || err.message || "clawperator execution failed");
  process.exit(1);
}
