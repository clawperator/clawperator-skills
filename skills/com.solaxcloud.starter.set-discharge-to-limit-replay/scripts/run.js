#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { resolveClawperatorBin, resolveOperatorPackage } = require("../../utils/common.js");

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

if (!/^\d+$/.test(percentArg)) {
  console.error(`Invalid discharge-to-limit percentage: ${percentArg}. Expected an integer from 0 to 100.`);
  process.exit(1);
}

const percent = Number.parseInt(percentArg, 10);

if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
  console.error(`Invalid discharge-to-limit percentage: ${percentArg}. Expected an integer from 0 to 100.`);
  process.exit(1);
}

const resolvedClawperatorBin = resolveClawperatorBin();
const operatorPackage = resolveOperatorPackage();
const skillId = "com.solaxcloud.starter.set-discharge-to-limit-replay";
const targetText = String(percent);
const forceFailure = process.env.CLAWPERATOR_SOLAX_REPLAY_FORCE_FAILURE === "1";
const skillResultFramePrefix = "[Clawperator-Skill-Result]";
const skillResultContractVersion = "1.0.0";

const checkpointOrder = [
  "app_opened",
  "discharge_to_row_focused",
  "target_text_entered",
  "save_completed",
  "terminal_state_verified",
];

const checkpointState = new Map(
  checkpointOrder.map(id => [id, { id, status: "skipped" }])
);
const diagnostics = {
  warnings: [],
};

function nowIso() {
  return new Date().toISOString();
}

function setCheckpoint(id, status, updates = {}) {
  checkpointState.set(id, {
    ...(checkpointState.get(id) ?? { id }),
    status,
    observedAt: nowIso(),
    ...updates,
  });
}

function buildSkillResult(status, terminalVerification) {
  return {
    contractVersion: skillResultContractVersion,
    skillId,
    goal: {
      kind: "set_discharge_limit",
      percent,
    },
    inputs: {
      percent,
    },
    status,
    checkpoints: checkpointOrder.map(id => checkpointState.get(id)),
    terminalVerification,
  };
}

