#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const acTileName = process.argv[3] || process.env.AC_TILE_NAME;
const receiverPkg = process.argv[4] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";
let clawBin = process.env.CLAW_BIN || "clawperator";

if (!deviceId || !acTileName) {
  console.error("Usage: node get_aircon_status.js <device_id> <ac_tile_name> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-gh-ac-status-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.google.android.apps.chromecast.app" } },
    { id: "wait1", type: "sleep", params: { durationMs: 3500 } },
    {
      id: "climate",
      type: "scroll_and_click",
      params: {
        target: { textEquals: "Climate" },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/category_chips" },
        direction: "right",
        maxSwipes: 6,
        clickType: "click",
        findFirstScrollableChild: true
      }
    },
    { id: "wait2", type: "sleep", params: { durationMs: 1500 } },
    {
      id: "openController",
      type: "scroll_and_click",
      params: {
        target: { textContains: acTileName },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/pager_home_tab" },
        direction: "down",
        maxSwipes: 8,
        clickType: "long_click"
      }
    },
    { id: "wait3", type: "sleep", params: { durationMs: 3000 } },
    { id: "read-power", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } } },
    { id: "read-mode", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/body_text" } } },
    { id: "read-indoor-temp", type: "read_text", params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/first_value_title" } } }
  ]
};

const tmpFile = join(tmpdir(), `${commandId}.json`);
writeFileSync(tmpFile, JSON.stringify(execution));

try {
  let cmd = clawBin;
  let args = ["execute", "--execution", tmpFile, "--device-id", deviceId, "--receiver-package", receiverPkg];
  
  if (clawBin === "clawperator") {
    try {
      execFileSync("command", ["-v", "clawperator"]);
    } catch {
      cmd = "node";
      args = [join(__dirname, "..", "..", "..", "..", "clawperator", "apps", "node", "dist", "cli", "index.js"), ...args];
    }
  }

  const output = execFileSync(cmd, args, { encoding: "utf-8" });
  const result = JSON.parse(output);

  const powerStep = result.envelope.stepResults.find(s => s.id === "read-power");
  const modeStep = result.envelope.stepResults.find(s => s.id === "read-mode");
  const tempStep = result.envelope.stepResults.find(s => s.id === "read-indoor-temp");

  const power = powerStep && powerStep.data ? powerStep.data.text : null;
  const mode = modeStep && modeStep.data ? modeStep.data.text : "unknown";
  const temp = tempStep && tempStep.data ? tempStep.data.text : "unknown";

  if (power) {
    console.log(`✅ AC status (${acTileName}): power=${power}, mode=${mode}, indoor_temp=${temp}`);
  } else {
    console.error("⚠️ Could not parse AC status values");
    console.error(`Raw result: ${output}`);
    process.exit(2);
  }
} catch (e) {
  console.error("⚠️ Skill execution failed");
  if (e.stdout) console.error(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(2);
}
