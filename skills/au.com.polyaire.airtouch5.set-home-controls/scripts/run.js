#!/usr/bin/env node

const {
  parseHomeControlsArgs,
  runHomeControlsSkill,
} = require("../../utils/airtouch5_home_controls.js");

const skillId = "au.com.polyaire.airtouch5.set-home-controls";
const deviceId = process.env.CLAWPERATOR_DEVICE_ID || process.argv[2] || "";
const rawArgs = process.env.CLAWPERATOR_DEVICE_ID ? process.argv.slice(2) : process.argv.slice(3);
const parsed = parseHomeControlsArgs(rawArgs);

runHomeControlsSkill({
  skillId,
  request: parsed.request,
  parseErrors: parsed.errors,
  deviceId,
}).then((exitCode) => {
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}).catch((error) => {
  console.error("runHomeControlsSkill failed:", error && error.message ? error.message : error);
  process.exitCode = 1;
});
