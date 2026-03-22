#!/usr/bin/env node
const { execFileSync } = require('child_process');
const { join } = require('path');

const argv2 = process.argv[2];
const argv3 = process.argv[3];
const argv4 = process.argv[4];
const argv5 = process.argv[5];

// Support both direct invocation (`set_aircon.sh on`) and `clawperator skills run`,
// which prepends the device id before forwarding extra args.
let stateInput = process.env.STATE;
let deviceId = process.env.DEVICE_ID;
let acTileName = process.env.AC_TILE_NAME;

const argv = [argv2, argv3, argv4, argv5];
const stateIndex = argv.findIndex((value) => value === "on" || value === "off");

if (stateIndex >= 0) {
  stateInput = argv[stateIndex];
  const positional = argv.filter((value) => value && value !== stateInput);
  if (!deviceId) {
    deviceId = positional[0];
  }
  if (!acTileName) {
    acTileName = positional[1];
  }
} else if (stateInput === "on" || stateInput === "off") {
  const positional = argv.filter(Boolean);
  if (!deviceId) {
    deviceId = positional[0];
  }
  if (!acTileName) {
    acTileName = positional[1];
  }
} else {
  console.error('Usage: node set_aircon.js <on|off> <device_id> <ac_tile_name>');
  console.error('   or: node set_aircon.js <device_id> <on|off> <ac_tile_name>');
  console.error('   or: STATE=<on|off> DEVICE_ID=<device_id> AC_TILE_NAME=<ac_tile_name> node set_aircon.js');
  process.exit(1);
}

stateInput = (stateInput || "").toLowerCase();

if (!["on", "off"].includes(stateInput)) {
  console.error('Error: state must be "on" or "off"');
  process.exit(1);
}

if (!deviceId || !acTileName) {
  console.error('Usage: node set_aircon.js <on|off> <device_id> <ac_tile_name>');
  console.error('   or: node set_aircon.js <device_id> <on|off> <ac_tile_name>');
  console.error('   or: STATE=<on|off> DEVICE_ID=<device_id> AC_TILE_NAME=<ac_tile_name> node set_aircon.js');
  process.exit(1);
}

const statusScript = join(__dirname, '..', '..', 'com.google.android.apps.chromecast.app.get-aircon-status', 'scripts', 'get_aircon_status.js');
const { logSkillProgress } = require("../../utils/common");
const skillId = "com.google.android.apps.chromecast.app.set-aircon";

function extractPowerState(output) {
  if (!output) return null;
  const match = output.match(/power\s*[:=]\s*(on|off)\b/i);
  return match ? match[1].toLowerCase() : null;
}

try {
  logSkillProgress(skillId, `Verifying target state (${stateInput})...`);
  logSkillProgress(skillId, `Locating ${acTileName} tile...`);
  logSkillProgress(skillId, "Reading current state via helper...");
  const output = execFileSync('node', [statusScript, deviceId, acTileName], { encoding: 'utf-8' });
  output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('✅ '))
    .forEach((line) => console.log(line));

  const currentPower = extractPowerState(output);
  if (currentPower === stateInput) {
    console.log(`✅ Already in requested state: ${stateInput}`);
    process.exit(0);
  }

  console.log('ℹ️ Direct semantic ac:on/ac:off invocation is not exposed via local debug broadcast yet.');
  console.log('ℹ️ Use the production command pipeline for state-changing actions.');
  console.log(`✅ AC state helper finished: requested=${stateInput}, observed=${currentPower || 'unknown'}`);
} catch (e) {
  console.error('⚠️ Failed to verify AC state');
  process.exit(2);
}
