#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const personName = process.argv[3] || process.env.PERSON_NAME;
const receiverPkg = process.argv[4] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";
let clawBin = process.env.CLAW_BIN || "clawperator";

if (!deviceId || !personName) {
  console.error("Usage: node get_life360_location.js <device_id> <person_name> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-life360-location-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.life360.android.safetymapd" } },
    { id: "open", type: "open_app", params: { applicationId: "com.life360.android.safetymapd" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 8000 } },
    { id: "click-person", type: "click", params: { matcher: { textEquals: personName } } },
    { id: "wait_detail", type: "sleep", params: { durationMs: 3000 } },
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
    const batteryMatch = snapText.match(/text="([0-9]+%)".*resource-id=".*battery_percentages_textView"/);
    const placeMatch = snapText.match(/text="([^"]*)".*resource-id=".*place_textView"/);
    
    const battery = batteryMatch ? batteryMatch[1] : "unknown";
    const place = placeMatch ? placeMatch[1] : "unknown";

    console.log(`✅ Life360 location for ${personName}:`);
    console.log(`   Place: ${place}`);
    console.log(`   Battery: ${battery}`);
  } else {
    console.error("⚠️ Could not capture Life360 location snapshot");
    console.error(`Raw result: ${output}`);
    process.exit(2);
  }
} catch (e) {
  console.error("⚠️ Skill execution failed");
  if (e.stdout) console.error(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(2);
}
