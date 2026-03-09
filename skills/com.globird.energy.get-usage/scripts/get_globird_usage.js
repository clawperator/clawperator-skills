#!/usr/bin/env node
const { runClawperator, findAttribute } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = process.argv[3] || process.env.RECEIVER_PKG || "com.clawperator.operator";

if (!deviceId) {
  console.error("Usage: node get_globird_usage.js <device_id> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-globird-usage-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.globird.energy" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.globird.energy" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 8000 } },
    { id: "open-energy-tab", type: "click", params: { matcher: { textEquals: "Energy" } } },
    { id: "wait-energy", type: "sleep", params: { durationMs: 4000 } },
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
  const lines = snapText.split("\n");
  let cost = "unknown", right = "unknown", grid = "unknown", solar = "unknown";

  lines.forEach(line => {
    if (line.includes("energy-usage-cost-left-stat-value")) cost = findAttribute(line, "text") || cost;
    if (line.includes("energy-usage-cost-right-stat-value")) right = findAttribute(line, "text") || right;
    if (line.includes("energy-usage-grid-usage")) grid = findAttribute(line, "text") || grid;
    if (line.includes("energy-usage-solar-feed-in")) solar = findAttribute(line, "text") || solar;
  });

  if (cost !== "unknown" || grid !== "unknown" || solar !== "unknown") {
    console.log(`✅ GloBird usage: cost_so_far=${cost}, avg_cost_per_day=${right}, grid_usage=${grid}, solar_feed_in=${solar}`);
  } else {
    console.error("⚠️ Could not parse GloBird values from snapshot. Is the app on the Energy tab?");
    process.exit(2);
  }
} else {
  console.error("⚠️ Could not capture GloBird usage snapshot");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}
