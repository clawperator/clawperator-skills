#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { mkdtemp, mkdir, readFile, rm, appendFile, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const skillId = process.env.CLAWPERATOR_SKILL_ID || "com.google.android.apps.chromecast.app.control-hvac-orchestrated";
const requiredCheckpointIds = [
  "app_opened",
  "controller_opened",
  "current_state_read",
  "action_applied",
  "terminal_state_verified",
];

const resolvedAgentCliPath = process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH;
const skillProgramPath = process.env.CLAWPERATOR_SKILL_PROGRAM;
const skillInputs = process.env.CLAWPERATOR_SKILL_INPUTS || "{}";
const deviceId = process.env.CLAWPERATOR_DEVICE_ID;
const clawperatorBin = process.env.CLAWPERATOR_BIN;
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator";
const skillsRegistry = process.env.CLAWPERATOR_SKILLS_REGISTRY || "";
const configuredAgentTimeoutMs = Number.parseInt(process.env.CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS || "", 10);
const debugMode = process.env.CLAWPERATOR_SKILL_DEBUG === "1";
const retainLogs = debugMode || process.env.CLAWPERATOR_SKILL_RETAIN_LOGS === "1";
const configuredLogDir = process.env.CLAWPERATOR_SKILL_LOG_DIR || "";
const forwardedArgs = process.argv.slice(2);
const skillsRepoRoot = resolve(__dirname, "../../..");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAction(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "temperature") return "temperature";
  if (normalized === "mode") return "mode";
  if (normalized === "fan_speed" || normalized === "fan-speed" || normalized === "fanspeed") return "fan_speed";
  if (normalized === "climate_state" || normalized === "climate-state" || normalized === "state" || normalized === "power") {
    return "climate_state";
  }
  return null;
}

function normalizeValue(action, raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return null;
  }
  if (action === "temperature") {
    if (!/^-?\d+$/.test(trimmed)) {
      return null;
    }
    return String(Number.parseInt(trimmed, 10));
  }
  if (action === "climate_state") {
    const lowered = trimmed.toLowerCase();
    if (lowered === "on" || lowered === "off") {
      return lowered;
    }
    return null;
  }
  if (action === "fan_speed") {
    const lowered = trimmed.toLowerCase();
    if (lowered === "medium" || lowered === "med") {
      return "medium";
    }
    if (["auto", "high", "low"].includes(lowered)) {
      return lowered;
    }
    return trimmed;
  }
  return trimmed;
}

function normalizeUiValue(action, raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return null;
  }
  if (action === "fan_speed") {
    const lowered = trimmed.toLowerCase();
    if (lowered === "medium" || lowered === "med") {
      return "med";
    }
    if (["auto", "high", "low"].includes(lowered)) {
      return lowered;
    }
  }
  return normalizeValue(action, raw);
}

function parseJsonInputs(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function extractRequestedConfig() {
  const jsonInputs = parseJsonInputs(skillInputs);
  let action = normalizeAction(jsonInputs.action);
  let value = jsonInputs.value;
  let rawValue = typeof jsonInputs.value === "string" ? jsonInputs.value.trim() : "";
  let unitName = typeof jsonInputs.unit_name === "string" ? jsonInputs.unit_name.trim() : "";

  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index];
    const next = forwardedArgs[index + 1];

    if (arg === "--action") {
      action = normalizeAction(next);
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--action=")) {
      action = normalizeAction(arg.slice("--action=".length));
      continue;
    }
    if (arg === "--value") {
      value = next;
      rawValue = String(next || "").trim();
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--value=")) {
      value = arg.slice("--value=".length);
      rawValue = value.trim();
      continue;
    }
    if (arg === "--unit-name") {
      unitName = String(next || "").trim();
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--unit-name=")) {
      unitName = arg.slice("--unit-name=".length).trim();
      continue;
    }
    if (arg === "--temperature") {
      action = "temperature";
      value = next;
      rawValue = String(next || "").trim();
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--temperature=")) {
      action = "temperature";
      value = arg.slice("--temperature=".length);
      rawValue = value.trim();
      continue;
    }
    if (arg === "--mode") {
      action = "mode";
      value = next;
      rawValue = String(next || "").trim();
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--mode=")) {
      action = "mode";
      value = arg.slice("--mode=".length);
      rawValue = value.trim();
      continue;
    }
    if (arg === "--fan-speed" || arg === "--fan_speed") {
      action = "fan_speed";
      value = next;
      rawValue = String(next || "").trim();
      index += 1;
      continue;
    }
    if (typeof arg === "string" && (arg.startsWith("--fan-speed=") || arg.startsWith("--fan_speed="))) {
      action = "fan_speed";
      value = arg.slice(arg.indexOf("=") + 1);
      rawValue = value.trim();
      continue;
    }
    if (arg === "--climate-state" || arg === "--state") {
      action = "climate_state";
      value = next;
      rawValue = String(next || "").trim();
      index += 1;
      continue;
    }
    if (typeof arg === "string" && (arg.startsWith("--climate-state=") || arg.startsWith("--state="))) {
      action = "climate_state";
      value = arg.slice(arg.indexOf("=") + 1);
      rawValue = value.trim();
      continue;
    }
  }

  const normalizedValue = action === null ? null : normalizeValue(action, value);
  const normalizedUiValue = action === null ? null : normalizeUiValue(action, value);
  return {
    action,
    rawValue: rawValue || normalizedValue,
    value: normalizedValue,
    uiValue: normalizedUiValue,
    unitName,
  };
}

