#!/usr/bin/env node
const { execFileSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const query = process.argv[3] || process.env.QUERY || "Coke Zero";
const receiverPkg = process.argv[4] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";
let clawBin = process.env.CLAW_BIN || "clawperator";

if (!deviceId) {
  console.error("Usage: node search_woolworths_products.js <device_id> <query> [receiver_package]");
  process.exit(1);
}

const commandId = `skill-woolworths-search-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 90000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.woolworths" } },
    { id: "open", type: "open_app", params: { applicationId: "com.woolworths" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 5000 } },
    { id: "click-search", type: "click", params: { matcher: { textContains: "Search" } } },
    { id: "type-query", type: "enter_text", params: { matcher: { role: "textfield" }, text: query, submit: true } },
    { id: "wait_results", type: "sleep", params: { durationMs: 3000 } },
    { id: "snap", type: "snapshot_ui", params: { format: "ascii" } }
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

  const snapStep = result.envelope.stepResults.find(s => s.id === "snap");
  const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

  if (snapText) {
    console.log(`✅ Woolworths search for '${query}' (top items from current view):`);
    
    const lines = snapText.split("\n");
    let lastName = "";
    
    for (const line of lines) {
      if (line.includes('resource-id="com.woolworths:id/product_name_text_view"')) {
        const match = line.match(/text="([^"]*)"/);
        if (match) lastName = match[1];
      } else if (line.includes('resource-id="com.woolworths:id/product_price_view"')) {
        const match = line.match(/content-desc="([^"]*)"/);
        if (match && lastName) {
          console.log(`- ${lastName}: ${match[1]}`);
          lastName = "";
        }
      }
    }
  } else {
    console.error("⚠️ Could not capture Woolworths search snapshot");
    console.error(`Raw result: ${output}`);
    process.exit(2);
  }
} catch (e) {
  console.error("⚠️ Skill execution failed");
  if (e.stdout) console.error(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(2);
}
