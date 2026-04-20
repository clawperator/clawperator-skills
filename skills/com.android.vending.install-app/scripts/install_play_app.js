#!/usr/bin/env node
/**
 * com.android.vending.install-app
 *
 * Searches for an app in Google Play, opens the matching details page,
 * and installs it if needed.
 *
 * Usage:
 *   node install_play_app.js <device_id> <app_name> [operator_package]
 *
 * Install state detection (discovered via live exploration):
 *   - Ready to install:     content-desc="Install" present, text="Open" absent
 *   - Already installed:    text="Open" AND text="Uninstall" both present, no "Install"
 *   - In progress:          text="Cancel" present, text="Open" absent
 *   - Install complete:     text="Open" present
 *   - Update available:     text="Update" present
 *   - Paid / paywall:       price text present, no "Install"
 *   - Login required:       text="Sign in" present
 *   - Incompatible:         informational text, no Install button
 *
 * Selector notes:
 *   - No resource-ids. All selectors use text or content-desc.
 *   - Install button: contentDescEquals "Install" (node itself is clickable=false;
 *     click coordinates land on the clickable parent container)
 *   - Open button (post-install): textEquals "Open"
 *   - Uninstall (settled): textEquals "Uninstall"
 */

const { runClawperator, runClawperatorCommand, resolveOperatorPackage, logSkillProgress } = require('../../utils/common');
const {
  detectOpenWithChooser,
  detectPlayDetailsSurface,
  parseInstallSignals,
} = require('./install_play_app_parser');
const {
  mergeSearchResults,
  isSearchResultsSurface,
  normalizeWhitespace,
} = require('../../com.android.vending.search-app/scripts/search_play_store_parser');

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const rawQuery = process.argv[3] || process.env.QUERY || '';
const query = rawQuery.trim();
const operatorPkg = resolveOperatorPackage(process.argv[4]);

if (!deviceId || !query) {
  console.error('Usage: node install_play_app.js <device_id> <app_name> [operator_package]');
  process.exit(1);
}

const commandId = `skill-play-install-${Date.now()}`;
const skillId = "com.android.vending.install-app";
const MAX_SCROLLS = 3;
const SCROLL_SETTLE_DELAY_MS = 1800;

