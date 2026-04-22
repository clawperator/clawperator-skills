const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const zlib = require("node:zlib");

const { resolveOperatorPackage, runClawperatorCommand } = require("./common.js");

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
  result.diagnostics = {
    ...(result.diagnostics || {}),
    ...diagnostics,
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

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseBounds(raw) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(String(raw || ""));
  if (!match) {
    return null;
  }
  return {
    left: Number.parseInt(match[1], 10),
    top: Number.parseInt(match[2], 10),
    right: Number.parseInt(match[3], 10),
    bottom: Number.parseInt(match[4], 10),
  };
}

function boundsKey(bounds) {
  return `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
}

function boundsWidth(bounds) {
  return Math.max(0, bounds.right - bounds.left);
}

function boundsHeight(bounds) {
  return Math.max(0, bounds.bottom - bounds.top);
}

function boundsCenter(bounds) {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

function parseXmlNodes(xml) {
  const nodes = [];
  const nodeRegex = /<node\s+([^>]*?)(?:\/>|>)/g;
  let match;
  while ((match = nodeRegex.exec(xml)) !== null) {
    const attributes = {};
    const attrRegex = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attributes[attrMatch[1]] = decodeEntities(attrMatch[2]);
    }
    const bounds = parseBounds(attributes.bounds);
    if (!bounds) {
      continue;
    }
    nodes.push({
      text: attributes.text || "",
      resourceId: attributes["resource-id"] || "",
      className: attributes.class || "",
      packageName: attributes.package || "",
      clickable: attributes.clickable === "true",
      bounds,
    });
  }
  return nodes;
}

function extractSnapshotXml(rawResult) {
  const xml = rawResult?.envelope?.stepResults?.find((step) => step.actionType === "snapshot_ui")?.data?.text;
  if (typeof xml !== "string" || xml.length === 0) {
    throw new Error("snapshot did not return hierarchy XML");
  }
  return xml;
}

function extractForegroundPackage(rawResult) {
  const foregroundPackage = rawResult?.envelope?.stepResults?.find((step) => step.actionType === "snapshot_ui")?.data?.foreground_package;
  return typeof foregroundPackage === "string" ? foregroundPackage : "";
}

function runJsonCommand(command, args) {
  const response = runClawperatorCommand(command, args, { encoding: "utf-8", timeoutMs: 30000 });
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

function clickText(deviceId, operatorPackage, text) {
  return runJsonCommand("click", ["--text", text, "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function clickCoordinate(deviceId, operatorPackage, x, y) {
  return runJsonCommand("click", ["--coordinate", String(x), String(y), "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function takeScreenshot(deviceId, operatorPackage, path) {
  return runJsonCommand("screenshot", ["--device", deviceId, "--operator-package", operatorPackage, "--path", path, "--json"]);
}

function paethPredictor(a, b, c) {
  const prediction = a + b - c;
  const pa = Math.abs(prediction - a);
  const pb = Math.abs(prediction - b);
  const pc = Math.abs(prediction - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

async function readPngRgba(path) {
  const data = await readFile(path);
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`not a png: ${path}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  const idatChunks = [];

  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    offset += 4;
    const type = data.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    const chunk = data.subarray(offset, offset + length);
    offset += length + 4;

    if (type === "IHDR") {
      if (chunk.length < 13) {
        throw new Error(`png IHDR chunk too short: ${path}`);
      }
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      sawIhdr = true;
      const bitDepth = chunk[8];
      const colorType = chunk[9];
      if (bitDepth !== 8 || colorType !== 6) {
        throw new Error(`expected RGBA png, got bitDepth=${bitDepth} colorType=${colorType}`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  if (!sawIhdr || width <= 0 || height <= 0) {
    throw new Error(`png missing valid IHDR dimensions: ${path}`);
  }
  if (idatChunks.length === 0) {
    throw new Error(`png missing IDAT data: ${path}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let inputOffset = 0;
  let previousScanline = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[inputOffset];
    inputOffset += 1;
    const scanline = Buffer.from(raw.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;

    if (filter === 1) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? scanline[x - 4] : 0;
        scanline[x] = (scanline[x] + left) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x += 1) {
        scanline[x] = (scanline[x] + previousScanline[x]) & 255;
      }
    } else if (filter === 3) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? scanline[x - 4] : 0;
        const up = previousScanline[x];
        scanline[x] = (scanline[x] + Math.floor((left + up) / 2)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? scanline[x - 4] : 0;
        const up = previousScanline[x];
        const upLeft = x >= 4 ? previousScanline[x - 4] : 0;
        scanline[x] = (scanline[x] + paethPredictor(left, up, upLeft)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported png filter ${filter}`);
    }

    scanline.copy(out, y * stride);
    previousScanline = scanline;
  }

  return { width, height, rgba: out };
}

function clampBounds(bounds, width, height) {
  return {
    left: Math.max(0, Math.min(width - 1, bounds.left)),
    top: Math.max(0, Math.min(height - 1, bounds.top)),
    right: Math.max(1, Math.min(width, bounds.right)),
    bottom: Math.max(1, Math.min(height, bounds.bottom)),
  };
}

function averageRgba(image, bounds) {
  const region = clampBounds(bounds, image.width, image.height);
  if (region.left >= region.right || region.top >= region.bottom) {
    throw new Error(`empty screenshot region after clamping: ${JSON.stringify(region)}`);
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let y = region.top; y < region.bottom; y += 1) {
    const rowOffset = y * image.width * 4;
    for (let x = region.left; x < region.right; x += 1) {
      const index = rowOffset + x * 4;
      red += image.rgba[index];
      green += image.rgba[index + 1];
      blue += image.rgba[index + 2];
      alpha += image.rgba[index + 3];
      count += 1;
    }
  }
  if (count === 0) {
    throw new Error(`screenshot region contained no pixels: ${JSON.stringify(region)}`);
  }
  return {
    region,
    pixelCount: count,
    avgRgba: [
      Number((red / count).toFixed(2)),
      Number((green / count).toFixed(2)),
      Number((blue / count).toFixed(2)),
      Number((alpha / count).toFixed(2)),
    ],
  };
}

function classifyPowerState(stats) {
  const [red, green, blue] = stats.avgRgba;
  const brightness = (red + green + blue) / 3;
  const blueDominance = blue - ((red + green) / 2);
  const isOn = brightness > 70 && blueDominance > 25;
  return {
    state: isOn ? "on" : "off",
    metrics: {
      brightness: Number(brightness.toFixed(2)),
      blueDominance: Number(blueDominance.toFixed(2)),
      avgRgba: stats.avgRgba,
      region: stats.region,
    },
  };
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

  return uniqueCandidates.sort((left, right) => left.left - right.left).slice(0, 3);
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
  const modeBounds = detectedSlots[1] || fallbackSlots.mode;
  const fanBounds = detectedSlots[2] || fallbackSlots.fan;
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
      power: detectedSlots[0] || fallbackSlots.power,
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
    const snapResult = snapshot(deviceId, operatorPackage);
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

    await sleep(1500);
  }

  throw new Error(
    `AirTouch Home screen did not stabilize; last foreground package was ${lastForegroundPackage || "unknown"} and poweredOn=${lastState ? String(lastState.looksPoweredOn) : "unknown"}.`,
  );
}

async function waitForChoiceDialog(deviceId, operatorPackage, allowedValues, { maxAttempts = 6 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapResult = snapshot(deviceId, operatorPackage);
    const foregroundPackage = extractForegroundPackage(snapResult);
    const xml = extractSnapshotXml(snapResult);

    if (foregroundPackage !== AIRTOUCH_PACKAGE) {
      openApp(deviceId, operatorPackage);
      await sleep(1200);
      continue;
    }

    const dialogState = extractChoiceDialogState(xml, allowedValues);
    if (dialogState) {
      return dialogState;
    }

    await sleep(800);
  }

  throw new Error("AirTouch selector dialog did not appear after tapping the Home control.");
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
    deviceId,
    allowedValues,
    transitions: [],
  };

  try {
    openApp(deviceId, operatorPackage);
    await sleep(1800);
    appendCheckpoint(result, "app_opened", "ok", `Opened ${AIRTOUCH_PACKAGE} on ${deviceId}.`);

    let homeState = await waitForHomeState(deviceId, operatorPackage);
    appendCheckpoint(result, "home_screen_ready", "ok", "Opened the AirTouch Home screen.");

    if (!homeState.looksPoweredOn) {
      result.terminalVerification.note = "Home controls did not expose live values, which usually means the system power is off.";
      return failResult(result, "home_controls_visible", "Mode and fan controls were not exposed on the Home screen.");
    }

    const controlBounds = inputKey === "mode" ? homeState.controlSlots.mode : homeState.controlSlots.fan;
    if (!controlBounds) {
      return failResult(result, "control_bounds_derived", `Could not derive the ${inputKey} control bounds from the Home screen.`);
    }

    let currentValue = inputKey === "mode" ? homeState.modeValue : homeState.fanLevelValue;
    if (!currentValue || !allowedValues.includes(currentValue)) {
      return failResult(result, "current_value_read", `Could not read the current ${inputKey.replace("_", " ")} from the Home snapshot.`);
    }

    appendCheckpoint(
      result,
      "current_value_read",
      "ok",
      `AirTouch reported ${inputKey.replace("_", " ")}=${currentValue} before action.`,
      { kind: "json", value: { controlBounds, currentValue } },
    );

    const center = boundsCenter(controlBounds);
    let actionNote = `No tap was needed because ${inputKey.replace("_", " ")} was already ${requestedValue}.`;

    if (currentValue !== requestedValue) {
      clickCoordinate(deviceId, operatorPackage, center.x, center.y);
      await sleep(1400);

      const dialogState = await waitForChoiceDialog(deviceId, operatorPackage, allowedValues);
      const targetOption = dialogState.options.find((option) => option.normalized === requestedValue);
      if (!targetOption) {
        return failResult(result, "selector_opened", `AirTouch opened a selector dialog, but ${requestedValue} was not available.`);
      }
      result.diagnostics.transitions.push({
        selectorOptions: dialogState.options.map((option) => option.normalized),
        selectedValue: targetOption.normalized,
      });
      const optionCenter = boundsCenter(targetOption.bounds);
      clickCoordinate(deviceId, operatorPackage, optionCenter.x, optionCenter.y);
      await sleep(1800);
      homeState = await waitForHomeState(deviceId, operatorPackage, { maxAttempts: 6 });
      currentValue = inputKey === "mode" ? homeState.modeValue : homeState.fanLevelValue;
      actionNote = `Opened the ${inputKey.replace("_", " ")} selector at (${center.x},${center.y}) and chose ${requestedValue}.`;
    }
    appendCheckpoint(result, "action_applied", "ok", actionNote);

    result.terminalVerification = {
      status: currentValue === requestedValue ? "verified" : "failed",
      expected: { kind: "text", text: requestedValue },
      observed: { kind: "text", text: currentValue || "unknown" },
      note: `Snapshot text above the ${inputKey.replace("_", " ")} control read ${currentValue || "unknown"}.`,
    };

    result.diagnostics = {
      ...(result.diagnostics || {}),
      finalControlBounds: controlBounds,
      finalValue: currentValue || null,
    };

    if (currentValue !== requestedValue) {
      return failResult(
        result,
        "terminal_state_verified",
        `Requested ${inputKey.replace("_", " ")}=${requestedValue} but the Home snapshot still reported ${currentValue || "unknown"}.`,
      );
    }

    appendCheckpoint(
      result,
      "terminal_state_verified",
      "ok",
      `Verified ${inputKey.replace("_", " ")}=${requestedValue} from the Home snapshot.`,
      { kind: "text", text: requestedValue },
    );
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
    deviceId,
    heuristics: [
      "Power is classified from the screenshot crop around the Home power control.",
    ],
  };

  try {
    openApp(deviceId, operatorPackage);
    await sleep(1800);
    appendCheckpoint(result, "app_opened", "ok", `Opened ${AIRTOUCH_PACKAGE} on ${deviceId}.`);

    let homeState = await waitForHomeState(deviceId, operatorPackage);
    appendCheckpoint(result, "home_screen_ready", "ok", "Opened the AirTouch Home screen.");

    const powerBounds = homeState.controlSlots.power;
    if (!powerBounds) {
      return failResult(result, "control_bounds_derived", "Could not derive the power control bounds from the Home screen.");
    }

    runDir = await mkdtemp(join(tmpdir(), "clawperator-airtouch-power-"));
    const beforePath = join(runDir, "power-before.png");
    takeScreenshot(deviceId, operatorPackage, beforePath);
    const beforeImage = await readPngRgba(beforePath);
    const beforeStats = averageRgba(beforeImage, powerBounds);
    const beforeState = classifyPowerState(beforeStats);
    let currentState = beforeState.state;
    appendCheckpoint(
      result,
      "current_value_read",
      "ok",
      `AirTouch power looked ${currentState} before action.`,
      { kind: "json", value: { powerBounds, screenshotMetrics: beforeState.metrics, setPointVisible: homeState.setPointVisible, modeValue: homeState.modeValue, fanLevelValue: homeState.fanLevelValue } },
    );

    const center = boundsCenter(powerBounds);
    let tapsApplied = 0;
    let actionNote = `No tap was needed because power was already ${requestedState}.`;

    for (let attempt = 0; currentState !== requestedState && attempt < 2; attempt += 1) {
      clickCoordinate(deviceId, operatorPackage, center.x, center.y);
      tapsApplied += 1;
      await sleep(2500);
      homeState = await waitForHomeState(deviceId, operatorPackage, { maxAttempts: 6 });
      const afterPath = join(runDir, `power-after-${attempt + 1}.png`);
      takeScreenshot(deviceId, operatorPackage, afterPath);
      const afterImage = await readPngRgba(afterPath);
      const afterStats = averageRgba(afterImage, powerBounds);
      const afterState = classifyPowerState(afterStats);
      currentState = afterState.state;
      result.diagnostics.lastPowerMetrics = afterState.metrics;
    }

    if (tapsApplied > 0) {
      actionNote = `Tapped the power control ${tapsApplied} time(s) at (${center.x},${center.y}).`;
    }
    appendCheckpoint(result, "action_applied", "ok", actionNote);

    result.terminalVerification = {
      status: currentState === requestedState ? "verified" : "failed",
      expected: { kind: "text", text: requestedState },
      observed: { kind: "text", text: currentState },
      note: `Heuristic power state after action was ${currentState}.`,
    };

    result.diagnostics = {
      ...(result.diagnostics || {}),
      powerBounds,
      beforePowerMetrics: beforeState.metrics,
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
    result.status = "success";
    emitSkillResult(result);
    return 0;
  } catch (error) {
    return failResult(result, "runtime_execution", summarizeError(error), { runtimeState: "poisoned" });
  } finally {
    if (runDir) {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
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
  parseXmlNodes,
  runCyclingSettingSkill,
  runPowerStateSkill,
};
