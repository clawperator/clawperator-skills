#!/usr/bin/env node
const { runClawperator, runClawperatorCommand, findAttribute, resolveOperatorPackage, logSkillProgress } = require('../../utils/common');

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const personName = process.argv[3] || process.env.PERSON_NAME;
const screenshotPath = process.argv[4] || process.env.SCREENSHOT_PATH;
const operatorPkg = resolveOperatorPackage(process.argv[5]);
const requestedPersonName = (personName || "").trim();
const skillId = "com.life360.android.safetymapd.get-location";
const FRAME = "[Clawperator-Skill-Result]";
const CONTRACT_VERSION = "1.0.0";

function writeFramed(payload) {
  console.log(FRAME);
  console.log(JSON.stringify(payload));
}

function failFramed(message, { checkpointNote = message } = {}) {
  logSkillProgress(skillId, message);
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_person_location" },
    inputs: { person: requestedPersonName || null, screenshot: Boolean(screenshotPath) },
    result: null,
    status: "failed",
    checkpoints: [{ id: "location_read", status: "failed", note: checkpointNote }],
    terminalVerification: {
      status: "failed",
      expected: { kind: "text", text: "Life360 member place and battery from detail snapshot" },
      observed: { kind: "text", text: message },
      note: message,
    },
    diagnostics: { runtimeState: "unknown" },
  });
  console.error(`⚠️ ${message}`);
}

if (!deviceId || !personName) {
  console.error('Usage: node get_life360_location.js <device_id> <person_name> [screenshot_path] [operator_package]');
  process.exit(1);
}

function normalizeForMatch(value) {
  return (value || "").trim().toLowerCase();
}

function findVisibleLabel(snapshotText, desiredName) {
  const target = normalizeForMatch(desiredName);
  if (!target || !snapshotText) return null;

  for (const line of snapshotText.split('\n')) {
    const text = findAttribute(line, 'text');
    if (!text) continue;
    if (normalizeForMatch(text) === target) {
      return text;
    }
  }

  return null;
}

function hasBlockingOverlay(snapshotText) {
  if (!snapshotText) return false;
  return snapshotText.includes('tooltipClose') || snapshotText.includes('Upgrade to a Premium membership');
}

const commandId = `skill-life360-location-${Date.now()}`;
function buildProbeExecution(scrollCount, dismissOverlay) {
  const actions = [
    { id: 'close', type: 'close_app', params: { applicationId: 'com.life360.android.safetymapd' } },
    { id: 'wait_close', type: 'sleep', params: { durationMs: 1500 } },
    { id: 'open', type: 'open_app', params: { applicationId: 'com.life360.android.safetymapd' } },
    { id: 'wait_open', type: 'sleep', params: { durationMs: 8000 } },
    { id: 'snap_0', type: 'snapshot' }
  ];

  if (dismissOverlay) {
    actions.push(
      { id: 'dismiss_overlay', type: 'click', params: { matcher: { resourceId: 'com.life360.android.safetymapd:id/tooltipClose' } } },
      { id: 'wait_overlay', type: 'sleep', params: { durationMs: 1000 } },
      { id: 'snap_overlay', type: 'snapshot' }
    );
  }

  for (let i = 0; i < scrollCount; i += 1) {
    actions.push({ id: `scroll_${i + 1}`, type: 'scroll', params: { direction: 'down', settleDelayMs: 1200 } });
    actions.push({ id: `snap_${i + 1}`, type: 'snapshot' });
  }

  return {
    commandId: `${commandId}-probe-${scrollCount}`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions
  };
}

function buildSelectExecution(scrollCount, exactName, dismissOverlay) {
  const actions = [
    { id: 'close', type: 'close_app', params: { applicationId: 'com.life360.android.safetymapd' } },
    { id: 'wait_close', type: 'sleep', params: { durationMs: 1500 } },
    { id: 'open', type: 'open_app', params: { applicationId: 'com.life360.android.safetymapd' } },
    { id: 'wait_open', type: 'sleep', params: { durationMs: 8000 } }
  ];

  if (dismissOverlay) {
    actions.push(
      { id: 'dismiss_overlay', type: 'click', params: { matcher: { resourceId: 'com.life360.android.safetymapd:id/tooltipClose' } } },
      { id: 'wait_overlay', type: 'sleep', params: { durationMs: 1000 } }
    );
  }

  for (let i = 0; i < scrollCount; i += 1) {
    actions.push({ id: `scroll_${i + 1}`, type: 'scroll', params: { direction: 'down', settleDelayMs: 1200 } });
  }

  actions.push(
    { id: 'click-person', type: 'click', params: { matcher: { textEquals: exactName } } },
    { id: 'wait_detail', type: 'sleep', params: { durationMs: 3000 } },
    { id: 'snap', type: 'snapshot' }
  );

  return {
    commandId: `${commandId}-select-${scrollCount}`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions
  };
}

function parseSnapshotSteps(result) {
  return (result.envelope && result.envelope.stepResults) || [];
}

function extractSnapshotText(stepResults, stepId) {
  const step = stepResults.find((s) => s.id === stepId);
  return step && step.data ? step.data.text : null;
}

