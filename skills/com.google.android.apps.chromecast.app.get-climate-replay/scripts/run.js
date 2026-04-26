#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { resolveClawperatorBin, resolveOperatorPackage } = require("../../utils/common.js");

const skillId = "com.google.android.apps.chromecast.app.get-climate-replay";
const SKILL_RESULT_FRAME_PREFIX = "[Clawperator-Skill-Result]";
const SKILL_RESULT_CONTRACT_VERSION = "1.0.0";
const APP_ID = "com.google.android.apps.chromecast.app";
const CLIMATE_APP_RESOURCE_PREFIX = "com.google.android.apps.chromecast.app:id";

function parseArgs(argv) {
  const [, , deviceId, ...restArgs] = argv;
  if (!deviceId) {
    return { deviceId: undefined, unitNameArg: undefined };
  }
  let unitNameArg;
  for (let index = 0; index < restArgs.length; index += 1) {
    const arg = restArgs[index];
    const next = restArgs[index + 1];
    if (arg === "--unit-name") {
      unitNameArg = next;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--unit-name=")) {
      unitNameArg = arg.slice("--unit-name=".length);
    }
  }
  return { deviceId, unitNameArg };
}

const { deviceId, unitNameArg } = parseArgs(process.argv);
if (!deviceId || !unitNameArg) {
  console.error('Usage: node run.js <device_id> --unit-name "<label>"');
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
  "climate_status_read",
];

const checkpointState = new Map(checkpointOrder.map(id => [id, { id, status: "skipped" }]));

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

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runExecution(execution) {
  try {
    const startedAt = Date.now();
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
        "--timeout-ms",
        String(execution.timeoutMs),
        "--json",
      ],
      {
        encoding: "utf8",
        timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return { ok: true, stdout, stderr: "", envelope: tryParseJson(stdout), exitCode: 0, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      stdout: err?.stdout?.toString?.("utf8") ?? "",
      stderr: err?.stderr?.toString?.("utf8") ?? "",
      envelope: tryParseJson(err?.stdout?.toString?.("utf8") ?? ""),
      exitCode: typeof err?.status === "number" ? err.status : 1,
      message: err?.message ?? "clawperator exec failed",
      elapsedMs: undefined,
    };
  }
}

function getStepResults(result) {
  return result?.envelope?.envelope?.stepResults ?? result?.envelope?.stepResults ?? [];
}

function getStepText(result, id) {
  return getStepResults(result).find(step => step.id === id)?.data?.text ?? "";
}

function buildExecution(actions, timeoutMs = 90000) {
  return {
    commandId: `${skillId}-${Date.now()}`,
    taskId: skillId,
    source: skillId,
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  };
}

function normalizeText(text) {
  return String(text || "").trim();
}

function normalizeTemperature(text) {
  return normalizeText(text);
}

function extractNumericLowValue(lowValue) {
  return normalizeText(lowValue).replace(/[^0-9.-]/g, "");
}

function parsePowerStateFromLowValue(lowValue) {
  const normalized = normalizeText(lowValue);
  if (!normalized) return null;
  if (normalized.toLowerCase() === "off") return "off";
  const numeric = extractNumericLowValue(lowValue);
  if (/^-?\d+(?:\.\d+)?$/.test(numeric)) return "on";
  return null;
}

function parseDesiredTemperatureFromLowValue(lowValue) {
  const numeric = extractNumericLowValue(lowValue);
  if (/^-?\d+(?:\.\d+)?$/.test(numeric)) return numeric;
  return null;
}

function sameLabel(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function parseDeviceName(snapshotText) {
  const text = String(snapshotText || "");
  const toolbarMatch = text.match(/text="([^"]+)" resource-id="com\.google\.android\.apps\.chromecast\.app:id\/toolbar_title"/);
  if (toolbarMatch) return toolbarMatch[1];
  const toolbarTextMatch = text.match(/resource-id="com\.google\.android\.apps\.chromecast\.app:id\/toolbar"[\s\S]{0,900}?text="([^"]+)"/);
  if (toolbarTextMatch) return toolbarTextMatch[1];
  const closeThenTitleMatch = text.match(/content-desc="Close"[\s\S]{0,400}?text="([^"]+)"/);
  if (closeThenTitleMatch) return closeThenTitleMatch[1];
  return "";
}

function parseResourceText(snapshotText, resourceName) {
  const text = String(snapshotText || "");
  const escaped = resourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`text="([^"]*)" resource-id="com\\.google\\.android\\.apps\\.chromecast\\.app:id/${escaped}"`));
  return match ? match[1].trim() : "";
}

