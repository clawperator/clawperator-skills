#!/usr/bin/env node
const { runClawperator, resolveReceiverPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const acTileName = process.argv[3] || process.env.AC_TILE_NAME;
const receiverPkg = resolveReceiverPackage(process.argv[4]);

if (!deviceId || !acTileName) {
  console.error("Usage: node get_aircon_status.js <device_id> <ac_tile_name> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-gh-ac-status-${Date.now()}`;
const skillId = "com.google.android.apps.chromecast.app.get-aircon-status";

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
      { id: "read-power", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } } },
      { id: "read-mode", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/body_text" } } },
      { id: "read-indoor-temp", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/first_value_title" } } }
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
        matcher: { textContains: acTileName },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/pager_home_tab" },
        direction: "down",
        maxSwipes: 8,
        clickType: "long_click"
      }
    },
    { id: "wait3", type: "sleep", params: { durationMs: 8000 } },
    { id: "read-power", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } } },
    { id: "read-mode", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/body_text" } } },
    { id: "read-indoor-temp", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/first_value_title" } } }
  ]
  };
}

function extractValues(result) {
  const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
  const powerStep = stepResults.find(s => s.id === "read-power");
  const modeStep = stepResults.find(s => s.id === "read-mode");
  const tempStep = stepResults.find(s => s.id === "read-indoor-temp");

  const power = powerStep && powerStep.data ? powerStep.data.text : null;
  const mode = modeStep && modeStep.data ? modeStep.data.text : "unknown";
  const temp = tempStep && tempStep.data ? tempStep.data.text : "unknown";
  return { power, mode, temp };
}

function getSnapshotText(result) {
  const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
  const snapStep = stepResults.find((s) => s.id === "snap");
  return snapStep && snapStep.data ? snapStep.data.text : "";
}

logSkillProgress(skillId, "Taking preflight snapshot...");
const preflightRun = runClawperator(buildPreflightExecution(), deviceId, receiverPkg);
if (!preflightRun.ok) {
  console.error(`⚠️ Skill execution failed: ${preflightRun.error}`);
  process.exit(2);
}

const preflightSnap = getSnapshotText(preflightRun.result);
const shouldNavigate = preflightSnap.includes('com.google.android.apps.chromecast.app:id/category_chips');
if (shouldNavigate) {
  logSkillProgress(skillId, "Direct read failed, navigating to aircon tile...");
}
logSkillProgress(skillId, "Capturing aircon status...");
const primaryRun = runClawperator(shouldNavigate ? buildNavigationExecution() : buildDirectReadExecution(), deviceId, receiverPkg);
let finalRun = primaryRun;
let values = primaryRun.ok ? extractValues(primaryRun.result) : { power: null, mode: "unknown", temp: "unknown" };

if (!values.power) {
  if (!shouldNavigate) {
    logSkillProgress(skillId, "Direct read failed, navigating to aircon tile...");
  }
  const secondaryRun = runClawperator(shouldNavigate ? buildDirectReadExecution() : buildNavigationExecution(), deviceId, receiverPkg);
  finalRun = secondaryRun;
  if (secondaryRun.ok) {
    values = extractValues(secondaryRun.result);
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
  logSkillProgress(skillId, "Parsing aircon data...");
  console.log(`✅ AC status (${acTileName}): power=${values.power}, mode=${values.mode}, indoor_temp=${values.temp}`);
} else {
  console.error("⚠️ Could not parse AC status values");
  console.error(`Raw result: ${finalRun.raw}`);
  process.exit(2);
}