const requestedConfig = extractRequestedConfig();

function buildHarnessFailureSkillResult(message) {
  return {
    contractVersion: "1.0.0",
    skillId,
    goal: {
      kind: "control_hvac",
      action: requestedConfig.action,
      value: requestedConfig.value,
      unit_name: requestedConfig.unitName || null,
    },
    inputs: {
      action: requestedConfig.action,
      value: requestedConfig.value,
      unit_name: requestedConfig.unitName || null,
    },
    result: null,
    status: "failed",
    checkpoints: requiredCheckpointIds.map((id) => ({ id, status: "skipped", note: message })),
    terminalVerification: {
      status: "not_run",
      note: message,
    },
  };
}

async function writeStdoutAndDrain(text) {
  await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      process.stdout.off("drain", handleDrain);
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    };
    const handleDrain = () => finish();
    const accepted = process.stdout.write(text, (error) => finish(error));
    if (!accepted) {
      process.stdout.once("drain", handleDrain);
    }
  });
}

async function emitHarnessFailureSkillResult(message) {
  await writeStdoutAndDrain("[Clawperator-Skill-Result]\n");
  await writeStdoutAndDrain(`${JSON.stringify(buildHarnessFailureSkillResult(message))}\n`);
}

async function createRunDirectory() {
  if (configuredLogDir.length > 0) {
    await mkdir(configuredLogDir, { recursive: true });
    return mkdtemp(join(configuredLogDir, "run-"));
  }
  return mkdtemp(join(tmpdir(), "clawperator-google-home-hvac-"));
}

function buildAgentEnv() {
  const env = {};
  for (const key of [
    "CODEX_HOME",
    "HOME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "SHELL",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "ADB_PATH",
  ]) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.CLAWPERATOR_BIN = clawperatorBin;
  env.CLAWPERATOR_DEVICE_ID = deviceId;
  env.CLAWPERATOR_OPERATOR_PACKAGE = operatorPackage;
  if (skillsRegistry.length > 0) {
    env.CLAWPERATOR_SKILLS_REGISTRY = skillsRegistry;
  }
  return env;
}

function expectedVerificationText() {
  return requestedConfig.value;
}

function canonicalizeFanSpeedLabel(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const withoutPrefix = normalized.startsWith("fan speed ")
    ? normalized.slice("fan speed ".length).trim()
    : normalized;
  return withoutPrefix === "med" ? "medium" : withoutPrefix;
}

function denormalizeObservedText(text) {
  if (requestedConfig.action === "climate_state") {
    return normalizeStateText(text);
  }
  if (requestedConfig.action === "fan_speed") {
    const expected = canonicalizeFanSpeedLabel(requestedConfig.value);
    const uiValue = canonicalizeFanSpeedLabel(requestedConfig.uiValue);
    const observed = canonicalizeFanSpeedLabel(text);
    if (uiValue.length > 0 && observed === uiValue) {
      return requestedConfig.value;
    }
    if (expected.length > 0 && observed === expected) {
      return requestedConfig.value;
    }
  }
  return text;
}

function buildExecCommand(commandId, timeoutMs, actions) {
  const execution = JSON.stringify({
    commandId,
    taskId: skillId,
    source: skillId,
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  });
  return `${clawperatorBin} exec --device ${quoteShellArg(deviceId)} --operator-package ${quoteShellArg(operatorPackage)} --execution ${quoteShellArg(execution)} --json`;
}

