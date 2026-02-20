#!/usr/bin/env node
const { runClawperator, findAttribute } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const query = process.argv[3] || process.env.QUERY || "Coke Zero 24 pack";
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
    { id: "type-query", type: "enter_text", params: { matcher: { resourceId: "com.woolworths:id/search_src_text" }, text: query, submit: false } },
    { id: "wait_sugg", type: "sleep", params: { durationMs: 4000 } },
    { id: "click-sugg", type: "click", params: { matcher: { resourceId: "com.woolworths:id/search_auto_complete_text" } } },
    { id: "wait_results", type: "sleep", params: { durationMs: 8000 } },
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
  console.log(`✅ Woolworths search results for '${query}':`);
  const lines = snapText.split("\n");
  
  lines.forEach(line => {
    const content = findAttribute(line, "content-desc") || findAttribute(line, "text") || "";
    
    if (content.includes("$") && content.length > 5) {
      const priceMatch = content.match(/\$([0-9]+\.[0-9]{2})/);
      const wasMatch = content.match(/Was \$([0-9]+\.[0-9]{2})/i);
      const specialMatch = content.toLowerCase().includes("special") || content.toLowerCase().includes("save");

      const name = content.split("\n")[0] || "Unknown Product";

      if (name.toLowerCase().includes("coke") || name.toLowerCase().includes("cola")) {
        console.log(`- ${name.trim()}`);
        console.log(`  current_price: ${priceMatch ? "$" + priceMatch[1] : "NA"}`);
        console.log(`  on_sale: ${specialMatch || wasMatch ? "YES" : "NO"}`);
        console.log(`  original_price: ${wasMatch ? "$" + wasMatch[1] : "NA"}`);
      }
    }
  });
} else {
  console.error("⚠️ Could not capture Woolworths search snapshot");
  process.exit(2);
}
