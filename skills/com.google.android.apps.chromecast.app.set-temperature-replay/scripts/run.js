#!/usr/bin/env node

const {
  resolveOperatorPackage,
  resolveClawperatorBin,
} = require("../../utils/common.js");
const { execFileSync } = require("node:child_process");

const skillId = "com.google.android.apps.chromecast.app.set-temperature-replay";
const SKILL_RESULT_FRAME_PREFIX = "[Clawperator-Skill-Result]";
const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";
const APP_ID = "com.google.android.apps.chromecast.app";
const MAX_ADJUSTMENTS = 32;

function parseArgs(argv) {
  const [, , deviceId, ...restArgs] = argv;
  if (!deviceId) {
    return { deviceId: undefined, desiredTempArg: undefined, unitNameArg: undefined };
  }
  let desiredTempArg;
  let unitNameArg;

  for (let index = 0; index < restArgs.length; index += 1) {
    const arg = restArgs[index];
    const next = restArgs[index + 1];

    if (arg === "--temperature") {
      desiredTempArg = next;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--temperature=")) {
      desiredTempArg = arg.slice("--temperature=".length);
      continue;
    }
    if (arg === "--desired-temp") {
      desiredTempArg = next;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--desired-temp=")) {
      desiredTempArg = arg.slice("--desired-temp=".length);
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
    if (desiredTempArg === undefined && !String(arg).startsWith("--")) {
      desiredTempArg = arg;
    }
  }

  return { deviceId, desiredTempArg, unitNameArg };
}

const { deviceId, desiredTempArg, unitNameArg } = parseArgs(process.argv);
const operatorPackage = resolveOperatorPackage();

if (!deviceId || !desiredTempArg || !unitNameArg) {
  console.error('Usage: node run.js <device_id> --temperature <integer> --unit-name "<label>"');
  process.exit(1);
}

if (!/^-?\d+$/.test(desiredTempArg)) {
  console.error(`Invalid desired temperature: ${desiredTempArg}. Expected an integer.`);
  process.exit(1);
}

const desiredTemp = Number.parseInt(desiredTempArg, 10);
if (!Number.isInteger(desiredTemp)) {
  console.error(`Invalid desired temperature: ${desiredTempArg}. Expected an integer.`);
  process.exit(1);
}
const unitName = String(unitNameArg).trim();
if (!unitName) {
  console.error("Invalid unit name: expected a non-empty label.");
  process.exit(1);
}

const resolvedClawperatorBin = resolveClawperatorBin();

const checkpointOrder = [
  "app_opened",
  "controller_opened",
  "current_temperature_read",
  "temperature_adjusted",
  "terminal_state_verified",
];

const checkpointState = new Map(
  checkpointOrder.map(id => [id, { id, status: "skipped" }])
);

const diagnostics = {
  warnings: [],
  hints: [
    "This replay verifies the visible Google Home setpoint and does not directly prove physical HVAC output.",
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
          temperature: desiredTemp,
          unit_name: unitName,
        },
      }
    : null;
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: "set_climate_temperature",
      temperature: desiredTemp,
    },
    inputs: {
      temperature: desiredTemp,
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
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function writeStdout(chunk) {
  await writeToStream(process.stdout, chunk);
}

async function writeStderr(chunk) {
  await writeToStream(process.stderr, chunk);
}

async function emitSkillResult(status, terminalVerification) {
  await writeStdout(`${SKILL_RESULT_FRAME_PREFIX}\n`);
  await writeStdout(`${JSON.stringify(buildSkillResult(status, terminalVerification))}\n`);
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
    return {
      ok: true,
      stdout,
      stderr: "",
      envelope: tryParseJson(stdout),
      exitCode: 0,
    };
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

function stepById(result, stepId) {
  return getStepResults(result).find(step => step.id === stepId);
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

function parseDisplayedTemperature(rawText) {
  const cleaned = String(rawText).trim();
  if (!cleaned) {
    return null;
  }

  if (/^-?\d+\.\d+$/.test(cleaned)) {
    return Number.parseFloat(cleaned);
  }

  if (/^-?\d{3,}$/.test(cleaned)) {
    return Number.parseInt(cleaned, 10) / 10;
  }

  const digitsOnly = cleaned.replace(/[^\d.-]/g, "");
  if (!digitsOnly) {
    return null;
  }

  if (/^-?\d+\.\d+$/.test(digitsOnly)) {
    return Number.parseFloat(digitsOnly);
  }

  if (/^-?\d{3,}$/.test(digitsOnly)) {
    return Number.parseInt(digitsOnly, 10) / 10;
  }

  if (/^-?\d+$/.test(digitsOnly)) {
    return Number.parseInt(digitsOnly, 10);
  }

  return null;
}

function extractCurrentTemp(result) {
  const text = stepById(result, "read_current_temp")?.data?.text ?? stepById(result, "read_temp_after_click")?.data?.text ?? "";
  return parseDisplayedTemperature(text);
}

function sameTemperature(left, right) {
  return Math.abs(left - right) < 0.01;
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

async function exitWithFailure(result, failingCheckpointId, terminalVerification, note) {
  if (failingCheckpointId) {
    setCheckpoint(failingCheckpointId, "failed", {
      note,
      evidence: note ? { kind: "text", text: note } : undefined,
    });
  }
  if (result?.stdout) await writeStdout(result.stdout);
  if (result?.stderr) await writeStderr(result.stderr);
  if (!result?.stdout && note) await writeStderr(`${note}\n`);
  await emitSkillResult("failed", terminalVerification ?? { status: "not_run", note: "Skill did not reach terminal verification." });
  process.exit(typeof result?.exitCode === "number" && result.exitCode !== 0 ? result.exitCode : 1);
}

async function main() {
  const openResult = runExecution(buildExecution("open-controller", 90000, [
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
      id: "read_current_temp",
      type: "read_text",
      params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } },
    },
    { id: "snap_controller", type: "snapshot_ui" },
  ]));

  if (!openResult.ok) {
    await exitWithFailure(openResult, "app_opened", { status: "not_run", note: "Could not reach the climate controller." }, openResult.message);
  }

  setCheckpoint("app_opened", "ok", {
    evidence: { kind: "text", text: "Opened Google Home and navigated into the Climate section." },
  });
  setCheckpoint("controller_opened", "ok", {
    evidence: { kind: "text", text: `Opened the ${unitName} climate controller screen.` },
  });

  const openedControllerTitle = parseControllerTitle(stepById(openResult, "snap_controller")?.data?.text ?? "");
  if (!openedControllerTitle) {
    await exitWithFailure(
      openResult,
      "controller_opened",
      { status: "not_run", note: "Could not verify the reopened controller title." },
      "Could not read the visible controller title after opening the requested climate unit."
    );
  }
  if (!sameLabel(openedControllerTitle, unitName)) {
    await exitWithFailure(
      openResult,
      "controller_opened",
      { status: "not_run", note: `Observed controller '${openedControllerTitle}' instead of requested unit '${unitName}'.` },
      `Opened controller '${openedControllerTitle}', which did not match requested unit '${unitName}'.`
    );
  }

  const initialTemp = extractCurrentTemp(openResult);
  if (initialTemp === null) {
    await exitWithFailure(openResult, "current_temperature_read", { status: "not_run", note: "Could not read the current set temperature." }, "Could not parse the current visible set temperature.");
  }

  setCheckpoint("current_temperature_read", "ok", {
    evidence: { kind: "text", text: String(initialTemp) },
    note: `Initial visible setpoint was ${initialTemp}.`,
  });

  let currentTemp = initialTemp;
  let adjustments = 0;

  while (!sameTemperature(currentTemp, desiredTemp) && adjustments < MAX_ADJUSTMENTS) {
    const buttonResourceId = currentTemp < desiredTemp
      ? "com.google.android.apps.chromecast.app:id/up_button"
      : "com.google.android.apps.chromecast.app:id/down_button";
    const actionLabel = currentTemp < desiredTemp ? "Increase temperature" : "Decrease temperature";

    const adjustResult = runExecution(buildExecution("adjust-temperature", 30000, [
      { id: "tap_temp_button", type: "click", params: { matcher: { resourceId: buttonResourceId } } },
      { id: "wait_after_tap", type: "sleep", params: { durationMs: 900 } },
      {
        id: "read_temp_after_click",
        type: "read_text",
        params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } },
      },
    ]));

    if (!adjustResult.ok) {
      await exitWithFailure(
        adjustResult,
        "temperature_adjusted",
        { status: "not_run", note: "Temperature adjustment failed before terminal verification." },
        `Failed while trying to ${actionLabel.toLowerCase()}.`
      );
    }

    const nextTemp = extractCurrentTemp(adjustResult);
    if (nextTemp === null) {
      await exitWithFailure(
        adjustResult,
        "temperature_adjusted",
        { status: "not_run", note: "The controller stopped exposing a parseable setpoint." },
        "Could not parse the visible set temperature after a button tap."
      );
    }

    currentTemp = nextTemp;
    adjustments += 1;
  }

  if (!sameTemperature(currentTemp, desiredTemp)) {
    const message = `Stopped after ${adjustments} adjustment attempts with visible setpoint ${currentTemp}; expected ${desiredTemp}.`;
    diagnostics.warnings.push(message);
    await exitWithFailure(
      null,
      "temperature_adjusted",
      {
        status: "failed",
        expected: { kind: "text", text: String(desiredTemp) },
        observed: { kind: "text", text: String(currentTemp) },
        note: message,
      },
      message
    );
  }

  setCheckpoint("temperature_adjusted", "ok", {
    evidence: { kind: "text", text: String(currentTemp) },
    note: adjustments === 0
      ? "The requested setpoint was already visible."
      : `Adjusted the visible setpoint in ${adjustments} step(s).`,
  });

  setCheckpoint("terminal_state_verified", "ok", {
    evidence: { kind: "text", text: String(currentTemp) },
    note: `Verified the ${openedControllerTitle} controller still showed the requested setpoint.`,
  });

  await emitSkillResult("success", {
    status: "verified",
    expected: { kind: "text", text: String(desiredTemp) },
    observed: { kind: "text", text: String(currentTemp) },
    note: "Verified the visible Google Home setpoint after the final adjustment.",
  });
}

main().catch(async (error) => {
  await writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
  await emitSkillResult("failed", {
    status: "not_run",
    note: "Unhandled replay error before terminal verification.",
  });
  process.exit(1);
});
