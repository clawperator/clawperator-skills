#!/usr/bin/env node

const { execFileSync } = require('child_process');
const { runClawperator, runClawperatorCommand, resolveOperatorPackage, logSkillProgress } = require('../../utils/common');
const { mergeSearchResults, isSearchResultsSurface } = require('./search_play_store_parser');

const SKILL_RESULT_FRAME_PREFIX = '[Clawperator-Skill-Result]';
const SKILL_RESULT_CONTRACT_VERSION = '1.0.0';
const MAX_QUERY_LENGTH = 256;
const MAX_SCROLLS = 3;
const SCROLL_SETTLE_DELAY_MS = 1800;
const skillId = "com.android.vending.search-app";

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const rawQuery = process.argv[3] || process.env.QUERY || '';
const query = rawQuery.trim();
const operatorPkg = resolveOperatorPackage(process.argv[4]);
const packageId = process.argv[5] || process.env.PACKAGE_ID || '';

if (!deviceId || !query) {
  console.error('Usage: node search_play_store.js <device_id> <query> [operator_package] [package_id]');
  process.exit(1);
}

if (query.length > MAX_QUERY_LENGTH) {
  console.error(`Query too long (max ${MAX_QUERY_LENGTH})`);
  process.exit(1);
}

function buildSearchExecution() {
  return {
    commandId: `skill-play-search-${Date.now()}`,
    taskId: `skill-play-search-${Date.now()}`,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 90000,
    actions: [
      { id: 'close', type: 'close_app', params: { applicationId: 'com.android.vending' } },
      { id: 'wait-close', type: 'sleep', params: { durationMs: 1500 } },
      { id: 'open', type: 'open_app', params: { applicationId: 'com.android.vending' } },
      { id: 'wait-open', type: 'sleep', params: { durationMs: 4000 } },
      { id: 'click-search-tab', type: 'click', params: { matcher: { textEquals: 'Search' } } },
      { id: 'wait-search-tab', type: 'sleep', params: { durationMs: 1000 } },
      { id: 'click-search-bar', type: 'click', params: { matcher: { contentDescEquals: 'Search Google Play' } } },
      { id: 'wait-bar', type: 'sleep', params: { durationMs: 500 } },
      {
        id: 'enter-query',
        type: 'enter_text',
        params: { matcher: { role: 'textfield' }, text: query, submit: true }
      },
      { id: 'wait-results', type: 'sleep', params: { durationMs: 6000 } },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

function buildSnapshotExecution(waitMs = 0) {
  const actions = [];
  if (waitMs > 0) {
    actions.push({ id: 'wait', type: 'sleep', params: { durationMs: waitMs } });
  }
  actions.push({ id: 'snap', type: 'snapshot_ui' });

  return {
    commandId: `skill-play-search-snapshot-${Date.now()}`,
    taskId: `skill-play-search-snapshot-${Date.now()}`,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 30000,
    actions,
  };
}

function buildScrollExecution() {
  return {
    commandId: `skill-play-search-scroll-${Date.now()}`,
    taskId: `skill-play-search-scroll-${Date.now()}`,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 30000,
    actions: [
      {
        id: 'scroll',
        type: 'scroll',
        params: { direction: 'down', settleDelayMs: SCROLL_SETTLE_DELAY_MS }
      }
    ]
  };
}

function pressEnterKey() {
  execFileSync('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '66'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function sleepMs(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function captureDirectSnapshot(waitMs = 0) {
  if (waitMs > 0) {
    sleepMs(waitMs);
  }

  const outcome = runClawperatorCommand('snapshot', [
    '--device',
    deviceId,
    '--operator-package',
    operatorPkg,
    '--json'
  ], { encoding: 'utf8' });

  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }

  try {
    const parsed = JSON.parse(outcome.result);
    const steps = (parsed && parsed.envelope && parsed.envelope.stepResults) || [];
    const snapStep = steps.find((step) => step.id === 'snap');
    return {
      ok: true,
      text: snapStep && snapStep.data ? snapStep.data.text || '' : '',
    };
  } catch (error) {
    return { ok: false, error: `Failed to parse direct snapshot output: ${error.message}` };
  }
}

function writeSkillResult(payload) {
  console.log(SKILL_RESULT_FRAME_PREFIX);
  console.log(JSON.stringify(payload));
}

function buildSkillResult({ status, checkpoints, terminalVerification, diagnostics, results }) {
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: 'search_apps'
    },
    inputs: {
      query,
      packageId: packageId || null,
    },
    status,
    checkpoints,
    terminalVerification,
    diagnostics,
    results,
  };
}

function emitFailureAndExit(message, checkpoints, diagnostics = {}) {
  writeSkillResult(buildSkillResult({
    status: 'failed',
    checkpoints,
    terminalVerification: {
      status: 'failed',
      expected: {
        kind: 'text',
        text: 'Readable Play Store search results'
      },
      observed: {
        kind: 'text',
        text: message
      },
      note: message
    },
    diagnostics,
    results: []
  }));
  console.error(message);
  process.exit(2);
}

logSkillProgress(skillId, `Searching Play Store for "${query}"...`);
const checkpoints = [];
const execution = buildSearchExecution();
const { ok, result, error } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  checkpoints.push({
    id: 'search_results_opened',
    status: 'failed',
    note: 'Play Store search execution failed before a readable results snapshot was captured.'
  });
  emitFailureAndExit(`Search execution failed: ${error}`, checkpoints, {
    path: 'in-app search',
  });
}