function buildPrompt(skillProgram) {
  const expectedText = expectedVerificationText();
  const enterControllerCommand = buildExecCommand(`${skillId}-enter-controller`, 90000, [
    { id: "wait_open", type: "sleep", params: { durationMs: 3500 } },
    { id: "go_home", type: "click", params: { matcher: { textEquals: "Home" } } },
    { id: "wait_home", type: "sleep", params: { durationMs: 1500 } },
    {
      id: "open_climate",
      type: "scroll_and_click",
      params: {
        matcher: { textEquals: "Climate" },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/category_chips" },
        direction: "right",
        maxSwipes: 6,
        clickType: "click",
        findFirstScrollableChild: true,
      },
    },
    { id: "wait_after_climate", type: "sleep", params: { durationMs: 1500 } },
    {
      id: "open_unit_controller",
      type: "scroll_and_click",
      params: {
        matcher: {
          resourceId: "com.google.android.apps.chromecast.app:id/control",
          textContains: requestedConfig.unitName,
        },
        container: { resourceId: "com.google.android.apps.chromecast.app:id/pager_home_tab" },
        direction: "down",
        maxSwipes: 12,
        clickType: "long_click",
      },
    },
    {
      id: "wait_controller",
      type: "wait_for_node",
      params: {
        matcher: { resourceId: "com.google.android.apps.chromecast.app:id/climate_power_button" },
        timeoutMs: 20000,
      },
    },
    { id: "snap_controller", type: "snapshot_ui", params: {} },
  ]);
  const readTemperatureCommand = buildExecCommand(`${skillId}-read-temperature`, 30000, [
    {
      id: "read_low_value",
      type: "read_text",
      params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } },
    },
  ]);
  const increaseTemperatureCommand = buildExecCommand(`${skillId}-increase-temperature`, 30000, [
    {
      id: "tap_adjust",
      type: "click",
      params: { matcher: { contentDescEquals: "Increase temperature" } },
    },
    { id: "wait_after_tap", type: "sleep", params: { durationMs: 1200 } },
    {
      id: "read_low_value",
      type: "read_text",
      params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } },
    },
  ]);
  const decreaseTemperatureCommand = buildExecCommand(`${skillId}-decrease-temperature`, 30000, [
    {
      id: "tap_adjust",
      type: "click",
      params: { matcher: { contentDescEquals: "Decrease temperature" } },
    },
    { id: "wait_after_tap", type: "sleep", params: { durationMs: 1200 } },
    {
      id: "read_low_value",
      type: "read_text",
      params: { matcher: { resourceId: "com.google.android.apps.chromecast.app:id/low_value" } },
    },
  ]);
  const readFanCommand = buildExecCommand(`${skillId}-read-fan`, 30000, [
    { id: "snap_controller", type: "snapshot_ui", params: {} },
  ]);
  const setFanCommand = buildExecCommand(`${skillId}-set-fan`, 30000, [
    {
      id: "open_fan_tile",
      type: "click",
      params: {
        matcher: {
          resourceId: "com.google.android.apps.chromecast.app:id/action_tile",
          textContains: "Fan speed",
        },
      },
    },
    {
      id: "wait_target_option",
      type: "wait_for_node",
      params: {
        matcher: {
          resourceId: "com.google.android.apps.chromecast.app:id/title",
          textEquals: String(requestedConfig.uiValue || requestedConfig.value || "").trim(),
        },
      },
    },
    {
      id: "click_target_option",
      type: "click",
      params: {
        matcher: {
          resourceId: "com.google.android.apps.chromecast.app:id/title",
          textEquals: String(requestedConfig.uiValue || requestedConfig.value || "").trim(),
        },
      },
    },
    { id: "wait_return", type: "sleep", params: { durationMs: 2500 } },
    { id: "snap_controller", type: "snapshot_ui", params: {} },
  ]);
  return [
    `You are the runtime agent for the Clawperator skill '${skillId}'.`,
    "Follow the attached SKILL.md exactly.",
    "Do not edit repository files.",
    "Do not inspect repository files during the live run.",
    "Use the shell tool to run Clawperator CLI commands.",
    "Every shell command must be one physical line with no embedded newline characters.",
    "Do not wrap shell commands in backticks or code fences when you send them to the shell tool.",
    "Never split '--json' or any other flag onto a second line.",
    "Do not spend a turn planning in prose.",
    "Your first response must include a real Clawperator shell command for the selected device.",
    "Run only one live device command at a time.",
    "Do not start a second Clawperator device command until the previous one has completed and you have inspected its result.",
    "Do not use adb directly for live evidence unless SKILL.md explicitly allows it, which it does not for this skill.",
    "Do not use 'skills install', 'skills list', 'skills get', or any other skills-store management command during the live run.",
    "Do not call 'clawperator skills run' from inside this skill. That would recurse back into the wrapper and is always wrong here.",
    "Do not run any '* --help' command during the live run.",
    "Do not run 'clawperator exec ... --validate-only' during the live run.",
    "Do not use 'exec best-effort'.",
    "Do not use the flat 'wait' command for this skill. Use exec payloads with wait_for_node instead.",
    "The skill program is already embedded in this prompt. No additional skill package installation or lookup is required.",
    "If you catch yourself checking the CLI surface instead of driving the device, stop and follow the concrete command templates below.",
    "Your final response must not be a prose summary.",
    "Your final response must be exactly two lines: first '[Clawperator-Skill-Result]', second one JSON object.",
    "Do not include markdown fences, bullets, or any extra text before or after the final frame.",
    "",
    "Requested run:",
    `- action: ${requestedConfig.action}`,
    `- value: ${requestedConfig.value}`,
    `- unit_name: ${requestedConfig.unitName}`,
    `- expected verification text: ${expectedText}`,
    "",
    "Runtime context:",
    `- Forwarded raw argv: ${JSON.stringify(forwardedArgs)}`,
    `- Declared skill inputs from CLAWPERATOR_SKILL_INPUTS: ${skillInputs}`,
    `- Selected device serial: ${deviceId}`,
    `- Clawperator CLI command: ${clawperatorBin}`,
    `- Operator package: ${operatorPackage}`,
    `- Skills registry: ${skillsRegistry || "(not set)"}`,
    "",
    "Hard route constraints:",
    "- Start from a fresh Google Home session by closing and reopening the app.",
    "- Use the recorded Home -> Climate -> named tile -> long press controller path.",
    "- Verify the controller title matches the requested unit label before applying any change.",
    "- Read current state before acting.",
    "- After the requested action, close and reopen Google Home and reread the target state for terminal proof.",
    "- For climate_state, use the same stale-UI avoidance pattern as the replay power skill: trust only the fresh-session reread.",
    "- Do not accept the immediate in-place controller as final proof.",
    "",
    "Suggested Clawperator primitives:",
    "- open_app",
    "- close_app",
    "- sleep",
    "- scroll_and_click",
    "- click",
    "- long_click",
    "- wait_for_node",
    "- read_text",
    "- snapshot_ui",
    "",
    "Google Home selectors and labels:",
    "- app id: com.google.android.apps.chromecast.app",
    "- controller title is visible near the toolbar close button",
    "- power button resourceId: com.google.android.apps.chromecast.app:id/climate_power_button",
    "- temperature value resourceId: com.google.android.apps.chromecast.app:id/low_value",
    "- decrease button resourceId: com.google.android.apps.chromecast.app:id/down_button",
    "- increase button resourceId: com.google.android.apps.chromecast.app:id/up_button",
    "- mode tile resourceId: com.google.android.apps.chromecast.app:id/action_tile and visible text starts with 'Mode '",
    "- fan speed tile resourceId: com.google.android.apps.chromecast.app:id/action_tile and visible text starts with 'Fan speed '",
    "- use Home tab text 'Home' and Climate chip text 'Climate'",
    "- on the proving device, the fan-speed sheet options are lowercase: 'auto', 'high', 'low', 'med'",
    "",
    "Controller-entry command pattern to prefer over ad hoc probing:",
    `- Use one bounded exec that reopens Google Home, taps Home, scrolls to the Climate chip, then scrolls to the requested unit tile and opens it with long press. The key navigation actions are scroll_and_click on 'Climate' in container resourceId='com.google.android.apps.chromecast.app:id/category_chips' and scroll_and_click on the requested unit tile with clickType='long_click'.`,
    "- Do not wait for the Climate chip to appear as a separate flat command. Use scroll_and_click to bring it into view inside the same exec payload.",
    "- After opening the controller, verify the toolbar title from a snapshot or read before applying any action.",
    "",
    "Exact command templates:",
    `- First command: ${clawperatorBin} close com.google.android.apps.chromecast.app --device ${quoteShellArg(deviceId)} --operator-package ${quoteShellArg(operatorPackage)} --json`,
    `- Second command: ${clawperatorBin} open com.google.android.apps.chromecast.app --device ${quoteShellArg(deviceId)} --operator-package ${quoteShellArg(operatorPackage)} --json`,
    `- Third command for controller entry: ${enterControllerCommand}`,
    `- For temperature reads: ${readTemperatureCommand}`,
    `- For one temperature increase step: ${increaseTemperatureCommand}`,
    `- For one temperature decrease step: ${decreaseTemperatureCommand}`,
    `- For fan-speed reads on the controller: ${readFanCommand}`,
    `- For fan-speed sheet selection: ${setFanCommand}`,
    `- For fresh-session verification after any action: repeat the close command, repeat the open command, repeat the controller-entry exec, then run the action-specific read command from the reopened controller.`,
    "",
    "Action-specific proof rules:",
    "- temperature: terminal observed text should be the reopened low_value integer",
    "- mode: terminal observed text should be the reopened selected mode label",
    "- fan_speed: terminal observed text should be the reopened selected fan speed label",
    "- climate_state: terminal observed text should be normalized to lowercase 'on' or 'off' from the reopened low_value",
    "",
    "Exact final-frame schema:",
    `- contractVersion must be '1.0.0'`,
    `- skillId must be '${skillId}'`,
    "- status must be 'success', 'failed', or 'indeterminate'",
    "- include goal.kind='control_hvac', goal.action, goal.value, goal.unit_name",
    "- include matching inputs.action, inputs.value, inputs.unit_name",
    "- include result before status; use {\"kind\":\"json\",\"value\":{\"action\":\"<action>\",\"value\":\"<normalized value>\",\"unit_name\":\"<unit>\"}} for success and result:null when no truthful final state is available",
    "- include checkpoints in this exact order with note on every checkpoint:",
    "  1. app_opened",
    "  2. controller_opened",
    "  3. current_state_read",
    "  4. action_applied",
    "  5. terminal_state_verified",
    "- include terminalVerification with status plus observed.text when verified",
    `- if the requested value is already present, still return status 'success' and mark action_applied as ok with a note saying it was a verified no-op`,
    `- for temperature value '${requestedConfig.value}', a valid terminalVerification example is {"status":"verified","method":"fresh-session reread","observed":{"text":"${expectedText}"}}`,
    "",
    "Exact final-frame example shape:",
    `[Clawperator-Skill-Result]
{"contractVersion":"1.0.0","skillId":"${skillId}","goal":{"kind":"control_hvac","action":"${requestedConfig.action}","value":"${requestedConfig.value}","unit_name":"${requestedConfig.unitName}"},"inputs":{"action":"${requestedConfig.action}","value":"${requestedConfig.value}","unit_name":"${requestedConfig.unitName}"},"result":{"kind":"json","value":{"action":"${requestedConfig.action}","value":"${requestedConfig.value}","unit_name":"${requestedConfig.unitName}"}},"status":"success","checkpoints":[{"id":"app_opened","status":"ok","note":"Google Home was reopened from a fresh session."},{"id":"controller_opened","status":"ok","note":"Opened the Panasonic controller through Home > Climate."},{"id":"current_state_read","status":"ok","note":"Read the current value before acting."},{"id":"action_applied","status":"ok","note":"Applied the requested action or confirmed a verified no-op."},{"id":"terminal_state_verified","status":"ok","note":"Fresh-session reread matched the requested value."}],"terminalVerification":{"status":"verified","method":"fresh-session reread","observed":{"text":"${expectedText}"}}}`,
    "",
    "SKILL.md program:",
    skillProgram,
  ].join("\n");
}

