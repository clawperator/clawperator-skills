#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const SKILL_ID = 'com.netflix.mediaclient.set-my-list-state-replay';
const FRAME = '[Clawperator-Skill-Result]';
const CONTRACT_VERSION = '1.0.0';
const NETFLIX_APP = 'com.netflix.mediaclient';
const MY_LIST_ID = 'com.netflix.mediaclient:id/2131428727';

function run(command, args, timeout = 120000) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function getInputs() {
  const candidates = [process.env.CLAWPERATOR_SKILL_INPUTS, process.env.SKILL_INPUTS];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return {};
}

function getString(inputs, key, fallback = '') {
  const value = inputs?.[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function lower(value) {
  return String(value || '').toLowerCase();
}

function action(deviceId, operatorPackage, actions, timeoutMs = 30000) {
  const execution = {
    commandId: `${SKILL_ID}-${Date.now()}`,
    taskId: SKILL_ID,
    source: SKILL_ID,
    expectedFormat: 'android-ui-automator',
    timeoutMs,
    actions,
  };
  return run('clawperator', [
    'exec',
    '--device', deviceId,
    '--operator-package', operatorPackage,
    '--execution', JSON.stringify(execution),
    '--json',
  ], Math.max(timeoutMs + 10000, 40000));
}

function sleep(deviceId, operatorPackage, durationMs) {
  return action(deviceId, operatorPackage, [{ id: 'sleep', type: 'sleep', params: { durationMs } }], durationMs + 5000);
}

function snapshot(deviceId) {
  return run('clawperator', ['snapshot', '--device', deviceId, '--output', 'json']);
}

function clickText(deviceId, operatorPackage, text, timeoutMs = 15000) {
  return action(deviceId, operatorPackage, [{ id: 'click', type: 'click', params: { text } }], timeoutMs);
}

function clickPoint(deviceId, operatorPackage, x, y, timeoutMs = 15000) {
  return action(deviceId, operatorPackage, [{ id: 'click', type: 'click', params: { x, y } }], timeoutMs);
}

function clickDesc(deviceId, operatorPackage, contentDescription, timeoutMs = 15000) {
  return action(deviceId, operatorPackage, [{ id: 'click', type: 'click', params: { contentDescription } }], timeoutMs);
}

function clickId(deviceId, operatorPackage, resourceId, timeoutMs = 15000) {
  return action(deviceId, operatorPackage, [{ id: 'click', type: 'click', params: { resourceId } }], timeoutMs);
}

function typeText(deviceId, operatorPackage, text, timeoutMs = 15000) {
  return action(deviceId, operatorPackage, [{ id: 'type', type: 'enter_text', params: { text, submit: false } }], timeoutMs);
}

function parseCheckedState(snapshotText) {
  const marker = `resource-id="${MY_LIST_ID}"`;
  const idx = snapshotText.indexOf(marker);
  if (idx === -1) return 'missing';
  const window = snapshotText.slice(Math.max(0, idx - 250), idx + 500);
  if (window.includes('checked="true"')) return 'on';
  if (window.includes('checked="false"')) return 'off';
  return 'unknown';
}

function containsTitle(snapshotText, title) {
  return lower(snapshotText).includes(lower(title));
}

function maybeSelectProfile(deviceId, operatorPackage, profile) {
  const snap = snapshot(deviceId);
  if (!lower(snap).includes('choose your profile')) return false;
  const raw = String(snap);
  const wanted = lower(profile);
  const lowered = raw.toLowerCase();
  let anchor = lowered.indexOf(`text=\"${wanted}\"`);
  if (anchor === -1) {
    anchor = lowered.indexOf(`content-desc=\"1 of 6 items. ${wanted}.\"`);
  }
  if (anchor === -1) {
    anchor = lowered.indexOf(wanted);
  }
  if (anchor === -1) {
    throw new Error(`Profile chooser is visible but profile ${profile} was not present`);
  }

  const before = raw.slice(0, anchor);
  let cardStart = before.lastIndexOf('resource-id="promo_profile_gate_profile"');
  if (cardStart === -1) {
    cardStart = before.lastIndexOf('resource-id=\"promo_profile_gate_profile\"');
  }
  if (cardStart === -1) {
    cardStart = before.lastIndexOf('promo_profile_gate_profile');
  }
  if (cardStart === -1) {
    throw new Error(`Profile chooser is visible but profile ${profile} card could not be resolved`);
  }

  const chunk = raw.slice(cardStart, anchor + 800);
  const boundsMatch = chunk.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!boundsMatch) {
    throw new Error(`Profile chooser is visible but profile ${profile} bounds could not be resolved`);
  }

  const left = Number(boundsMatch[1]);
  const top = Number(boundsMatch[2]);
  const right = Number(boundsMatch[3]);
  const bottom = Number(boundsMatch[4]);
  const x = Math.round((left + right) / 2);
  const y = Math.round((top + bottom) / 2);

  clickPoint(deviceId, operatorPackage, x, y);
  sleep(deviceId, operatorPackage, 2500);
  const after = snapshot(deviceId);
  if (!lower(after).includes('choose your profile')) {
    return true;
  }

  throw new Error(`Profile chooser is visible but profile ${profile} could not be selected`);
}

function openSearch(deviceId, operatorPackage) {
  try {
    clickDesc(deviceId, operatorPackage, 'Search');
    sleep(deviceId, operatorPackage, 2500);
    return;
  } catch {}
  try {
    clickText(deviceId, operatorPackage, 'Search');
    sleep(deviceId, operatorPackage, 2500);
    return;
  } catch {}
  throw new Error('Could not open Netflix Search');
}

function openTitle(deviceId, operatorPackage, title) {
  try {
    clickText(deviceId, operatorPackage, title, 20000);
    sleep(deviceId, operatorPackage, 3000);
    return;
  } catch {
    throw new Error(`Could not open title details for ${title}`);
  }
}

function emitResult({ actionName, title, profile, desiredState, status, checkpoints, terminalVerification, hints }) {
  const result = {
    contractVersion: CONTRACT_VERSION,
    skillId: SKILL_ID,
    goal: { kind: 'set_my_list_state' },
    inputs: { action: actionName, title, profile, state: desiredState },
    status,
    checkpoints,
    terminalVerification,
    diagnostics: {
      runtimeState: status === 'success' ? 'healthy' : 'poisoned',
      hints,
    },
  };
  process.stdout.write(`${FRAME}\n${JSON.stringify(result)}\n`);
}

(function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--device' || token === '--operator-package' || token === '--input') {
      i += 1;
      continue;
    }
    if (token === '--json') continue;
    positional.push(token);
  }

  const [deviceId, operatorPackageArg] = positional;
  if (!deviceId) {
    console.error('Usage: node run.js <device_id> [operator_package]');
    process.exit(1);
  }

  const operatorPackage = operatorPackageArg || process.env.CLAWPERATOR_OPERATOR_PACKAGE || 'com.clawperator.operator.dev';
  const inputs = getInputs();
  const actionName = lower(getString(inputs, 'action', 'add')) === 'remove' ? 'remove' : 'add';
  const desiredState = actionName === 'remove' ? 'off' : 'on';
  const title = getString(inputs, 'title', 'House of Cards');
  const profile = getString(inputs, 'profile', 'Chris');
  const checkpoints = [];
  const hints = [
    'This skill uses live Clawperator navigation from the current Netflix UI, not a human-operated recording handoff.',
    'Verification is based on the Netflix My List ToggleButton checked state on the title page.',
  ];

  try {
    console.log(`[skill:${SKILL_ID}] Opening Netflix...`);
    action(deviceId, operatorPackage, [
      { id: 'close', type: 'close_app', params: { applicationId: NETFLIX_APP } },
      { id: 'wait1', type: 'sleep', params: { durationMs: 1500 } },
      { id: 'open', type: 'open_app', params: { applicationId: NETFLIX_APP } },
      { id: 'wait2', type: 'sleep', params: { durationMs: 5000 } },
    ], 60000);
    checkpoints.push({ id: 'netflix-opened', status: 'ok', note: 'Opened Netflix from a fresh force-stop baseline.' });

    console.log(`[skill:${SKILL_ID}] Selecting profile ${profile} if chooser is present...`);
    const selected = maybeSelectProfile(deviceId, operatorPackage, profile);
    checkpoints.push({ id: 'profile-selected', status: 'ok', note: selected ? `Selected Netflix profile ${profile}.` : 'Profile chooser did not appear, continued from current profile state.' });

    console.log(`[skill:${SKILL_ID}] Opening Search...`);
    openSearch(deviceId, operatorPackage);
    checkpoints.push({ id: 'search-opened', status: 'ok', note: 'Opened Netflix Search.' });

    console.log(`[skill:${SKILL_ID}] Searching for ${title}...`);
    typeText(deviceId, operatorPackage, title, 20000);
    sleep(deviceId, operatorPackage, 3500);

    console.log(`[skill:${SKILL_ID}] Opening ${title} details...`);
    openTitle(deviceId, operatorPackage, title);
    const titleSnapshot = snapshot(deviceId);
    if (!containsTitle(titleSnapshot, title)) {
      throw new Error(`Expected title page for ${title} was not observed`);
    }
    checkpoints.push({ id: 'title-details-opened', status: 'ok', evidence: { kind: 'text', text: title }, note: `Reached the ${title} details page.` });

    let currentState = parseCheckedState(titleSnapshot);
    if (currentState === 'missing') {
      throw new Error('My List toggle was not found on the title page');
    }

    if (currentState !== desiredState) {
      console.log(`[skill:${SKILL_ID}] Setting My List to ${desiredState}...`);
      clickId(deviceId, operatorPackage, MY_LIST_ID, 15000);
      sleep(deviceId, operatorPackage, 2500);
    } else {
      console.log(`[skill:${SKILL_ID}] My List already ${desiredState}.`);
    }

    const finalSnapshot = snapshot(deviceId);
    const finalState = parseCheckedState(finalSnapshot);
    if (finalState !== desiredState) {
      throw new Error(`Final My List verification failed, expected ${desiredState} but observed ${finalState}`);
    }

    checkpoints.push({
      id: 'my-list-state-verified',
      status: 'ok',
      evidence: { kind: 'text', text: `${title} :: My List state=${desiredState}` },
      note: `Verified My List is ${desiredState} for ${title}.`,
    });

    console.log(`Netflix My List state for ${title}: ${desiredState}`);
    emitResult({
      actionName,
      title,
      profile,
      desiredState,
      status: 'success',
      checkpoints,
      terminalVerification: {
        status: 'verified',
        expected: { kind: 'text', text: `${title} :: My List state=${desiredState}` },
        observed: { kind: 'text', text: `${title} :: My List state=${desiredState}` },
        note: `Verified the Netflix My List toggle is ${desiredState} on the ${title} title page.`,
      },
      hints,
    });
  } catch (error) {
    checkpoints.push({ id: 'run-failed', status: 'failed', note: error.message });
    emitResult({
      actionName,
      title,
      profile,
      desiredState,
      status: 'failed',
      checkpoints,
      terminalVerification: {
        status: 'failed',
        expected: { kind: 'text', text: `${title} :: My List state=${desiredState}` },
        observed: { kind: 'text', text: error.message },
        note: 'Skill run ended before truthful terminal verification.',
      },
      hints,
    });
    console.error(error.message);
    process.exit(1);
  }
})();
