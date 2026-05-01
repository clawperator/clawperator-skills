#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { resolveClawperatorBin, resolveOperatorPackage } = require("../../utils/common.js");

const skillId = "com.google.android.apps.chromecast.app.set-power-replay";
const SKILL_RESULT_FRAME_PREFIX = "[Clawperator-Skill-Result]";
const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";
const APP_ID = "com.google.android.apps.chromecast.app";

function parseArgs(argv) {
  const [, , deviceId, ...restArgs] = argv;
  if (!deviceId) {
    return { deviceId: undefined, desiredStateArg: undefined, unitNameArg: undefined };
  }
  let desiredStateArg;
  let unitNameArg;

  for (let index = 0; index < restArgs.length; index += 1) {
    const arg = restArgs[index];
    const next = restArgs[index + 1];

    if (arg === "--climate-state") {
      desiredStateArg = next;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--climate-state=")) {
      desiredStateArg = arg.slice("--climate-state=".length);
      continue;
    }
    if (arg === "--state") {
      desiredStateArg = next;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--state=")) {
      desiredStateArg = arg.slice("--state=".length);
      continue;
    }
    if (arg === "--unit-name") {
      unitNameArg = next;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--unit-name=")) {
      unitNameArg = arg.slice("--unit-name=".length);
      continue;
    }
    if (desiredStateArg === undefined && !String(arg).startsWith("--")) {
      desiredStateArg = arg;
    }
  }
  return { deviceId, desiredStateArg, unitNameArg };
}

function normalizeDesiredState(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "on") return "On";
  if (normalized === "off") return "Off";
  return null;
}

const { deviceId, desiredStateArg, unitNameArg } = parseArgs(process.argv);
const desiredState = normalizeDesiredState(desiredStateArg);

if (!deviceId || !desiredState || !unitNameArg) {
  console.error('Usage: node run.js <device_id> --climate-state <on|off> --unit-name "<label>"');
  process.exit(1);
}
const unitName = String(unitNameArg).trim();
if (!unitName) {
  console.error("Invalid unit name: expected a non-empty label.");
  process.exit(1);
}

const operatorPackage = resolveOperatorPackage();
const resolvedClawperatorBin = resolveClawperatorBin();

const checkpointOrder = [
  "app_opened",
  "controller_opened",
  "current_power_read",
  "power_toggled",
  "terminal_state_verified",
];

const checkpointState = new Map(
  checkpointOrder.map(id => [id, { id, status: "skipped" }])
);

const diagnostics = {
  warnings: [],
  hints: [
    "This replay trusts a fresh-session reread of the Google Home controller because the immediate post-toggle view can be stale.",
  ],
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
  const result = status === "success"
    ? {
        kind: "json",
        value: {
          climate_state: desiredState.toLowerCase(),
          unit_name: unitName,
        },
      }
    : null;
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: "set_climate_power",
      climate_state: desiredState.toLowerCase(),
    },
    inputs: {
      climate_state: desiredState.toLowerCase(),
      unit_name: unitName,
    },
    result,
    status,
    checkpoints: checkpointOrder.map(id => checkpointState.get(id)),
    terminalVerification,
    diagnostics,
  };
}

