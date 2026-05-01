const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { resolveOperatorPackage, runClawperatorCommand } = require("./common.js");
const {
  averageRgba,
  boundsCenter,
  boundsHeight,
  boundsKey,
  boundsWidth,
  classifyPowerState,
  extractSnapshotXml,
  isSnapshotStep,
  parseXmlNodes,
  readPngRgba,
} = require("./airtouch5_snapshot.js");

const AIRTOUCH_PACKAGE = "au.com.polyaire.airtouch5";
const MODE_VALUES = ["cool", "heat", "fan", "dry", "auto"];
const FAN_LEVEL_VALUES = ["auto", "low", "medium", "high"];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitSkillResult(skillResult) {
  console.log("[Clawperator-Skill-Result]");
  console.log(JSON.stringify(skillResult));
}

function truncateText(value, maxLength = 220) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function summarizeError(error) {
  if (error instanceof Error) {
    return truncateText(error.message);
  }
  return truncateText(String(error));
}

const defaultDependencies = {
  averageRgba,
  classifyPowerState,
  mkdtemp,
  readPngRgba,
  rm,
  runClawperatorCommand,
  sleep,
};

let dependencyOverrides = {};

function getDependency(name) {
  return dependencyOverrides[name] || defaultDependencies[name];
}

function setAirTouchHomeControlsDepsForTest(overrides) {
  dependencyOverrides = overrides ? { ...overrides } : {};
}

function appendCheckpoint(result, id, status, note, evidence) {
  const checkpoint = { id, status, observedAt: nowIso() };
  if (note) {
    checkpoint.note = note;
  }
  if (evidence) {
    checkpoint.evidence = evidence;
  }
  result.checkpoints.push(checkpoint);
}

function failResult(result, id, note, diagnostics = {}) {
  appendCheckpoint(result, id, "failed", note);
  result.status = "failed";
  const failureRuntimeState = diagnostics.runtimeState
    || ((result.diagnostics && result.diagnostics.runtimeState) === "healthy" ? "unknown" : (result.diagnostics && result.diagnostics.runtimeState))
    || "unknown";
  result.diagnostics = {
    ...(result.diagnostics || {}),
    ...diagnostics,
    runtimeState: failureRuntimeState,
  };
  emitSkillResult(result);
  return 1;
}

function buildSkillResult(skillId, goalKind, inputs, expectedText) {
  return {
    contractVersion: "1.0.0",
    skillId,
    goal: {
      kind: goalKind,
      ...inputs,
    },
    inputs,
    result: null,
    status: "failed",
    checkpoints: [],
    terminalVerification: {
      status: "not_run",
      expected: { kind: "text", text: expectedText || "unknown" },
      observed: null,
      note: null,
    },
    diagnostics: {
      runtimeState: "unknown",
      targetPackage: AIRTOUCH_PACKAGE,
    },
  };
}

function normalizeChoiceValue(value) {
  return String(value || "").trim().toLowerCase();
}

function parseChoiceArg(args, { flag, allowedValues }) {
  const allowed = new Set((allowedValues || []).map((value) => normalizeChoiceValue(value)));

  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] || "").trim();
    const currentNormalized = normalizeChoiceValue(current);
    const nextNormalized = normalizeChoiceValue(args[index + 1]);

    if (currentNormalized === normalizeChoiceValue(flag) && allowed.has(nextNormalized)) {
      return nextNormalized;
    }

    const equalsPrefix = `${normalizeChoiceValue(flag)}=`;
    if (currentNormalized.startsWith(equalsPrefix)) {
      const inlineValue = currentNormalized.slice(equalsPrefix.length);
      if (allowed.has(inlineValue)) {
        return inlineValue;
      }
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const currentNormalized = normalizeChoiceValue(args[index]);
    const previous = String(args[index - 1] || "").trim();
    if (previous.startsWith("--") && !previous.includes("=")) {
      continue;
    }
    if (allowed.has(currentNormalized)) {
      return currentNormalized;
    }
  }

  return null;
}

function parseNamedChoiceArg(args, { flag, allowedValues }) {
  const allowed = new Set((allowedValues || []).map((value) => normalizeChoiceValue(value)));
  const normalizedFlag = normalizeChoiceValue(flag);
  const equalsPrefix = `${normalizedFlag}=`;

  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] || "").trim();
    const currentNormalized = normalizeChoiceValue(current);

    if (currentNormalized === normalizedFlag) {
      const value = normalizeChoiceValue(args[index + 1]);
      return {
        provided: true,
        value: allowed.has(value) ? value : null,
      };
    }

    if (currentNormalized.startsWith(equalsPrefix)) {
      const value = currentNormalized.slice(equalsPrefix.length);
      return {
        provided: true,
        value: allowed.has(value) ? value : null,
      };
    }
  }

  return { provided: false, value: null };
}

