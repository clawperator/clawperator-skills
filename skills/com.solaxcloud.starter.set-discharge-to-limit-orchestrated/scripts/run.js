#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { extname } = require("node:path");

const resolvedAgentCliPath = process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH;
const skillProgramPath = process.env.CLAWPERATOR_SKILL_PROGRAM;
const forwardedArgs = process.argv.slice(2);

if (!resolvedAgentCliPath || !skillProgramPath) {
  console.error(
    "Missing orchestrated skill runtime env. Run this skill through 'clawperator skills run' so the harness receives the resolved agent CLI and SKILL.md path."
  );
  process.exit(1);
}

const launchViaNode = extname(resolvedAgentCliPath) === ".js";
const child = spawn(
  launchViaNode ? process.execPath : resolvedAgentCliPath,
  launchViaNode ? [resolvedAgentCliPath, skillProgramPath, ...forwardedArgs] : [skillProgramPath, ...forwardedArgs],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  }
);

child.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk);
});

child.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  console.error(`Failed to start agent CLI: ${error.message}`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