checkpoints.push({
  id: 'search_results_opened',
  status: 'ok',
  note: 'Submitted the Play Store query and captured the results surface.'
});

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find((step) => step.id === 'snap');
let snapText = snapStep && snapStep.data ? snapStep.data.text : '';
const snapshotSeries = [];

if (!snapText) {
  checkpoints.push({
    id: 'results_collected',
    status: 'failed',
    note: 'No terminal Play Store snapshot text was returned.'
  });
  emitFailureAndExit('No search-results snapshot returned from Play Store.', checkpoints);
}

if (snapText.includes('Sign in') || snapText.includes('Choose an account')) {
  checkpoints.push({
    id: 'results_collected',
    status: 'failed',
    note: 'Google Play surfaced a login or account-picker requirement instead of search results.'
  });
  emitFailureAndExit('Login required. Please sign in to Google Play on the device.', checkpoints);
}

if (!isSearchResultsSurface(snapText)) {
  logSkillProgress(skillId, 'Typed search remained on suggestions. Sending Enter key to reach results...');
  try {
    pressEnterKey();
  } catch (error) {
    checkpoints.push({
      id: 'results_collected',
      status: 'failed',
      note: 'Failed to submit the Play Store query with an Enter key fallback.'
    });
    emitFailureAndExit(`Failed to submit Play Store search with Enter key: ${error.message}`, checkpoints);
  }

  const retry = captureDirectSnapshot(5000);
  if (!retry.ok) {
    checkpoints.push({
      id: 'results_collected',
      status: 'failed',
      note: 'Enter-key fallback ran, but the follow-up direct snapshot failed.'
    });
    emitFailureAndExit(`Play Store follow-up snapshot failed after Enter fallback: ${retry.error}`, checkpoints);
  }
  snapText = retry.text;
}

if (!isSearchResultsSurface(snapText)) {
  checkpoints.push({
    id: 'results_collected',
    status: 'failed',
    note: 'Terminal snapshot still did not look like a readable Play Store search-results surface after Enter fallback.'
  });
  emitFailureAndExit('Play Store search did not reach a readable results surface.', checkpoints);
}

snapshotSeries.push(snapText);
logSkillProgress(skillId, `Reached Play Store results. Collecting additional rows with up to ${MAX_SCROLLS} scrolls...`);

for (let scrollIndex = 0; scrollIndex < MAX_SCROLLS; scrollIndex += 1) {
  const collected = mergeSearchResults(snapshotSeries);
  if (collected.length >= 5) {
    break;
  }

  const scrolled = runClawperator(buildScrollExecution(), deviceId, operatorPkg);
  if (!scrolled.ok) {
    break;
  }
  const scrolledSnapshot = captureDirectSnapshot(1200);
  if (!scrolledSnapshot.ok) {
    break;
  }
  const scrolledText = scrolledSnapshot.text;
  if (!scrolledText || !isSearchResultsSurface(scrolledText)) {
    break;
  }
  snapshotSeries.push(scrolledText);
}

const results = mergeSearchResults(snapshotSeries);
if (results.length === 0) {
  checkpoints.push({
    id: 'results_collected',
    status: 'failed',
    note: 'The results surface was visible, but no structured app rows were parsed.'
  });
  emitFailureAndExit('Play Store results were visible but no structured app rows were parsed.', checkpoints);
}

checkpoints.push({
  id: 'results_collected',
  status: 'ok',
  evidence: {
    kind: 'json',
    value: {
      resultCount: results.length,
      snapshotsCollected: snapshotSeries.length
    }
  },
  note: 'Parsed and merged Play Store app rows from the visible and scrolled search results surfaces.'
});

console.log(`✅ Play Store search results for '${query}':`);
for (const [index, resultRow] of results.entries()) {
  const sponsoredLabel = resultRow.sponsored ? ' [sponsored]' : '';
  const installLabel = resultRow.installState !== 'unknown' ? ` (${resultRow.installState})` : '';
  console.log(`${index + 1}. ${resultRow.title} — ${resultRow.developer || resultRow.secondaryText || 'Unknown details'}${sponsoredLabel}${installLabel}`);
}

writeSkillResult(buildSkillResult({
  status: 'success',
  checkpoints,
  terminalVerification: {
    status: 'verified',
    expected: {
      kind: 'text',
      text: 'Readable Play Store search results with structured app rows'
    },
    observed: {
      kind: 'json',
      value: results
    },
    note: 'Structured app rows were extracted from the visible Play Store search-results surface.'
  },
  diagnostics: {
    path: 'in-app search',
    ignoredPackageId: packageId || null,
  },
  results,
}));
