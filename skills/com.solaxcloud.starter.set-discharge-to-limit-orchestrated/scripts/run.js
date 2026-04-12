#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm, access } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const FRAME_PREFIX = "[Clawperator-Skill-Result]";
const CONTRACT_VERSION = "1.0.0";
const resolvedAgentCliPath = process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH;
const configuredAgentCli = process.env.CLAWPERATOR_SKILL_AGENT_CLI || "codex";
const enableSandboxBypass = process.env.CLAWPERATOR_SKILL_AGENT_ALLOW_BYPASS === "1";
const configuredAgentTimeoutMs = Number.parseInt(process.env.CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS || "", 10);
const skillProgramPath = process.env.CLAWPERATOR_SKILL_PROGRAM;
const skillId = process.env.CLAWPERATOR_SKILL_ID || "com.solaxcloud.starter.set-discharge-to-limit-orchestrated";
const forwardedArgs = process.argv.slice(2);
const declaredInputs = parseJsonArray(process.env.CLAWPERATOR_SKILL_INPUTS);
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator.dev";
const skillsRegistry = process.env.CLAWPERATOR_SKILLS_REGISTRY || resolve(__dirname, "../../../skills-registry.json");
const skillsRepoRoot = resolve(__dirname, "../../..");
const clawperatorRepoRoot = resolve(skillsRepoRoot, "../clawperator");
const clawperatorBinCommand = process.env.CLAWPERATOR_BIN || `${process.execPath} ${resolve(clawperatorRepoRoot, "apps/node/dist/cli/index.js")}`;
const stableOutputPollIntervalMs = 1000;
const stableOutputGracePolls = 2;
const childShutdownGraceMs = 5000;
const CHECKPOINT_IDS = [
  "app_opened",
  "discharge_to_row_focused",
  "target_text_entered",
  "save_completed",
  "terminal_state_verified",
];
const SAFE_ENV_KEYS = [
  "ALL_PROXY",
  "CI",
  "CODEX_HOME",
  "COLORTERM",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "NO_PROXY",
  "OPENAI_API_BASE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
  "PATH",
  "SHELL",
  "SSH_AUTH_SOCK",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
];

if (!resolvedAgentCliPath || !skillProgramPath) {
  console.error(
    "Missing orchestrated skill runtime env. Run this skill through 'clawperator skills run' so the harness receives the resolved agent CLI and skill program path."
  );
  process.exit(1);
}

function parseJsonArray(rawValue) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

function splitForwardedArgs(rawArgs) {
  const [deviceId, ...skillArgs] = rawArgs;
  return {
    deviceId: deviceId || null,
    skillArgs,
  };
}

function parsePercentInput(rawArgs, skillInputs) {
  const { deviceId, skillArgs } = splitForwardedArgs(rawArgs);

  if (!deviceId) {
    return { ok: false, message: "Missing device_id. Expected argv shape: <device_id> <percent>." };
  }

  if (skillArgs.length !== 1) {
    return {
      ok: false,
      message: `Expected exactly one positional skill arg after device_id, got ${skillArgs.length}.`,
    };
  }

  const percentArg = skillArgs[0];
  if (!/^\d+$/.test(percentArg)) {
    return {
      ok: false,
      message: `Invalid percent '${percentArg}'. Expected an integer from 0 to 100.`,
    };
  }

  const percent = Number.parseInt(percentArg, 10);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return {
      ok: false,
      message: `Invalid percent '${percentArg}'. Expected an integer from 0 to 100.`,
    };
  }

  if (skillInputs.length > 0 && JSON.stringify(skillInputs) !== JSON.stringify(rawArgs)) {
    return {
      ok: false,
      message: `Declared inputs ${JSON.stringify(skillInputs)} did not match forwarded argv ${JSON.stringify(rawArgs)}.`,
    };
  }

  return {
    ok: true,
    deviceId,
    percentArg,
    percent,
  };
}

function buildFailureSkillResult(message, percentArg = null) {
  const parsedPercent = percentArg !== null && /^\d+$/.test(percentArg) ? Number.parseInt(percentArg, 10) : null;
  return {
    contractVersion: CONTRACT_VERSION,
    skillId,
    ...(parsedPercent !== null ? {
      goal: { kind: "set_discharge_limit", percent: parsedPercent },
      inputs: { percent: parsedPercent },
    } : {}),
    status: "failed",
    checkpoints: CHECKPOINT_IDS.map((id) => ({ id, status: "skipped" })),
    terminalVerification: {
      status: "not_run",
      note: message,
    },
    diagnostics: {
      runtimeState: "unavailable",
      warnings: [message],
    },
  };
}