async function writeToStream(stream, chunk) {
  if (!chunk) return;
  await new Promise((resolve, reject) => {
    stream.write(chunk, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function emitSkillResult(status, terminalVerification) {
  await writeToStream(process.stdout, `${SKILL_RESULT_FRAME_PREFIX}\n`);
  await writeToStream(process.stdout, `${JSON.stringify(buildSkillResult(status, terminalVerification))}\n`);
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runExecution(execution) {
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
    return { ok: true, stdout, stderr: "", envelope: tryParseJson(stdout), exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: err?.stdout?.toString?.("utf8") ?? "",
      stderr: err?.stderr?.toString?.("utf8") ?? "",
      envelope: tryParseJson(err?.stdout?.toString?.("utf8") ?? ""),
      exitCode: typeof err?.status === "number" ? err.status : 1,
      message: err?.message ?? "clawperator exec failed",
    };
  }
}

function getStepResults(result) {
  return result?.envelope?.envelope?.stepResults ?? result?.envelope?.stepResults ?? [];
}

function getStepText(result, id) {
  return getStepResults(result).find(step => step.id === id)?.data?.text ?? "";
}

function normalizeText(text) {
  return String(text || "").trim();
}

function sameLabel(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function parseControllerTitle(snapshotText) {
  const text = String(snapshotText || "");
  const toolbarMatch = text.match(/text="([^"]+)" resource-id="com\.google\.android\.apps\.chromecast\.app:id\/toolbar_title"/);
  if (toolbarMatch) return toolbarMatch[1];
  const closeThenTitleMatch = text.match(/content-desc="Close"[\s\S]{0,400}?text="([^"]+)"/);
  if (closeThenTitleMatch) return closeThenTitleMatch[1];
  return "";
}

function normalizeObservedPower(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (normalized === "on") return "On";
  if (normalized === "off") return "Off";
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return "On";
  const numericCandidate = normalized.replace(/[^\d.-]+/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(numericCandidate)) return "On";
  return null;
}

function buildExecution(name, actions, timeoutMs = 90000) {
  return {
    commandId: `${skillId}-${name}-${Date.now()}`,
    taskId: skillId,
    source: skillId,
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  };
}

function buildOpenControllerActions() {
  return [
    { id: "close", type: "close_app", params: { applicationId: APP_ID } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: APP_ID } },
    { id: "wait_open", type: "sleep", params: { durationMs: 3500 } },
    { id: "go_home", type: "click", params: { matcher: { textEquals: "Home" } } },
    { id: "wait_home", type: "sleep", params: { durationMs: 1500 } },
    {
      id: "open_climate",
      type: "scroll_and_click",
      params: {
        matcher: { textEquals: "Climate" },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/category_chips" },
        direction: "right",
        maxSwipes: 6,
        clickType: "click",
        findFirstScrollableChild: true,
      },
    },
    { id: "wait_after_climate", type: "sleep", params: { durationMs: 1500 } },
    {
      id: "open_unit_controller",
      type: "scroll_and_click",
      params: {
        matcher: {
          resourceId: "com.google.android.apps.chromecast.app:id/control",
          textContains: unitName,
        },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/pager_home_tab" },
        direction: "down",
        maxSwipes: 12,
        clickType: "long_click",
      },
    },
    {
      id: "wait_controller",
      type: "wait_for_node",
      params: {
        matcher: { resourceId: "com.google.android.apps.chromecast.app:id/climate_power_button" },
        timeoutMs: 20000,
      },
    },
    {
      id: "read_power",
      type: "read_text",
      params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } },
    },
    { id: "snap_controller", type: "snapshot" },
  ];
}

async function exitWithFailure(result, checkpointId, terminalVerification, note) {
  if (checkpointId) {
    setCheckpoint(checkpointId, "failed", {
      note,
      evidence: note ? { kind: "text", text: note } : undefined,
    });
  }
  if (result?.stdout) await writeToStream(process.stdout, result.stdout);
  if (result?.stderr) await writeToStream(process.stderr, result.stderr);
  if (!result?.stdout && note) await writeToStream(process.stderr, `${note}\n`);
  await emitSkillResult("failed", terminalVerification ?? { status: "not_run", note: "Skill did not reach terminal verification." });
  process.exit(typeof result?.exitCode === "number" && result.exitCode !== 0 ? result.exitCode : 1);
}

