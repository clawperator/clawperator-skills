#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
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
  return [
    `You are the runtime agent for the Clawperator skill '${skillId}'.`,
    "Follow the attached SKILL.md exactly.",
    "Do not edit repository files.",
    "",
    "Runtime context:",
    `- Forwarded raw argv: ${JSON.stringify(forwardedArgs)}`,
    `- Declared skill inputs from CLAWPERATOR_SKILL_INPUTS: ${skillInputs}`,
    `- Selected device serial: ${deviceId}`,
    `- Clawperator CLI command: ${clawperatorBin}`,
    `- Operator package: ${operatorPackage}`,
    `- Skills registry: ${skillsRegistry || "(not set)"}`,
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
  const tempDir = await mkdtemp(join(tmpdir(), "clawperator-solax-orchestrated-"));
  const outputPath = join(tempDir, "last-message.txt");

  let settled = false;
  let watchdogTimer = null;

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
      "-C",
      skillsRepoRoot,
      "-o",
      outputPath,
      "-",
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["pipe", "ignore", "pipe"],
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
    await rm(tempDir, { recursive: true, force: true });
    process.exit(code);
  };

  process.once("SIGTERM", () => terminateChild("SIGTERM"));
  process.once("SIGINT", () => terminateChild("SIGINT"));

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  child.on("error", async (error) => {
    console.error(`Failed to start agent CLI: ${error.message}`);
    await cleanupAndExit(1);
  });

  if (Number.isInteger(configuredAgentTimeoutMs) && configuredAgentTimeoutMs > 0) {
    watchdogTimer = setTimeout(() => {
      console.error(
        `Agent CLI exceeded configured timeout ${configuredAgentTimeoutMs}ms; terminating orchestrated harness child process.`
      );
      terminateChild("SIGTERM");
      setTimeout(() => terminateChild("SIGKILL"), 5000);
    }, configuredAgentTimeoutMs);
  }

  child.stdin.write(prompt);
  child.stdin.end();

  child.on("close", async (code, signal) => {
    const framePresent = await flushLastMessage(outputPath);

    if (signal) {
      await cleanupAndExit(1);
      return;
    }

    if (!framePresent) {
      console.error("Agent CLI exited without writing a final SkillResult frame.");
      await cleanupAndExit(code === 0 ? 1 : (code ?? 1));
      return;
    }

    await cleanupAndExit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