function extractReadingFromSnapshot(snapText) {
  const lines = snapText.split('\n');
  let battery = 'unknown';
  let place = 'unknown';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Battery %: TextView sibling immediately after the battery icon ImageView
    // (content-desc is "Battery low", "Battery medium", "Battery full", etc.)
    if (line.includes('content-desc="Battery') && line.includes('ImageView')) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const txt = findAttribute(lines[j], 'text');
        if (txt && txt.includes('%')) {
          battery = txt;
          break;
        }
      }
    }

    // Place: the TextView immediately preceding the "Since <time>" label
    const txt = findAttribute(line, 'text');
    if (txt && txt.startsWith('Since ')) {
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const prevTxt = findAttribute(lines[j], 'text');
        if (prevTxt && prevTxt.length > 0 && !prevTxt.includes('%')) {
          place = prevTxt;
          break;
        }
      }
    }
  }

  return { battery, place };
}

function probeForVisibleName(maxScrolls) {
  logSkillProgress(skillId, "Opening Life360...");
  const initialProbe = runClawperator(buildProbeExecution(0, false), deviceId, operatorPkg);
  if (!initialProbe.ok) {
    failFramed(String(initialProbe.error || "initial probe failed"));
    process.exit(2);
  }

  const initialSteps = parseSnapshotSteps(initialProbe.result);
  const initialSnapText = extractSnapshotText(initialSteps, 'snap_0');
  const dismissOverlay = hasBlockingOverlay(initialSnapText);
  const initialResolvedName = findVisibleLabel(initialSnapText, requestedPersonName);
  if (initialResolvedName) {
    return { resolvedName: initialResolvedName, scrollCount: 0, dismissOverlay };
  }

  logSkillProgress(skillId, `Searching for ${requestedPersonName}...`);
  const probeRun = runClawperator(buildProbeExecution(maxScrolls, dismissOverlay), deviceId, operatorPkg);
  if (!probeRun.ok) {
    failFramed(String(probeRun.error || "scroll probe failed"));
    process.exit(2);
  }

  const stepResults = parseSnapshotSteps(probeRun.result);
  const firstSnapshotId = dismissOverlay ? 'snap_overlay' : 'snap_0';
  const firstSnapshotText = extractSnapshotText(stepResults, firstSnapshotId);
  const firstResolvedName = findVisibleLabel(firstSnapshotText, requestedPersonName);
  if (firstResolvedName) {
    return { resolvedName: firstResolvedName, scrollCount: 0, dismissOverlay };
  }

  for (let i = 1; i <= maxScrolls; i += 1) {
    const snapText = extractSnapshotText(stepResults, `snap_${i}`);
    const resolvedName = findVisibleLabel(snapText, requestedPersonName);
    if (resolvedName) {
      return { resolvedName, scrollCount: i, dismissOverlay };
    }
  }

  return { resolvedName: null, scrollCount: maxScrolls, dismissOverlay };
}

const MAX_SCROLLS = 6;
const searchResult = probeForVisibleName(MAX_SCROLLS);
if (!searchResult.resolvedName) {
  failFramed(
    `Could not find a visible Life360 member matching "${requestedPersonName}"`,
    { checkpointNote: "Member not visible after scroll probe." }
  );
  process.exit(2);
}

const selectRun = runClawperator(
  buildSelectExecution(searchResult.scrollCount, searchResult.resolvedName, searchResult.dismissOverlay),
  deviceId,
  operatorPkg
);

if (!selectRun.ok) {
  failFramed(String(selectRun.error || "select execution failed"));
  process.exit(2);
}

const stepResults = parseSnapshotSteps(selectRun.result);
const snapText = extractSnapshotText(stepResults, 'snap');

if (snapText) {
  logSkillProgress(skillId, "Capturing location snapshot...");
  if (screenshotPath) {
    logSkillProgress(skillId, "Capturing screenshot...");
    const screenshotResult = runClawperatorCommand("screenshot", [
      "--device", deviceId,
      "--operator-package", operatorPkg,
      "--path", screenshotPath
    ]);
    if (!screenshotResult.ok) {
      failFramed(String(screenshotResult.error || "screenshot failed"));
      process.exit(2);
    }
    console.log(`SCREENSHOT|path=${screenshotPath}`);
  }
  logSkillProgress(skillId, "Parsing location data...");
  const { battery, place } = extractReadingFromSnapshot(snapText);
  console.log(`✅ Life360 location for ${searchResult.resolvedName}: place=${place}, battery=${battery}`);
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: "read_person_location" },
    inputs: { person: searchResult.resolvedName, screenshot: Boolean(screenshotPath) },
    result: {
      kind: "json",
      value: {
        person: searchResult.resolvedName,
        place,
        battery,
      },
    },
    status: "success",
    checkpoints: [
      { id: "member_opened", status: "ok", note: `Opened detail for ${searchResult.resolvedName}.` },
      { id: "location_read", status: "ok", note: "Parsed place and battery lines from the detail snapshot." },
    ],
    terminalVerification: {
      status: "verified",
      expected: { kind: "text", text: "Non-unknown place and battery when visible" },
      observed: { kind: "json", value: { place, battery } },
      note: "Heuristic parse from the Life360 detail snapshot text.",
    },
    diagnostics: { runtimeState: "healthy" },
  });
} else {
  failFramed("Could not capture Life360 location snapshot", { checkpointNote: "snap step had no text." });
  process.exit(2);
}