function parseMode(snapshotText) {
  const text = String(snapshotText || "");
  const modeTileMatch = text.match(/text="Mode" resource-id="com\.google\.android\.apps\.chromecast\.app:id\/header_text"[\s\S]{0,300}?text="([^"]+)" resource-id="com\.google\.android\.apps\.chromecast\.app:id\/body_text"/);
  if (modeTileMatch) return modeTileMatch[1];

  const contentDescMatch = text.match(/content-desc="Mode\s+([^"]+)"/);
  if (contentDescMatch) return contentDescMatch[1].trim();

  const generic = text.match(/text="([^"]+)" resource-id="com\.google\.android\.apps\.chromecast\.app:id\/body_text"/);
  return generic ? generic[1] : "";
}

function parseFanSpeed(snapshotText) {
  const text = String(snapshotText || "");
  const labeledMatch = text.match(/text="Fan speed\s+([^"]+)"/);
  if (labeledMatch) return labeledMatch[1].trim();

  const contentDescMatch = text.match(/content-desc="Fan speed\s+([^"]+)"/);
  if (contentDescMatch) return contentDescMatch[1].trim();

  const tileMatch = text.match(/text="Fan speed"[\s\S]{0,800}?resource-id="com\.google\.android\.apps\.chromecast\.app:id\/body_text"[\s\S]{0,200}?text="([^"]+)"/);
  if (tileMatch) return tileMatch[1].trim();

  return "";
}

function parseLabeledTemperature(snapshotText, label) {
  const text = String(snapshotText || "");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const contentDescMatch = text.match(new RegExp(`content-desc="${escapedLabel}\\s+([^"\\\\]+)`));
  if (contentDescMatch) {
    const valueMatch = contentDescMatch[1].match(/-?\d+(?:\.\d+)?°/);
    if (valueMatch) return valueMatch[0];
    return contentDescMatch[1].trim();
  }

  const textMatch = text.match(new RegExp(`text="${escapedLabel}"[\\s\\S]{0,800}?resource-id="com\\.google\\.android\\.apps\\.chromecast\\.app:id/first_value_title"[\\s\\S]{0,200}?text="([^"]+)"`));
  if (textMatch) return textMatch[1].trim();

  return "";
}

async function writeToStream(stream, chunk) {
  if (!chunk) return;
  await new Promise((resolve, reject) => {
    stream.write(chunk, error => error ? reject(error) : resolve());
  });
}

async function emitSkillResult(status, climate, terminalVerification, diagnostics = {}) {
  const result = {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_climate_status" },
    inputs: {
      unit_name: unitName,
    },
    result: climate
      ? { kind: "json", value: climate }
      : null,
    status,
    checkpoints: checkpointOrder.map(id => checkpointState.get(id)),
    terminalVerification,
    diagnostics: {
      runtimeState: "healthy",
      ...diagnostics,
    },
  };
  await writeToStream(process.stdout, `${SKILL_RESULT_FRAME_PREFIX}\n`);
  await writeToStream(process.stdout, `${JSON.stringify(result)}\n`);
}

async function exitWithFailure(result, checkpointId, note) {
  if (checkpointId) {
    setCheckpoint(checkpointId, "failed", {
      note,
      evidence: note ? { kind: "text", text: note } : undefined,
    });
  }
  if (result?.stdout) await writeToStream(process.stdout, result.stdout);
  if (result?.stderr) await writeToStream(process.stderr, result.stderr);
  if (!result?.stdout && note) await writeToStream(process.stderr, `${note}\n`);
  await emitSkillResult("failed", null, { status: "not_run", note });
  process.exit(typeof result?.exitCode === "number" && result.exitCode !== 0 ? result.exitCode : 1);
}

function buildOpenSnapshotExecution() {
  return buildExecution([
    { id: "close", type: "close_app", params: { applicationId: APP_ID } },
    { id: "open", type: "open_app", params: { applicationId: APP_ID } },
    {
      id: "wait_google_home_app",
      type: "wait_for_node",
      params: { matcher: { resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/action_bar_root` }, timeoutMs: 15000 },
    },
    { id: "snap", type: "snapshot_ui" },
  ], 30000);
}

function buildNavigateToControllerExecution() {
  return buildExecution([
    { id: "go_home", type: "click", params: { matcher: { textEquals: "Home" } } },
    {
      id: "open_climate",
      type: "scroll_and_click",
      params: {
        matcher: { textEquals: "Climate" },
        container: { resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/category_chips` },
        direction: "right",
        maxSwipes: 6,
        clickType: "click",
        findFirstScrollableChild: true,
      },
    },
    {
      id: "wait_climate_tile",
      type: "wait_for_node",
      params: {
        matcher: {
          resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/control`,
          textContains: unitName,
        },
        timeoutMs: 15000,
      },
    },
    {
      id: "open_controller",
      type: "scroll_and_click",
      params: {
        matcher: {
          resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/control`,
          textContains: unitName,
        },
        container: { resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/pager_home_tab` },
        direction: "down",
        maxSwipes: 12,
        clickType: "long_click",
      },
    },
    {
      id: "wait_controller",
      type: "wait_for_node",
      params: { matcher: { resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/low_value` }, timeoutMs: 15000 },
    },
    {
      id: "wait_status_values",
      type: "wait_for_node",
      params: { matcher: { resourceId: `${CLIMATE_APP_RESOURCE_PREFIX}/first_value_title` }, timeoutMs: 15000 },
    },
    { id: "snap", type: "snapshot_ui" },
  ]);
}

