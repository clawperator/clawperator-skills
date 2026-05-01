#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const SKILL_ID = "au.com.polyaire.airtouch5.set-home-controls";

function parseArgs(argv) {
  const parsed = {
    deviceId: "",
    registry: resolve(__dirname, "../skills/skills-registry.json"),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--device" && argv[index + 1]) {
      parsed.deviceId = argv[index + 1];
      index += 1;
    } else if (token === "--registry" && argv[index + 1]) {
      parsed.registry = argv[index + 1];
      index += 1;
    } else if (!parsed.deviceId && !token.startsWith("--")) {
      parsed.deviceId = token;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

function usage() {
  return [
    "Usage: scripts/validate_airtouch_home_controls_live.js --device <device_serial> [--registry <path>]",
    "",
    "Runs the live AirTouch Home-controls transition proof on a connected device.",
  ].join("\n");
}

function runSkill({ deviceId, registry, request }) {
  const args = [
    "skills",
    "run",
    SKILL_ID,
    "--device",
    deviceId,
  ];

  if (request.state) args.push("--state", request.state);
  if (request.mode) args.push("--mode", request.mode);
  if (request.fan_level) args.push("--fan-level", request.fan_level);

  const run = spawnSync("clawperator", args, {
    encoding: "utf-8",
    env: {
      ...process.env,
      CLAWPERATOR_SKILLS_REGISTRY: registry,
    },
    maxBuffer: 1024 * 1024 * 8,
  });

  const stdout = String(run.stdout || "").trim();
  let payload = null;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Could not parse clawperator JSON output: ${error.message}\n${stdout}`);
  }

  if (run.status !== 0 || payload.status === "failed") {
    const note = payload.skillResult?.checkpoints?.at(-1)?.note || payload.message || "skill failed";
    throw new Error(`Skill command failed: ${note}`);
  }

  return payload.skillResult || payload;
}

function assertTransitionResult(name, skillResult, expected, { requireNoPowerTap = true } = {}) {
  if (skillResult.status !== "success") {
    throw new Error(`${name}: expected success, got ${skillResult.status}`);
  }

  const observed = skillResult.result?.value?.final || {};
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) {
      throw new Error(`${name}: expected final ${key}=${value}, observed ${observed[key] || "unknown"}`);
    }
  }

  const powerCheckpoint = skillResult.checkpoints?.find((checkpoint) => checkpoint.id === "power_action_applied");
  if (requireNoPowerTap && (!powerCheckpoint || !String(powerCheckpoint.note || "").startsWith("No tap was needed"))) {
    throw new Error(`${name}: expected no power tap, observed ${powerCheckpoint?.note || "missing power checkpoint"}`);
  }

  const terminalStatus = skillResult.terminalVerification?.status;
  if (terminalStatus !== "verified") {
    throw new Error(`${name}: expected terminal verification, got ${terminalStatus || "missing"}`);
  }
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed.deviceId) {
    console.error(usage());
    return 2;
  }

  const transitions = [
    {
      name: "Precondition to Fan/Medium",
      request: { state: "on", mode: "fan", fan_level: "medium" },
      expected: { state: "on", mode: "fan", fan_level: "medium" },
      requireNoPowerTap: false,
    },
    {
      name: "Fan/on -> Cool/High",
      request: { state: "on", mode: "cool", fan_level: "high" },
      expected: { state: "on", mode: "cool", fan_level: "high" },
      requireNoPowerTap: true,
    },
    {
      name: "Cool/High -> Dry",
      request: { state: "on", mode: "dry" },
      expected: { state: "on", mode: "dry" },
      requireNoPowerTap: true,
    },
    {
      name: "Dry -> Cool/High",
      request: { state: "on", mode: "cool", fan_level: "high" },
      expected: { state: "on", mode: "cool", fan_level: "high" },
      requireNoPowerTap: true,
    },
    {
      name: "Cool/High -> Fan/Medium",
      request: { state: "on", mode: "fan", fan_level: "medium" },
      expected: { state: "on", mode: "fan", fan_level: "medium" },
      requireNoPowerTap: true,
    },
    {
      name: "Return to Cool/High",
      request: { state: "on", mode: "cool", fan_level: "high" },
      expected: { state: "on", mode: "cool", fan_level: "high" },
      requireNoPowerTap: true,
    },
  ];

  console.log(`Using registry: ${parsed.registry}`);
  console.log(`Running ${transitions.length} live AirTouch transition checks on selected device.`);

  for (const transition of transitions) {
    process.stdout.write(`- ${transition.name} ... `);
    const skillResult = runSkill({
      deviceId: parsed.deviceId,
      registry: parsed.registry,
      request: transition.request,
    });

    assertTransitionResult(transition.name, skillResult, transition.expected, {
      requireNoPowerTap: transition.requireNoPowerTap,
    });

    console.log("ok");
  }

  console.log("Live AirTouch Home-controls validation passed.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
