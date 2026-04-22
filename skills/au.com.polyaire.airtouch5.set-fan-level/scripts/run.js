#!/usr/bin/env node

const { parseChoiceArg, runCyclingSettingSkill } = require("../../utils/airtouch5_home_controls.js");

const skillId = "au.com.polyaire.airtouch5.set-fan-level";
const deviceId = process.env.CLAWPERATOR_DEVICE_ID || process.argv[2] || "";
const rawArgs = process.env.CLAWPERATOR_DEVICE_ID ? process.argv.slice(2) : process.argv.slice(3);
const requestedValue = parseChoiceArg(rawArgs, { flag: "--fan-level", allowedValues: ["auto", "low", "medium", "high"] });

runCyclingSettingSkill({
  skillId,
  goalKind: "set_fan_level",
  inputKey: "fan_level",
  requestedValue,
  allowedValues: ["auto", "low", "medium", "high"],
  deviceId,
}).then((exitCode) => {
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}).catch((error) => {
  console.error("Unexpected error running set-fan-level skill:", error && error.message ? error.message : error);
  process.exitCode = 1;
});
