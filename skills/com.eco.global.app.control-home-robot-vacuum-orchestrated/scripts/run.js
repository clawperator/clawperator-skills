#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { resolveClawperatorBin, resolveOperatorPackage } = require("../../utils/common.js");
const {
  extractBatteryPercentFromSnapshot,
  inferRobotStateFromSnapshot,
  normalizeAction,
  shouldRetryRobotStateRead,
  shouldSkipActionTap,
} = require("./robot_vacuum_controls.js");

const skillId = "com.eco.global.app.control-home-robot-vacuum-orchestrated";
const skillContractVersion = "1.0.0";
const skillResultFramePrefix = "[Clawperator-Skill-Result]";
const applicationId = "com.eco.global.app";
const stateReadRetryDelayMs = 3000;

function parseJsonInputs(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const deviceId = process.env.CLAWPERATOR_DEVICE_ID || argv[2] || "";
  const jsonInputs = parseJsonInputs(process.env.CLAWPERATOR_SKILL_INPUTS || "{}");
  let action = normalizeAction(jsonInputs.action);
  const restArgs = process.env.CLAWPERATOR_DEVICE_ID ? argv.slice(2) : argv.slice(3);

  for (let index = 0; index < restArgs.length; index += 1) {
    const arg = restArgs[index];
    const next = restArgs[index + 1];

    if (arg === "--action" || arg === "--command") {
      action = normalizeAction(next);
      index += 1;
      continue;
    }
    if (typeof arg === "string" && (arg.startsWith("--action=") || arg.startsWith("--command="))) {
      action = normalizeAction(arg.slice(arg.indexOf("=") + 1));
      continue;
    }
    if (!String(arg).startsWith("--") && action === null) {
      action = normalizeAction(arg);
    }
  }

  return { deviceId, action };
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCheckpoints() {
  return new Map([
    ["app_opened", { id: "app_opened", status: "skipped" }],
    ["current_state_read", { id: "current_state_read", status: "skipped" }],
    ["action_applied", { id: "action_applied", status: "skipped" }],
    ["terminal_state_verified", { id: "terminal_state_verified", status: "skipped" }],
  ]);
}

function setCheckpoint(checkpoints, id, status, updates = {}) {
  checkpoints.set(id, {
    ...(checkpoints.get(id) || { id }),
    status,
    observedAt: nowIso(),
    ...updates,
  });
}

function buildExecution(commandId, actions, timeoutMs = 30000) {
  return {
    commandId,
    taskId: skillId,
    source: skillId,
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  };
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runExecution(clawperatorBin, deviceId, operatorPackage, execution) {
  try {
    const stdout = execFileSync(
      clawperatorBin.cmd,
      [
        ...clawperatorBin.args,
        "exec",
        "--device",
        deviceId,
        "--operator-package",
        operatorPackage,
        "--execution",
        JSON.stringify(execution),
        "--json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }
    );
    return { ok: true, stdout, stderr: "", envelope: tryParseJson(stdout), exitCode: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout?.toString?.("utf8") ?? "",
      stderr: error?.stderr?.toString?.("utf8") ?? "",
      envelope: tryParseJson(error?.stdout?.toString?.("utf8") ?? ""),
      exitCode: typeof error?.status === "number" ? error.status : 1,
      message: error?.message || "clawperator exec failed",
    };
  }
}

function runSnapshotCommand(clawperatorBin, deviceId) {
  try {
    const stdout = execFileSync(
      clawperatorBin.cmd,
      [
        ...clawperatorBin.args,
        "snapshot",
        "--device",
        deviceId,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }
    );
    return { ok: true, stdout, stderr: "", envelope: tryParseJson(stdout), exitCode: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout?.toString?.("utf8") ?? "",
      stderr: error?.stderr?.toString?.("utf8") ?? "",
      envelope: tryParseJson(error?.stdout?.toString?.("utf8") ?? ""),
      exitCode: typeof error?.status === "number" ? error.status : 1,
      message: error?.message || "clawperator snapshot failed",
    };
  }
}

function getStepResults(result) {
  return result?.envelope?.envelope?.stepResults ?? result?.envelope?.stepResults ?? [];
}

function getStepText(result, id) {
  return getStepResults(result).find((step) => step.id === id)?.data?.text ?? "";
}

function readSnapshotText(result) {
  return getStepText(result, "snapshot");
}

function readBatteryPercentFromResult(result, priorBatteryPercent) {
  return extractBatteryPercentFromSnapshot(readSnapshotText(result)) ?? priorBatteryPercent;
}

function buildSkillResult({ status, checkpoints, resultValue, terminalVerification, diagnostics }) {
  return {
    contractVersion: skillContractVersion,
    skillId,
    goal: {
      kind: "control_home_robot_vacuum",
      action: requested.action,
    },
    inputs: {
      action: requested.action,
    },
    result: status === "success" ? { kind: "json", value: resultValue } : null,
    status,
    checkpoints: Array.from(checkpoints.values()),
    terminalVerification,
    diagnostics,
  };
}

async function writeFrame(payload) {
  process.stdout.write(`${skillResultFramePrefix}\n`);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function normalizeStateLabel(state) {
  if (state === "paused") return "paused";
  if (state === "running") return "running";
  if (state === "operating") return "running";
  if (state === "offline") return "offline";
  return null;
}

function parseSnapshotState(snapshotText) {
  return inferRobotStateFromSnapshot(snapshotText);
}

async function retryStateReadIfNeeded({
  clawperatorBin,
  deviceId,
  operatorPackage,
  initialResult,
  observed,
  batteryPercent,
}) {
  if (!shouldRetryRobotStateRead({
    snapshotSucceeded: initialResult.ok,
    observedState: observed.state,
    batteryPercent,
  })) {
    return {
      observed,
      batteryPercent,
      retried: false,
      retryResult: null,
    };
  }

  await sleep(stateReadRetryDelayMs);
  const retryResult = runExecution(
    clawperatorBin,
    deviceId,
    operatorPackage,
    buildSnapshotExecution(`${skillId}-read-state-retry`)
  );
  if (!retryResult.ok) {
    return {
      observed,
      batteryPercent,
      retried: true,
      retryResult,
    };
  }

  const retrySnapshotText = readSnapshotText(retryResult);
  const retryObserved = parseSnapshotState(retrySnapshotText);
  const retryBatteryPercent = extractBatteryPercentFromSnapshot(retrySnapshotText);
  const nextObserved = retryObserved.state ? retryObserved : observed;
  const nextBatteryPercent = retryBatteryPercent ?? batteryPercent;
  if (!nextObserved.state && nextBatteryPercent !== null) {
    return {
      observed: {
        state: "offline",
        primaryActionLabel: null,
        dockActionLabel: retryObserved.dockActionLabel ?? null,
      },
      batteryPercent: nextBatteryPercent,
      retried: true,
      retryResult,
    };
  }

  return {
    observed: nextObserved,
    batteryPercent: nextBatteryPercent,
    retried: true,
    retryResult,
  };
}

function buildOpenAppExecution() {
  return buildExecution(`${skillId}-open-app`, [
    { id: "close", type: "close_app", params: { applicationId } },
    { id: "open", type: "open_app", params: { applicationId } },
    { id: "snapshot", type: "snapshot_ui" },
  ]);
}

function buildSnapshotExecution(commandId) {
  return buildExecution(commandId, [
    { id: "snapshot", type: "snapshot_ui" },
  ]);
}

function buildTapExecution(commandId, label) {
  return buildExecution(commandId, [
    {
      id: "tap",
      type: "click",
      params: { matcher: { textEquals: label } },
    },
    { id: "wait_settle", type: "wait_for_node", params: { matcher: { textContains: "Docking" }, timeoutMs: 15000 } },
    { id: "snapshot", type: "snapshot_ui" },
  ]);
}

const parsed = parseArgs(process.argv);
const requested = {
  action: parsed.action,
};

if (!parsed.deviceId || !parsed.action) {
  console.error("Usage: node run.js <device_id> --action <get_state|start|pause|return_to_dock>");
  process.exit(1);
}

const operatorPackage = resolveOperatorPackage();
const clawperatorBin = resolveClawperatorBin();
const checkpoints = makeCheckpoints();
const diagnostics = {
  runtimeState: "healthy",
  notes: [
    "The runtime infers robot state from the visible left action label or offline message on the main Ecovacs robot surface.",
    "The runtime waits about 3 seconds and retries a state read once if the first snapshot is empty or error-prone before falling back to offline.",
    "Docking is exposed as a visible button, but the UI does not expose a separate dock-complete sensor.",
  ],
};

function fail(message, stage, result, note) {
  if (stage) {
    setCheckpoint(checkpoints, stage, "failed", { note: message });
  }
  const payload = buildSkillResult({
    status: "failed",
    checkpoints,
    resultValue: null,
    terminalVerification: { status: "not_run", note: message },
    diagnostics: { ...diagnostics, failure: note || message },
  });
  return writeFrame(payload).then(() => process.exit(1));
}

async function main() {
  const openResult = runExecution(clawperatorBin, parsed.deviceId, operatorPackage, buildOpenAppExecution());
  if (!openResult.ok) {
    return fail(openResult.message, "app_opened", openResult, "Failed to open the Ecovacs app.");
  }

  setCheckpoint(checkpoints, "app_opened", "ok", {
    evidence: { kind: "text", text: "Opened com.eco.global.app and captured the live Ecovacs surface." },
  });

  const openSnapshot = readSnapshotText(openResult);
  let batteryPercent = extractBatteryPercentFromSnapshot(openSnapshot);
  const batterySnapshotResult = runSnapshotCommand(clawperatorBin, parsed.deviceId);
  if (batterySnapshotResult.ok) {
    batteryPercent = readBatteryPercentFromResult(batterySnapshotResult, batteryPercent);
  }
  let observed = parseSnapshotState(openSnapshot);
  const retryStateRead = await retryStateReadIfNeeded({
    clawperatorBin,
    deviceId: parsed.deviceId,
    operatorPackage,
    initialResult: openResult,
    observed,
    batteryPercent,
  });
  observed = retryStateRead.observed;
  batteryPercent = retryStateRead.batteryPercent;
  if (!observed.state) {
    const fallbackResult = runExecution(
      clawperatorBin,
      parsed.deviceId,
      operatorPackage,
      buildSnapshotExecution(`${skillId}-read-state`)
    );
    if (!fallbackResult.ok) {
      return fail(
        fallbackResult.message,
        "current_state_read",
        fallbackResult,
        "The robot state could not be read from the live UI."
      );
    }
    observed = parseSnapshotState(readSnapshotText(fallbackResult));
    if (batteryPercent === null) {
      batteryPercent = extractBatteryPercentFromSnapshot(readSnapshotText(fallbackResult));
    }
    if (!observed.state) {
      return fail(
        "Could not infer robot state from the visible Start/Pause/Offline surface after a retry.",
        "current_state_read",
        fallbackResult,
        "The live UI did not expose Start, Pause, or Offline after waiting and retrying once."
      );
    }
  }

  setCheckpoint(checkpoints, "current_state_read", "ok", {
    observedState: observed.state,
    evidence: {
      kind: "json",
      value: {
        state: observed.state,
        primaryActionLabel: observed.primaryActionLabel,
        dockActionLabel: observed.dockActionLabel,
        batteryPercent,
      },
    },
  });

  const resultValue = {
    action: requested.action,
    current_state: normalizeStateLabel(observed.state),
    primary_action_label: observed.primaryActionLabel,
    dock_action_label: observed.dockActionLabel,
    battery_percent: batteryPercent,
  };

  if (requested.action === "get_state") {
    if (batteryPercent === null) {
      return fail(
        "Could not infer battery percentage from the visible UI.",
        "current_state_read",
        openResult,
        "The live UI did not expose a readable battery percentage."
      );
    }
    setCheckpoint(checkpoints, "action_applied", "skipped", {
      note: "No tap was needed for get_state.",
    });
    setCheckpoint(checkpoints, "terminal_state_verified", "ok", {
      note: "Verified by rereading the live UI without mutating the device state.",
    });
    return writeFrame(
      buildSkillResult({
        status: "success",
        checkpoints,
        resultValue,
        terminalVerification: {
          status: "verified",
          expected: { kind: "text", text: "Visible Start, Pause, or Offline state and battery percentage on the robot surface" },
          observed: { kind: "json", value: resultValue },
        },
        diagnostics,
      })
    );
  }

  if (observed.state === "offline") {
    return fail(
      "The Ecovacs app is offline, so control actions are unavailable until the device reconnects.",
      "action_applied",
      null,
      "The live UI reported Offline with the device help message."
    );
  }

  const desiredState = requested.action === "start" ? "running" : requested.action === "pause" ? "paused" : null;

  if (requested.action === "start" || requested.action === "pause") {
    if (!desiredState) {
      return fail("Invalid action requested.", "action_applied", null, "Unsupported action.");
    }

    const desiredLabel = requested.action === "start" ? "Start" : "Pause";
    if (shouldSkipActionTap(requested.action, observed.state)) {
      setCheckpoint(checkpoints, "action_applied", "skipped", {
        note: `The robot was already ${normalizeStateLabel(observed.state)}; no tap was needed.`,
      });
    } else {
      const tapResult = runExecution(
        clawperatorBin,
        parsed.deviceId,
        operatorPackage,
        buildTapExecution(`${skillId}-${requested.action}`, desiredLabel)
      );
      if (!tapResult.ok) {
        return fail(tapResult.message, "action_applied", tapResult, `Failed to tap ${desiredLabel}.`);
      }
      setCheckpoint(checkpoints, "action_applied", "ok", {
        evidence: { kind: "text", text: `Tapped ${desiredLabel} on the robot surface.` },
      });
      const postSnapshot = getStepText(tapResult, "snapshot");
      observed = parseSnapshotState(postSnapshot);
      if (!observed.state) {
        return fail(
          `Could not verify the post-action state after tapping ${desiredLabel}.`,
          "terminal_state_verified",
          tapResult,
          "The live UI did not expose a readable Start/Pause label after the tap."
        );
      }
      resultValue.current_state = normalizeStateLabel(observed.state);
      resultValue.primary_action_label = observed.primaryActionLabel;
      resultValue.dock_action_label = observed.dockActionLabel;
    }

    if (resultValue.current_state !== desiredState) {
      return fail(
        `Expected ${desiredState} after ${requested.action}, but the live UI still read ${resultValue.current_state}.`,
        "terminal_state_verified",
        null,
        "The observed Start/Pause label did not match the requested command."
      );
    }

    setCheckpoint(checkpoints, "terminal_state_verified", "ok", {
      note: `Verified the live UI shows ${resultValue.primary_action_label} after the action.`,
    });
    return writeFrame(
      buildSkillResult({
        status: "success",
        checkpoints,
        resultValue,
        terminalVerification: {
          status: "verified",
          expected: { kind: "text", text: desiredLabel },
          observed: { kind: "text", text: resultValue.primary_action_label || "" },
        },
        diagnostics,
      })
    );
  }

  if (requested.action === "return_to_dock") {
    const tapResult = runExecution(
      clawperatorBin,
      parsed.deviceId,
      operatorPackage,
      buildTapExecution(`${skillId}-return-to-dock`, "Docking")
    );
    if (!tapResult.ok) {
      return fail(tapResult.message, "action_applied", tapResult, "Failed to tap Docking.");
    }
    setCheckpoint(checkpoints, "action_applied", "ok", {
      evidence: { kind: "text", text: "Tapped Docking on the robot surface." },
    });
    const postSnapshot = getStepText(tapResult, "snapshot");
    observed = parseSnapshotState(postSnapshot) || observed;
    if (observed.state === "offline") {
      return fail(
        "The Ecovacs app reported Offline after the Docking tap, so the command could not be verified.",
        "terminal_state_verified",
        tapResult,
        "The live UI switched to the offline error surface instead of confirming docking."
      );
    }
    resultValue.current_state = normalizeStateLabel(observed.state);
    resultValue.primary_action_label = observed.primaryActionLabel;
    resultValue.dock_action_label = observed.dockActionLabel;
    setCheckpoint(checkpoints, "terminal_state_verified", "ok", {
      note: "Verified by rereading the live UI after the Docking tap.",
    });
    return writeFrame(
      buildSkillResult({
        status: "success",
        checkpoints,
        resultValue: {
          ...resultValue,
          docking_command_sent: true,
        },
        terminalVerification: {
          status: "verified",
          expected: { kind: "text", text: "Docking button tap accepted" },
          observed: { kind: "json", value: resultValue },
          note: "The Ecovacs surface exposes Start/Pause state, not a separate dock-complete flag.",
        },
        diagnostics,
      })
    );
  }

  return fail("Unsupported action requested.", "action_applied", null, "The action could not be normalized.");
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await writeFrame(
    buildSkillResult({
      status: "failed",
      checkpoints,
      resultValue: null,
      terminalVerification: { status: "not_run", note: "Unhandled runtime error before completion." },
      diagnostics: { ...diagnostics, failure: message },
    })
  );
  process.exit(1);
});
