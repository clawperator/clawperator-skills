#!/usr/bin/env node
const { runClawperator, findAttribute, resolveOperatorPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const climateTileName = process.argv[3] || process.env.CLIMATE_TILE_NAME || process.env.AC_TILE_NAME;
const operatorPkg = resolveOperatorPackage(process.argv[4]);

if (!deviceId || !climateTileName) {
  console.error("Usage: node get_climate_status.js <device_id> <tile_name> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-gh-climate-status-${Date.now()}`;
const skillId = "com.google.android.apps.chromecast.app.get-climate";

function buildDirectReadExecution() {
  return {
    commandId,
    taskId: commandId,
    source: "clawperator-skill",
    expectedFormat: "android-ui-automator",
    timeoutMs: 90000,
    actions: [
      { id: "close", type: "close_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
      { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
      { id: "open", type: "open_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
      { id: "wait1", type: "sleep", params: { durationMs: 12000 } },
      { id: "snap", type: "snapshot_ui" }
    ]
  };
}

function buildPreflightExecution() {
  return {
    commandId,
    taskId: commandId,
    source: "clawperator-skill",
    expectedFormat: "android-ui-automator",
    timeoutMs: 60000,
    actions: [
      { id: "close", type: "close_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
      { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
      { id: "open", type: "open_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
      { id: "wait1", type: "sleep", params: { durationMs: 15000 } },
      { id: "snap", type: "snapshot_ui" }
    ]
  };
}

function buildNavigationExecution() {
  return {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
    { id: "wait1", type: "sleep", params: { durationMs: 3500 } },
    {
      id: "climate",
      type: "scroll_and_click",
      params: {
        matcher: { textEquals: "Climate" },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/category_chips" },
        direction: "right",
        maxSwipes: 6,
        clickType: "click",
        findFirstScrollableChild: true
      }
    },
    { id: "wait2", type: "sleep", params: { durationMs: 1500 } },
    {
      id: "openController",
      type: "scroll_and_click",
      params: {
        matcher: { textContains: climateTileName },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/pager_home_tab" },
        direction: "down",
        maxSwipes: 8,
        clickType: "long_click"
      }
    },
    { id: "wait3", type: "sleep", params: { durationMs: 8000 } },
    { id: "snap", type: "snapshot_ui" }
  ]
  };
}

function extractValues(result) {
  const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
  const snapStep = stepResults.find(s => s.id === "snap");
  const snapText = snapStep && snapStep.data ? snapStep.data.text : "";

  let power = null;
  let mode = "unknown";
  let temp = "unknown";

  snapText.split("\n").forEach((line) => {
    const resourceId = findAttribute(line, "resource-id") || "";
    const text = findAttribute(line, "text") || "";
    if (resourceId.includes("low_value") && text) {
      power = text;
    }
    if (resourceId.includes("body_text") && text) {
      mode = text;
    }
    if (resourceId.includes("first_value_title") && text) {
      temp = text;
    }
  });

  return { power, mode, temp };
}

function getSnapshotText(result) {
  const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
  const snapStep = stepResults.find((s) => s.id === "snap");
  return snapStep && snapStep.data ? snapStep.data.text : "";
}

logSkillProgress(skillId, "Taking preflight snapshot...");
const preflightRun = runClawperator(buildPreflightExecution(), deviceId, operatorPkg);
if (!preflightRun.ok) {
  console.error(`⚠️ Skill execution failed: ${preflightRun.error}`);
  process.exit(2);
}

const preflightSnap = getSnapshotText(preflightRun.result);
const shouldNavigate = preflightSnap.includes('com.google.android.apps.chromecast.app:id/category_chips');
if (shouldNavigate) {
  logSkillProgress(skillId, "Home tiles detected, opening climate unit...");
}
logSkillProgress(skillId, "Capturing HVAC status...");
const primaryExecution = shouldNavigate ? buildNavigationExecution() : buildDirectReadExecution();
const primaryRun = runClawperator(primaryExecution, deviceId, operatorPkg);
let finalRun = primaryRun;
let values = { power: null, mode: "unknown", temp: "unknown" };

if (primaryRun.ok) {
  values = extractValues(primaryRun.result);
}

if (!primaryRun.ok || !values.power) {
  if (!shouldNavigate) {
    logSkillProgress(skillId, "Direct read failed, navigating to climate unit tile...");
  }
  const fallbackExecution = shouldNavigate ? buildDirectReadExecution() : buildNavigationExecution();
  const fallbackRun = runClawperator(fallbackExecution, deviceId, operatorPkg);
  finalRun = fallbackRun;
  if (fallbackRun.ok) {
    values = extractValues(fallbackRun.result);
  }
}

if (!finalRun.ok) {
  console.error(`⚠️ Skill execution failed: ${finalRun.error}`);
  process.exit(2);
}

if (values.power) {
  if (!shouldNavigate) {
    logSkillProgress(skillId, "Direct tile read succeeded...");
  }
  logSkillProgress(skillId, "Parsing HVAC data...");
  console.log(`✅ HVAC status (${climateTileName}): power=${values.power}, mode=${values.mode}, indoor_temp=${values.temp}`);
} else {
  console.error("⚠️ Could not parse HVAC status values");
  console.error(`Raw result: ${finalRun.raw}`);
  process.exit(2);
}