function buildSearchExecution() {
  return {
    commandId: `${commandId}-search`,
    taskId: commandId,
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

function buildScrollExecution() {
  return {
    commandId: `${commandId}-scroll-${Date.now()}`,
    taskId: commandId,
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

function buildOpenResultExecution(title) {
  return {
    commandId: `${commandId}-open-result`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 30000,
    actions: [
      {
        id: 'open-result',
        type: 'click',
        params: { matcher: { contentDescContains: title } }
      },
      { id: 'wait-detail', type: 'sleep', params: { durationMs: 3000 } },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

function pressEnterKey() {
  require('child_process').execFileSync('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '66'], {
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

function getSnapshotText(result) {
  const steps = (result && result.envelope && result.envelope.stepResults) || [];
  const snapStep = steps.find((step) => step.id === 'snap');
  return snapStep && snapStep.data ? snapStep.data.text || '' : '';
}

function pickInstallCandidate(results, appQuery) {
  const normalizedQuery = normalizeWhitespace(appQuery).toLowerCase();
  const exact = results.find((result) => normalizeWhitespace(result.title).toLowerCase() === normalizedQuery);
  if (exact) return exact;

  const startsWith = results.find((result) => normalizeWhitespace(result.title).toLowerCase().startsWith(normalizedQuery));
  if (startsWith) return startsWith;

  const contains = results.find((result) => normalizeWhitespace(result.title).toLowerCase().includes(normalizedQuery));
  if (contains) return contains;

  return null;
}

/**
 * First, take a snapshot to detect the current state.
 * This avoids clicking Install if the app is already installed or if a blocking
 * state (login, paywall) exists.
 */
function buildPreflightExecution() {
  return {
    commandId: `${commandId}-preflight`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 20000,
    actions: [
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

function buildChooserExecution() {
  return {
    commandId: `${commandId}-chooser`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 20000,
    actions: [
      {
        id: 'pick-play-store',
        type: 'click',
        params: { matcher: { textEquals: 'Google Play Store' } }
      },
      { id: 'wait-choice', type: 'sleep', params: { durationMs: 500 } },
      {
        id: 'pick-just-once',
        type: 'click',
        params: { matcher: { textEquals: 'Just once' } }
      }
    ]
  };
}

/**
 * Click Install and wait for completion.
 * Uses wait_for_node polling for text="Open" to detect completion rather than
 * a fixed sleep, since download time is unpredictable.
 *
 * Falls back to a 30-second sleep if the device is slow.
 */
function buildInstallExecution() {
  return {
    commandId,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions: [
      // Click the Install button.
      // content-desc="Install" targets the label node; the click coordinates land on
      // the clickable parent container (verified via live exploration).
      {
        id: 'click-install',
        type: 'click',
        params: { matcher: { contentDescEquals: 'Install' } }
      },
      // Wait for the "Open" button to appear, indicating install completion.
      // Polls every 3 seconds up to 120 seconds total.
      {
        id: 'wait-open',
        type: 'wait_for_node',
        params: {
          matcher: { textEquals: 'Open' },
          timeoutMs: 90000
        }
      },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

// --- Search for target app and open its details page ---

logSkillProgress(skillId, `Searching Play Store for "${query}"...`);
const { ok: searchOk, result: searchResult, error: searchError } = runClawperator(buildSearchExecution(), deviceId, operatorPkg);

if (!searchOk) {
  console.error(`Search execution failed: ${searchError}`);
  process.exit(2);
}

let searchText = getSnapshotText(searchResult);
if (!searchText) {
  console.error('Search snapshot returned empty.');
  process.exit(2);
}

if (!isSearchResultsSurface(searchText)) {
  logSkillProgress(skillId, 'Typed search remained on suggestions. Sending Enter key...');
  pressEnterKey();
  const retry = captureDirectSnapshot(5000);
  if (!retry.ok) {
    console.error(`Follow-up snapshot after Enter fallback failed: ${retry.error}`);
    process.exit(2);
  }
  searchText = retry.text;
}

if (!isSearchResultsSurface(searchText)) {
  console.error('BLOCKED: no-search-results - Search did not reach a readable Play results surface.');
  process.exit(2);
}

const searchSnapshots = [searchText];
for (let scrollIndex = 0; scrollIndex < MAX_SCROLLS; scrollIndex += 1) {
  const collected = mergeSearchResults(searchSnapshots);
  if (pickInstallCandidate(collected, query)) {
    break;
  }

  const { ok: scrollOk } = runClawperator(buildScrollExecution(), deviceId, operatorPkg);
  if (!scrollOk) {
    break;
  }
  const snap = captureDirectSnapshot(1500);
  if (!snap.ok) {
    break;
  }
  const scrolledText = snap.text;
  if (!scrolledText || !isSearchResultsSurface(scrolledText)) {
    break;
  }
  searchSnapshots.push(scrolledText);
}

const mergedResults = mergeSearchResults(searchSnapshots);
const candidate = pickInstallCandidate(mergedResults, query);
if (!candidate) {
  console.error(`BLOCKED: app-not-found - No Play search result matched "${query}".`);
  process.exit(2);
}

logSkillProgress(skillId, `Opening Play details for "${candidate.title}"...`);
const { ok: openOk, result: openResult, error: openError } = runClawperator(buildOpenResultExecution(candidate.title), deviceId, operatorPkg);
if (!openOk) {
  console.error(`Failed to open Play result "${candidate.title}": ${openError}`);
  process.exit(3);
}

let prefText = getSnapshotText(openResult);
if (detectOpenWithChooser(prefText)) {
  logSkillProgress(skillId, 'Open-with chooser detected; selecting Google Play Store...');
  const { ok, error } = runClawperator(buildChooserExecution(), deviceId, operatorPkg);
  if (!ok) {
    console.error(`Open-with chooser handling failed: ${error}`);
    process.exit(3);
  }

  const { ok: retryOk, result: retryResult, error: retryError } = runClawperator(buildPreflightExecution(), deviceId, operatorPkg);
  if (!retryOk) {
    console.error(`Follow-up preflight after chooser handling failed: ${retryError}`);
    process.exit(3);
  }
  prefText = getSnapshotText(retryResult);
}

if (!detectPlayDetailsSurface(prefText)) {
  console.error('BLOCKED: not-details-page - Search did not land on a Play app details page.');
  process.exit(7);
}

const {
  hasInstall,
  hasOpen,
  hasUninstall,
  hasUpdate,
  hasCancel,
  hasSignIn,
  hasPriceText,
} = parseInstallSignals(prefText);

// Handle blocking states
if (hasSignIn) {
  console.error('BLOCKED: Login required. Please sign in to Google Play on the device.');
  process.exit(4);
}

if (hasUpdate) {
  logSkillProgress(skillId, "Update available; proceeding with install flow...");
  // Fall through to install execution (Update button uses same flow as Install)
}

if (hasOpen && hasUninstall && !hasInstall) {
  console.log('✅ Already installed. Nothing to do.');
  process.exit(0);
}

if (hasOpen && hasCancel) {
  logSkillProgress(skillId, "Install already in progress; waiting for Open button...");
  // Could wait_for_node here; simplified version: just snap the final state
  const waitExec = {
    commandId: `${commandId}-wait`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions: [
      {
        id: 'wait-open',
        type: 'wait_for_node',
        params: { matcher: { textEquals: 'Open' }, timeoutMs: 110000 }
      },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
  const { ok, result, error } = runClawperator(waitExec, deviceId, operatorPkg);
  if (!ok) {
    console.error(`Wait for completion failed: ${error}`);
    process.exit(5);
  }
  console.log('✅ Install completed (was already in progress).');
  process.exit(0);
}

if (!hasInstall && !hasUpdate) {
  if (hasPriceText) {
    console.error('BLOCKED: paid-app - This app requires purchase. Cannot install without payment.');
    process.exit(6);
  }

  console.error('BLOCKED: no-install-button - Install button not found. Device may not be on app details page.');
  process.exit(7);
}

// --- Execute install ---

const installExec = buildInstallExecution();
logSkillProgress(skillId, "Installing from Play Store details page...");
logSkillProgress(skillId, "Waiting for Open button...");
const { ok, result, error } = runClawperator(installExec, deviceId, operatorPkg);

if (!ok) {
  console.error(`Install execution failed: ${error}`);
  process.exit(8);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === 'snap');
const snapText = snapStep && snapStep.data ? snapStep.data.text : '';

// Verify final state
let finalHasOpen = false;
let finalHasUninstall = false;
if (snapText) {
  const finalSignals = parseInstallSignals(snapText);
  finalHasOpen = finalSignals.hasOpen;
  finalHasUninstall = finalSignals.hasUninstall;
}

if (finalHasOpen) {
  logSkillProgress(skillId, "Verifying installation result...");
  const state = finalHasUninstall ? 'installed (settled)' : 'installed (transition)';
  if (!finalHasUninstall) {
    console.log('Uninstall button not yet visible - this is normal immediately after install.');
  }
  console.log(`✅ App installed. State: ${state}`);
} else {
  console.error('WARNING: Install may have failed. "Open" button not found in final snapshot.');
  process.exit(9);
}