function normalizeWhitespace(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function normalizeStateText(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "on") return "on";
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return "on";
  const numericCandidate = normalized.replace(/[^\d.-]+/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(numericCandidate)) return "on";
  return normalized;
}

function observedMatchesExpected(observedText) {
  const observed = normalizeWhitespace(observedText);
  if (!observed) {
    return false;
  }
  if (requestedConfig.action === "temperature") {
    const match = observed.match(/-?\d+/);
    return match !== null && match[0] === requestedConfig.value;
  }
  if (requestedConfig.action === "climate_state") {
    return normalizeStateText(observed) === requestedConfig.value;
  }
  if (requestedConfig.action === "fan_speed") {
    return canonicalizeFanSpeedLabel(observed) === canonicalizeFanSpeedLabel(requestedConfig.value);
  }
  return observed.toLowerCase().includes(String(requestedConfig.value).toLowerCase());
}

function hasValidCheckpoint(checkpoint) {
  return isPlainObject(checkpoint)
    && typeof checkpoint.id === "string"
    && ["ok", "failed", "skipped"].includes(checkpoint.status);
}

function hasRequiredCheckpointNotes(checkpoints) {
  return checkpoints.every((checkpoint) => (
    checkpoint.status !== "ok"
      || (typeof checkpoint.note === "string" && checkpoint.note.trim().length > 0)
  ));
}