async function main() {
  const precheck = runExecution(buildExecution("precheck-open-controller", buildOpenControllerActions()));
  if (!precheck.ok) {
    await exitWithFailure(precheck, "app_opened", { status: "not_run", note: `Could not reach the ${unitName} controller for precheck.` }, precheck.message);
  }

  setCheckpoint("app_opened", "ok", {
    evidence: { kind: "text", text: "Opened Google Home, entered Home, and navigated to the Climate category." },
  });
  setCheckpoint("controller_opened", "ok", {
    evidence: { kind: "text", text: `Opened the ${unitName} climate controller screen.` },
  });

  const openedControllerTitle = parseControllerTitle(getStepText(precheck, "snap_controller"));
  if (!openedControllerTitle) {
    await exitWithFailure(
      precheck,
      "controller_opened",
      { status: "not_run", note: "Could not verify the opened controller title." },
      "Could not read the visible controller title after opening the requested climate unit."
    );
  }
  if (!sameLabel(openedControllerTitle, unitName)) {
    await exitWithFailure(
      precheck,
      "controller_opened",
      { status: "not_run", note: `Observed controller '${openedControllerTitle}' instead of requested unit '${unitName}'.` },
      `Opened controller '${openedControllerTitle}', which did not match requested unit '${unitName}'.`
    );
  }

  const currentPower = normalizeObservedPower(getStepText(precheck, "read_power"));
  if (currentPower === null) {
    await exitWithFailure(precheck, "current_power_read", { status: "not_run", note: "Could not parse the current power state." }, "Could not parse the visible Google Home power state from low_value.");
  }

  setCheckpoint("current_power_read", "ok", {
    evidence: { kind: "text", text: currentPower },
    note: `Initial visible power state was ${currentPower}.`,
  });

  if (currentPower !== desiredState) {
    const toggle = runExecution(buildExecution("toggle-power", [
      {
        id: "toggle_aircon",
        type: "click",
        params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/climate_power_button" } },
      },
      { id: "wait_after_toggle", type: "sleep", params: { durationMs: 5000 } },
    ], 20000));

    if (!toggle.ok) {
      await exitWithFailure(toggle, "power_toggled", { status: "not_run", note: "The controller tap failed before terminal verification." }, toggle.message);
    }

    setCheckpoint("power_toggled", "ok", {
      evidence: { kind: "text", text: desiredState },
      note: `Clicked the climate power button to request ${desiredState}.`,
    });
  } else {
    setCheckpoint("power_toggled", "ok", {
      evidence: { kind: "text", text: desiredState },
      note: `Power was already ${desiredState}; no toggle tap was needed.`,
    });
  }

  const verification = runExecution(buildExecution("verify-after-refresh", buildOpenControllerActions()));
  if (!verification.ok) {
    await exitWithFailure(verification, "terminal_state_verified", { status: "not_run", note: "Could not reopen the controller for terminal verification." }, verification.message);
  }

  const verifiedPower = normalizeObservedPower(getStepText(verification, "read_power"));
  const verifiedControllerTitle = parseControllerTitle(getStepText(verification, "snap_controller"));
  if (!verifiedControllerTitle) {
    await exitWithFailure(
      verification,
      "terminal_state_verified",
      { status: "failed", note: "Could not verify the reopened controller title." },
      "Could not read the visible controller title during terminal verification."
    );
  }
  if (!sameLabel(verifiedControllerTitle, unitName)) {
    await exitWithFailure(
      verification,
      "terminal_state_verified",
      {
        status: "failed",
        note: `Observed controller '${verifiedControllerTitle}' instead of requested unit '${unitName}' during terminal verification.`,
      },
      `Verified controller '${verifiedControllerTitle}', which did not match requested unit '${unitName}'.`
    );
  }
  if (verifiedPower === null) {
    await exitWithFailure(verification, "terminal_state_verified", { status: "failed", note: "Could not parse the refreshed controller power state." }, "Could not parse the refreshed Google Home power state from low_value.");
  }

  if (verifiedPower !== desiredState) {
    const message = `Fresh-session verification observed ${verifiedPower}; expected ${desiredState}.`;
    diagnostics.warnings.push(message);
    await exitWithFailure(
      verification,
      "terminal_state_verified",
      {
        status: "failed",
        expected: { kind: "text", text: desiredState.toLowerCase() },
        observed: { kind: "text", text: verifiedPower.toLowerCase() },
        note: message,
      },
      message
    );
  }

  setCheckpoint("terminal_state_verified", "ok", {
    evidence: { kind: "text", text: verifiedPower },
    note: `Verified the ${verifiedControllerTitle} controller after reopening it from a fresh app session.`,
  });

  await emitSkillResult("success", {
    status: "verified",
    expected: { kind: "text", text: desiredState.toLowerCase() },
    observed: { kind: "text", text: verifiedPower.toLowerCase() },
    note: "Verified the Google Home power state after reopening the controller from a fresh app session.",
  });
}

main().catch(async (error) => {
  await writeToStream(process.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
  await emitSkillResult("failed", {
    status: "not_run",
    note: "Unhandled replay error before terminal verification.",
  });
  process.exit(1);
});
