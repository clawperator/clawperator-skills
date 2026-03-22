#!/usr/bin/env node
const { execFileSync } = require('child_process');
const { join } = require('path');

const argv2 = process.argv[2];
const argv3 = process.argv[3];
const argv4 = process.argv[4];
const argv5 = process.argv[5];

// Support both direct invocation (`set_climate.sh on`) and `clawperator skills run`,
// which prepends the device id before forwarding extra args.
let stateInput = process.env.STATE;
let deviceId = process.env.DEVICE_ID;
let climateTileName = process.env.CLIMATE_TILE_NAME || process.env.AC_TILE_NAME;

const argv = [argv2, argv3, argv4, argv5];
const stateIndex = argv.findIndex((value) => value === "on" || value === "off");

if (stateIndex >= 0) {
  stateInput = argv[stateIndex];
  const positional = argv.filter((value) => value && value !== stateInput);
  if (!deviceId) {
    deviceId = positional[0];
  }
  if (!climateTileName) {
    climateTileName = positional[1];
  }
} else if (stateInput === "on" || stateInput === "off") {
  const positional = argv.filter(Boolean);
  if (!deviceId) {
    deviceId = positional[0];
  }
  if (!climateTileName) {
    climateTileName = positional[1];
  }
} else {
  console.error('Usage: node set_climate.js <on|off> <device_id> <climate_tile_name>');
  console.error('   or: node set_climate.js <device_id> <on|off> <climate_tile_name>');
  console.error('   or: STATE=<on|off> DEVICE_ID=<device_id> CLIMATE_TILE_NAME=<tile_name> node set_climate.js');
  process.exit(1);
}

stateInput = (stateInput || "").toLowerCase();

if (!["on", "off"].includes(stateInput)) {
  console.error('Error: state must be "on" or "off"');
  process.exit(1);
}

if (!deviceId || !climateTileName) {
  console.error('Usage: node set_climate.js <on|off> <device_id> <climate_tile_name>');
  console.error('   or: node set_climate.js <device_id> <on|off> <climate_tile_name>');
  console.error('   or: STATE=<on|off> DEVICE_ID=<device_id> CLIMATE_TILE_NAME=<tile_name> node set_climate.js');
  process.exit(1);
}

const statusScript = join(__dirname, '..', '..', 'com.google.android.apps.chromecast.app.get-climate', 'scripts', 'get_climate_status.js');
const { logSkillProgress } = require("../../utils/common");
const skillId = "com.google.android.apps.chromecast.app.set-climate";

function extractPowerState(output) {
  if (!output) return null;
  const match = output.match(/power\s*[:=]\s*(on|off)\b/i);
  return match ? match[1].toLowerCase() : null;
}

try {
  logSkillProgress(skillId, `Verifying target state (${stateInput})...`);
  logSkillProgress(skillId, `Locating ${climateTileName} tile...`);
  logSkillProgress(skillId, "Reading current state via helper...");
  const output = execFileSync('node', [statusScript, deviceId, climateTileName], { encoding: 'utf-8' });

  const currentPower = extractPowerState(output);
  if (currentPower === stateInput) {
    console.log(`✅ ${climateTileName}: requested=${stateInput}, observed=${currentPower}, action=none`);
    process.exit(0);
  }

  console.log(`✅ ${climateTileName}: requested=${stateInput}, observed=${currentPower || 'unknown'}, action=verify-only`);
} catch (e) {
  console.error('⚠️ Failed to verify climate unit state');
  process.exit(2);
}