function writeToStream(stream, chunk) {
  if (!chunk) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    stream.write(chunk, error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function writeStdout(chunk) {
  return writeToStream(process.stdout, chunk);
}

function writeStderr(chunk) {
  return writeToStream(process.stderr, chunk);
}

async function emitSkillResult(status, terminalVerification) {
  const result = buildSkillResult(status, terminalVerification);
  if (diagnostics.warnings.length > 0) {
    result.diagnostics = diagnostics;
  }
  await writeStdout(`${skillResultFramePrefix}\n`);
  await writeStdout(`${JSON.stringify(result)}\n`);
}

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
      resolvedClawperatorBin.cmd,
      [
        ...resolvedClawperatorBin.args,
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
    const envelope = tryParseJson(stdout);
    if (!envelope) {
      return {
        ok: false,
        stdout,
        stderr: "",
        envelope: null,
        exitCode: 1,
        message: "clawperator exec returned non-JSON output",
      };
    }
    return {
      ok: true,
      stdout,
      stderr: "",
      envelope,
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

function getExecFailureSummary(result) {
  const nestedError = result?.envelope?.envelope?.error ?? result?.envelope?.error;
  if (typeof nestedError === "string" && nestedError.length > 0) {
    return nestedError;
  }
  if (typeof result?.envelope?.message === "string" && result.envelope.message.length > 0) {
    return result.envelope.message;
  }
  if (typeof result?.envelope?.code === "string" && result.envelope.code.length > 0) {
    return result.envelope.code;
  }
  if (typeof result?.message === "string" && result.message.length > 0) {
    return result.message.replace(/^Command failed:\s*/, "");
  }
  return "clawperator exec failed";
}

function isResultEnvelopeTimeout(result) {
  return result?.envelope?.code === "RESULT_ENVELOPE_TIMEOUT";
}

function updateNavigateCheckpoints(result) {
  const stepResults = getStepResults(result);
  if (stepResults.find(step => step.id === "wait_home" && step.success)) {
    setCheckpoint("app_opened", "ok", {
      evidence: {
        kind: "text",
        text: "Intelligence tab entrypoint became available after opening the app.",
      },
    });
  }
  if (
    stepResults.find(step => step.id === "wait_discharge_row" && step.success) &&
    stepResults.find(step => step.id === "read_before" && step.success)
  ) {
    setCheckpoint("discharge_to_row_focused", "ok", {
      evidence: {
        kind: "text",
        text: getStepText(result, "read_before") || "Discharge row became readable.",
      },
    });
  }
}

async function exitWithExecFailure(result, failingCheckpointId, terminalVerification) {
  const failureSummary = getExecFailureSummary(result);
  if (failingCheckpointId) {
    const updates = {};
    updates.evidence = {
      kind: "text",
      text: failureSummary,
    };
    updates.note = failureSummary;
    setCheckpoint(failingCheckpointId, "failed", updates);
  }
  if (result.stdout) await writeStdout(result.stdout);
  if (result.stderr) await writeStderr(result.stderr);
  if (!result.stdout && !result.stderr) {
    await writeStderr(`${failureSummary}\n`);
  }
  await emitSkillResult("failed", terminalVerification ?? { status: "not_run", note: "Skill did not reach terminal verification." });
  process.exitCode = typeof result.exitCode === "number" && result.exitCode !== 0 ? result.exitCode : 1;
}

function getStepResults(result) {
  return result?.envelope?.envelope?.stepResults ?? result?.envelope?.stepResults ?? [];
}

function getStepText(result, stepId) {
  return getStepResults(result).find(step => step.id === stepId)?.data?.text ?? "";
}

function extractPercent(text) {
  const match = String(text).match(/Discharge to\s*(\d+)%/i);
  return match ? match[1] : null;
}

function sleepSync(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function buildExecution(name, timeoutMs, actions) {
  return {
    commandId: `${skillId}-${name}-${Date.now()}`,
    taskId: skillId,
    source: skillId,
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  };
}

async function waitForPeakExportSurfaceAfterToolbarSave(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshotResult = runClawperatorExecution(
      buildExecution("wait-post-toolbar-save-snapshot", 15000, [
        { id: "snapshot", type: "snapshot_ui", params: {} },
      ])
    );
    if (!snapshotResult.ok) {
      await exitWithExecFailure(snapshotResult, "save_completed");
      return false;
    }

    const xml = getStepText(snapshotResult, "snapshot");
    if (xml.includes('text="Peak Export"')) {
      return true;
    }

    sleepSync(750);
  }

  const message = "Timed out waiting for the post-toolbar-save Peak Export screen to appear.";
  setCheckpoint("save_completed", "failed", {
    evidence: {
      kind: "text",
      text: message,
    },
    note: message,
  });
  await writeStderr(`${message}\n`);
  await emitSkillResult("failed", {
    status: "not_run",
    note: message,
  });
  process.exitCode = 1;
  return false;
}

function runAdb(args) {
  execFileSync("adb", ["-s", deviceId, ...args], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const navigateToInputExecution = buildExecution("navigate", 90000, [
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
  ]);

const toolbarSaveExecution = buildExecution("save-toolbar", 45000, [
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
    { id: "wait_after_toolbar_save", type: "sleep", params: { durationMs: 1000 } },
  ]);

const finalizeSaveExecution = buildExecution("save-final", 30000, [
    {
      id: "save_bottom_sheet",
      type: "click",
      params: {
        matcher: { textEquals: "Save" },
      },
    },
    { id: "wait_after_final_save", type: "sleep", params: { durationMs: 4000 } },
  ]);

const confirmSaveCancellationPromptExecution = buildExecution("confirm-save-cancellation-prompt", 15000, [
    {
      id: "confirm_save_cancellation_prompt",
      type: "click",
      params: {
        matcher: { textEquals: "Confirm" },
      },
    },
    { id: "wait_after_save_cancellation_prompt_confirm", type: "sleep", params: { durationMs: 3500 } },
  ]);

const verifyExecution = buildExecution("verify", 45000, [
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
  ]);

const forceFailureExecution = buildExecution("forced-failure", 15000, [
    {
      id: "force_missing_node",
      type: "wait_for_node",
      params: {
        matcher: { textEquals: "__FORCED_SOLAX_REPLAY_FAILURE__" },
        timeoutMs: 1500,
      },
    },
  ]);

async function handleOptionalSaveCancellationPrompt() {
  const snapshotResult = runClawperatorExecution(
    buildExecution("optional-save-cancellation-prompt-snapshot", 15000, [
      { id: "snapshot", type: "snapshot_ui", params: {} },
    ])
  );
  if (!snapshotResult.ok) {
    await exitWithExecFailure(snapshotResult, "save_completed");
    return false;
  }

  const xml = getStepText(snapshotResult, "snapshot");
  if (!xml.includes("The save operation will cancel the currently executing scenario")) {
    return true;
  }

  diagnostics.warnings.push("Optional save-cancellation prompt appeared and was confirmed before terminal verification.");
  const confirmPromptResult = runClawperatorExecution(confirmSaveCancellationPromptExecution);
  if (!confirmPromptResult.ok) {
    await exitWithExecFailure(confirmPromptResult, "save_completed");
    return false;
  }
  return true;
}

async function main() {
  const navigateResult = runClawperatorExecution(navigateToInputExecution);
  if (!navigateResult.ok) {
    updateNavigateCheckpoints(navigateResult);
    await exitWithExecFailure(
      navigateResult,
      checkpointState.get("discharge_to_row_focused")?.status === "ok" ? "target_text_entered" : "discharge_to_row_focused"
    );
    return;
  }
  updateNavigateCheckpoints(navigateResult);

  const beforeRowText = getStepText(navigateResult, "read_before");
  const beforePercent = extractPercent(beforeRowText);

  for (let i = 0; i < 4; i += 1) {
    runAdb(["shell", "input", "keyevent", "67"]);
  }
  runAdb(["shell", "input", "text", targetText]);
  runAdb(["shell", "input", "keyevent", "66"]);
  setCheckpoint("target_text_entered", "ok", {
    evidence: {
      kind: "text",
      text: targetText,
    },
  });

  if (forceFailure) {
    const forcedFailureResult = runClawperatorExecution(forceFailureExecution);
    if (!forcedFailureResult.ok) {
      await exitWithExecFailure(forcedFailureResult, "save_completed");
      return;
    }
  }

  const toolbarSaveResult = runClawperatorExecution(toolbarSaveExecution);
  if (!toolbarSaveResult.ok && !isResultEnvelopeTimeout(toolbarSaveResult)) {
    await exitWithExecFailure(toolbarSaveResult, "save_completed");
    return;
  }
  if (!toolbarSaveResult.ok && isResultEnvelopeTimeout(toolbarSaveResult)) {
    diagnostics.warnings.push("Toolbar save timed out waiting for the Operator result envelope; post-toolbar UI state was verified by snapshot before continuing.");
  }

  const peakExportVisible = await waitForPeakExportSurfaceAfterToolbarSave();
  if (!peakExportVisible) {
    return;
  }

  const finalizeSaveResult = runClawperatorExecution(finalizeSaveExecution);
  if (!finalizeSaveResult.ok) {
    await exitWithExecFailure(finalizeSaveResult, "save_completed");
    return;
  }

  const optionalPromptHandled = await handleOptionalSaveCancellationPrompt();
  if (!optionalPromptHandled) {
    return;
  }

  setCheckpoint("save_completed", "ok", {
    evidence: {
      kind: "text",
      text: "Toolbar save and bottom-sheet save completed.",
    },
  });

  const verifyResult = runClawperatorExecution(verifyExecution);
  if (!verifyResult.ok) {
    await exitWithExecFailure(
      verifyResult,
      "terminal_state_verified",
      { status: "failed", note: "Verification exec failed before the final discharge row could be read." }
    );
    return;
  }

  const observedRowText = getStepText(verifyResult, "read_discharge_row_after_save");
  const observedPercent = extractPercent(observedRowText);

  if (observedPercent !== targetText) {
    setCheckpoint("terminal_state_verified", "failed", {
      evidence: {
        kind: "text",
        text: observedRowText || "<empty>",
      },
      note: `Expected discharge-to-limit ${targetText}%.`,
    });
    if (verifyResult.stdout) {
      await writeStdout(verifyResult.stdout);
    }
    await writeStderr(
      `Terminal verification failed: expected discharge-to-limit ${targetText}%, observed "${observedRowText || "<empty>"}".\n`
    );
    await emitSkillResult("failed", {
      status: "failed",
      expected: {
        kind: "text",
        text: `Discharge to ${targetText}%`,
      },
      observed: {
        kind: "text",
        text: observedRowText || "<empty>",
      },
      note: "Final discharge row did not match the requested percentage.",
    });
    process.exitCode = 1;
    return;
  }

  if (beforePercent === targetText) {
    const note =
      `Terminal verification note: discharge-to-limit already showed ${targetText}% before the change, so this run proves final state but not that the value changed from a different starting value.`;
    diagnostics.warnings.push(note);
    await writeStderr(`${note}\n`);
  }

  await writeStdout(verifyResult.stdout);
  setCheckpoint("terminal_state_verified", "ok", {
    evidence: {
      kind: "text",
      text: observedRowText || "<empty>",
    },
  });
  await emitSkillResult("success", {
    status: "verified",
    expected: {
      kind: "text",
      text: `Discharge to ${targetText}%`,
    },
    observed: {
      kind: "text",
      text: observedRowText || "<empty>",
    },
  });
}

main().catch(async (err) => {
  const stderr = err?.stderr?.toString?.("utf8") ?? "";
  const message = stderr || err.message || "clawperator execution failed";
  if (checkpointState.get("target_text_entered")?.status !== "ok") {
    setCheckpoint("target_text_entered", "failed", { note: message });
  } else if (checkpointState.get("save_completed")?.status !== "ok") {
    setCheckpoint("save_completed", "failed", { note: message });
  } else {
    setCheckpoint("terminal_state_verified", "failed", { note: message });
  }
  await writeStderr(`${message}\n`);
  await emitSkillResult("failed", {
    status: "failed",
    note: message,
  });
  process.exitCode = 1;
});