function parseClimateFromSnapshot(snapshotText) {
  const lowValue = normalizeTemperature(parseResourceText(snapshotText, "low_value"));
  const desiredTemperature = parseDesiredTemperatureFromLowValue(lowValue);
  const power = parsePowerStateFromLowValue(lowValue);
  const deviceName = parseDeviceName(snapshotText);
  const mode = parseMode(snapshotText);
  const fanSpeed = parseFanSpeed(snapshotText);
  const indoorTemperature =
    normalizeTemperature(parseLabeledTemperature(snapshotText, "Indoor temperature")) ||
    normalizeTemperature(parseResourceText(snapshotText, "first_value_title"));
  const outdoorTemperature = parseLabeledTemperature(snapshotText, "Outdoor temperature");

  return {
    device_name: deviceName,
    power,
    desired_temperature: desiredTemperature,
    mode: mode || null,
    fan_speed: fanSpeed || null,
    indoor_temperature: indoorTemperature,
    outdoor_temperature: outdoorTemperature || null,
  };
}

function hasCompleteClimate(climate) {
  return Boolean(climate?.device_name && climate?.indoor_temperature && climate?.power);
}

async function main() {
  const skillStartedAt = Date.now();
  const openResult = runExecution(buildOpenSnapshotExecution());

  if (!openResult.ok) {
    await exitWithFailure(openResult, "app_opened", openResult.message);
  }

  let result = openResult;
  let snapshotText = getStepText(openResult, "snap");
  let climate = parseClimateFromSnapshot(snapshotText);
  let route = "restored-controller";

  if (!hasCompleteClimate(climate) || !sameLabel(climate.device_name, unitName)) {
    result = runExecution(buildNavigateToControllerExecution());
    route = "home-tab-navigation";
    if (!result.ok) {
      await exitWithFailure(result, "controller_opened", result.message);
    }
    snapshotText = getStepText(result, "snap");
    climate = parseClimateFromSnapshot(snapshotText);
  }

  setCheckpoint("app_opened", "ok", {
    evidence: { kind: "text", text: "Opened Google Home and observed the current app state." },
  });
  setCheckpoint("controller_opened", "ok", {
    evidence: { kind: "text", text: `Reached the ${unitName} climate controller screen via ${route}.` },
  });

  if (!hasCompleteClimate(climate)) {
    await exitWithFailure(result, "climate_status_read", "Could not parse one or more climate status fields from the controller screen.");
  }

  if (!sameLabel(climate.device_name, unitName)) {
    await exitWithFailure(
      result,
      "climate_status_read",
      `Opened controller '${climate.device_name}', which did not match requested unit '${unitName}'.`
    );
  }

  setCheckpoint("climate_status_read", "ok", {
    evidence: { kind: "json", value: climate },
    note: "Parsed visible device name, low-value state, mode, fan speed, indoor temperature, and outdoor temperature values from the controller screen.",
  });

  await emitSkillResult("success", climate, {
    status: "verified",
    expected: { kind: "text", text: "Visible climate status fields on the controller screen" },
    observed: { kind: "json", value: climate },
    note: "Verified by reading the visible Google Home controller status fields without fixed sleep actions.",
  }, {
    openSnapshotElapsedMs: openResult.elapsedMs,
    navigationElapsedMs: route === "home-tab-navigation" ? result.elapsedMs : 0,
    totalElapsedMs: Date.now() - skillStartedAt,
    route,
    waitStrategy: "condition-based wait_for_node actions and snapshot parsing with no fixed sleep actions",
  });
}

main().catch(async (error) => {
  await writeToStream(process.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
  await emitSkillResult("failed", null, { status: "not_run", note: "Unhandled replay error before terminal verification." });
  process.exit(1);
});
