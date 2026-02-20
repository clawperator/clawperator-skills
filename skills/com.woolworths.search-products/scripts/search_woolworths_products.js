#!/usr/bin/env node
const { runClawperator, findAttribute } = require("../../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const query = process.argv[3] || process.env.QUERY || "Coke Zero";
const receiverPkg = process.argv[4] || process.env.RECEIVER_PKG || "com.clawperator.operator.dev";

if (!deviceId) {
  console.error("Usage: node search_woolworths_products.js <device_id> [query] [receiver_package]");
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
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.woolworths" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 8000 } },
    { id: "click-search", type: "click", params: { matcher: { resourceId: "com.woolworths:id/search_view_blocker" } } },
    { id: "type-query", type: "enter_text", params: { matcher: { resourceId: "com.woolworths:id/search_src_text" }, text: query, submit: true } },
    { id: "wait_results", type: "sleep", params: { durationMs: 5000 } },
    { id: "snap", type: "snapshot_ui", params: { format: "ascii" } }
  ]
};

const { ok, result, error, raw } = runClawperator(execution, deviceId, receiverPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === "snap");
const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

if (snapText) {
  console.log(`✅ Woolworths search for \\ (top items from current view):`);
  const lines = snapText.split("\n");
  lines.forEach(line => {
     if (line.includes("$")) {
       const txt = findAttribute(line, "text") || findAttribute(line, "content-desc");
       if (txt) console.log(`- ${txt}`);
     }
  });
} else {
  console.error("⚠️ Could not capture Woolworths search snapshot");
  console.error(`Raw result: ${raw}`);
  process.exit(2);
}
