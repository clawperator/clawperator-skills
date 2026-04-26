#!/usr/bin/env node
const { runClawperator, resolveOperatorPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const operatorPkg = resolveOperatorPackage(process.argv[3]);
const skillId = "com.globird.energy.get-usage";
const FRAME = "[Clawperator-Skill-Result]";
const CONTRACT_VERSION = "1.0.0";

function writeFramed(payload) {
  console.log(FRAME);
  console.log(JSON.stringify(payload));
}

function failFramed(message, extra = {}) {
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_energy_usage" },
    inputs: {},
    result: null,
    status: "failed",
    checkpoints: extra.checkpoints || [
      { id: "read_usage", status: "failed", note: message },
    ],
    terminalVerification: {
      status: "failed",
      expected: { kind: "text", text: "Energy tab usage readouts" },
      observed: { kind: "text", text: message },
      note: message,
    },
    diagnostics: { runtimeState: "unknown", ...extra.diagnostics },
  });
  console.error(`⚠️ ${message}`);
}

if (!deviceId) {
  console.error("Usage: node get_globird_usage.js <device_id> [operator_package]");
  process.exit(1);
}

const commandId = `skill-globird-usage-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 120000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.globird.energy" } },
    { id: "open", type: "open_app", params: { applicationId: "com.globird.energy" } },
    { id: "wait_open", type: "wait_for_node", params: { matcher: { resourceId: "nav-item-energy" }, timeoutMs: 15000 } },
    { id: "open-energy-tab", type: "click", params: { matcher: { textEquals: "Energy" } } },
    { id: "wait-energy-cost", type: "wait_for_node", params: { matcher: { resourceId: "energy-usage-cost-left-stat-value" }, timeoutMs: 15000 } },
    { id: "read-cost", type: "read_text", params: { matcher: { resourceId: "energy-usage-cost-left-stat-value" } } },
    { id: "read-right", type: "read_text", params: { matcher: { resourceId: "energy-usage-cost-right-stat-value" } } },
    { id: "read-grid", type: "read_text", params: { matcher: { resourceId: "energy-usage-grid-usage" } } },
    { id: "read-solar", type: "read_text", params: { matcher: { resourceId: "energy-usage-solar-feed-in" } } },
  ],
};

logSkillProgress(skillId, "Launching GloBird app...");
logSkillProgress(skillId, "Navigating to Energy tab...");
logSkillProgress(skillId, "Reading energy usage values...");
const { ok, result, error, raw } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  failFramed(String(error || "Skill execution failed"));
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
function readStepText(stepId) {
  const step = stepResults.find((entry) => entry && entry.id === stepId);
  return step && step.data && typeof step.data.text === "string" ? step.data.text : null;
}

const cost = readStepText("read-cost") || "unknown";
const right = readStepText("read-right") || "unknown";
const grid = readStepText("read-grid") || "unknown";
const solar = readStepText("read-solar") || "unknown";

if (cost !== "unknown" || grid !== "unknown" || solar !== "unknown") {
  logSkillProgress(skillId, "Parsing results...");
  console.log(`✅ GloBird usage: cost_so_far=${cost}, avg_cost_per_day=${right}, grid_usage=${grid}, solar_feed_in=${solar}`);
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_energy_usage" },
    inputs: {},
    result: {
      kind: "json",
      value: {
        cost_so_far: cost,
        avg_cost_per_day: right,
        grid_usage: grid,
        solar_feed_in: solar,
      },
    },
    status: "success",
    checkpoints: [
      { id: "energy_tab_reached", status: "ok", note: "Read usage stat nodes from the Energy screen." },
    ],
    terminalVerification: {
      status: "verified",
      expected: { kind: "text", text: "Non-unknown values for at least one of cost, grid, or solar" },
      observed: {
        kind: "json",
        value: { cost_so_far: cost, avg_cost_per_day: right, grid_usage: grid, solar_feed_in: solar },
      },
      note: "Values taken from the energy usage read_text steps.",
    },
    diagnostics: { runtimeState: "healthy" },
  });
} else {
  failFramed("Could not read GloBird values. Is the app on the Energy tab?", {
    diagnostics: { rawHint: String(raw || "").slice(0, 300) },
  });
  process.exit(2);
}
