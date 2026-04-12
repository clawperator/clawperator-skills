#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm, access } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const resolvedAgentCliPath = process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH;
const configuredAgentCli = process.env.CLAWPERATOR_SKILL_AGENT_CLI || "codex";
const configuredAgentTimeoutMs = Number.parseInt(process.env.CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS || "", 10);
const skillProgramPath = process.env.CLAWPERATOR_SKILL_PROGRAM;
const skillId = process.env.CLAWPERATOR_SKILL_ID || "com.solaxcloud.starter.set-discharge-to-limit-orchestrated";
const forwardedArgs = process.argv.slice(2);
const declaredInputs = parseJsonArray(process.env.CLAWPERATOR_SKILL_INPUTS);
const operatorPackage = process.env.CLAWPERATOR_OPERATOR_PACKAGE || "com.clawperator.operator.dev";
const skillsRegistry = process.env.CLAWPERATOR_SKILLS_REGISTRY || resolve(__dirname, "../../../skills-registry.json");
const skillsRepoRoot = resolve(__dirname, "../../..");
const clawperatorRepoRoot = resolve(skillsRepoRoot, "../clawperator");
const clawperatorBin = process.env.CLAWPERATOR_BIN || resolve(clawperatorRepoRoot, "apps/node/dist/cli/index.js");
const stableOutputPollIntervalMs = 1000;
const stableOutputGracePolls = 2;
const childShutdownGraceMs = 5000;

if (!resolvedAgentCliPath || !skillProgramPath) {
  console.error(
    "Missing orchestrated skill runtime env. Run this skill through 'clawperator skills run' so the harness receives the resolved agent CLI and SKILL.md path."
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

function resolvePercentArg(skillArgs, skillInputs) {
  const candidates = [...skillInputs, ...skillArgs];
  return candidates.find((value) => /^-?\d+$/.test(value)) || null;
}

function buildPrompt(skillProgram, rawArgs, skillInputs) {
  const { deviceId, skillArgs } = splitForwardedArgs(rawArgs);
  const serializedArgs = JSON.stringify(rawArgs);
  const serializedInputs = JSON.stringify(skillInputs);
  const percentArg = resolvePercentArg(skillArgs, skillInputs);

  return [
    `You are the runtime agent for the Clawperator skill '${skillId}'.`,
    "Follow the SKILL.md program exactly and use Clawperator as the hand.",
    "",
    "Runtime context:",
    `- Forwarded raw argv: ${serializedArgs}`,
    `- Declared skill inputs from CLAWPERATOR_SKILL_INPUTS: ${serializedInputs}`,
    `- Selected device serial: ${deviceId || "<missing>"}`,
    `- Resolved requested percent: ${percentArg || "<missing>"}`,
    `- Operator package: ${operatorPackage}`,
    `- Branch-local Clawperator CLI: node ${clawperatorBin}`,
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
    "- Always pass `--operator-package com.clawperator.operator.dev` on Clawperator commands.",
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
    `- Open app: node ${clawperatorBin} open com.solaxcloud.starter --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Open the Intelligence tab: node ${clawperatorBin} click --text "Intelligence" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Open Peak Export: node ${clawperatorBin} click --text "Peak Export" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Open Device Discharging (By percentage): node ${clawperatorBin} click --text "Device Discharging (By percentage)" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Open Discharge to row: node ${clawperatorBin} click --text-contains "Discharge to" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Snapshot: node ${clawperatorBin} snapshot --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Click by visible text: node ${clawperatorBin} click --text "<visible text>" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Type into the focused field: node ${clawperatorBin} type --text "${percentArg || "<percent>"}" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Read terminal text: node ${clawperatorBin} read --text "Discharge to ${percentArg || "<percent>"}%" --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Press back if needed: node ${clawperatorBin} press --key back --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    `- Scroll if the target row is off-screen: node ${clawperatorBin} scroll down --device ${deviceId || "<device_serial>"} --operator-package ${operatorPackage} --json`,
    "- You already know the allowed surface. Do not rediscover the CLI.",
    "",
    "Output requirements:",
    `- Use \`contractVersion: "1.0.0"\` and \`skillId: "${skillId}"\`.`,
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
    "[Clawperator-Skill-Result]",
    `{"contractVersion":"1.0.0","skillId":"${skillId}","goal":{"kind":"set_discharge_limit","percent":${percentArg || "null"}},"inputs":{"percent":${percentArg || "null"}},"status":"success","checkpoints":[{"id":"app_opened","status":"ok","note":"replace with truthful runtime evidence"},{"id":"discharge_to_row_focused","status":"ok","note":"replace with truthful runtime evidence"},{"id":"target_text_entered","status":"ok","note":"replace with truthful runtime evidence"},{"id":"save_completed","status":"ok","note":"replace with truthful runtime evidence"},{"id":"terminal_state_verified","status":"ok","note":"replace with truthful runtime evidence"}],"terminalVerification":{"status":"verified","expected":{"kind":"text","text":"Discharge to ${percentArg || "<percent>"}%"},"observed":{"kind":"text","text":"replace with truthful observed text"},"note":"replace with truthful runtime evidence"}}`,
    "",
    "SKILL.md program:",
    skillProgram,
  ].join("\n");
}

async function tryReadStableFinalMessage(outputPath, previousSample) {
  try {
    await access(outputPath);
    const content = await readFile(outputPath, "utf8");
    const trimmed = content.trim();
    if (!trimmed.startsWith("[Clawperator-Skill-Result]\n{")) {
      return { content, stableCount: 0 };
    }

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
  const { deviceId } = splitForwardedArgs(forwardedArgs);
  const skillProgram = await readFile(skillProgramPath, "utf8");
  const prompt = buildPrompt(skillProgram, forwardedArgs, declaredInputs);
  const tempDir = await mkdtemp(join(tmpdir(), "clawperator-solax-orchestrated-"));
  const outputPath = join(tempDir, "last-message.txt");
  let settled = false;
  let pollTimer = null;
  let lastStableSample = null;
  let agentWatchdogTimer = null;
  let childShutdownTimer = null;
  let shutdownRequested = false;
  let shutdownExitCode = 1;

  const child = spawn(
    resolvedAgentCliPath,
    [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
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
    ],
    {
      detached: process.platform !== "win32",
      stdio: ["pipe", "ignore", "pipe"],
      env: {
        ...process.env,
        CLAWPERATOR_BIN: clawperatorBin,
        CLAWPERATOR_DEVICE_ID: deviceId ?? "",
        CLAWPERATOR_OPERATOR_PACKAGE: operatorPackage,
        CLAWPERATOR_SKILLS_REGISTRY: skillsRegistry,
      },
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
    if (!sample.content || sample.stableCount < stableOutputGracePolls || settled) {
      return;
    }

    process.stdout.write(sample.content.endsWith("\n") ? sample.content : `${sample.content}\n`);
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
      process.stdout.write(finalMessage.endsWith("\n") ? finalMessage : `${finalMessage}\n`);
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
