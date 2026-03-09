#!/usr/bin/env node
const { runClawperator } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = process.argv[3] || process.env.RECEIVER_PKG || "com.clawperator.operator";

if (!deviceId) {
  console.error("Usage: node get_solax_battery.js <device_id> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-solax-battery-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.solaxcloud.starter" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.solaxcloud.starter" } },
    { id: "wait_load", type: "sleep", params: { durationMs: 12000 } },
    { id: "read-battery-value", type: "read_text", params: { matcher: { resourceId: "com.solaxcloud.starter:id/tv_pb_title" } } },
    { id: "read-battery-unit", type: "read_text", params: { matcher: { resourceId: "com.solaxcloud.starter:id/tv_pb_unit" } } }
  ]
};

const { ok, result, error, raw } = runClawperator(execution, deviceId, receiverPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const valStep = stepResults.find(s => s.id === "read-battery-value");
const unitStep = stepResults.find(s => s.id === "read-battery-unit");
const val = valStep && valStep.data ? valStep.data.text : null;
const unit = unitStep && unitStep.data ? unitStep.data.text : null;

if (val) {
  console.log(`✅ SolaX battery level: ${val}${unit || ""}`);
} else {
  console.error("⚠️ Could not parse SolaX battery level");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}
