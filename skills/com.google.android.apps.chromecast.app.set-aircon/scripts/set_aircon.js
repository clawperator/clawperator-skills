#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { join } = require("path");

const stateInput = (process.argv[2] || "on").toLowerCase();
const deviceId = process.argv[3] || process.env.DEVICE_ID;
const acTileName = process.argv[4] || process.env.AC_TILE_NAME;

if (!["on", "off"].includes(stateInput)) {
  console.error("Error: state must be \on\ or \off\");
  process.exit(1);
}

if (!deviceId || !acTileName) {
  console.error("Usage: node set_aircon.js <on|off> <device_id> <ac_tile_name>");
  process.exit(1);
}

const statusScript = join(__dirname, "..", "..", "com.google.android.apps.chromecast.app.get-aircon-status", "scripts", "get_aircon_status.js");

try {
  console.log(`Checking current state for ${acTileName}...`);
  const output = execFileSync("node", [statusScript, deviceId, acTileName], { encoding: "utf-8" });
  console.log(output.trim());

  if (output.toLowerCase().includes(`power=${stateInput}`)) {
    console.log(`✅ Already in requested state: ${stateInput}`);
    process.exit(0);
  }

  console.log("ℹ️ Direct semantic ac:on/ac:off invocation is not exposed via local debug broadcast yet.");
  console.log("ℹ️ Use the production command pipeline for state-changing actions.");
} catch (e) {
  console.error("⚠️ Failed to verify AC state");
  process.exit(2);
}
