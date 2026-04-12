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
      { id: "close", type: "close_app", params: { applicationId: "com.solaxcloud.starter" } },
      { id: "wait_close", type: "sleep", params: { durationMs: 1500 } },
      { id: "open", type: "open_app", params: { applicationId: "com.solaxcloud.starter" } },
      {
        id: "wait_home",
        type: "wait_for_node",
        params: {
          matcher: { resourceId: "com.solaxcloud.starter:id/tab_intelligent" },
          timeoutMs: 20000,
        },
      },
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
    "Run the bootstrap command below first, then continue with the rest of the known-good route from SKILL.md.",
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
    "- You already have the route and selectors you need in this prompt. Do not search the repo for examples.",
    "",
    "Bootstrap command to run first:",
    `${clawperatorBin} exec --device ${deviceId} --operator-package ${operatorPackage} --execution '${JSON.stringify(bootstrapExecution)}' --json`,
    "",
    "SKILL.md program:",
    skillProgram,
  ].join("\n");
}

async function flushLastMessage(outputPath) {
  try {
    const content = await readFile(outputPath, "utf8");
    if (content.trim().length > 0) {
      process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
      return true;
    }
  } catch {
    return false;
  }
  return false;
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
    const framePresent = await flushLastMessage(outputPath);

    if (signal) {
      preserveTempDir = retainLogs;
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      await cleanupAndExit(1);
      return;
    }

    if (!framePresent) {
      preserveTempDir = retainLogs || true;
      if (preserveTempDir) {
        console.error(`Orchestrated skill logs retained at ${tempDir}`);
      }
      console.error("Agent CLI exited without writing a final SkillResult frame.");
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