function hasValidTerminalVerification(terminalVerification) {
  return terminalVerification === null || (
    isPlainObject(terminalVerification)
    && ["verified", "failed", "not_run"].includes(terminalVerification.status)
  );
}

function hasRequiredCheckpointsInOrder(checkpoints) {
  const remainingRequiredIds = [...requiredCheckpointIds];
  for (const checkpoint of checkpoints) {
    if (!hasValidCheckpoint(checkpoint)) {
      return false;
    }
    if (remainingRequiredIds[0] === checkpoint.id) {
      remainingRequiredIds.shift();
    }
  }
  return remainingRequiredIds.length === 0;
}

function hasMinimalSkillResultShape(skillResult) {
  return isPlainObject(skillResult)
    && isPlainObject(skillResult.goal)
    && isPlainObject(skillResult.inputs)
    && Array.isArray(skillResult.checkpoints)
    && hasRequiredCheckpointsInOrder(skillResult.checkpoints)
    && hasRequiredCheckpointNotes(skillResult.checkpoints)
    && hasValidTerminalVerification(
      Object.prototype.hasOwnProperty.call(skillResult, "terminalVerification")
        ? skillResult.terminalVerification
        : null
    );
}

function normalizeCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    status: checkpoint.status,
    note: typeof checkpoint.note === "string" ? checkpoint.note.trim() : checkpoint.note,
  };
}

