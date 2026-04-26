#!/usr/bin/env node
const { runClawperator, resolveOperatorPackage, logSkillProgress } = require("../../utils/common");

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const operatorPkg = resolveOperatorPackage(process.argv[3]);
const skillId = "com.theswitchbot.switchbot.get-bedroom-temperature";
const FRAME = "[Clawperator-Skill-Result]";
const CONTRACT_VERSION = "1.0.0";

function writeFramed(payload) {
  console.log(FRAME);
  console.log(JSON.stringify(payload));
}

function failFramed(message, { checkpoints = [], terminalNote = message } = {}) {
  logSkillProgress(skillId, message);
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_bedroom_temperature" },
    inputs: {},
    result: null,
    status: "failed",
    checkpoints: checkpoints.length > 0
      ? checkpoints
      : [
          {
            id: "read_temperature",
            status: "failed",
            note: message,
          },
        ],
    terminalVerification: {
      status: "failed",
      expected: { kind: "text", text: "Bedroom temperature from SwitchBot" },
      observed: { kind: "text", text: message },
      note: terminalNote,
    },
    diagnostics: { runtimeState: "unknown" },
  });
  console.error(`⚠️ ${message}`);
}

if (!deviceId) {
  console.error("Usage: node get_bedroom_temperature.js <device_id> [operator_package]");
  process.exit(1);
}

const commandId = `skill-switchbot-temp-${Date.now()}`;
const execution = {
  commandId,
  taskId: commandId,
  source: "clawperator-skill",
  expectedFormat: "android-ui-automator",
  timeoutMs: 60000,
  actions: [
    { id: "close", type: "close_app", params: { applicationId: "com.theswitchbot.switchbot" } },
    { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
    { id: "open", type: "open_app", params: { applicationId: "com.theswitchbot.switchbot" } },
    { id: "wait_open", type: "sleep", params: { durationMs: 4000 } },
    { id: "read_temp", type: "read_text", params: { matcher: { resourceId: "com.theswitchbot.switchbot:id/tvTemp" } } },
  ],
};

logSkillProgress(skillId, "Launching SwitchBot app...");
logSkillProgress(skillId, "Navigating to bedroom device...");
logSkillProgress(skillId, "Reading temperature...");
const { ok, result, error, raw } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  failFramed(String(error || "Skill execution failed"), {
    terminalNote: "Clawperator run failed before read_text could complete.",
  });
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find((s) => s.id === "read_temp");
const temp = snapStep && snapStep.data ? snapStep.data.text : null;

if (temp) {
  logSkillProgress(skillId, "Read temperature text.");
  console.log(`✅ Bedroom temperature: ${temp}`);
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_bedroom_temperature" },
    inputs: {},
    result: { kind: "text", text: String(temp) },
    status: "success",
    checkpoints: [
      { id: "app_opened", status: "ok", note: "Opened SwitchBot and read bedroom temperature from tvTemp." },
    ],
    terminalVerification: {
      status: "verified",
      expected: { kind: "text", text: "Numeric or textual bedroom temperature" },
      observed: { kind: "text", text: String(temp) },
      note: "Value read from com.theswitchbot.switchbot:id/tvTemp.",
    },
    diagnostics: { runtimeState: "healthy" },
  });
} else {
  failFramed("Could not parse bedroom temperature", {
    checkpoints: [
      { id: "read_temperature", status: "failed", note: "read_text step returned no text." },
    ],
    terminalNote: `No tvTemp text in step results. raw=${String(raw || "").slice(0, 200)}`,
  });
  process.exit(2);
}