function parseHomeControlsArgs(args) {
  const state = parseNamedChoiceArg(args, { flag: "--state", allowedValues: ["on", "off"] });
  const fanLevel = parseNamedChoiceArg(args, { flag: "--fan-level", allowedValues: FAN_LEVEL_VALUES });
  const mode = parseNamedChoiceArg(args, { flag: "--mode", allowedValues: MODE_VALUES });
  const errors = [];

  if (state.provided && !state.value) {
    errors.push("Pass --state on|off.");
  }
  if (fanLevel.provided && !fanLevel.value) {
    errors.push(`Pass --fan-level ${FAN_LEVEL_VALUES.join("|")}.`);
  }
  if (mode.provided && !mode.value) {
    errors.push(`Pass --mode ${MODE_VALUES.join("|")}.`);
  }

  const request = {
    state: state.value,
    fanLevel: fanLevel.value,
    mode: mode.value,
  };

  if (!request.state && !request.fanLevel && !request.mode && errors.length === 0) {
    errors.push("Pass at least one of --state, --fan-level, or --mode.");
  }
  if (request.state === "off" && (request.fanLevel || request.mode)) {
    errors.push("Do not combine --state off with --fan-level or --mode; Home controls are not adjustable while power is off.");
  }
  if (request.mode === "dry" && request.fanLevel) {
    errors.push("Do not combine --mode dry with --fan-level; AirTouch does not expose a fan level to verify in Dry mode.");
  }

  return {
    request,
    errors,
  };
}

function extractForegroundPackage(rawResult) {
  const foregroundPackage = rawResult?.envelope?.stepResults?.find((step) => isSnapshotStep(step))?.data?.foreground_package;
  return typeof foregroundPackage === "string" ? foregroundPackage : "";
}

function runJsonCommand(command, args) {
  const response = getDependency("runClawperatorCommand")(command, args, { encoding: "utf-8", timeoutMs: 30000 });
  if (!response.ok) {
    throw new Error(truncateText(response.error));
  }
  try {
    return JSON.parse(response.result);
  } catch (error) {
    throw new Error(`Failed to parse ${command} JSON output: ${summarizeError(error)}`);
  }
}