function normalizeTerminalVerification(terminalVerification) {
  if (!isPlainObject(terminalVerification)) {
    return null;
  }
  if (
    isPlainObject(terminalVerification.observed)
    && typeof terminalVerification.observed.text === "string"
  ) {
    return {
      ...terminalVerification,
      observed: {
        kind: "text",
        text: denormalizeObservedText(terminalVerification.observed.text),
      },
    };
  }
  if (
    isPlainObject(terminalVerification.observed)
    && terminalVerification.observed.kind === "text"
    && typeof terminalVerification.observed.value === "string"
  ) {
    return {
      ...terminalVerification,
      observed: {
        kind: "text",
        text: denormalizeObservedText(terminalVerification.observed.value),
      },
    };
  }
  if (typeof terminalVerification.text === "string") {
    return {
      status: terminalVerification.status,
      method: terminalVerification.method,
      observed: {
        kind: "text",
        text: denormalizeObservedText(terminalVerification.text),
      },
    };
  }
  return terminalVerification;
}

function normalizeSkillResult(skillResult) {
  return {
    contractVersion: skillResult.contractVersion,
    skillId: skillResult.skillId,
    goal: skillResult.goal,
    inputs: skillResult.inputs,
    result: Object.prototype.hasOwnProperty.call(skillResult, "result") ? skillResult.result : null,
    status: skillResult.status,
    checkpoints: skillResult.checkpoints.map(normalizeCheckpoint),
    terminalVerification: normalizeTerminalVerification(
      Object.prototype.hasOwnProperty.call(skillResult, "terminalVerification")
        ? skillResult.terminalVerification
        : null
    ),
  };
}

function hasRequiredSkillResultShape(skillResult) {
  return isPlainObject(skillResult)
    && typeof skillResult.contractVersion === "string"
    && skillResult.skillId === skillId
    && !Object.prototype.hasOwnProperty.call(skillResult, "source")
    && isPlainObject(skillResult.goal)
    && isPlainObject(skillResult.inputs)
    && Object.prototype.hasOwnProperty.call(skillResult, "result")
    && ["success", "failed", "indeterminate"].includes(skillResult.status)
    && Array.isArray(skillResult.checkpoints)
    && hasRequiredCheckpointsInOrder(skillResult.checkpoints)
    && hasRequiredCheckpointNotes(skillResult.checkpoints)
    && hasValidTerminalVerification(
      Object.prototype.hasOwnProperty.call(skillResult, "terminalVerification")
        ? skillResult.terminalVerification
        : null
    );
}

function hasExpectedGoalAndInputs(skillResult) {
  const actualGoalValue = normalizeValue(requestedConfig.action, skillResult.goal.value);
  const actualInputValue = normalizeValue(requestedConfig.action, skillResult.inputs.value);
  return skillResult.goal.kind === "control_hvac"
    && skillResult.goal.action === requestedConfig.action
    && actualGoalValue === requestedConfig.value
    && skillResult.goal.unit_name === requestedConfig.unitName
    && skillResult.inputs.action === requestedConfig.action
    && actualInputValue === requestedConfig.value
    && skillResult.inputs.unit_name === requestedConfig.unitName;
}

