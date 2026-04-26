#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { mkdtemp, mkdir, readFile, rm, appendFile, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const resolvedAgentCliPath = process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH;
const skillProgramPath = process.env.CLAWPERATOR_SKILL_PROGRAM;
const skillInputs = process.env.CLAWPERATOR_SKILL_INPUTS || "[]";
const deviceId = process.env.CLAWPERATOR_DEVICE_ID;
const clawperatorBin = process.env.CLAWPERATOR_BIN;
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator";
const skillsRegistry = process.env.CLAWPERATOR_SKILLS_REGISTRY || "";
const configuredAgentTimeoutMs = Number.parseInt(process.env.CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS || "", 10);
const skillId = process.env.CLAWPERATOR_SKILL_ID || "com.solaxcloud.starter.set-discharge-to-limit-orchestrated";
const forwardedArgs = process.argv.slice(2);
const skillsRepoRoot = resolve(__dirname, "../../..");
const debugMode = process.env.CLAWPERATOR_SKILL_DEBUG === "1";
const retainLogs = debugMode || process.env.CLAWPERATOR_SKILL_RETAIN_LOGS === "1";
const configuredLogDir = process.env.CLAWPERATOR_SKILL_LOG_DIR || "";
const requiredCheckpointIds = [
  "app_opened",
  "discharge_to_row_focused",
  "target_text_entered",
  "save_completed",
  "terminal_state_verified",
];

