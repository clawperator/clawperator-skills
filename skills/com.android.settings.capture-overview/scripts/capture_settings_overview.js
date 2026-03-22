#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { mkdirSync, writeFileSync } = require("fs");
const { join, resolve } = require("path");
const { runClawperator, resolveReceiverPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = resolveReceiverPackage(process.argv[3]);
const screenshotDir = resolve(process.env.SCREENSHOT_DIR || "/tmp/clawperator-settings-screenshots");
const settingsAppId = process.env.SETTINGS_APP_ID || "com.android.settings";
const adbBin = process.env.ADB_BIN || "adb";
const captureStamp = Date.now();

if (!deviceId) {
  console.error("Usage: node capture_settings_overview.js <device_id> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-settings-overview-${Date.now()}`;
const skillId = "com.android.settings.capture-overview";
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 60000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: settingsAppId } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: settingsAppId } },
    { id: "settle", type: "sleep", params: { durationMs: 2000 } },
    { id: "snap", type: "snapshot_ui" }
  ]
};

logSkillProgress(skillId, "Capturing system overview...");
const { ok, result, error, raw } = runClawperator(execution, deviceId, receiverPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === "snap");
const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

if (!snapText) {
  console.error("⚠️ Could not capture settings overview");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}

mkdirSync(screenshotDir, { recursive: true });
const screenshotPath = join(screenshotDir, `clawperator-settings-${deviceId}-${captureStamp}.png`);
const snapshotPath = join(screenshotDir, `clawperator-settings-${deviceId}-${captureStamp}.txt`);

try {
  logSkillProgress(skillId, "Saving screenshot to disk...");
  const image = execFileSync(adbBin, ["-s", deviceId, "exec-out", "screencap", "-p"], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: null,
    maxBuffer: 20 * 1024 * 1024
  });
  writeFileSync(screenshotPath, image);
  writeFileSync(snapshotPath, `${snapText}\n`);
} catch (screenshotError) {
  console.error(`⚠️ Screenshot capture failed: ${screenshotError.message}`);
  process.exit(2);
}

console.log("TEXT_BEGIN");
console.log(snapText);
console.log("TEXT_END");
console.log(`SCREENSHOT|path=${screenshotPath}`);
console.log(`SNAPSHOT|path=${snapshotPath}`);
console.log(`✅ Settings overview captured for ${settingsAppId}`);
