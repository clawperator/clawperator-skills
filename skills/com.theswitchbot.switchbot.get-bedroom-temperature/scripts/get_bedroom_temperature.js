#!/usr/bin/env node
const { runClawperator } = require("../../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = process.argv[3] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";

if (!deviceId) {
  console.error("Usage: node get_bedroom_temperature.js <device_id> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-switchbot-temp-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 60000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.theswitchbot.switchbot" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.theswitchbot.switchbot" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 4000 } },
    { id: "read_temp", type: "read_text", params: { matcher: { resourceId: "com.theswitchbot.switchbot:id/tvTemp" } } }
  ]
};

const { ok, result, error, raw } = runClawperator(execution, deviceId, receiverPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === "read_temp");
const temp = snapStep && snapStep.data ? snapStep.data.text : null;

if (temp) {
  console.log(`✅ Bedroom temperature: ${temp}`);
} else {
  console.error("⚠️ Could not parse bedroom temperature");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}