function hasSuccessVerification(skillResult) {
  if (skillResult.status !== "success") {
    return true;
  }
  const requiredCheckpointStatuses = new Map(
    skillResult.checkpoints
      .filter((checkpoint) => requiredCheckpointIds.includes(checkpoint.id))
      .map((checkpoint) => [checkpoint.id, checkpoint.status])
  );
  if (!requiredCheckpointIds.every((checkpointId) => requiredCheckpointStatuses.get(checkpointId) === "ok")) {
    return false;
  }
  if (!isPlainObject(skillResult.terminalVerification)) {
    return false;
  }
  if (skillResult.terminalVerification.status !== "verified") {
    return false;
  }
  const observedText = skillResult.terminalVerification.observed?.text;
  return typeof observedText === "string" && observedMatchesExpected(observedText);
}

function extractJsonObjectAfterMarker(content, marker) {
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex === -1) {
    return { ok: false, message: "Agent CLI output did not contain a terminal SkillResult frame." };
  }

  const trailing = content.slice(markerIndex + marker.length).trimStart();
  const firstBraceIndex = trailing.indexOf("{");
  if (firstBraceIndex === -1) {
    return { ok: false, message: "Agent CLI output did not contain a JSON payload after the terminal SkillResult frame." };
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  let startIndex = -1;
  for (let index = firstBraceIndex; index < trailing.length; index += 1) {
    const char = trailing[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && startIndex !== -1) {
        return {
          ok: true,
          jsonText: trailing.slice(startIndex, index + 1),
          framedOutput: `${marker}\n${trailing.slice(startIndex, index + 1)}\n`,
        };
      }
    }
  }
  return { ok: false, message: "Agent CLI output ended with an incomplete SkillResult JSON payload." };
}

function parseTerminalSkillResultFrame(content) {
  const marker = "[Clawperator-Skill-Result]";
  const extracted = extractJsonObjectAfterMarker(content, marker);
  if (!extracted.ok) {
    return extracted;
  }

  let parsed;
  try {
    parsed = JSON.parse(extracted.jsonText);
  } catch {
    return { ok: false, message: "Agent CLI output contained an invalid SkillResult JSON payload." };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, message: "Agent CLI output ended with a non-object SkillResult JSON payload." };
  }
  if (!hasMinimalSkillResultShape(parsed)) {
    return { ok: false, message: "Agent CLI output ended with a malformed SkillResult payload." };
  }
  const normalized = normalizeSkillResult(parsed);
  if (!hasRequiredSkillResultShape(normalized)) {
    return { ok: false, message: "Agent CLI output ended with a malformed SkillResult payload." };
  }
  if (!hasExpectedGoalAndInputs(normalized)) {
    return { ok: false, message: "Agent CLI output ended with a SkillResult whose goal or inputs do not match the requested action/value/unit." };
  }
  if (!hasSuccessVerification(normalized)) {
    return { ok: false, message: "Agent CLI output claimed success without a verified terminal reread for the requested action." };
  }
  return {
    ok: true,
    framedOutput: `${marker}\n${JSON.stringify(normalized)}\n`,
    skillResult: normalized,
  };
}

async function flushLastMessage(outputPath, { emit = true } = {}) {
  try {
    const content = await readFile(outputPath, "utf8");
    if (content.trim().length === 0) {
      return { ok: false, message: "Agent CLI did not write any final output." };
    }
    const parsedFrame = parseTerminalSkillResultFrame(content);
    if (!parsedFrame.ok) {
      return parsedFrame;
    }
    if (emit) {
      process.stdout.write(parsedFrame.framedOutput);
    }
    return { ok: true, framedOutput: parsedFrame.framedOutput, skillResult: parsedFrame.skillResult };
  } catch {
    return { ok: false, message: "Agent CLI did not write the final message artifact." };
  }
}

function exitCodeForSkillResult(skillResult) {
  return skillResult.status === "success" ? 0 : 1;
}

