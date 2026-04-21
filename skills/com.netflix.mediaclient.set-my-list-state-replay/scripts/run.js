#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const {
  logSkillProgress,
  resolveClawperatorBin,
  resolveOperatorPackage,
} = require("../../utils/common.js");

const SKILL_ID = "com.netflix.mediaclient.set-my-list-state-replay";
const FRAME = "[Clawperator-Skill-Result]";
const CONTRACT_VERSION = "1.0.0";
const NETFLIX_APP = "com.netflix.mediaclient";
const MY_LIST_ID = "com.netflix.mediaclient:id/2131428727";
const NETFLIX_SEARCH_FIELD_ID = "android:id/search_src_text";

const CLAWPERATOR_COMMAND = resolveClawperatorBin();

function run(command, args, timeout = 120000) {
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function getInputs() {
  const candidates = [process.env.CLAWPERATOR_SKILL_INPUTS, process.env.SKILL_INPUTS];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return {};
}

function getArgValue(argv, flagName) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === flagName) {
      return argv[index + 1];
    }
    if (typeof token === "string" && token.startsWith(`${flagName}=`)) {
      return token.slice(flagName.length + 1);
    }
  }
  return undefined;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function requireInput(inputs, key) {
  const value = inputs?.[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required input: ${key}`);
  }
  return value.trim();
}

function xmlUnescape(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function runClawperator(args, timeout = 120000) {
  return run(CLAWPERATOR_COMMAND.cmd, [...CLAWPERATOR_COMMAND.args, ...args], timeout);
}

function getStepResults(parsed) {
  if (Array.isArray(parsed?.envelope?.stepResults)) {
    return parsed.envelope.stepResults;
  }
  if (Array.isArray(parsed?.envelope?.envelope?.stepResults)) {
    return parsed.envelope.envelope.stepResults;
  }
  return [];
}

function extractSnapshotText(snapshotOutput) {
  try {
    const parsed = JSON.parse(snapshotOutput);
    const snapshotStep = getStepResults(parsed).find((step) => step?.actionType === "snapshot_ui" && typeof step?.data?.text === "string");
    if (snapshotStep?.data?.text) {
      return snapshotStep.data.text;
    }
    const firstTextStep = getStepResults(parsed).find((step) => typeof step?.data?.text === "string");
    if (firstTextStep?.data?.text) {
      return firstTextStep.data.text;
    }
    return snapshotOutput;
  } catch {
    return snapshotOutput;
  }
}

function action(deviceId, operatorPackage, actions, timeoutMs = 30000) {
  const execution = {
    commandId: `${SKILL_ID}-${Date.now()}`,
    taskId: SKILL_ID,
    source: SKILL_ID,
    expectedFormat: "android-ui-automator",
    timeoutMs,
    actions,
  };
  return runClawperator(
    [
      "exec",
      "--device", deviceId,
      "--operator-package", operatorPackage,
      "--execution", JSON.stringify(execution),
      "--json",
    ],
    Math.max(timeoutMs + 10000, 40000),
  );
}

function sleep(deviceId, operatorPackage, durationMs) {
  return action(
    deviceId,
    operatorPackage,
    [{ id: "sleep", type: "sleep", params: { durationMs } }],
    Math.max(durationMs + 15000, 20000),
  );
}

function snapshot(deviceId, operatorPackage) {
  return runClawperator([
    "snapshot",
    "--device", deviceId,
    "--operator-package", operatorPackage,
    "--json",
  ]);
}

function clickId(deviceId, operatorPackage, resourceId, timeoutMs = 15000) {
  return action(
    deviceId,
    operatorPackage,
    [{ id: "click", type: "click", params: { matcher: { resourceId } } }],
    timeoutMs,
  );
}

function typeText(deviceId, operatorPackage, text, timeoutMs = 25000) {
  return action(
    deviceId,
    operatorPackage,
    [
      {
        id: "wait_for_search_input",
        type: "wait_for_node",
        params: { matcher: { resourceId: NETFLIX_SEARCH_FIELD_ID }, timeoutMs: 10000 },
      },
      { id: "focus_search", type: "click", params: { matcher: { resourceId: NETFLIX_SEARCH_FIELD_ID } } },
      {
        id: "type",
        type: "enter_text",
        params: { matcher: { resourceId: NETFLIX_SEARCH_FIELD_ID }, text, clear: true, submit: false },
      },
      { id: "settle_after_type", type: "sleep", params: { durationMs: 3500 } },
    ],
    timeoutMs,
  );
}

function isSearchSurface(snapshotText) {
  const normalized = lower(snapshotText);
  return normalized.includes(NETFLIX_SEARCH_FIELD_ID);
}

function parseBoundsFromLine(line) {
  const match = line.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!match) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

function findProfileTap(snapshotText, expectedText) {
  const xml = extractSnapshotText(snapshotText);
  const wanted = lower(expectedText).trim();
  let activeProfileBounds = null;

  for (const line of xml.split("\n")) {
    if (line.includes('resource-id="promo_profile_gate_profile"')) {
      activeProfileBounds = parseBoundsFromLine(line);
      continue;
    }

    if (!activeProfileBounds || !line.includes('text="')) continue;

    const textMatch = line.match(/text="([^"]*)"/);
    if (!textMatch) continue;

    const nodeText = lower(xmlUnescape(textMatch[1])).trim();
    if (nodeText !== wanted) continue;

    return {
      x: Math.round((activeProfileBounds.left + activeProfileBounds.right) / 2),
      y: Math.round((activeProfileBounds.top + activeProfileBounds.bottom) / 2),
    };
  }

  return null;
}

function parseCheckedState(snapshotText) {
  const xml = extractSnapshotText(snapshotText);
  const marker = `resource-id="${MY_LIST_ID}"`;
  const idx = xml.indexOf(marker);
  if (idx === -1) return "missing";
  const window = xml.slice(Math.max(0, idx - 250), idx + 500);
  if (window.includes('checked="true"')) return "on";
  if (window.includes('checked="false"')) return "off";
  return "unknown";
}

function containsTitle(snapshotText, title) {
  return lower(extractSnapshotText(snapshotText)).includes(lower(title));
}

function maybeSelectProfile(deviceId, operatorPackage, profile) {
  const snap = snapshot(deviceId, operatorPackage);
  const snapText = extractSnapshotText(snap);
  if (!lower(snapText).includes("choose your profile") && !lower(snapText).includes("promo_profile_gate_profile")) {
    return false;
  }

  const tap = findProfileTap(snapText, profile);
  if (!tap) {
    throw new Error(`Profile chooser is visible but profile ${profile} was not found`);
  }

  action(
    deviceId,
    operatorPackage,
    [
      { id: "select_profile", type: "click", params: { coordinate: { x: tap.x, y: tap.y } } },
      { id: "wait_after_profile", type: "sleep", params: { durationMs: 3000 } },
    ],
    30000,
  );
  const after = snapshot(deviceId, operatorPackage);
  if (!lower(extractSnapshotText(after)).includes("choose your profile")) {
    return true;
  }

  throw new Error(`Profile chooser is visible but profile ${profile} could not be selected`);
}

function openSearch(deviceId, operatorPackage) {
  try {
    action(
      deviceId,
      operatorPackage,
      [
        { id: "open_search_icon", type: "click", params: { matcher: { resourceId: "com.netflix.mediaclient:id/2131427347" } } },
        { id: "wait_after_search_icon", type: "sleep", params: { durationMs: 2500 } },
      ],
      25000,
    );
    const snap = extractSnapshotText(snapshot(deviceId, operatorPackage));
    if (isSearchSurface(snap)) {
      return;
    }
  } catch {}
  try {
    action(
      deviceId,
      operatorPackage,
      [
        { id: "open_search_coordinate", type: "click", params: { coordinate: { x: 1008, y: 159 } } },
        { id: "wait_after_search_coordinate", type: "sleep", params: { durationMs: 2500 } },
      ],
      25000,
    );
    const snap = extractSnapshotText(snapshot(deviceId, operatorPackage));
    if (isSearchSurface(snap)) {
      return;
    }
  } catch {}
  try {
    action(
      deviceId,
      operatorPackage,
      [
        { id: "open_search_desc", type: "click", params: { matcher: { contentDescEquals: "Search" } } },
        { id: "wait_after_search_desc", type: "sleep", params: { durationMs: 2500 } },
      ],
      25000,
    );
    return;
  } catch {}
  try {
    action(
      deviceId,
      operatorPackage,
      [
        { id: "open_search_text", type: "click", params: { matcher: { textEquals: "Search" } } },
        { id: "wait_after_search_text", type: "sleep", params: { durationMs: 2500 } },
      ],
      25000,
    );
    return;
  } catch {}
  throw new Error("Could not open Netflix Search");
}

function openTitle(deviceId, operatorPackage, title) {
  try {
    action(
      deviceId,
      operatorPackage,
      [
        { id: "open_title", type: "click", params: { matcher: { textEquals: title } } },
        { id: "wait_after_title_open", type: "sleep", params: { durationMs: 3000 } },
      ],
      30000,
    );
    return;
  } catch {
    throw new Error(`Could not open title details for ${title}`);
  }
}

function emitResult({ actionName, title, profile, desiredState, status, checkpoints, terminalVerification, hints }) {
  const result = {
    contractVersion: CONTRACT_VERSION,
    skillId: SKILL_ID,
    goal: { kind: "set_my_list_state" },
    inputs: { action: actionName, title, profile, state: desiredState },
    status,
    checkpoints,
    terminalVerification,
    diagnostics: {
      runtimeState: status === "success" ? "healthy" : "poisoned",
      hints,
    },
  };
  process.stdout.write(`${FRAME}\n${JSON.stringify(result)}\n`);
}

function parseArgs(argv) {
  const positional = [];
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (
      token === "--device" ||
      token === "--operator-package" ||
      token === "--input" ||
      token === "--action" ||
      token === "--title" ||
      token === "--profile"
    ) {
      i += 1;
      continue;
    }
    if (token === "--json") continue;
    positional.push(token);
  }

  return {
    deviceId: positional[0],
    operatorPackageArg: getArgValue(argv.slice(2), "--operator-package"),
    actionArg: getArgValue(argv.slice(2), "--action") ?? positional[1],
    titleArg: getArgValue(argv.slice(2), "--title") ?? positional[2],
    profileArg: getArgValue(argv.slice(2), "--profile") ?? positional[3],
  };
}

(function main() {
  const { deviceId, operatorPackageArg, actionArg, titleArg, profileArg } = parseArgs(process.argv);
  const inputs = getInputs();
  const operatorPackage = resolveOperatorPackage(operatorPackageArg);
  let actionName;
  let desiredState;
  let title;
  let profile;
  const checkpoints = [];
  const hints = [
    "This skill uses live Clawperator navigation from the current Netflix UI, not a human-operated recording handoff.",
    "The Search step targets Netflix's search_src_text field and relies on enter_text replacement semantics (clear=true, submit=false).",
    "Verification is based on the Netflix My List ToggleButton checked state on the title page.",
  ];

  try {
    if (!deviceId) {
      throw new Error("Usage: node run.js <device_id> [--action <add|remove>] [--title <title>] [--profile <name>] [--operator-package <pkg>]");
    }
    const actionInput = lower(actionArg ?? requireInput(inputs, "action"));
    if (actionInput !== "add" && actionInput !== "remove") {
      throw new Error("Input 'action' must be 'add' or 'remove'");
    }
    actionName = actionInput;
    desiredState = actionName === "remove" ? "off" : "on";
    title = typeof titleArg === "string" && titleArg.trim().length > 0 ? titleArg.trim() : requireInput(inputs, "title");
    profile = typeof profileArg === "string" && profileArg.trim().length > 0 ? profileArg.trim() : requireInput(inputs, "profile");

    logSkillProgress(SKILL_ID, "Opening Netflix...");
    action(
      deviceId,
      operatorPackage,
      [
        { id: "close", type: "close_app", params: { applicationId: NETFLIX_APP } },
        { id: "wait1", type: "sleep", params: { durationMs: 1500 } },
        { id: "open", type: "open_app", params: { applicationId: NETFLIX_APP } },
        { id: "wait2", type: "sleep", params: { durationMs: 5000 } },
      ],
      60000,
    );
    checkpoints.push({ id: "netflix-opened", status: "ok", note: "Opened Netflix from a fresh force-stop baseline." });

    logSkillProgress(SKILL_ID, `Selecting profile ${profile} if chooser is present...`);
    const selected = maybeSelectProfile(deviceId, operatorPackage, profile);
    checkpoints.push({
      id: "profile-selected",
      status: "ok",
      note: selected
        ? `Selected Netflix profile ${profile}.`
        : "Profile chooser did not appear, continued from current profile state.",
    });

    logSkillProgress(SKILL_ID, "Opening Search...");
    openSearch(deviceId, operatorPackage);
    checkpoints.push({ id: "search-opened", status: "ok", note: "Opened Netflix Search." });

    logSkillProgress(SKILL_ID, `Searching for ${title}...`);
    typeText(deviceId, operatorPackage, title, 30000);

    logSkillProgress(SKILL_ID, `Opening ${title} details...`);
    openTitle(deviceId, operatorPackage, title);
    const titleSnapshot = snapshot(deviceId, operatorPackage);
    if (!containsTitle(titleSnapshot, title)) {
      throw new Error(`Expected title page for ${title} was not observed`);
    }
    checkpoints.push({
      id: "title-details-opened",
      status: "ok",
      evidence: { kind: "text", text: title },
      note: `Reached the ${title} details page.`,
    });

    const currentState = parseCheckedState(titleSnapshot);
    if (currentState === "missing") {
      throw new Error("My List toggle was not found on the title page");
    }

    if (currentState !== desiredState) {
      logSkillProgress(SKILL_ID, `Setting My List to ${desiredState}...`);
      clickId(deviceId, operatorPackage, MY_LIST_ID, 15000);
      sleep(deviceId, operatorPackage, 2500);
    } else {
      logSkillProgress(SKILL_ID, `My List already ${desiredState}.`);
    }

    const finalSnapshot = snapshot(deviceId, operatorPackage);
    const finalState = parseCheckedState(finalSnapshot);
    if (finalState !== desiredState) {
      throw new Error(`Final My List verification failed, expected ${desiredState} but observed ${finalState}`);
    }

    checkpoints.push({
      id: "my-list-state-verified",
      status: "ok",
      evidence: { kind: "text", text: `${title} :: My List state=${desiredState}` },
      note: `Verified My List is ${desiredState} for ${title}.`,
    });

    console.log(`Netflix My List state for ${title}: ${desiredState}`);
    emitResult({
      actionName,
      title,
      profile,
      desiredState,
      status: "success",
      checkpoints,
      terminalVerification: {
        status: "verified",
        expected: { kind: "text", text: `${title} :: My List state=${desiredState}` },
        observed: { kind: "text", text: `${title} :: My List state=${desiredState}` },
        note: `Verified the Netflix My List toggle is ${desiredState} on the ${title} title page.`,
      },
      hints,
    });
  } catch (error) {
    checkpoints.push({ id: "run-failed", status: "failed", note: error.message });
    emitResult({
      actionName: actionName ?? (typeof actionArg === "string" ? lower(actionArg) : undefined),
      title: title ?? (typeof titleArg === "string" && titleArg.trim().length > 0 ? titleArg.trim() : undefined),
      profile: profile ?? (typeof profileArg === "string" && profileArg.trim().length > 0 ? profileArg.trim() : undefined),
      desiredState,
      status: "failed",
      checkpoints,
      terminalVerification: {
        status: "failed",
        expected: { kind: "text", text: `${title} :: My List state=${desiredState}` },
        observed: { kind: "text", text: error.message },
        note: "Skill run ended before truthful terminal verification.",
      },
      hints,
    });
    console.error(error.message);
    process.exit(1);
  }
})();
