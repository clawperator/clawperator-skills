#!/usr/bin/env node

const { mkdtemp, rm } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { resolveOperatorPackage, runClawperatorCommand } = require("../../utils/common.js");
const {
  averageRgba,
  boundsCenter,
  classifyPowerState,
  extractSnapshotXml,
  parseXmlNodes,
  readPngRgba,
} = require("../../utils/airtouch5_snapshot.js");

const skillId = "au.com.polyaire.airtouch5.set-zone-state";
const targetPackage = "au.com.polyaire.airtouch5";
const operatorPackage = resolveOperatorPackage();
const deviceId = process.env.CLAWPERATOR_DEVICE_ID || process.argv[2] || "";
const rawArgs = process.env.CLAWPERATOR_DEVICE_ID ? process.argv.slice(2) : process.argv.slice(3);
const retainRunArtifacts = process.env.CLAWPERATOR_SKILL_RETAIN_LOGS === "1" || process.env.CLAWPERATOR_SKILL_DEBUG === "1";

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

function describeSelectedDevice() {
  return "the selected device";
}

function parseRequestedState(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim().toLowerCase();
    const next = String(args[index + 1] || "").trim().toLowerCase();

    if (arg === "--state" && (next === "on" || next === "off")) {
      return next;
    }
    if (arg.startsWith("--state=")) {
      const value = arg.slice("--state=".length);
      if (value === "on" || value === "off") {
        return value;
      }
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim().toLowerCase();
    const previous = String(args[index - 1] || "").trim().toLowerCase();

    if (previous.startsWith("--") && !previous.includes("=")) {
      continue;
    }
    if (arg === "on" || arg === "off") {
      return arg;
    }
  }
  return null;
}

