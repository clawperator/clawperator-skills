#!/usr/bin/env node

const { parseChoiceArg, runPowerStateSkill, splitDeviceAndArgs } = require("../../utils/airtouch5_home_controls.js");

const skillId = "au.com.polyaire.airtouch5.set-power-state";
const argvArgs = process.argv.slice(2);
const { deviceId, rawArgs } = splitDeviceAndArgs(argvArgs, process.env.CLAWPERATOR_DEVICE_ID || "");
const requestedState = parseChoiceArg(rawArgs, { flag: "--state", allowedValues: ["on", "off"] });

runPowerStateSkill({
  skillId,
  requestedState,
  deviceId,
}).then((exitCode) => {
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}).catch((error) => {
  console.error("runPowerStateSkill failed:", error && error.message ? error.message : error);
  process.exitCode = 1;
});
