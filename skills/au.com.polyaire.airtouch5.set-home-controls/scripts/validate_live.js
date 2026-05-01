#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const { resolveClawperatorBin } = require("../../utils/common.js");

const SKILL_ID = "au.com.polyaire.airtouch5.set-home-controls";

function parseArgs(argv) {
  const parsed = {
    deviceId: "",
    registry: resolve(__dirname, "../../skills-registry.json"),
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
    "Usage: skills/au.com.polyaire.airtouch5.set-home-controls/scripts/validate_live.js --device <device_serial> [--registry <path>]",
    "",
    "Runs the live AirTouch Home-controls transition proof on a connected device.",
  ].join("\n");
}

function sanitizePreview(value, maxLength = 1000) {
  const text = String(value || "")
    .replace(/--device\s+\S+/g, "--device <device_serial>")
    .replace(/(\bdevice(?:Id)?=)\S+/gi, "$1<device_serial>")
    .replace(/\/Users\/[^/\s]+/g, "/Users/<local_user>")
    .replace(/\/var\/folders\/\S+/g, "<tmp_path>")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function isRetriableRuntimeFailure(skillResult) {
  if (!skillResult || skillResult.status !== "failed") {
    return false;
  }
  const checkpoints = skillResult.checkpoints || [];
  const lastCheckpoint = checkpoints.at(-1);
  const mutatingActionStarted = checkpoints.some((checkpoint) => {
    const id = String(checkpoint.id || "");
    if (id.endsWith("mutation_started")) {
      return true;
    }
    if (id === "mode_action_applied" || id === "fan_level_action_applied") {
      return true;
    }
    if (id === "power_action_applied") {
      return !String(checkpoint.note || "").startsWith("No tap was needed");
    }
    return false;
  });
  return lastCheckpoint?.id === "runtime_execution" && !mutatingActionStarted;
}

function runSkillOnce({ deviceId, registry, request }) {
  const args = [
    "skills",
    "run",
    SKILL_ID,
    "--device",
    deviceId,
    "--timeout",
    "300000",
  ];

  if (request.state) args.push("--state", request.state);
  if (request.mode) args.push("--mode", request.mode);
  if (request.fan_level) args.push("--fan-level", request.fan_level);

  const clawperatorBin = resolveClawperatorBin();
  const run = spawnSync(clawperatorBin.cmd, [...clawperatorBin.args, ...args], {
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
    throw new Error(`Could not parse clawperator JSON output: ${error.message}; stdout=${sanitizePreview(stdout)}`);
  }

  if (run.status !== 0 || payload.status === "failed") {
    return {
      ok: false,
      skillResult: payload.skillResult || null,
      note: sanitizePreview(payload.skillResult?.checkpoints?.at(-1)?.note || payload.message || "skill failed"),
    };
  }

  return {
    ok: true,
    skillResult: payload.skillResult || payload,
  };
}

function runSkill({ deviceId, registry, request }) {
  const maxAttempts = 4;
  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runSkillOnce({ deviceId, registry, request });
    if (result.ok) {
      return result.skillResult;
    }

    lastFailure = result;
    if (attempt < maxAttempts && isRetriableRuntimeFailure(result.skillResult)) {
      process.stdout.write("retrying transient runtime failure ... ");
      continue;
    }
    break;
  }

  throw new Error(`Skill command failed: ${sanitizePreview(lastFailure?.note || "skill failed")}`);
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

  console.log(`Using registry: ${sanitizePreview(parsed.registry)}`);
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