function parseRequestedPercent() {
  const parseValue = (value) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100) {
      return value;
    }
    if (typeof value === "string" && /^[0-9]{1,3}$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      if (parsed >= 0 && parsed <= 100) {
        return parsed;
      }
    }
    return null;
  };

  for (const arg of forwardedArgs) {
    const parsed = parseValue(arg);
    if (parsed !== null) {
      return parsed;
    }
  }

  try {
    const parsedInputs = JSON.parse(skillInputs);
    if (Array.isArray(parsedInputs)) {
      for (const entry of parsedInputs) {
        const parsed = parseValue(entry);
        if (parsed !== null) {
          return parsed;
        }
      }
    } else if (isPlainObject(parsedInputs)) {
      const parsed = parseValue(parsedInputs.percent);
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch {
    // Best-effort only.
  }

  return null;
}

const requestedPercent = parseRequestedPercent();

async function createRunDirectory() {
  if (configuredLogDir.length > 0) {
    await mkdir(configuredLogDir, { recursive: true });
    return mkdtemp(join(configuredLogDir, "run-"));
  }

  return mkdtemp(join(tmpdir(), "clawperator-solax-orchestrated-"));
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

function buildPrompt(skillProgram) {
  return [
    `You are the runtime agent for the Clawperator skill '${skillId}'.`,
    "Follow the attached SKILL.md exactly.",
    "Do not edit repository files.",
    "Do not inspect repository files during the live run.",
    "Do not use rg, grep, sed, cat, find, or ls against the repo while the device run is in progress.",
    "Use the shell tool to run Clawperator CLI commands.",
    "Do not spend a turn planning in prose.",
    "Your first response must include a real Clawperator shell command for the selected device.",
    "Run only one live device command at a time.",
    "Do not start a second Clawperator device command until the previous device command has completed and you have inspected its result.",
    "Do not issue multiple shell commands in parallel for the same live run.",
    "Start from the current visible SolaX state using the route in SKILL.md.",
    "If SolaX is not already foregrounded, your first live command should open com.solaxcloud.starter.",
    "Do not close and reopen SolaX unless the route in SKILL.md says recovery is needed.",
    "If you cannot make progress with real Clawperator evidence, emit a truthful failed SkillResult instead of waiting on the launcher.",
    "Never open unrelated apps or system surfaces such as launcher search, the Google app, voice search, Assistant, Chrome, or Settings.",
    "The only target app for this run is com.solaxcloud.starter. If the flow leaves that app, recover back to SolaX immediately or fail truthfully.",
    "",
    "Runtime context:",
    `- Forwarded raw argv: ${JSON.stringify(forwardedArgs)}`,
    `- Declared skill inputs from CLAWPERATOR_SKILL_INPUTS: ${skillInputs}`,
    `- Selected device serial: ${deviceId}`,
    `- Clawperator CLI command: ${clawperatorBin}`,
    `- Operator package: ${operatorPackage}`,
    `- Skills registry: ${skillsRegistry || "(not set)"}`,
    "",
    "Required command shape:",
    `- Every device action must be a shell command that starts with: ${clawperatorBin}`,
    `- Reuse these arguments on every device command: --device ${deviceId} --operator-package ${operatorPackage}`,
    "- Prefer Clawperator CLI commands over adb for runtime evidence.",
    "- Use these runtime action types when possible: open_app, close_app, sleep, wait_for_node, click, read_text, enter_text.",
    "- For open_app, the params key is applicationId. Do not use packageName.",
    "- If the SolaX discharge dialog does not persist a plain enter_text update reliably, you may use adb shell input keyevent/text against the already-focused van-field-1-input as the replay sibling proved for this exact dialog.",
    "- For coordinate taps, click params must use params.coordinate with nested x/y. Never emit raw params.x or params.y.",
    "- Wait for each exec result before deciding the next exec. Never pipeline two route steps at once.",
    "- You already have the route and selectors you need in this prompt. Do not search the repo for examples.",
    "- Prefer several small exec payloads over one oversized execution when moving between Peak Export, Device Discharging, set-value, save, and verify phases.",
    "- If a wait for Device Discharging times out after opening Peak Export, probe whether Peak Export is already visible and then continue with the next recorded step instead of repeating the same failed wait blindly.",
    "- Do not spend a dedicated exec waiting for 'Peak Export' text after tapping the Intelligence tab. After a short settle, proceed to the known Peak Export coordinate unless the current screen already proves a later route state.",
    "- Do not append a trailing read_text to the same exec that taps 'Device Discharging (By percentage)'. Open that screen first, then use a second exec to wait for and read the 'Discharge to' row from the new current state.",
    "- After the pre-edit read_text succeeds, log one concise progress line that names both values, for example: 'This run will try to change Discharge to from 35 to 40.'",
    "- Do not treat a successful click on the 'Discharge to' row as proof that the edit dialog opened. The dialog is open only after wait_for_node observes resourceId='van-field-1-input'.",
    "- If the first attempt to open the 'Discharge to' dialog does not produce van-field-1-input, treat it as an intermittent missed tap and spend one bounded retry reopening that same row before failing the run.",
    "- Do not make the scenario-cancel confirmation prompt a required wait after the second Save. If it appears, click Confirm. If it does not appear and the route can be reopened for terminal verification, treat the save path as acceptable without the prompt.",
    "- If the first Intelligence-to-Peak-Export exec returns RESULT_ENVELOPE_TIMEOUT or another no-envelope failure, spend the one allowed recovery on closing and reopening com.solaxcloud.starter, then retry that same route command exactly once before failing.",
    "- During terminal verification, if the tap back into 'Device Discharging (By percentage)' returns RESULT_ENVELOPE_TIMEOUT after Peak Export was already re-opened, treat that as a possible partial advance and immediately attempt the separate Discharge-to wait-and-read from the current screen before failing verification.",
    "- For terminal verification, treat a read_text result that contains 'Discharge to <percent>%' as valid even if the row also includes a decorative trailing glyph such as ''.",
    "",
    "Known-good execution decomposition from a successful live run:",
    `1. Open SolaX if needed: ${clawperatorBin} open com.solaxcloud.starter --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `2. Enter Peak Export editor: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-enter-peak-export","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open_intelligence","type":"click","params":{"matcher":{"resourceId":"com.solaxcloud.starter:id/tab_intelligent"}}},{"id":"wait_after_tab","type":"sleep","params":{"durationMs":1500}},{"id":"open_peak_export","type":"click","params":{"coordinate":{"x":860,"y":1399}}},{"id":"wait_peak_export_editor","type":"wait_for_node","params":{"matcher":{"textContains":"Device Discharging"},"timeoutMs":15000}}]}' --json`,
    `2a. If step 2 times out without a result envelope, run one recovery sequence in three separate commands: first ${clawperatorBin} close com.solaxcloud.starter --device ${deviceId} --operator-package ${operatorPackage} --json, then ${clawperatorBin} open com.solaxcloud.starter --device ${deviceId} --operator-package ${operatorPackage} --json, then retry step 2 once.`,
    `3. Open Device Discharging: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-open-device-discharging","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":20000,"actions":[{"id":"open_device_discharging","type":"click","params":{"coordinate":{"x":875,"y":1548}}},{"id":"wait_after_open_device_discharging","type":"sleep","params":{"durationMs":1500}}]}' --json`,
    `4. Read the current Discharge to row from the new screen: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-read-discharge-row","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":25000,"actions":[{"id":"wait_discharge_row","type":"wait_for_node","params":{"matcher":{"textContains":"Discharge to"},"timeoutMs":15000}},{"id":"read_discharge_row","type":"read_text","params":{"matcher":{"textContains":"Discharge to"}}}]}' --json`,
    `5. Set value and confirm: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-set-value","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open_discharge_dialog","type":"click","params":{"matcher":{"textContains":"Discharge to"}}},{"id":"wait_input","type":"wait_for_node","params":{"matcher":{"resourceId":"van-field-1-input"},"timeoutMs":10000}},{"id":"focus_input","type":"click","params":{"matcher":{"resourceId":"van-field-1-input"}}},{"id":"enter_target","type":"enter_text","params":{"matcher":{"resourceId":"van-field-1-input"},"text":"<percent>"}},{"id":"confirm_value","type":"click","params":{"matcher":{"text":"Confirm"}}},{"id":"wait_after_confirm","type":"wait_for_node","params":{"matcher":{"textContains":"Save"},"timeoutMs":10000}}]}' --json`,
    `5a. If step 5 clicks the row but wait_input does not observe resourceId='van-field-1-input', log that the first dialog-open attempt missed, rerun the same small open-and-wait command exactly once, and fail truthfully if the retry still does not open the dialog.`,
    `6. Save without assuming the prompt appears: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-save","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"click_save_first","type":"click","params":{"matcher":{"text":"Save"}}},{"id":"wait_after_first_save","type":"sleep","params":{"durationMs":1500}},{"id":"wait_save_again","type":"wait_for_node","params":{"matcher":{"text":"Save"},"timeoutMs":10000}},{"id":"click_save_second","type":"click","params":{"matcher":{"text":"Save"}}},{"id":"wait_after_second_save","type":"sleep","params":{"durationMs":3000}}]}' --json`,
    `7. If the scenario-cancel prompt is visibly blocking the screen after step 6, handle it in a separate small exec that clicks matcher.text='Confirm'. Otherwise move directly into terminal verification.`,
    `8. Verify by reopening the route with the same smaller command pattern: return to Peak Export, open Device Discharging, then run a separate wait+read exec for matcher.textContains='Discharge to'. If the Device Discharging tap times out without an envelope, still try the separate wait+read once from the current screen before deciding verification failed. Treat successful reopened-route verification as the final proof that save completed.`,
    "",
    "SKILL.md program:",
    skillProgram,
  ].join("\n");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function extractObservedPercent(observedText) {
  const match = /Discharge to\s+(\d+)%/.exec(observedText);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function extractInitialObservedPercentFromSkillResult(skillResult) {
  if (!Array.isArray(skillResult?.checkpoints)) {
    return null;
  }
  const checkpoint = skillResult.checkpoints.find((entry) => entry?.id === "discharge_to_row_focused");
  if (!checkpoint || typeof checkpoint.note !== "string") {
    return null;
  }
  return extractObservedPercent(checkpoint.note);
}

function buildTransitionLogLine(skillResult) {
  if (requestedPercent === null) {
    return null;
  }
  const observedPercent = extractInitialObservedPercentFromSkillResult(skillResult);
  if (observedPercent === null) {
    return null;
  }
  return `This run will try to change Discharge to from ${observedPercent} to ${requestedPercent}.`;
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
  return typeof observedText === "string"
    && requestedPercent !== null
    && extractObservedPercent(observedText) === requestedPercent;
}

function hasExpectedGoalAndInputs(skillResult) {
  if (requestedPercent === null) {
    return true;
  }
  return skillResult.goal.kind === "set_discharge_limit"
    && skillResult.goal.percent === requestedPercent
    && skillResult.inputs.percent === requestedPercent;
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

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Agent CLI output ended with a non-object SkillResult JSON payload." };
  }

  if (!hasRequiredSkillResultShape(parsed)) {
    return { ok: false, message: "Agent CLI output ended with a malformed SkillResult payload." };
  }

  if (!hasExpectedGoalAndInputs(parsed)) {
    return { ok: false, message: "Agent CLI output ended with a SkillResult whose goal or inputs do not match the requested percent." };
  }

  if (!hasSuccessVerification(parsed)) {
    return { ok: false, message: "Agent CLI output claimed success without a verified terminal read for the requested percent." };
  }

  return { ok: true, framedOutput: extracted.framedOutput, skillResult: parsed };
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

async function writeStdoutAndDrain(text) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      process.stdout.off("drain", handleDrain);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const handleDrain = () => finish();
    const accepted = process.stdout.write(text, (error) => finish(error));
    if (!accepted) {
      process.stdout.once("drain", handleDrain);
    }
  });
}

function buildHarnessFailureSkillResult(message) {
  const percent = requestedPercent;
  return {
    contractVersion: "1.0.0",
    skillId,
    goal: { kind: "set_discharge_limit", percent },
    inputs: { percent },
    result: null,
    status: "failed",
    checkpoints: requiredCheckpointIds.map((id) => ({ id, status: "skipped", note: message })),
    terminalVerification: {
      status: "not_run",
      note: message,
    },
  };
};

async function emitHarnessFailureSkillResult(message) {
  await writeStdoutAndDrain("[Clawperator-Skill-Result]\n");
  await writeStdoutAndDrain(`${JSON.stringify(buildHarnessFailureSkillResult(message))}\n`);
}

function exitCodeForSkillResult(skillResult) {
  return skillResult.status === "success" ? 0 : 1;
}

async function main() {
  if (!resolvedAgentCliPath || !skillProgramPath || !deviceId || !clawperatorBin) {
    const message =
      "Missing orchestrated skill runtime env. Run this skill through 'clawperator skills run' so the harness receives the resolved agent CLI, skill program path, selected device, and CLAWPERATOR_BIN."
    console.error(message);
    await emitHarnessFailureSkillResult(message);
    process.exit(1);
  }
  if (requestedPercent === null) {
    const message = "Missing or invalid percent input. Provide one integer between 0 and 100 as the first forwarded skill argument.";
    console.error(message);
    await emitHarnessFailureSkillResult(message);
    process.exit(1);
  }

  const skillProgram = await readFile(skillProgramPath, "utf8");
  const prompt = buildPrompt(skillProgram);
  const tempDir = await createRunDirectory();
  const outputPath = join(tempDir, "last-message.txt");
  const promptPath = join(tempDir, "prompt.txt");
  const stdoutLogPath = join(tempDir, "codex-stdout.log");
  const stderrLogPath = join(tempDir, "codex-stderr.log");
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
    appendFile(stdoutLogPath, text).catch(() => {
      // Best-effort debug capture only.
    });
    if (debugMode) {
      process.stderr.write(text);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    appendFile(stderrLogPath, text).catch(() => {
      // Best-effort debug capture only.
    });
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
    const transitionLogLine = buildTransitionLogLine(frameResult.skillResult);
    if (transitionLogLine !== null) {
      console.error(transitionLogLine);
    }
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
    .catch(() => {
      // Best-effort only during fatal teardown.
    })
    .finally(() => {
      process.exit(1);
    });
});
