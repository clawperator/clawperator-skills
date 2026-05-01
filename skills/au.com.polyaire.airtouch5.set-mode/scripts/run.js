#!/usr/bin/env node

const { parseChoiceArg, runCyclingSettingSkill, splitDeviceAndArgs } = require("../../utils/airtouch5_home_controls.js");

const skillId = "au.com.polyaire.airtouch5.set-mode";
const argvArgs = process.argv.slice(2);
const { deviceId, rawArgs } = splitDeviceAndArgs(argvArgs, process.env.CLAWPERATOR_DEVICE_ID || "");
const requestedValue = parseChoiceArg(rawArgs, { flag: "--mode", allowedValues: ["cool", "heat", "fan", "dry", "auto"] });

runCyclingSettingSkill({
  skillId,
  goalKind: "set_mode",
  inputKey: "mode",
  requestedValue,
  allowedValues: ["cool", "heat", "fan", "dry", "auto"],
  deviceId,
}).then((exitCode) => {
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}).catch((error) => {
  console.error("runCyclingSettingSkill failed:", error && error.message ? error.message : error);
  process.exitCode = 1;
});
