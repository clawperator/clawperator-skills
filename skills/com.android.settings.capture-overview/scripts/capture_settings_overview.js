#!/usr/bin/env node
const { runClawperator } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = process.argv[3] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";

if (!deviceId) {
  console.error("Usage: node capture_settings_overview.js <device_id> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-settings-overview-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 60000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.android.settings" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.android.settings" } },
    { id: "settle", type: "sleep", params: { durationMs: 2000 } },
    { id: "snap", type: "snapshot_ui", params: { format: "ascii" } }
  ]
};

const { ok, result, error, raw } = runClawperator(execution, deviceId, receiverPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === "snap");
const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

if (snapText) {
  console.log("✅ Settings Overview captured");
  console.log("TEXT_BEGIN");
  console.log(snapText);
  console.log("TEXT_END");
} else {
  console.error("⚠️ Could not capture settings overview");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}