async function main() {
  if (!resolvedAgentCliPath || !skillProgramPath || !deviceId || !clawperatorBin) {
    const message =
      "Missing orchestrated skill runtime env. Run this skill through 'clawperator skills run' so the harness receives the resolved agent CLI, skill program path, selected device, and CLAWPERATOR_BIN.";
    console.error(message);
    await emitHarnessFailureSkillResult(message);
    process.exit(1);
  }
  if (!requestedConfig.action || !requestedConfig.value || !requestedConfig.unitName) {
    const message =
      "Missing or invalid HVAC inputs. Provide --action <temperature|mode|fan_speed|climate_state> --value <target> --unit-name <label>.";
    console.error(message);
    await emitHarnessFailureSkillResult(message);
    process.exit(1);
  }

  const skillProgram = await readFile(skillProgramPath, "utf8");
  const prompt = buildPrompt(skillProgram);
  const tempDir = await createRunDirectory();
  const outputPath = join(tempDir, "last-message.txt");
  const promptPath = join(tempDir, "prompt.txt");
  const stdoutLogPath = join(tempDir, "agent-stdout.log");
  const stderrLogPath = join(tempDir, "agent-stderr.log");
  const metadataPath = join(tempDir, "run-metadata.json");

  let settled = false;
  let watchdogTimer = null;
  let preserveTempDir = false;
  let terminationReason = null;

  await writeFile(promptPath, prompt, "utf8");
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        skillId,
        debugMode,
        retainLogs,
        tempDir,
        outputPath,
        promptPath,
        stdoutLogPath,
        stderrLogPath,
        forwardedArgs,
        requestedConfig,
        deviceId,
        clawperatorBin,
        operatorPackage,
        skillsRegistry,
        configuredAgentTimeoutMs: Number.isInteger(configuredAgentTimeoutMs) ? configuredAgentTimeoutMs : null,
      },
      null,
      2
    ),
    "utf8"
  );

  const child = spawn(
    resolvedAgentCliPath,
    [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "danger-full-access",
      "--color",
      "never",
      ...(debugMode ? ["--json"] : []),
      "-C",
      skillsRepoRoot,
      "-o",
      outputPath,
      "-",
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: buildAgentEnv(),
    }
  );

  const terminateChild = (signal) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      if (process.platform !== "win32" && typeof child.pid === "number") {
        process.kill(-child.pid, signal);
        return;
      }
    } catch {
      // Fall through to direct child termination.
    }
    child.kill(signal);
  };

  const cleanupAndExit = async (code) => {
    if (settled) {
      return;
    }
    settled = true;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (!preserveTempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    process.exit(code);
  };

  process.once("SIGTERM", () => terminateChild("SIGTERM"));
  process.once("SIGINT", () => terminateChild("SIGINT"));

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    appendFile(stdoutLogPath, text).catch(() => {});
    if (debugMode) {
      process.stderr.write(text);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    appendFile(stderrLogPath, text).catch(() => {});
    process.stderr.write(text);
  });

  child.on("error", async (error) => {
    preserveTempDir = retainLogs;
    terminationReason = `Failed to start agent CLI: ${error.message}`;
    console.error(terminationReason);
    await emitHarnessFailureSkillResult(terminationReason);
    if (preserveTempDir) {
      console.error(`Orchestrated skill logs retained at ${tempDir}`);
    }
    await cleanupAndExit(1);
  });

  if (Number.isInteger(configuredAgentTimeoutMs) && configuredAgentTimeoutMs > 0) {
    watchdogTimer = setTimeout(() => {
      preserveTempDir = retainLogs;
      terminationReason = `Agent CLI exceeded configured timeout ${configuredAgentTimeoutMs}ms; terminating orchestrated harness child process.`;
      console.error(terminationReason);
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      terminateChild("SIGTERM");
      setTimeout(() => terminateChild("SIGKILL"), 5000);
    }, configuredAgentTimeoutMs);
  }

  child.stdin.write(prompt);
  child.stdin.end();

  child.on("close", async (code, signal) => {
    if (signal || terminationReason !== null) {
      preserveTempDir = retainLogs;
      await emitHarnessFailureSkillResult(terminationReason ?? `Agent CLI terminated with signal ${signal}.`);
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      await cleanupAndExit(1);
      return;
    }

    const frameResult = await flushLastMessage(outputPath, { emit: false });
    if (!frameResult.ok) {
      preserveTempDir = retainLogs;
      await emitHarnessFailureSkillResult(frameResult.message);
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      console.error(frameResult.message);
      await cleanupAndExit(code === 0 ? 1 : (code ?? 1));
      return;
    }

    if ((code ?? 0) !== 0) {
      preserveTempDir = retainLogs;
      const message = `Agent CLI exited with code ${code ?? 1}; refusing to accept a terminal SkillResult from a non-zero child exit.`;
      await emitHarnessFailureSkillResult(message);
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      console.error(message);
      await cleanupAndExit(code ?? 1);
      return;
    }

    await writeStdoutAndDrain(frameResult.framedOutput);
    if (retainLogs) {
      preserveTempDir = true;
      console.error(`Orchestrated skill logs retained at ${tempDir}`);
    }
    await cleanupAndExit(exitCodeForSkillResult(frameResult.skillResult));
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  writeStdoutAndDrain("[Clawperator-Skill-Result]\n")
    .then(() => writeStdoutAndDrain(`${JSON.stringify(buildHarnessFailureSkillResult(message))}\n`))
    .catch(() => {})
    .finally(() => {
      process.exit(1);
    });
});
