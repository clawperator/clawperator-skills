#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function parseCommand(command) {
  const parts = (command || "clawperator").match(/(?:[^\s"]+|"[^"]*")+/g) || ["clawperator"];
  return parts.map(part => part.replace(/^"(.*)"$/, "$1"));
}

const [, , deviceId, percentArg] = process.argv;

if (!deviceId || !percentArg) {
  console.error("Usage: node run.js <device_id> <percent>");
  process.exit(1);
}

const percent = Number.parseInt(percentArg, 10);

if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
  console.error(`Invalid discharge-to-limit percentage: ${percentArg}. Expected an integer from 0 to 100.`);
  process.exit(1);
}

const [clawperatorCmd, ...clawperatorPrefixArgs] = parseCommand(process.env.CLAWPERATOR_BIN || "clawperator");
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator";
const skillId = "com.solaxcloud.starter.set-discharge-to-limit";
const targetText = String(percent);

function runClawperatorExecution(execution) {
  return execFileSync(
    clawperatorCmd,
    [
      ...clawperatorPrefixArgs,
      "exec",
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
      "--execution",
      JSON.stringify(execution),
      "--json",
    ],
    {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

function runAdb(args) {
  execFileSync("adb", ["-s", deviceId, ...args], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const navigateToInputExecution = {
  commandId: `${skillId}-${Date.now()}`,
  taskId: skillId,
  source: skillId,
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.solaxcloud.starter" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.solaxcloud.starter" } },
    {
      id: "wait_home",
      type: "wait_for_node",
      params: {
        matcher: { resourceId: "com.solaxcloud.starter:id/tab_intelligent" },
        timeoutMs: 20000,
      },
    },
    {
      id: "open_intelligence",
      type: "click",
      params: {
        matcher: { resourceId: "com.solaxcloud.starter:id/tab_intelligent" },
      },
    },
    { id: "wait_intelligence", type: "sleep", params: { durationMs: 3500 } },
    {
      id: "open_peak_export",
      type: "click",
      params: {
        coordinate: { x: 860, y: 1399 },
      },
    },
    { id: "wait_peak_export", type: "sleep", params: { durationMs: 3000 } },
    {
      id: "wait_discharge_action",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Device Discharging" },
        timeoutMs: 15000,
      },
    },
    {
      id: "open_discharge_action",
      type: "click",
      params: {
        coordinate: { x: 875, y: 1548 },
      },
    },
    { id: "wait_discharge_action_open", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "wait_discharge_row",
      type: "wait_for_node",
      params: {
        matcher: { textContains: "Discharge to" },
        timeoutMs: 10000,
      },
    },
    {
      id: "open_discharge_dialog",
      type: "click",
      params: {
        matcher: { textContains: "Discharge to" },
      },
    },
    {
      id: "wait_input",
      type: "wait_for_node",
      params: {
        matcher: { resourceId: "van-field-1-input" },
        timeoutMs: 10000,
      },
    },
    {
      id: "focus_input",
      type: "click",
      params: {
        matcher: { resourceId: "van-field-1-input" },
      },
    },
    { id: "wait_keyboard", type: "sleep", params: { durationMs: 1000 } },
  ],
};

const saveExecution = {
  commandId: `${skillId}-save-${Date.now()}`,
  taskId: skillId,
  source: skillId,
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    {
      id: "confirm_dialog",
      type: "click",
      params: {
        matcher: { textEquals: "Confirm" },
      },
    },
    { id: "wait_after_confirm", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "save_toolbar",
      type: "click",
      params: {
        matcher: { textEquals: "Save" },
      },
    },
    { id: "wait_after_toolbar_save", type: "sleep", params: { durationMs: 2500 } },
    {
      id: "save_bottom_sheet",
      type: "click",
      params: {
        matcher: { textEquals: "Save" },
      },
    },
    { id: "wait_after_final_save", type: "sleep", params: { durationMs: 4000 } },
  ],
};

try {
  runClawperatorExecution(navigateToInputExecution);
  runAdb(["shell", "input", "keyevent", "67"]);
  runAdb(["shell", "input", "keyevent", "67"]);
  runAdb(["shell", "input", "text", targetText]);
  runAdb(["shell", "input", "keyevent", "66"]);

  const stdout = runClawperatorExecution(saveExecution);
  process.stdout.write(stdout);
} catch (err) {
  const stdout = err?.stdout?.toString?.("utf8") ?? "";
  const stderr = err?.stderr?.toString?.("utf8") ?? "";

  if (stdout) {
    process.stdout.write(stdout);
    process.exit(0);
  }

  console.error(stderr || err.message || "clawperator execution failed");
  process.exit(1);
}
