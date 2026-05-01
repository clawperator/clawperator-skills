#!/usr/bin/env node

const {
  parseHomeControlsArgs,
  runHomeControlsSkill,
  splitDeviceAndArgs,
} = require("../../utils/airtouch5_home_controls.js");

const skillId = "au.com.polyaire.airtouch5.set-home-controls";
const argvArgs = process.argv.slice(2);
const { deviceId, rawArgs } = splitDeviceAndArgs(argvArgs, process.env.CLAWPERATOR_DEVICE_ID || "");
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
