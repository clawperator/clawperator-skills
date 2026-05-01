#!/usr/bin/env node

const {
  parseHomeControlsArgs,
  runHomeControlsSkill,
} = require("../../utils/airtouch5_home_controls.js");

const skillId = "au.com.polyaire.airtouch5.set-home-controls";
const argvArgs = process.argv.slice(2);
let deviceId = process.env.CLAWPERATOR_DEVICE_ID || "";
let rawArgs = argvArgs;
if (!deviceId && rawArgs[0] && !rawArgs[0].startsWith("--")) {
  deviceId = rawArgs[0];
  rawArgs = rawArgs.slice(1);
} else if (deviceId && rawArgs[0] === deviceId) {
  rawArgs = rawArgs.slice(1);
}
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
