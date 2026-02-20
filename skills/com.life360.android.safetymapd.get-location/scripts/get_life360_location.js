#!/usr/bin/env node
const { runClawperator, findAttribute } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const personName = process.argv[3] || process.env.PERSON_NAME;
const screenshotPath = process.argv[4] || process.env.SCREENSHOT_PATH;
const receiverPkg = process.argv[5] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";

if (!deviceId || !personName) {
  console.error("Usage: node get_life360_location.js <device_id> <person_name> [screenshot_path] [receiver_package]");
  process.exit(1);
}

const actions = [
  { id: "close", type: "close_app", params: { applicationId: "com.life360.android.safetymapd" } },
  { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
  { id: "open", type: "open_app", params: { applicationId: "com.life360.android.safetymapd" } },
  { id: "wait_open", type: "sleep", params: { durationMs: 8000 } },
  { id: "click-person", type: "click", params: { matcher: { textEquals: personName } } },
  { id: "wait_detail", type: "sleep", params: { durationMs: 3000 } },
  { id: "snap", type: "snapshot_ui", params: { format: "ascii" } }
];

if (screenshotPath) {
  actions.push({ id: "visual", type: "take_screenshot", params: { path: screenshotPath } });
}

const commandId = `skill-life360-location-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions
};

const { ok, result, error, raw } = runClawperator(execution, deviceId, receiverPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === "snap");
const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

const screenStep = stepResults.find(s => s.id === "visual");
const finalPath = screenStep && screenStep.data ? screenStep.data.path : null;

if (snapText) {
  const lines = snapText.split("\n");
  let battery = "unknown", place = "unknown";

  lines.forEach(line => {
    if (line.includes("battery_percentages_textView")) battery = findAttribute(line, "text") || battery;
    if (line.includes("place_textView")) place = findAttribute(line, "text") || place;
  });

  console.log(`✅ Life360 location for ${personName}:`);
  console.log(`   Place: ${place}`);
  console.log(`   Battery: ${battery}`);
  if (finalPath) {
    console.log(`   Screenshot: ${finalPath}`);
  }
} else {
  console.error("⚠️ Could not capture Life360 location snapshot");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}