function parseRequestedZoneName(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    const next = String(args[index + 1] || "").trim();

    if (arg === "--zone-name" && next.length > 0) {
      return next;
    }
    if (arg.startsWith("--zone-name=")) {
      const value = arg.slice("--zone-name=".length).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function buildBaseSkillResult(zoneName, state, status = "failed") {
  return {
    contractVersion: "1.0.0",
    skillId,
    goal: {
      kind: "set_zone_state",
      zone_name: zoneName,
      state,
    },
    inputs: {
      zone_name: zoneName,
      state,
    },
    status,
    checkpoints: [],
    terminalVerification: {
      status: "not_run",
      expected: { kind: "text", text: state || "unknown" },
      observed: null,
      note: null,
    },
    diagnostics: {
      runtimeState: "unknown",
    },
  };
}

function appendCheckpoint(result, id, status, note, evidence) {
  const checkpoint = { id, status };
  if (note) {
    checkpoint.note = note;
  }
  if (evidence) {
    checkpoint.evidence = evidence;
  }
  checkpoint.observedAt = nowIso();
  result.checkpoints.push(checkpoint);
}

function failResult(result, id, note, diagnostics = {}) {
  appendCheckpoint(result, id, "failed", note);
  result.status = "failed";
  result.diagnostics = {
    ...(result.diagnostics || {}),
    runtimeState: "unknown",
    ...diagnostics,
  };
  emitSkillResult(result);
  return 1;
}

async function cleanupRunDirectory(runDir, shouldRetain) {
  if (!runDir || shouldRetain) {
    return;
  }
  await rm(runDir, { recursive: true, force: true });
}

function pruneTransientArtifactDiagnostics(result, shouldRetain) {
  if (shouldRetain || !result.diagnostics) {
    return;
  }
  delete result.diagnostics.runDir;
  delete result.diagnostics.beforeScreenshot;
  delete result.diagnostics.afterScreenshot;
}

async function cleanupRunDirectoryBestEffort(result, runDir, shouldRetain) {
  try {
    await cleanupRunDirectory(runDir, shouldRetain);
  } catch (cleanupError) {
    result.diagnostics = {
      ...(result.diagnostics || {}),
      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    };
  }
  pruneTransientArtifactDiagnostics(result, shouldRetain);
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top);
}

function overlapY(a, b) {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function findZoneLabelNode(nodes, zoneName) {
  const normalizedZoneName = String(zoneName || "").trim().toLowerCase();
  return nodes.find((node) => node.text.trim().toLowerCase() === normalizedZoneName);
}

function derivePowerBounds(nodes, labelNode) {
  const labelBounds = labelNode.bounds;
  const candidates = nodes
    .filter((node) => node.bounds.right <= labelBounds.left + 4)
    .filter((node) => overlapY(node.bounds, labelBounds) >= Math.floor((labelBounds.bottom - labelBounds.top) * 0.5))
    .filter((node) => boundsArea(node.bounds) >= 12000)
    .sort((a, b) => {
      const overlapDelta = overlapY(b.bounds, labelBounds) - overlapY(a.bounds, labelBounds);
      if (overlapDelta !== 0) {
        return overlapDelta;
      }
      const areaDelta = boundsArea(b.bounds) - boundsArea(a.bounds);
      if (areaDelta !== 0) {
        return areaDelta;
      }
      return b.bounds.right - a.bounds.right;
    });

  if (candidates.length > 0) {
    return candidates[0].bounds;
  }

  const rowHeight = Math.max(120, labelBounds.bottom - labelBounds.top + 54);
  const rowTop = Math.max(0, Math.round((labelBounds.top + labelBounds.bottom - rowHeight) / 2));
  return {
    left: 32,
    top: rowTop,
    right: Math.max(160, labelBounds.left - 24),
    bottom: rowTop + rowHeight,
  };
}

function runJsonCommand(command, args) {
  const response = runClawperatorCommand(command, args, { encoding: "utf-8" });
  if (!response.ok) {
    throw new Error(response.error || `${command} failed`);
  }
  return JSON.parse(response.result);
}

function openApp() {
  return runJsonCommand("open", [targetPackage, "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function snapshot() {
  return runJsonCommand("snapshot", ["--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function clickText(text) {
  return runJsonCommand("click", ["--text", text, "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function clickCoordinate(x, y) {
  return runJsonCommand("click", ["--coordinate", String(x), String(y), "--device", deviceId, "--operator-package", operatorPackage, "--json"]);
}

function takeScreenshot(path) {
  return runJsonCommand("screenshot", ["--device", deviceId, "--operator-package", operatorPackage, "--path", path, "--json"]);
}

async function waitForZonesReady() {
  let lastXml = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapResult = snapshot();
    lastXml = extractSnapshotXml(snapResult);
    if (lastXml.includes('text="Zones"') || lastXml.includes(">Zones<")) {
      return lastXml;
    }
    await sleep(1200);
  }
  throw new Error("AirTouch did not expose the Zones tab");
}

async function waitForZoneSnapshot(zoneName) {
  let lastXml = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const snapResult = snapshot();
    lastXml = extractSnapshotXml(snapResult);
    const nodes = parseXmlNodes(lastXml);
    if (findZoneLabelNode(nodes, zoneName)) {
      return lastXml;
    }
    await sleep(1200);
  }
  throw new Error(`AirTouch Zones view did not expose the ${zoneName} row`);
}

async function main() {
  const requestedState = parseRequestedState(rawArgs);
  const targetZone = parseRequestedZoneName(rawArgs);
  const result = buildBaseSkillResult(targetZone, requestedState);
  let runDir = null;

  if (!deviceId) {
    return failResult(result, "device_selected", "No device id was provided to the skill.");
  }
  if (requestedState !== "on" && requestedState !== "off") {
    return failResult(result, "input_validated", "Pass --state on or --state off.");
  }
  if (!targetZone) {
    return failResult(result, "input_validated", "Pass --zone-name <label>.");
  }

  try {
    runDir = await mkdtemp(join(tmpdir(), "clawperator-airtouch-zone-"));
    result.diagnostics = {
      runtimeState: "healthy",
      targetPackage,
      operatorPackage,
      deviceSelected: true,
      artifactsRetained: retainRunArtifacts,
      ...(retainRunArtifacts ? { runDir } : {}),
    };

    openApp();
    await sleep(2000);
    appendCheckpoint(result, "app_opened", "ok", `Opened ${targetPackage} on ${describeSelectedDevice()}.`);

    await waitForZonesReady();
    clickText("Zones");
    await sleep(1800);
    appendCheckpoint(result, "zones_tab_opened", "ok", "Opened the Zones tab.");

    const zonesXml = await waitForZoneSnapshot(targetZone);
    const nodes = parseXmlNodes(zonesXml);
    const zoneLabel = findZoneLabelNode(nodes, targetZone);
    if (!zoneLabel) {
      await cleanupRunDirectoryBestEffort(result, runDir, retainRunArtifacts);
      return failResult(result, "zone_row_located", `${targetZone} row was not found in the Zones snapshot.`);
    }
    const powerBounds = derivePowerBounds(nodes, zoneLabel);
    appendCheckpoint(
      result,
      "zone_row_located",
      "ok",
      `Located the ${targetZone} row and derived the power hitbox ${JSON.stringify(powerBounds)}.`,
      { kind: "text", text: `${targetZone} bounds ${JSON.stringify(powerBounds)}` },
    );

    const beforePath = join(runDir, "zone-before.png");
    takeScreenshot(beforePath);
    const beforeImage = await readPngRgba(beforePath);
    const beforeStats = averageRgba(beforeImage, powerBounds);
    const beforeState = classifyPowerState(beforeStats, { blueDominanceThreshold: 20, greenLiftThreshold: 15 });
    appendCheckpoint(
      result,
      "zone_state_read",
      "ok",
      `${targetZone} power looked ${beforeState.state} before action.`,
      { kind: "json", value: beforeState.metrics },
    );

    let actionNote = `${targetZone} already matched the requested state; no tap was needed.`;
    let actionTaken = false;
    if (beforeState.state !== requestedState) {
      const center = boundsCenter(powerBounds);
      clickCoordinate(center.x, center.y);
      actionTaken = true;
      actionNote = `Tapped the ${targetZone} power hitbox at (${center.x},${center.y}) to switch ${beforeState.state} -> ${requestedState}.`;
      await sleep(2200);
    }
    appendCheckpoint(result, "action_applied", "ok", actionNote);

    const afterPath = join(runDir, actionTaken ? "zone-after-toggle.png" : "zone-after-noop.png");
    takeScreenshot(afterPath);
    const afterImage = await readPngRgba(afterPath);
    const afterStats = averageRgba(afterImage, powerBounds);
    const afterState = classifyPowerState(afterStats, { blueDominanceThreshold: 20, greenLiftThreshold: 15 });

    result.terminalVerification = {
      status: afterState.state === requestedState ? "verified" : "failed",
      expected: { kind: "text", text: requestedState },
      observed: { kind: "text", text: afterState.state },
      note: `Screenshot classifier observed ${targetZone}=${afterState.state}.`,
    };
    const artifactDiagnostics = retainRunArtifacts
      ? {
          runDir,
          beforeScreenshot: beforePath,
          afterScreenshot: afterPath,
        }
      : {
          artifactsRetained: false,
        };
    result.diagnostics = {
      ...(result.diagnostics || {}),
      powerBounds,
      beforeMetrics: beforeState.metrics,
      afterMetrics: afterState.metrics,
      ...artifactDiagnostics,
    };

    if (afterState.state !== requestedState) {
      result.diagnostics = {
        ...(result.diagnostics || {}),
        runtimeState: (result.diagnostics && result.diagnostics.runtimeState) || "healthy",
      };
      await cleanupRunDirectoryBestEffort(result, runDir, retainRunArtifacts);
      return failResult(
        result,
        "terminal_state_verified",
        `Requested ${targetZone}=${requestedState} but screenshot classifier still observed ${afterState.state}.`,
      );
    }

    appendCheckpoint(
      result,
      "terminal_state_verified",
      "ok",
      `Verified ${targetZone}=${requestedState} from the screenshot crop.`,
      { kind: "json", value: afterState.metrics },
    );
    result.status = "success";
    await cleanupRunDirectoryBestEffort(result, runDir, retainRunArtifacts);
    emitSkillResult(result);
    return 0;
  } catch (error) {
    await cleanupRunDirectoryBestEffort(result, runDir, retainRunArtifacts);
    return failResult(
      result,
      "runtime_execution",
      error instanceof Error ? error.message : String(error),
      { ...(result.diagnostics || {}), runtimeState: "poisoned" },
    );
  }
}

main().then((exitCode) => {
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
});