function openApp(deviceId, operatorPackage) {
  return runJsonCommand("open", [AIRTOUCH_PACKAGE, "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function snapshot(deviceId, operatorPackage) {
  return runJsonCommand("snapshot", ["--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

async function snapshotWithRetry(deviceId, operatorPackage, options = {}) {
  const attempts = options.attempts || 3;
  const retryDelayMs = options.retryDelayMs || 900;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return {
        result: snapshot(deviceId, operatorPackage),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await getDependency("sleep")(retryDelayMs);
      }
    }
  }

  throw lastError;
}

function clickText(deviceId, operatorPackage, text) {
  return runJsonCommand("click", ["--text", text, "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function clickCoordinate(deviceId, operatorPackage, x, y) {
  return runJsonCommand("click", ["--coordinate", String(x), String(y), "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function takeScreenshot(deviceId, operatorPackage, path) {
  return runJsonCommand("screenshot", ["--device", deviceId, "--operator-package", operatorPackage, "--path", path, "--json"]);
}

function screenshotRetryName(screenshotName, attempt) {
  if (attempt === 1) {
    return screenshotName;
  }
  if (screenshotName.endsWith(".png")) {
    return `${screenshotName.slice(0, -4)}-retry-${attempt}.png`;
  }
  return `${screenshotName}-retry-${attempt}`;
}

async function takeScreenshotWithRetry(deviceId, operatorPackage, runDir, screenshotName, options = {}) {
  const attempts = options.attempts || 3;
  const retryDelayMs = options.retryDelayMs || 900;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const screenshotPath = join(runDir, screenshotRetryName(screenshotName, attempt));
    try {
      takeScreenshot(deviceId, operatorPackage, screenshotPath);
      return { screenshotPath, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await getDependency("sleep")(retryDelayMs);
      }
    }
  }

  throw lastError;
}


function computeViewport(nodes) {
  let right = 0;
  let bottom = 0;
  for (const node of nodes) {
    right = Math.max(right, node.bounds.right);
    bottom = Math.max(bottom, node.bounds.bottom);
  }
  return {
    left: 0,
    top: 0,
    right,
    bottom,
  };
}

function detectControlSlots(nodes, homeRootBounds) {
  const uniqueCandidates = [];
  const seen = new Set();
  const topFloor = homeRootBounds.top + 40;
  const topCeiling = homeRootBounds.top + 420;

  for (const node of nodes) {
    const width = boundsWidth(node.bounds);
    const height = boundsHeight(node.bounds);
    const ratio = height === 0 ? 0 : width / height;
    if (width < 220 || width > 320 || height < 220 || height > 320) {
      continue;
    }
    if (ratio < 0.8 || ratio > 1.2) {
      continue;
    }
    if (node.bounds.top < topFloor || node.bounds.bottom > topCeiling) {
      continue;
    }
    if (node.bounds.left < homeRootBounds.left || node.bounds.right > homeRootBounds.right) {
      continue;
    }
    const key = boundsKey(node.bounds);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueCandidates.push(node.bounds);
  }

  return uniqueCandidates.sort((left, right) => left.left - right.left);
}

function buildFallbackControlSlots(viewport) {
  const width = Math.max(1, boundsWidth(viewport));
  const height = Math.max(1, boundsHeight(viewport));

  function makeBounds(leftRatio, topRatio, rightRatio, bottomRatio) {
    return {
      left: Math.round(viewport.left + width * leftRatio),
      top: Math.round(viewport.top + height * topRatio),
      right: Math.round(viewport.left + width * rightRatio),
      bottom: Math.round(viewport.top + height * bottomRatio),
    };
  }

  return {
    power: makeBounds(0.044, 0.197, 0.289, 0.31),
    mode: makeBounds(0.383, 0.197, 0.628, 0.31),
    fan: makeBounds(0.686, 0.197, 0.933, 0.31),
  };
}

function findValueAboveControl(nodes, controlBounds, allowedValues) {
  if (!controlBounds) {
    return null;
  }
  const allowed = new Set(allowedValues);
  const candidates = nodes
    .filter((node) => node.text.trim().length > 0)
    .map((node) => ({
      node,
      normalized: normalizeChoiceValue(node.text),
      center: boundsCenter(node.bounds),
    }))
    .filter((entry) => allowed.has(entry.normalized))
    .filter((entry) => entry.center.x >= controlBounds.left && entry.center.x <= controlBounds.right)
    .filter((entry) => entry.node.bounds.bottom <= controlBounds.top + 12)
    .sort((left, right) => (controlBounds.top - left.node.bounds.bottom) - (controlBounds.top - right.node.bounds.bottom));

  return candidates.length > 0 ? candidates[0].normalized : null;
}

function selectLabeledControlBounds(nodes, candidateBounds, allowedValues, excludedBounds = []) {
  const excludedKeys = new Set(excludedBounds.map((bounds) => boundsKey(bounds)));
  const matches = candidateBounds
    .filter((bounds) => !excludedKeys.has(boundsKey(bounds)))
    .map((bounds) => ({
      bounds,
      value: findValueAboveControl(nodes, bounds, allowedValues),
    }))
    .filter((entry) => entry.value);

  return matches.length > 0 ? matches[0].bounds : null;
}

function selectPowerControlBounds(candidateBounds, labeledBounds, fallbackBounds) {
  const usedKeys = new Set(labeledBounds.filter(Boolean).map((bounds) => boundsKey(bounds)));
  const remaining = candidateBounds
    .filter((bounds) => !usedKeys.has(boundsKey(bounds)))
    .sort((left, right) => left.left - right.left);

  if (remaining.length === 0) {
    return fallbackBounds;
  }
  if (!labeledBounds[0]) {
    return remaining[0];
  }

  const modeCenterX = boundsCenter(labeledBounds[0]).x;
  const leftOfMode = remaining.filter((bounds) => boundsCenter(bounds).x < modeCenterX);
  if (leftOfMode.length === 0) {
    return remaining[0];
  }

  return leftOfMode.sort(
    (left, right) => Math.abs(modeCenterX - boundsCenter(left).x) - Math.abs(modeCenterX - boundsCenter(right).x),
  )[0];
}

function extractChoiceDialogState(xml, allowedValues) {
  const nodes = parseXmlNodes(xml);
  const dialog = nodes.find((node) => node.className === "android.app.AlertDialog");
  if (!dialog) {
    return null;
  }

  const allowed = new Set(allowedValues);
  const options = nodes
    .map((node) => ({
      text: node.text,
      normalized: normalizeChoiceValue(node.text),
      clickable: node.clickable,
      bounds: node.bounds,
    }))
    .filter((entry) => entry.clickable && allowed.has(entry.normalized))
    .sort((left, right) => left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left);

  if (options.length < 2) {
    return null;
  }

  return {
    bounds: dialog.bounds,
    options,
  };
}

function extractHomeScreenState(xml) {
  const nodes = parseXmlNodes(xml);
  const viewport = computeViewport(nodes);
  const homeRoot = nodes.find((node) => node.resourceId === "comp-home-single-ac");
  const detectedSlots = homeRoot ? detectControlSlots(nodes, homeRoot.bounds) : [];
  const fallbackSlots = buildFallbackControlSlots(viewport);
  const modeBounds = selectLabeledControlBounds(nodes, detectedSlots, MODE_VALUES) || detectedSlots[1] || fallbackSlots.mode;
  const fanBounds = selectLabeledControlBounds(nodes, detectedSlots, FAN_LEVEL_VALUES, [modeBounds]) || detectedSlots[2] || fallbackSlots.fan;
  const powerBounds = selectPowerControlBounds(detectedSlots, [modeBounds, fanBounds], fallbackSlots.power);
  const modeValue = findValueAboveControl(nodes, modeBounds, MODE_VALUES);
  const fanLevelValue = findValueAboveControl(nodes, fanBounds, FAN_LEVEL_VALUES);
  const setPointVisible = nodes.some((node) => normalizeChoiceValue(node.text) === "set point");
  const navLabels = ["home", "zones", "timer", "programs", "insights"];
  const navCount = navLabels.filter((label) => nodes.some((node) => normalizeChoiceValue(node.text) === label)).length;

  return {
    nodes,
    viewport,
    isHomeScreen: navCount >= 4 && (Boolean(homeRoot) || Boolean(modeValue) || Boolean(fanLevelValue) || setPointVisible),
    homeRootBounds: homeRoot ? homeRoot.bounds : null,
    controlSlots: {
      power: powerBounds,
      mode: modeBounds,
      fan: fanBounds,
    },
    modeValue,
    fanLevelValue,
    setPointVisible,
    looksPoweredOn: Boolean(modeValue || fanLevelValue || setPointVisible),
  };
}

async function waitForHomeState(deviceId, operatorPackage, { maxAttempts = 8 } = {}) {
  let lastForegroundPackage = "";
  let lastState = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { result: snapResult } = await snapshotWithRetry(deviceId, operatorPackage);
    const foregroundPackage = extractForegroundPackage(snapResult);
    const xml = extractSnapshotXml(snapResult);
    const state = extractHomeScreenState(xml);
    lastForegroundPackage = foregroundPackage;
    lastState = state;

    if (foregroundPackage === AIRTOUCH_PACKAGE && state.isHomeScreen) {
      return { ...state, foregroundPackage };
    }

    if (foregroundPackage === AIRTOUCH_PACKAGE && !state.isHomeScreen) {
      try {
        clickText(deviceId, operatorPackage, "Home");
      } catch {
        openApp(deviceId, operatorPackage);
      }
    } else {
      openApp(deviceId, operatorPackage);
    }

    await getDependency("sleep")(1500);
  }

  throw new Error(
    `AirTouch Home screen did not stabilize; last foreground package was ${lastForegroundPackage || "unknown"} and poweredOn=${lastState ? String(lastState.looksPoweredOn) : "unknown"}.`,
  );
}

async function waitForChoiceDialog(deviceId, operatorPackage, allowedValues, { maxAttempts = 6 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { result: snapResult } = await snapshotWithRetry(deviceId, operatorPackage);
    const foregroundPackage = extractForegroundPackage(snapResult);
    const xml = extractSnapshotXml(snapResult);

    if (foregroundPackage !== AIRTOUCH_PACKAGE) {
      openApp(deviceId, operatorPackage);
      await getDependency("sleep")(1200);
      continue;
    }

    const dialogState = extractChoiceDialogState(xml, allowedValues);
    if (dialogState) {
      return dialogState;
    }

    await getDependency("sleep")(800);
  }

  throw new Error("AirTouch selector dialog did not appear after tapping the Home control.");
}

function describeSelectedDevice() {
  return "the selected device";
}

function appendAppOpenedCheckpoint(result) {
  appendCheckpoint(result, "app_opened", "ok", `Opened ${AIRTOUCH_PACKAGE} on ${describeSelectedDevice()}.`);
}

function shouldRetryPowerToggle() {
  return false;
}

function scopedCheckpointId(scope, id) {
  return scope ? `${scope}_${id}` : id;
}

function mergePowerStateEvidence(homeState, visualState) {
  const semanticSignals = {
    setPointVisible: Boolean(homeState?.setPointVisible),
    modeValue: homeState?.modeValue || null,
    fanLevelValue: homeState?.fanLevelValue || null,
  };
  return {
    state: visualState?.state || "unknown",
    metrics: {
      ...(visualState?.metrics || {}),
      semanticSignals,
      visualState: visualState?.state || "unknown",
      resolvedBy: "screenshot_crop",
    },
  };
}

async function samplePowerState(deviceId, operatorPackage, powerBounds, runDir, screenshotName, waitMs) {
  if (waitMs > 0) {
    await getDependency("sleep")(waitMs);
  }
  const homeState = await waitForHomeState(deviceId, operatorPackage, { maxAttempts: 6 });
  const { screenshotPath, attempts } = await takeScreenshotWithRetry(deviceId, operatorPackage, runDir, screenshotName);
  const image = await getDependency("readPngRgba")(screenshotPath);
  const stats = getDependency("averageRgba")(image, powerBounds);
  const visualState = getDependency("classifyPowerState")(stats);
  const classified = mergePowerStateEvidence(homeState, visualState);
  classified.metrics.screenshotAttempts = attempts;
  return { homeState, classified };
}

async function observePowerTransition(deviceId, operatorPackage, powerBounds, runDir, attemptPrefix, requestedState) {
  const observations = [];
  const delaysMs = [2500, 1400, 1800, 2200];
  let homeState = null;
  let currentState = "unknown";
  let lastMetrics = null;

  for (let observation = 0; observation < delaysMs.length && currentState !== requestedState; observation += 1) {
    const sample = await samplePowerState(
      deviceId,
      operatorPackage,
      powerBounds,
      runDir,
      `${attemptPrefix}-${observation + 1}.png`,
      delaysMs[observation],
    );
    homeState = sample.homeState;
    currentState = sample.classified.state;
    lastMetrics = sample.classified.metrics;
    observations.push(currentState);
  }

  return { currentState, homeState, lastMetrics, observations };
}

async function readPowerStateFromHome(deviceId, operatorPackage, powerBounds, runDir, screenshotName, homeState) {
  const { screenshotPath, attempts } = await takeScreenshotWithRetry(deviceId, operatorPackage, runDir, screenshotName);
  const image = await getDependency("readPngRgba")(screenshotPath);
  const stats = getDependency("averageRgba")(image, powerBounds);
  const visualState = getDependency("classifyPowerState")(stats);
  const classified = mergePowerStateEvidence(homeState, visualState);
  classified.metrics.screenshotAttempts = attempts;
  return classified;
}

async function applyPowerStateFromHome({
  deviceId,
  operatorPackage,
  requestedState,
  homeState,
  runDir,
  result,
  checkpointPrefix = "",
}) {
  const powerBounds = homeState.controlSlots.power;
  if (!powerBounds) {
    throw new Error("Could not derive the power control bounds from the Home screen.");
  }

  const screenshotPrefix = checkpointPrefix ? `${checkpointPrefix}-` : "";
  const beforeState = await readPowerStateFromHome(deviceId, operatorPackage, powerBounds, runDir, `${screenshotPrefix}power-before.png`, homeState);
  let currentState = beforeState.state;
  appendCheckpoint(
    result,
    scopedCheckpointId(checkpointPrefix, "current_value_read"),
    "ok",
    `AirTouch power looked ${currentState} before action.`,
    { kind: "json", value: { powerBounds, screenshotMetrics: beforeState.metrics, setPointVisible: homeState.setPointVisible, modeValue: homeState.modeValue, fanLevelValue: homeState.fanLevelValue } },
  );

  const center = boundsCenter(powerBounds);
  let tapsApplied = 0;
  let finalHomeState = homeState;
  let actionNote = `No tap was needed because power was already ${requestedState}.`;
  const diagnostics = {
    powerBounds,
    beforePowerMetrics: beforeState.metrics,
  };

  if (currentState !== requestedState) {
    clickCoordinate(deviceId, operatorPackage, center.x, center.y);
    tapsApplied += 1;
    const firstAttempt = await observePowerTransition(
      deviceId,
      operatorPackage,
      powerBounds,
      runDir,
        `${screenshotPrefix}power-after-1`,
      requestedState,
    );
    finalHomeState = firstAttempt.homeState || finalHomeState;
    currentState = firstAttempt.currentState;
    diagnostics.lastPowerMetrics = firstAttempt.lastMetrics;
    diagnostics.firstTapObservations = firstAttempt.observations;

    diagnostics.powerRetryPolicy = "single_tap_only";
  }

  if (tapsApplied > 0) {
    actionNote = `Tapped the power control ${tapsApplied} time(s) at (${center.x},${center.y}).`;
  }
  appendCheckpoint(result, scopedCheckpointId(checkpointPrefix, "action_applied"), "ok", actionNote);

  return {
    homeState: finalHomeState,
    finalState: currentState,
    diagnostics,
  };
}

async function applyCyclingSettingFromHome({
  deviceId,
  operatorPackage,
  inputKey,
  requestedValue,
  allowedValues,
  homeState,
  result,
  checkpointPrefix = "",
}) {
  if (!homeState.looksPoweredOn) {
    throw new Error("Mode and fan controls were not exposed on the Home screen.");
  }

  const controlBounds = inputKey === "mode" ? homeState.controlSlots.mode : homeState.controlSlots.fan;
  if (!controlBounds) {
    throw new Error(`Could not derive the ${inputKey} control bounds from the Home screen.`);
  }

  let currentValue = inputKey === "mode" ? homeState.modeValue : homeState.fanLevelValue;
  if (!currentValue || !allowedValues.includes(currentValue)) {
    throw new Error(`Could not read the current ${inputKey.replace("_", " ")} from the Home snapshot.`);
  }

  appendCheckpoint(
    result,
    scopedCheckpointId(checkpointPrefix, "current_value_read"),
    "ok",
    `AirTouch reported ${inputKey.replace("_", " ")}=${currentValue} before action.`,
    { kind: "json", value: { controlBounds, currentValue } },
  );

  const center = boundsCenter(controlBounds);
  let finalHomeState = homeState;
  let actionNote = `No tap was needed because ${inputKey.replace("_", " ")} was already ${requestedValue}.`;
  const diagnostics = {
    controlBounds,
    transitions: [],
  };

  if (currentValue !== requestedValue) {
    clickCoordinate(deviceId, operatorPackage, center.x, center.y);
    await getDependency("sleep")(1400);

    const dialogState = await waitForChoiceDialog(deviceId, operatorPackage, allowedValues);
    const targetOption = dialogState.options.find((option) => option.normalized === requestedValue);
    if (!targetOption) {
      throw new Error(`AirTouch opened a selector dialog, but ${requestedValue} was not available.`);
    }
    diagnostics.transitions.push({
      selectorOptions: dialogState.options.map((option) => option.normalized),
      selectedValue: targetOption.normalized,
    });
    const optionCenter = boundsCenter(targetOption.bounds);
    clickCoordinate(deviceId, operatorPackage, optionCenter.x, optionCenter.y);
    await getDependency("sleep")(1800);
    finalHomeState = await waitForHomeState(deviceId, operatorPackage, { maxAttempts: 6 });
    currentValue = inputKey === "mode" ? finalHomeState.modeValue : finalHomeState.fanLevelValue;
    actionNote = `Opened the ${inputKey.replace("_", " ")} selector at (${center.x},${center.y}) and chose ${requestedValue}.`;
  }

  appendCheckpoint(result, scopedCheckpointId(checkpointPrefix, "action_applied"), "ok", actionNote);

  return {
    homeState: finalHomeState,
    finalValue: currentValue || null,
    diagnostics,
  };
}

async function runCyclingSettingSkill({
  skillId,
  goalKind,
  inputKey,
  requestedValue,
  allowedValues,
  deviceId,
}) {
  const operatorPackage = resolveOperatorPackage();
  const result = buildSkillResult(skillId, goalKind, { [inputKey]: requestedValue }, requestedValue);

  if (!deviceId) {
    return failResult(result, "device_selected", "No device id was provided to the skill.");
  }
  if (!requestedValue || !allowedValues.includes(requestedValue)) {
    return failResult(result, "input_validated", `Pass ${inputKey === "mode" ? "--mode" : "--fan-level"} ${allowedValues.join("|")}.`);
  }

  result.diagnostics = {
    ...(result.diagnostics || {}),
    runtimeState: "healthy",
    operatorPackage,
    deviceSelected: true,
    allowedValues,
    transitions: [],
  };

  try {
    openApp(deviceId, operatorPackage);
    await getDependency("sleep")(1800);
    appendAppOpenedCheckpoint(result);

    let homeState = await waitForHomeState(deviceId, operatorPackage);
    appendCheckpoint(result, "home_screen_ready", "ok", "Opened the AirTouch Home screen.");

    if (!homeState.looksPoweredOn) {
      result.terminalVerification.note = "Home controls did not expose live values, which usually means the system power is off.";
      return failResult(result, "home_controls_visible", "Mode and fan controls were not exposed on the Home screen.");
    }

    const applied = await applyCyclingSettingFromHome({
      deviceId,
      operatorPackage,
      inputKey,
      requestedValue,
      allowedValues,
      homeState,
      result,
      checkpointPrefix: "",
    });
    homeState = applied.homeState;
    const currentValue = applied.finalValue;
    result.diagnostics.transitions.push(...applied.diagnostics.transitions);

    result.terminalVerification = {
      status: currentValue === requestedValue ? "verified" : "failed",
      expected: { kind: "text", text: requestedValue },
      observed: { kind: "text", text: currentValue || "unknown" },
      note: `Snapshot text above the ${inputKey.replace("_", " ")} control read ${currentValue || "unknown"}.`,
    };

    result.diagnostics = {
      ...(result.diagnostics || {}),
      finalControlBounds: applied.diagnostics.controlBounds,
      finalValue: currentValue || null,
    };

    if (currentValue !== requestedValue) {
      return failResult(
        result,
        "terminal_state_verified",
        `Requested ${inputKey.replace("_", " ")}=${requestedValue} but the Home snapshot still reported ${currentValue || "unknown"}.`,
      );
    }

    appendCheckpoint(result, "terminal_state_verified", "ok", `Verified ${inputKey.replace("_", " ")}=${requestedValue} from the Home snapshot.`, { kind: "text", text: requestedValue });
    result.result = {
      kind: "json",
      value: {
        [inputKey]: requestedValue,
      },
    };
    result.status = "success";
    emitSkillResult(result);
    return 0;
  } catch (error) {
    return failResult(result, "runtime_execution", summarizeError(error), { runtimeState: "poisoned" });
  }
}

async function runPowerStateSkill({ skillId, requestedState, deviceId }) {
  const operatorPackage = resolveOperatorPackage();
  const result = buildSkillResult(skillId, "set_power_state", { state: requestedState }, requestedState);
  let runDir = null;

  if (!deviceId) {
    return failResult(result, "device_selected", "No device id was provided to the skill.");
  }
  if (requestedState !== "on" && requestedState !== "off") {
    return failResult(result, "input_validated", "Pass --state on or --state off.");
  }

  result.diagnostics = {
    ...(result.diagnostics || {}),
    runtimeState: "healthy",
    operatorPackage,
    deviceSelected: true,
    heuristics: [
      "Power is classified from the screenshot crop around the Home power control.",
    ],
  };

  try {
    openApp(deviceId, operatorPackage);
    await getDependency("sleep")(1800);
    appendAppOpenedCheckpoint(result);

    let homeState = await waitForHomeState(deviceId, operatorPackage);
    appendCheckpoint(result, "home_screen_ready", "ok", "Opened the AirTouch Home screen.");

    runDir = await getDependency("mkdtemp")(join(tmpdir(), "clawperator-airtouch-power-"));
    const appliedPower = await applyPowerStateFromHome({
      deviceId,
      operatorPackage,
      requestedState,
      homeState,
      runDir,
      result,
      checkpointPrefix: "",
    });
    homeState = appliedPower.homeState;
    const currentState = appliedPower.finalState;
    Object.assign(result.diagnostics, appliedPower.diagnostics);

    result.terminalVerification = {
      status: currentState === requestedState ? "verified" : "failed",
      expected: { kind: "text", text: requestedState },
      observed: { kind: "text", text: currentState },
      note: `Heuristic power state after action was ${currentState}.`,
    };

    result.diagnostics = {
      ...(result.diagnostics || {}),
      finalState: currentState,
      finalSnapshot: {
        setPointVisible: homeState.setPointVisible,
        modeValue: homeState.modeValue,
        fanLevelValue: homeState.fanLevelValue,
      },
    };

    if (currentState !== requestedState) {
      return failResult(result, "terminal_state_verified", `Requested power=${requestedState} but the Home screen still looked ${currentState}.`);
    }

    appendCheckpoint(
      result,
      "terminal_state_verified",
      "ok",
      `Verified power=${requestedState} from the Home screen state.`,
      { kind: "text", text: requestedState },
    );
    result.result = {
      kind: "json",
      value: {
        state: requestedState,
      },
    };
    result.status = "success";
    emitSkillResult(result);
    return 0;
  } catch (error) {
    return failResult(result, "runtime_execution", summarizeError(error), { runtimeState: "poisoned" });
  } finally {
    if (runDir) {
      await getDependency("rm")(runDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function runHomeControlsSkill({ skillId, request, parseErrors, deviceId }) {
  const operatorPackage = resolveOperatorPackage();
  const inputs = {};
  if (request && request.state) inputs.state = request.state;
  if (request && request.fanLevel) inputs.fan_level = request.fanLevel;
  if (request && request.mode) inputs.mode = request.mode;
  const result = buildSkillResult(skillId, "set_home_controls", inputs, JSON.stringify(inputs));
  let runDir = null;

  if (!deviceId) {
    return failResult(result, "device_selected", "No device id was provided to the skill.");
  }
  if (parseErrors && parseErrors.length > 0) {
    return failResult(result, "input_validated", parseErrors.join(" "));
  }

  result.diagnostics = {
    ...(result.diagnostics || {}),
    runtimeState: "healthy",
    operatorPackage,
    deviceSelected: true,
    allowedValues: {
      state: ["on", "off"],
      fan_level: FAN_LEVEL_VALUES,
      mode: MODE_VALUES,
    },
    heuristics: [
      "Power is classified from the screenshot crop around the Home power control.",
    ],
    transitions: [],
  };

  try {
    openApp(deviceId, operatorPackage);
    await getDependency("sleep")(1800);
    appendAppOpenedCheckpoint(result);

    let homeState = await waitForHomeState(deviceId, operatorPackage);
    appendCheckpoint(result, "home_screen_ready", "ok", "Opened the AirTouch Home screen.");

    const finalValues = {};
    const requestedFinalValues = {};

    if (request.state) {
      runDir = await getDependency("mkdtemp")(join(tmpdir(), "clawperator-airtouch-home-controls-"));
      const appliedPower = await applyPowerStateFromHome({
        deviceId,
        operatorPackage,
        requestedState: request.state,
        homeState,
        runDir,
        result,
        checkpointPrefix: "power",
      });
      homeState = appliedPower.homeState;
      finalValues.state = appliedPower.finalState;
      requestedFinalValues.state = request.state;
      Object.assign(result.diagnostics, appliedPower.diagnostics);

      if (appliedPower.finalState !== request.state) {
        result.terminalVerification = {
          status: "failed",
          expected: { kind: "json", value: requestedFinalValues },
          observed: { kind: "json", value: finalValues },
          note: `Requested power=${request.state} but the Home screen still looked ${appliedPower.finalState}.`,
        };
        return failResult(result, "terminal_state_verified", result.terminalVerification.note);
      }

      if (request.state === "on" && (request.fanLevel || request.mode)) {
        homeState = await waitForHomeState(deviceId, operatorPackage, { maxAttempts: 6 });
        if (!homeState.looksPoweredOn) {
          return failResult(result, "home_controls_visible", "Power was requested on, but the Home controls did not expose mode and fan values.");
        }
        appendCheckpoint(result, "home_controls_visible", "ok", "Verified Home controls are visible after turning power on.");
      }
    } else if ((request.fanLevel || request.mode) && !homeState.looksPoweredOn) {
      result.terminalVerification.note = "Home controls did not expose live values, which usually means the system power is off.";
      return failResult(result, "home_controls_visible", "Mode and fan controls were not exposed on the Home screen.");
    }

    if (request.mode) {
      const appliedMode = await applyCyclingSettingFromHome({
        deviceId,
        operatorPackage,
        inputKey: "mode",
        requestedValue: request.mode,
        allowedValues: MODE_VALUES,
        homeState,
        result,
        checkpointPrefix: "mode",
      });
      homeState = appliedMode.homeState;
      finalValues.mode = appliedMode.finalValue;
      requestedFinalValues.mode = request.mode;
      result.diagnostics.transitions.push(...appliedMode.diagnostics.transitions);
      result.diagnostics.modeControlBounds = appliedMode.diagnostics.controlBounds;
    }

    if (request.fanLevel) {
      if (!homeState.fanLevelValue) {
        result.terminalVerification = {
          status: "failed",
          expected: { kind: "json", value: { ...requestedFinalValues, fan_level: request.fanLevel } },
          observed: { kind: "json", value: finalValues },
          note: "The Home snapshot did not expose a fan level. The current mode may not support fan-level changes.",
        };
        return failResult(
          result,
          "fan_control_visible",
          "The Home snapshot did not expose a fan level. Pass a mode that exposes fan controls, such as --mode cool, before --fan-level.",
          { runtimeState: "healthy" },
        );
      }

      const appliedFan = await applyCyclingSettingFromHome({
        deviceId,
        operatorPackage,
        inputKey: "fan_level",
        requestedValue: request.fanLevel,
        allowedValues: FAN_LEVEL_VALUES,
        homeState,
        result,
        checkpointPrefix: "fan_level",
      });
      homeState = appliedFan.homeState;
      finalValues.fan_level = appliedFan.finalValue;
      requestedFinalValues.fan_level = request.fanLevel;
      result.diagnostics.transitions.push(...appliedFan.diagnostics.transitions);
      result.diagnostics.fanLevelControlBounds = appliedFan.diagnostics.controlBounds;
    }

    const failures = Object.entries(requestedFinalValues)
      .filter(([key, expected]) => finalValues[key] !== expected)
      .map(([key, expected]) => `${key} expected ${expected} but observed ${finalValues[key] || "unknown"}`);

    result.terminalVerification = {
      status: failures.length === 0 ? "verified" : "failed",
      expected: { kind: "json", value: requestedFinalValues },
      observed: { kind: "json", value: finalValues },
      note: failures.length === 0 ? "Verified every requested Home control." : failures.join("; "),
    };

    result.diagnostics = {
      ...(result.diagnostics || {}),
      finalValues,
      finalSnapshot: {
        setPointVisible: homeState.setPointVisible,
        modeValue: homeState.modeValue,
        fanLevelValue: homeState.fanLevelValue,
      },
    };

    if (failures.length > 0) {
      return failResult(result, "terminal_state_verified", result.terminalVerification.note);
    }

    appendCheckpoint(result, "terminal_state_verified", "ok", "Verified every requested Home control.", { kind: "json", value: finalValues });
    result.result = {
      kind: "json",
      value: {
        requested: requestedFinalValues,
        final: finalValues,
      },
    };
    result.status = "success";
    emitSkillResult(result);
    return 0;
  } catch (error) {
    return failResult(result, "runtime_execution", summarizeError(error), { runtimeState: "poisoned" });
  } finally {
    if (runDir) {
      await getDependency("rm")(runDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  AIRTOUCH_PACKAGE,
  FAN_LEVEL_VALUES,
  MODE_VALUES,
  boundsCenter,
  classifyPowerState,
  extractChoiceDialogState,
  extractHomeScreenState,
  parseChoiceArg,
  parseHomeControlsArgs,
  parseNamedChoiceArg,
  parseXmlNodes,
  mergePowerStateEvidence,
  runCyclingSettingSkill,
  runHomeControlsSkill,
  runPowerStateSkill,
  setAirTouchHomeControlsDepsForTest,
  shouldRetryPowerToggle,
};