async function emitSkillResultFrame(result) {
  const payload = JSON.stringify(result);
  process.stdout.write(`${FRAME_PREFIX}\n${payload}\n`);
}

function parseFinalSkillResultFrame(content) {
  const nonEmptyLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length !== 2) {
    return { ok: false, message: `Expected exactly 2 non-empty lines in final output, got ${nonEmptyLines.length}.` };
  }

  if (nonEmptyLines[0] !== FRAME_PREFIX) {
    return { ok: false, message: "Final output must start with exactly one SkillResult frame marker." };
  }

  if (!nonEmptyLines[1].startsWith("{")) {
    return { ok: false, message: "SkillResult frame marker must be followed by one JSON object line." };
  }

  let parsed;
  try {
    parsed = JSON.parse(nonEmptyLines[1]);
  } catch (error) {
    return { ok: false, message: `SkillResult JSON was invalid: ${error.message}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "SkillResult payload must be a JSON object." };
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "source")) {
    return { ok: false, message: "SkillResult payload must not include source." };
  }

  if (parsed.contractVersion !== CONTRACT_VERSION || parsed.skillId !== skillId) {
    return { ok: false, message: "SkillResult payload contractVersion or skillId did not match the expected runtime values." };
  }

  if (!Array.isArray(parsed.checkpoints)) {
    return { ok: false, message: "SkillResult payload must include checkpoints." };
  }

  return { ok: true, content: `${FRAME_PREFIX}\n${nonEmptyLines[1]}\n` };
}

function buildAgentEnv(deviceId) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  env.CLAWPERATOR_BIN = clawperatorBinCommand;
  env.CLAWPERATOR_DEVICE_ID = deviceId ?? "";
  env.CLAWPERATOR_OPERATOR_PACKAGE = operatorPackage;
  env.CLAWPERATOR_SKILLS_REGISTRY = skillsRegistry;
  return env;
}

function buildPrompt(skillProgram, runtimeContext) {
  const { rawArgs, skillInputs, deviceId, percentArg } = runtimeContext;
  const serializedArgs = JSON.stringify(rawArgs);
  const serializedInputs = JSON.stringify(skillInputs);

  return [
    `You are the runtime agent for the Clawperator skill '${skillId}'.`,
    "Follow the SKILL.md program exactly and use Clawperator as the hand.",
    "",
    "Runtime context:",
    `- Forwarded raw argv: ${serializedArgs}`,
    `- Declared skill inputs from CLAWPERATOR_SKILL_INPUTS: ${serializedInputs}`,
    `- Selected device serial: ${deviceId}`,
    `- Resolved requested percent: ${percentArg}`,
    `- Operator package: ${operatorPackage}`,
    `- Branch-local Clawperator CLI command: ${clawperatorBinCommand}`,
    `- Skills registry: ${skillsRegistry}`,
    "",
    "Hard rules:",
    "- Do not edit files.",
    "- This is a live device run, not a coding task.",
    "- Do not inspect or modify the repository unless a command is required to operate the device.",
    "- Do not run `--help`, `rg`, `grep`, `find`, `git`, or other repo-inspection commands.",
    "- Do not call the replay skill.",
    "- Use only branch-local Clawperator commands for device interaction.",
    "- Always target the selected device serial shown above.",
    `- Always pass \`--operator-package ${operatorPackage}\` on Clawperator commands.`,
    "- Use the flat Clawperator commands directly instead of building JSON execution files.",
    "- Prefer `open`, `snapshot`, `click`, `type`, `read`, `press`, `scroll`, and `wait` command forms.",
    "- Follow the recorded Solax path exactly instead of exploring the app.",
    "- The only allowed bottom-tab navigation is to `Intelligence`.",
    "- Do not visit unrelated bottom tabs or sections such as `Device` or `Service`.",
    "- Keep the run focused on the minimum actions needed to complete and verify the skill.",
    "- The final response must contain exactly two lines:",
    "  1. [Clawperator-Skill-Result]",
    "  2. one single-line JSON object matching the SkillResult frame",
    "- Do not wrap the final response in markdown fences.",
    "- Do not include `source` in the JSON.",
    "- Emit the final frame immediately after the terminal verification conclusion is reached.",
    "- If you fail before terminal verification, emit a truthful failed or indeterminate SkillResult instead of prose.",
    "",
    "Execution plan:",
    "1. Treat the resolved requested percent above as the skill input to parse.",
    "2. If parsing fails, emit a failed SkillResult immediately.",
    "3. Operate SolaX Cloud with Clawperator only.",
    "4. Use this exact route: Intelligence -> Peak Export -> Device Discharging (By percentage) -> Discharge to ... -> Confirm -> toolbar Save -> lower Save.",
    "5. If this route is unavailable after one close-and-reopen retry, emit a failed or indeterminate result instead of exploring other tabs.",
    "6. Record only these checkpoints, in this order when reached: app_opened, discharge_to_row_focused, target_text_entered, save_completed, terminal_state_verified.",
    "7. After save, verify whether the post-save UI contains exactly `Discharge to <percent>%`.",
    "8. As soon as that verification is success, failed, or indeterminate, emit the final frame and stop.",
    "",
    "Known command forms:",
    `- Open app: ${clawperatorBinCommand} open com.solaxcloud.starter --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Open the Intelligence tab: ${clawperatorBinCommand} click --text "Intelligence" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Open Peak Export: ${clawperatorBinCommand} click --text "Peak Export" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Open Device Discharging (By percentage): ${clawperatorBinCommand} click --text "Device Discharging (By percentage)" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Open Discharge to row: ${clawperatorBinCommand} click --text-contains "Discharge to" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Snapshot: ${clawperatorBinCommand} snapshot --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Click by visible text: ${clawperatorBinCommand} click --text "<visible text>" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Type into the focused field: ${clawperatorBinCommand} type --text "${percentArg}" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Read terminal text: ${clawperatorBinCommand} read --text "Discharge to ${percentArg}%" --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Press back if needed: ${clawperatorBinCommand} press --key back --device ${deviceId} --operator-package ${operatorPackage} --json`,
    `- Scroll if the target row is off-screen: ${clawperatorBinCommand} scroll down --device ${deviceId} --operator-package ${operatorPackage} --json`,
    "- You already know the allowed surface. Do not rediscover the CLI.",
    "",
    "Output requirements:",
    `- Use \`contractVersion: "${CONTRACT_VERSION}"\` and \`skillId: "${skillId}"\`.`,
    '- `status: "success"` only if the post-save UI proves `Discharge to <percent>%`.',
    '- `status: "failed"` if a concrete failure occurs or the post-save UI proves a different value.',
    '- `status: "indeterminate"` only if the run ends without proof either way.',
    '- Use terminalVerification.status only from: "verified", "failed", "not_run".',
    '- Every checkpoint object must include both `id` and `status`.',
    '- Use checkpoint.status only from: "ok", "failed", "skipped".',
    '- On the success path, all reached checkpoints should be emitted with `status: "ok"`.',
    "- Include concise checkpoint notes and terminalVerification evidence.",
    "- Do not emit any prose after the frame.",
    "",
    "Frame template:",
    FRAME_PREFIX,
    `{"contractVersion":"${CONTRACT_VERSION}","skillId":"${skillId}","goal":{"kind":"set_discharge_limit","percent":${percentArg}},"inputs":{"percent":${percentArg}},"status":"success","checkpoints":[{"id":"app_opened","status":"ok","note":"replace with truthful runtime evidence"},{"id":"discharge_to_row_focused","status":"ok","note":"replace with truthful runtime evidence"},{"id":"target_text_entered","status":"ok","note":"replace with truthful runtime evidence"},{"id":"save_completed","status":"ok","note":"replace with truthful runtime evidence"},{"id":"terminal_state_verified","status":"ok","note":"replace with truthful runtime evidence"}],"terminalVerification":{"status":"verified","expected":{"kind":"text","text":"Discharge to ${percentArg}%"},"observed":{"kind":"text","text":"replace with truthful observed text"},"note":"replace with truthful runtime evidence"}}`,
    "",
    "SKILL.md program:",
    skillProgram,
  ].join("\n");
}

