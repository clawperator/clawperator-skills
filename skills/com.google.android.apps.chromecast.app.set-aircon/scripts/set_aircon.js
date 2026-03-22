#!/usr/bin/env node
const { execFileSync } = require('child_process');
const { join } = require('path');

const argv2 = process.argv[2];
const argv3 = process.argv[3];
const argv4 = process.argv[4];

// Support both direct invocation (`set_aircon.sh on`) and `clawperator skills run`,
// which prepends the device id before forwarding extra args.
let stateInput = process.env.STATE;
let deviceId = process.env.DEVICE_ID;
let acTileName = process.env.AC_TILE_NAME;

if (argv2 === "on" || argv2 === "off") {
  stateInput = argv2;
  deviceId = argv3 || deviceId;
  acTileName = argv4 || acTileName;
} else if (argv3 === "on" || argv3 === "off") {
  deviceId = argv2 || deviceId;
  stateInput = argv3;
  acTileName = argv4 || acTileName;
} else {
  stateInput = argv2 || stateInput;
  deviceId = argv3 || deviceId;
  acTileName = argv4 || acTileName;
}

stateInput = (stateInput || "on").toLowerCase();

if (!["on", "off"].includes(stateInput)) {
  console.error('Error: state must be "on" or "off"');
  process.exit(1);
}

if (!deviceId || !acTileName) {
  console.error('Usage: node set_aircon.js <on|off> <device_id> <ac_tile_name>');
  process.exit(1);
}

const statusScript = join(__dirname, '..', '..', 'com.google.android.apps.chromecast.app.get-aircon-status', 'scripts', 'get_aircon_status.js');

function extractPowerState(output) {
  if (!output) return null;
  const match = output.match(/power\s*[:=]\s*(on|off)\b/i);
  return match ? match[1].toLowerCase() : null;
}

try {
  console.log(`Checking current state for ${acTileName}...`);
  const output = execFileSync('node', [statusScript, deviceId, acTileName], { encoding: 'utf-8' });
  console.log(output.trim());

  const currentPower = extractPowerState(output);
  if (currentPower === stateInput) {
    console.log(`✅ Already in requested state: ${stateInput}`);
    process.exit(0);
  }

  console.log('ℹ️ Direct semantic ac:on/ac:off invocation is not exposed via local debug broadcast yet.');
  console.log('ℹ️ Use the production command pipeline for state-changing actions.');
} catch (e) {
  console.error('⚠️ Failed to verify AC state');
  process.exit(2);
}
