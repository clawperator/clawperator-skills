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
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator.dev";
const skillsRegistry = process.env.CLAWPERATOR_SKILLS_REGISTRY || "";
const configuredAgentTimeoutMs = Number.parseInt(process.env.CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS || "", 10);
const skillId = process.env.CLAWPERATOR_SKILL_ID || "com.solaxcloud.starter.set-discharge-to-limit-orchestrated";
const forwardedArgs = process.argv.slice(2);
const skillsRepoRoot = resolve(__dirname, "../../..");
const debugMode = process.env.CLAWPERATOR_SKILL_DEBUG === "1";
const retainLogs = debugMode || process.env.CLAWPERATOR_SKILL_RETAIN_LOGS === "1";
const configuredLogDir = process.env.CLAWPERATOR_SKILL_LOG_DIR || "";

async function createRunDirectory() {
  if (configuredLogDir.length > 0) {
    await mkdir(configuredLogDir, { recursive: true });
    return mkdtemp(join(configuredLogDir, "run-"));
  }

  return mkdtemp(join(tmpdir(), "clawperator-solax-orchestrated-"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
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
  const bootstrapExecution = {
    commandId: `${skillId}-bootstrap-open`,
    taskId: skillId,
    source: skillId,
    expectedFormat: "android-ui-automator",
    timeoutMs: 45000,
    actions: [
      { id: "open", type: "open_app", params: { applicationId: "com.solaxcloud.starter" } },
      { id: "wait_focus", type: "sleep", params: { durationMs: 2000 } },
    ],
  };

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
    "Run the non-destructive bootstrap command below first, then continue from the current in-app state using the route in SKILL.md.",
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
    "- Use only these runtime action types unless the run fails truthfully first: open_app, close_app, sleep, wait_for_node, click, read_text, enter_text.",
    "- For coordinate taps, click params must use params.coordinate with nested x/y. Never emit raw params.x or params.y.",
    "- Wait for each exec result before deciding the next exec. Never pipeline two route steps at once.",
    "- You already have the route and selectors you need in this prompt. Do not search the repo for examples.",
    "- Prefer several small exec payloads over one oversized execution when moving between Peak Export, Device Discharging, set-value, save, and verify phases.",
    "- If a wait for Device Discharging times out after opening Peak Export, probe whether Peak Export is already visible and then continue with the next recorded step instead of repeating the same failed wait blindly.",
    "- For terminal verification, treat a read_text result that contains 'Discharge to <percent>%' as valid even if the row also includes a decorative trailing glyph such as ''.",
    "",
    "Known-good execution decomposition from a successful live run:",
    `1. Focus Intelligence: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-focus-intelligence","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open_intelligence","type":"click","params":{"matcher":{"resourceId":"com.solaxcloud.starter:id/tab_intelligent"}}},{"id":"wait_after_tab","type":"sleep","params":{"durationMs":1500}},{"id":"wait_peak_export_text","type":"wait_for_node","params":{"matcher":{"textContains":"Peak Export"},"timeoutMs":15000}}]}' --json`,
    `2. Enter Peak Export editor: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-enter-peak-export","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open_peak_export","type":"click","params":{"coordinate":{"x":860,"y":1399}}},{"id":"wait_peak_export_editor","type":"wait_for_node","params":{"matcher":{"textContains":"Device Discharging"},"timeoutMs":15000}}]}' --json`,
    `3. Open discharge row: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-open-discharge-row","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open_device_discharging","type":"click","params":{"coordinate":{"x":875,"y":1548}}},{"id":"wait_discharge_row","type":"wait_for_node","params":{"matcher":{"textContains":"Discharge to"},"timeoutMs":15000}},{"id":"read_discharge_row","type":"read_text","params":{"matcher":{"textContains":"Discharge to"}}}]}' --json`,
    `4. Set value and confirm: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-set-value","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":30000,"actions":[{"id":"open_discharge_dialog","type":"click","params":{"matcher":{"textContains":"Discharge to"}}},{"id":"wait_input","type":"wait_for_node","params":{"matcher":{"resourceId":"van-field-1-input"},"timeoutMs":10000}},{"id":"focus_input","type":"click","params":{"matcher":{"resourceId":"van-field-1-input"}}},{"id":"enter_target","type":"enter_text","params":{"matcher":{"resourceId":"van-field-1-input"},"text":"<percent>"}},{"id":"confirm_value","type":"click","params":{"matcher":{"text":"Confirm"}}},{"id":"wait_after_confirm","type":"wait_for_node","params":{"matcher":{"textContains":"Save"},"timeoutMs":10000}}]}' --json`,
    `5. Save and confirm the save prompt: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-save","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":40000,"actions":[{"id":"click_save_first","type":"click","params":{"matcher":{"text":"Save"}}},{"id":"wait_after_first_save","type":"sleep","params":{"durationMs":1500}},{"id":"wait_save_again","type":"wait_for_node","params":{"matcher":{"text":"Save"},"timeoutMs":10000}},{"id":"click_save_second","type":"click","params":{"matcher":{"text":"Save"}}},{"id":"wait_confirm_prompt","type":"wait_for_node","params":{"matcher":{"textContains":"cancel the currently executing scenario"},"timeoutMs":10000}},{"id":"confirm_save_prompt","type":"click","params":{"matcher":{"text":"Confirm"}}},{"id":"wait_after_prompt_confirm","type":"sleep","params":{"durationMs":3000}}]}' --json`,
    `6. Verify by reopening the route: ${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '{"commandId":"${skillId}-return-intelligence","taskId":"${skillId}","source":"${skillId}","expectedFormat":"android-ui-automator","timeoutMs":20000,"actions":[{"id":"open_intelligence_again","type":"click","params":{"matcher":{"resourceId":"com.solaxcloud.starter:id/tab_intelligent"}}},{"id":"wait_after_tab_again","type":"sleep","params":{"durationMs":1500}},{"id":"wait_peak_export_text_again","type":"wait_for_node","params":{"matcher":{"textContains":"Peak Export"},"timeoutMs":15000}}]}' --json`,
    `7. Then reopen Peak Export and Device Discharging with the same coordinate payloads, ending with read_text on matcher.textContains='Discharge to'. Do not declare save complete until the prompt confirmation has been handled.`,
    "",
    "Bootstrap command to run first:",
    `${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '${JSON.stringify(bootstrapExecution)}' --json`,
    "",
    "SKILL.md program:",
    skillProgram,
  ].join("\n");
}

function parseTerminalSkillResultFrame(content) {
  const nonEmptyLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (nonEmptyLines.length < 2) {
    return { ok: false, message: "Agent CLI output did not contain a terminal SkillResult frame." };
  }

  const marker = "[Clawperator-Skill-Result]";
  const markerIndex = nonEmptyLines.lastIndexOf(marker);
  if (markerIndex === -1 || markerIndex !== nonEmptyLines.length - 2) {
    return { ok: false, message: "Agent CLI output did not end with the required terminal SkillResult frame." };
  }

  let parsed;
  try {
    parsed = JSON.parse(nonEmptyLines[markerIndex + 1]);
  } catch {
    return { ok: false, message: "Agent CLI output ended with an invalid SkillResult JSON payload." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Agent CLI output ended with a non-object SkillResult JSON payload." };
  }

  return { ok: true, framedOutput: `${marker}\n${nonEmptyLines[markerIndex + 1]}\n` };
}

async function flushLastMessage(outputPath) {
  try {
    const content = await readFile(outputPath, "utf8");
    if (content.trim().length === 0) {
      return { ok: false, message: "Agent CLI did not write any final output." };
    }
    const parsedFrame = parseTerminalSkillResultFrame(content);
    if (!parsedFrame.ok) {
      return parsedFrame;
    }
    process.stdout.write(parsedFrame.framedOutput);
    return { ok: true };
  } catch {
    return { ok: false, message: "Agent CLI did not write the final message artifact." };
  }
}

async function main() {
  if (!resolvedAgentCliPath || !skillProgramPath || !deviceId || !clawperatorBin) {
    fail(
      "Missing orchestrated skill runtime env. Run this skill through 'clawperator skills run' so the harness receives the resolved agent CLI, skill program path, selected device, and CLAWPERATOR_BIN."
    );
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
    console.error(`Failed to start agent CLI: ${error.message}`);
    if (preserveTempDir) {
      console.error(`Orchestrated skill logs retained at ${tempDir}`);
    }
    await cleanupAndExit(1);
  });

  if (Number.isInteger(configuredAgentTimeoutMs) && configuredAgentTimeoutMs > 0) {
    watchdogTimer = setTimeout(() => {
      preserveTempDir = retainLogs;
      console.error(
        `Agent CLI exceeded configured timeout ${configuredAgentTimeoutMs}ms; terminating orchestrated harness child process.`
      );
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
    const frameResult = await flushLastMessage(outputPath);

    if (signal) {
      preserveTempDir = retainLogs;
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      await cleanupAndExit(1);
      return;
    }

    if (!frameResult.ok) {
      preserveTempDir = retainLogs;
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      console.error(frameResult.message);
      await cleanupAndExit(code === 0 ? 1 : (code ?? 1));
      return;
    }

    if (retainLogs) {
      preserveTempDir = true;
      console.error(`Orchestrated skill logs retained at ${tempDir}`);
    }
    await cleanupAndExit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