async function tryReadStableFinalMessage(outputPath, previousSample) {
  try {
    await access(outputPath);
    const content = await readFile(outputPath, "utf8");
    if (previousSample && previousSample.content === content) {
      return {
        content,
        stableCount: previousSample.stableCount + 1,
      };
    }

    return { content, stableCount: 1 };
  } catch {
    return { content: null, stableCount: 0 };
  }
}

async function main() {
  const parsedInputs = parsePercentInput(forwardedArgs, declaredInputs);
  if (!parsedInputs.ok) {
    await emitSkillResultFrame(buildFailureSkillResult(parsedInputs.message, null));
    process.exit(1);
  }

  const { deviceId, percentArg } = parsedInputs;
  const skillProgram = await readFile(skillProgramPath, "utf8");
  const prompt = buildPrompt(skillProgram, {
    rawArgs: forwardedArgs,
    skillInputs: declaredInputs,
    deviceId,
    percentArg,
  });
  const tempDir = await mkdtemp(join(tmpdir(), "clawperator-solax-orchestrated-"));
  const outputPath = join(tempDir, "last-message.txt");
  const agentExecArgs = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-C",
    skillsRepoRoot,
    "--add-dir",
    clawperatorRepoRoot,
    "-o",
    outputPath,
    "-",
  ];
  if (enableSandboxBypass) {
    agentExecArgs.splice(1, 0, "--dangerously-bypass-approvals-and-sandbox");
  }
  let settled = false;
  let pollTimer = null;
  let lastStableSample = null;
  let agentWatchdogTimer = null;
  let childShutdownTimer = null;
  let shutdownRequested = false;
  let shutdownExitCode = 1;
  let frameEmitted = false;

  const child = spawn(
    resolvedAgentCliPath,
    agentExecArgs,
    {
      detached: process.platform !== "win32",
      stdio: ["pipe", "ignore", "pipe"],
      env: buildAgentEnv(deviceId),
    }
  );

  child.stdin.write(prompt);
  child.stdin.end();

  const terminateAgentChild = (signal = "SIGTERM") => {
    if (child.killed || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    try {
      if (process.platform !== "win32" && typeof child.pid === "number") {
        process.kill(-child.pid, signal);
        return;
      }
    } catch {
      // Fall through to direct child kill when process-group termination is unavailable.
    }

    child.kill(signal);
  };

  const cleanupAndExit = async (code) => {
    if (settled) {
      return;
    }
    settled = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (agentWatchdogTimer) {
      clearTimeout(agentWatchdogTimer);
      agentWatchdogTimer = null;
    }
    if (childShutdownTimer) {
      clearTimeout(childShutdownTimer);
      childShutdownTimer = null;
    }
    await rm(tempDir, { recursive: true, force: true });
    process.exit(code);
  };

  const beginChildShutdown = (exitCode) => {
    if (settled || shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    shutdownExitCode = exitCode;
    terminateAgentChild("SIGTERM");
    childShutdownTimer = setTimeout(() => {
      terminateAgentChild("SIGKILL");
      void cleanupAndExit(exitCode);
    }, childShutdownGraceMs);
  };

  const emitStableOutputIfReady = async () => {
    const sample = await tryReadStableFinalMessage(outputPath, lastStableSample);
    lastStableSample = sample;
    if (!sample.content || sample.stableCount < stableOutputGracePolls || settled || frameEmitted) {
      return;
    }

    const parsedFrame = parseFinalSkillResultFrame(sample.content);
    if (!parsedFrame.ok) {
      process.stderr.write(`Invalid final agent message: ${parsedFrame.message}\n`);
      beginChildShutdown(1);
      return;
    }

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    frameEmitted = true;
    process.stdout.write(parsedFrame.content);
    beginChildShutdown(0);
  };

  pollTimer = setInterval(() => {
    emitStableOutputIfReady().catch(async (error) => {
      console.error(`Failed to monitor final agent message: ${error.message}`);
      await cleanupAndExit(1);
    });
  }, stableOutputPollIntervalMs);

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  if (Number.isInteger(configuredAgentTimeoutMs) && configuredAgentTimeoutMs > 0) {
    agentWatchdogTimer = setTimeout(() => {
      process.stderr.write(
        `Agent CLI '${configuredAgentCli}' exceeded configured timeout ${configuredAgentTimeoutMs}ms; terminating child process.\n`
      );
      beginChildShutdown(1);
    }, configuredAgentTimeoutMs + stableOutputPollIntervalMs);
  }

  const handleTerminationSignal = (signalName) => {
    process.stderr.write(`Received ${signalName}; terminating orchestrated skill harness.\n`);
    beginChildShutdown(1);
  };

  process.once("SIGTERM", () => handleTerminationSignal("SIGTERM"));
  process.once("SIGINT", () => handleTerminationSignal("SIGINT"));

  child.on("error", async (error) => {
    console.error(`Failed to start agent CLI '${configuredAgentCli}': ${error.message}`);
    await cleanupAndExit(1);
  });

  child.on("close", async (code, signal) => {
    try {
      if (settled) {
        return;
      }

      if (shutdownRequested) {
        await cleanupAndExit(shutdownExitCode);
        return;
      }

      if (signal) {
        await cleanupAndExit(1);
        return;
      }

      if (code !== 0) {
        await cleanupAndExit(code ?? 1);
        return;
      }

      const finalMessage = await readFile(outputPath, "utf8");
      if (!frameEmitted) {
        const parsedFrame = parseFinalSkillResultFrame(finalMessage);
        if (!parsedFrame.ok) {
          console.error(`Failed to validate final agent message: ${parsedFrame.message}`);
          await cleanupAndExit(1);
          return;
        }
        frameEmitted = true;
        process.stdout.write(parsedFrame.content);
      }
      await cleanupAndExit(0);
    } catch (error) {
      console.error(`Failed to read final agent message: ${error.message}`);
      await cleanupAndExit(1);
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
