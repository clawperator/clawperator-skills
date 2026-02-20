#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = process.argv[3] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";
let clawBin = process.env.CLAW_BIN || "clawperator";

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
    { id: "open", type: "open_app", params: { applicationId: "com.globird.energy" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 8000 } },
    { id: "open-energy-tab", type: "click", params: { matcher: { textEquals: "Energy" } } },
    { id: "wait-energy", type: "sleep", params: { durationMs: 4000 } },
    { id: "snap", type: "snapshot_ui", params: { format: "ascii" } }
  ]
};

const tmpFile = join(tmpdir(), `${commandId}.json`);
writeFileSync(tmpFile, JSON.stringify(execution));

try {
  let cmd = clawBin;
  let args = ["execute", "--execution", tmpFile, "--device-id", deviceId, "--receiver-package", receiverPkg];
  
  if (clawBin === "clawperator") {
    try {
      execFileSync("command", ["-v", "clawperator"]);
    } catch {
      cmd = "node";
      args = [join(__dirname, "..", "..", "..", "..", "clawperator", "apps", "node", "dist", "cli", "index.js"), ...args];
    }
  }

  const output = execFileSync(cmd, args, { encoding: "utf-8" });
  const result = JSON.parse(output);

  const snapStep = result.envelope.stepResults.find(s => s.id === "snap");
  const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

  if (snapText) {
    const costMatch = snapText.match(/text="([^"]*)".*resource-id="energy-usage-cost-left-stat-value"/);
    const rightMatch = snapText.match(/text="([^"]*)".*resource-id="energy-usage-cost-right-stat-value"/);
    const gridMatch = snapText.match(/text="([^"]*)".*resource-id="energy-usage-grid-usage"/);
    const solarMatch = snapText.match(/text="([^"]*)".*resource-id="energy-usage-solar-feed-in"/);
    
    const cost = costMatch ? costMatch[1] : "unknown";
    const right = rightMatch ? rightMatch[1] : "unknown";
    const grid = gridMatch ? gridMatch[1] : "unknown";
    const solar = solarMatch ? solarMatch[1] : "unknown";

    if (cost !== "unknown" || grid !== "unknown" || solar !== "unknown") {
      console.log(`✅ GloBird usage: cost_so_far=${cost}, avg_cost_per_day=${right}, grid_usage=${grid}, solar_feed_in=${solar}`);
    } else {
      console.error("⚠️ Could not parse GloBird values from snapshot. Is the app on the Energy tab?");
      process.exit(2);
    }
  } else {
    console.error("⚠️ Could not capture GloBird usage snapshot");
    console.error(`Raw result: ${output}`);
    process.exit(2);
  }
} catch (e) {
  console.error("⚠️ Skill execution failed");
  if (e.stdout) console.error(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(2);
}
