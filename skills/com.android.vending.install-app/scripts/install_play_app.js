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

const SKILL_RESULT_FRAME_PREFIX = '[Clawperator-Skill-Result]';
const SKILL_RESULT_CONTRACT_VERSION = '1.0.0';
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
const SEARCH_RESULTS_POLL_TIMEOUT_MS = 12000;
const SEARCH_RESULTS_POLL_INTERVAL_MS = 500;
const DETAILS_POLL_TIMEOUT_MS = 12000;
const DETAILS_POLL_INTERVAL_MS = 500;
const SEARCH_SUBMIT_ATTEMPTS = 3;
const INSTALL_POLL_INTERVAL_MS = 1000;
const INSTALL_POLL_TIMEOUT_MS = 120000;
const checkpoints = [];

function writeSkillResult(payload) {
  console.log(SKILL_RESULT_FRAME_PREFIX);
  console.log(JSON.stringify(payload));
}

function buildSkillResult({ status, terminalVerification, diagnostics = {}, result = null }) {
  const evidenceResult =
    result === null || result === undefined
      ? null
      : result && typeof result === 'object' && typeof result.kind === 'string'
        ? result
        : { kind: 'json', value: result };
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: 'install_app'
    },
    inputs: {
      query,
    },
    result: evidenceResult,
    status,
    checkpoints,
    terminalVerification,
    diagnostics,
  };
}

function emitFailureAndExit(message, exitCode, diagnostics = {}, result = null) {
  writeSkillResult(buildSkillResult({
    status: 'failed',
    terminalVerification: {
      status: 'failed',
      expected: {
        kind: 'text',
        text: 'Installed or already-installed Play Store app state'
      },
      observed: {
        kind: 'text',
        text: message
      },
      note: message
    },
    diagnostics,
    result,
  }));
  console.error(message);
  process.exit(exitCode);
}

function emitSuccessAndExit(summary, result) {
  console.log(summary);
  writeSkillResult(buildSkillResult({
    status: 'success',
    terminalVerification: {
      status: 'verified',
      expected: {
        kind: 'text',
        text: 'Play Store details page shows an installed state'
      },
      observed: {
        kind: 'text',
        text: summary
      },
      note: summary
    },
    diagnostics: {
      path: 'search -> results -> details -> install'
    },
    result,
  }));
  process.exit(0);
}

function buildSearchExecution() {
  return {
    commandId: `${commandId}-search`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 90000,
    actions: [
      { id: 'close', type: 'close_app', params: { applicationId: 'com.android.vending' } },
      { id: 'open', type: 'open_app', params: { applicationId: 'com.android.vending' } },
      { id: 'wait-open', type: 'wait_for_node', params: { matcher: { textEquals: 'Search' }, timeoutMs: 15000 } },
      { id: 'click-search-tab', type: 'click', params: { matcher: { textEquals: 'Search' } } },
      { id: 'wait-search-bar', type: 'wait_for_node', params: { matcher: { contentDescEquals: 'Search Google Play' }, timeoutMs: 15000 } },
      { id: 'click-search-bar', type: 'click', params: { matcher: { contentDescEquals: 'Search Google Play' } } },
      { id: 'wait-query-field', type: 'wait_for_node', params: { matcher: { role: 'textfield' }, timeoutMs: 10000 } },
      {
        id: 'enter-query',
        type: 'enter_text',
        params: { matcher: { role: 'textfield' }, text: query, submit: true }
      },
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
        params: { direction: 'down' }
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
    ]
  };
}

function buildSubmitSearchSuggestionExecution() {
  return {
    commandId: `${commandId}-submit-suggestion-${Date.now()}`,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 30000,
    actions: [
      {
        id: 'submit-suggestion',
        type: 'click',
        params: { matcher: { contentDescContains: `Search for '${query}'` } }
      },
    ]
  };
}

function pressEnterKey() {
  require('child_process').execFileSync('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '66'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function captureDirectSnapshot() {
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
    const snapStep = steps.find((step) => step && step.actionType === 'snapshot')
      || steps.find((step) => step && step.data && typeof step.data.text === 'string');
    return {
      ok: true,
      text: snapStep && snapStep.data && typeof snapStep.data.text === 'string' ? snapStep.data.text : '',
    };
  } catch (error) {
    return { ok: false, error: `Failed to parse direct snapshot output: ${error.message}` };
  }
}

function waitForSnapshotText(predicate, {
  previousText = '',
  timeoutMs = SEARCH_RESULTS_POLL_TIMEOUT_MS,
  intervalMs = SEARCH_RESULTS_POLL_INTERVAL_MS,
  blockedPredicate = null,
  blockedMessage = 'Blocked state encountered while waiting for the Play Store surface.',
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  let lastText = '';

  while (Date.now() < deadline) {
    const snap = captureDirectSnapshot();
    if (snap.ok) {
      lastText = snap.text || '';
      if (blockedPredicate && blockedPredicate(lastText)) {
        return { ok: false, error: blockedMessage, text: lastText };
      }
      if (lastText && predicate(lastText) && lastText !== previousText) {
        return { ok: true, text: lastText };
      }
    } else {
      lastError = snap.error || '';
    }

    if (Date.now() >= deadline) {
      break;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }

  return {
    ok: false,
    error: lastError
      ? `Timed out waiting for a readable Play Store surface: ${lastError}`
      : 'Timed out waiting for a readable Play Store surface.',
    text: lastText,
  };
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

function trySubmitSearchQuery(currentText) {
  let snapshotText = currentText;

  for (let attempt = 0; attempt < SEARCH_SUBMIT_ATTEMPTS; attempt += 1) {
    if (isSearchResultsSurface(snapshotText)) {
      return { ok: true, text: snapshotText, method: attempt === 0 ? 'initial-submit' : 'follow-up-submit' };
    }

    const trimmed = normalizeWhitespace(snapshotText);
    const exactSuggestionVisible = trimmed.includes(`Search for '${query}'`)
      || trimmed.includes(`Search for "${query}"`)
      || trimmed.includes(`Search for &apos;${query}&apos;`);

    if (exactSuggestionVisible) {
      logSkillProgress(skillId, `Play is still on suggestions. Tapping the exact "${query}" search suggestion...`);
      const { ok } = runClawperator(buildSubmitSearchSuggestionExecution(), deviceId, operatorPkg);
      if (ok) {
        const snap = waitForSnapshotText(isSearchResultsSurface, {
          previousText: snapshotText,
          timeoutMs: SEARCH_RESULTS_POLL_TIMEOUT_MS,
          blockedPredicate: (text) => text.includes('Sign in') || text.includes('Choose an account'),
          blockedMessage: 'Login required. Please sign in to Google Play on the device.',
        });
        if (!snap.ok) {
          return { ok: false, error: `Follow-up snapshot after tapping the search suggestion failed: ${snap.error}` };
        }
        snapshotText = snap.text;
        continue;
      }
    }

    logSkillProgress(skillId, 'Play is still on suggestions. Sending Enter to force query submission...');
    try {
      pressEnterKey();
    } catch (error) {
      return {
        ok: false,
        error: `Submitting the query with Enter failed: ${error && error.message ? error.message : String(error)}`,
      };
    }
    const retry = waitForSnapshotText(isSearchResultsSurface, {
      previousText: snapshotText,
      timeoutMs: SEARCH_RESULTS_POLL_TIMEOUT_MS,
      blockedPredicate: (text) => text.includes('Sign in') || text.includes('Choose an account'),
      blockedMessage: 'Login required. Please sign in to Google Play on the device.',
    });
    if (!retry.ok) {
      return { ok: false, error: `Follow-up snapshot after query submit failed: ${retry.error}` };
    }
    snapshotText = retry.text;
  }

  return { ok: isSearchResultsSurface(snapshotText), text: snapshotText };
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
      { id: 'snap', type: 'snapshot' }
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
      { id: 'wait-choice', type: 'wait_for_node', params: { matcher: { textEquals: 'Just once' }, timeoutMs: 10000 } },
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
 */
function buildInstallExecution(actionLabel = 'Install') {
  return {
    commandId,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 30000,
    actions: [
      // Click the Install/Update button.
      // content-desc targets the label node; the click coordinates land on
      // the clickable parent container (verified via live exploration).
      {
        id: 'click-install',
        type: 'click',
        params: { matcher: { contentDescEquals: actionLabel } }
      },
    ]
  };
}

function waitForInstalledState(appTitle) {
  const deadline = Date.now() + INSTALL_POLL_TIMEOUT_MS;
  let lastText = '';

  while (Date.now() < deadline) {
    const snap = captureDirectSnapshot();
    if (!snap.ok) {
      return { ok: false, error: `Direct snapshot polling failed: ${snap.error}` };
    }

    lastText = snap.text || '';
    if (!lastText) {
      continue;
    }

    const signals = parseInstallSignals(lastText);
    if (signals.hasOpen) {
      return {
        ok: true,
        text: lastText,
        installState: signals.hasUninstall ? 'installed' : 'installed-transition',
      };
    }

    if (signals.hasSignIn) {
      return { ok: false, error: 'Play Store requested sign-in during install verification.', text: lastText };
    }

    logSkillProgress(skillId, `Waiting for "${appTitle}" to reach an Open button on the Play details page...`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, INSTALL_POLL_INTERVAL_MS);
  }

  return { ok: false, error: 'Timed out waiting for the Play details page to show Open.', text: lastText };
}

// --- Search for target app and open its details page ---

logSkillProgress(skillId, `Searching Play Store for "${query}"...`);
const { ok: searchOk, result: searchResult, error: searchError } = runClawperator(buildSearchExecution(), deviceId, operatorPkg);

if (!searchOk) {
  checkpoints.push({ id: 'search_results_opened', status: 'failed', note: 'Play Store search execution failed.' });
  emitFailureAndExit(`Search execution failed: ${searchError}`, 2, { path: 'search' });
}

let initialSearchSnapshot = waitForSnapshotText(isSearchResultsSurface, {
  timeoutMs: SEARCH_RESULTS_POLL_TIMEOUT_MS,
  blockedPredicate: (text) => text.includes('Sign in') || text.includes('Choose an account'),
  blockedMessage: 'Login required. Please sign in to Google Play on the device.',
});
if (!initialSearchSnapshot.ok) {
  checkpoints.push({ id: 'search_results_opened', status: 'failed', note: 'Initial search snapshot failed after query entry.' });
  emitFailureAndExit(`Initial search snapshot failed: ${initialSearchSnapshot.error}`, 2, { path: 'search-post-submit-snapshot' });
}
let searchText = initialSearchSnapshot.text;
if (!searchText) {
  checkpoints.push({ id: 'search_results_opened', status: 'failed', note: 'Search snapshot returned empty.' });
  emitFailureAndExit('Search snapshot returned empty.', 2, { path: 'search' });
}
checkpoints.push({ id: 'search_results_opened', status: 'ok', note: 'Submitted the Play Store query and captured the initial search surface.' });

if (!isSearchResultsSurface(searchText)) {
  const submitResult = trySubmitSearchQuery(searchText);
  if (!submitResult.ok) {
    checkpoints.push({ id: 'search_results_collected', status: 'failed', note: 'Query submission fallback did not reach Play results.' });
    emitFailureAndExit(submitResult.error || 'Query submission fallback did not reach Play results.', 2, { path: 'search-submit-fallback' });
  }
  searchText = submitResult.text;
}

if (!isSearchResultsSurface(searchText)) {
  checkpoints.push({ id: 'search_results_collected', status: 'failed', note: 'Play Store did not reach a readable search-results surface.' });
  emitFailureAndExit('BLOCKED: no-search-results - Search did not reach a readable Play results surface.', 2, { path: 'search-results' });
}
checkpoints.push({ id: 'search_results_collected', status: 'ok', note: 'Reached a readable Play Store results surface.' });

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
  const snap = waitForSnapshotText(isSearchResultsSurface, {
    previousText: searchSnapshots[searchSnapshots.length - 1],
    timeoutMs: 4000,
    blockedPredicate: (text) => text.includes('Sign in') || text.includes('Choose an account'),
    blockedMessage: 'Login required. Please sign in to Google Play on the device.',
  });
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
  checkpoints.push({ id: 'target_result_selected', status: 'failed', note: 'No result matched the requested app query.' });
  emitFailureAndExit(`BLOCKED: app-not-found - No Play search result matched "${query}".`, 2, {
    path: 'result-selection',
    availableResults: mergedResults.map((result) => result.title),
  });
}
checkpoints.push({ id: 'target_result_selected', status: 'ok', note: `Selected "${candidate.title}" from Play Store search results.` });

logSkillProgress(skillId, `Opening Play details for "${candidate.title}"...`);
const { ok: openOk, result: openResult, error: openError } = runClawperator(buildOpenResultExecution(candidate.title), deviceId, operatorPkg);
if (!openOk) {
  checkpoints.push({ id: 'details_page_opened', status: 'failed', note: 'Failed to open the matched Play result.' });
  emitFailureAndExit(`Failed to open Play result "${candidate.title}": ${openError}`, 3, { path: 'open-result' });
}

let detailSnapshot = waitForSnapshotText((text) => detectPlayDetailsSurface(text) || detectOpenWithChooser(text), {
  timeoutMs: DETAILS_POLL_TIMEOUT_MS,
});
if (!detailSnapshot.ok) {
  checkpoints.push({ id: 'details_page_opened', status: 'failed', note: 'Direct snapshot after opening the Play result failed.' });
  emitFailureAndExit(`Snapshot after opening Play result failed: ${detailSnapshot.error}`, 3, { path: 'open-result-snapshot' });
}
let prefText = detailSnapshot.text;
if (detectOpenWithChooser(prefText)) {
  logSkillProgress(skillId, 'Open-with chooser detected; selecting Google Play Store...');
  const { ok, error } = runClawperator(buildChooserExecution(), deviceId, operatorPkg);
  if (!ok) {
    checkpoints.push({ id: 'details_page_opened', status: 'failed', note: 'Android chooser handling failed.' });
    emitFailureAndExit(`Open-with chooser handling failed: ${error}`, 3, { path: 'chooser' });
  }

  const retrySnap = waitForSnapshotText(detectPlayDetailsSurface, {
    timeoutMs: DETAILS_POLL_TIMEOUT_MS,
  });
  if (!retrySnap.ok) {
    checkpoints.push({ id: 'details_page_opened', status: 'failed', note: 'Preflight after chooser handling failed.' });
    emitFailureAndExit(`Follow-up preflight after chooser handling failed: ${retrySnap.error}`, 3, { path: 'chooser-preflight' });
  }
  prefText = retrySnap.text;
}

if (!detectPlayDetailsSurface(prefText)) {
  checkpoints.push({ id: 'details_page_opened', status: 'failed', note: 'Search did not land on a Play details page.' });
  emitFailureAndExit('BLOCKED: not-details-page - Search did not land on a Play app details page.', 7, { path: 'details-page' });
}
checkpoints.push({ id: 'details_page_opened', status: 'ok', note: `Opened the Play details page for "${candidate.title}".` });

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
  checkpoints.push({ id: 'install_state_verified', status: 'failed', note: 'Play Store requires login before install can continue.' });
  emitFailureAndExit('BLOCKED: Login required. Please sign in to Google Play on the device.', 4, { path: 'preflight' });
}

if (hasUpdate) {
  logSkillProgress(skillId, "Update available; proceeding with install flow...");
  // Fall through to install execution (Update button uses same flow as Install)
}

if (hasOpen && hasUninstall && !hasInstall) {
  checkpoints.push({ id: 'install_state_verified', status: 'ok', note: 'Play Store already showed a settled installed state.' });
  emitSuccessAndExit('✅ Already installed. Nothing to do.', {
    appTitle: candidate.title,
    installState: 'already-installed',
    selectedResult: candidate,
  });
}

if (hasOpen && hasCancel) {
  logSkillProgress(skillId, 'Install is already in progress. Polling the Play details page until Open appears...');
  const waitResult = waitForInstalledState(candidate.title);
  if (!waitResult.ok) {
    checkpoints.push({ id: 'install_state_verified', status: 'failed', note: 'Install was in progress but waiting for completion failed.' });
    emitFailureAndExit(`Wait for completion failed: ${waitResult.error}`, 5, { path: 'wait-for-open' });
  }
  checkpoints.push({ id: 'install_state_verified', status: 'ok', note: 'Install completed from an already-in-progress state.' });
  emitSuccessAndExit('✅ Install completed (was already in progress).', {
    appTitle: candidate.title,
    installState: waitResult.installState || 'installed',
    selectedResult: candidate,
  });
}

if (!hasInstall && !hasUpdate) {
  if (hasPriceText) {
    checkpoints.push({ id: 'install_started', status: 'failed', note: 'The matched app appears to be paid.' });
    emitFailureAndExit('BLOCKED: paid-app - This app requires purchase. Cannot install without payment.', 6, { path: 'preflight' });
  }

  checkpoints.push({ id: 'install_started', status: 'failed', note: 'No install action was available on the details page.' });
  emitFailureAndExit('BLOCKED: no-install-button - Install button not found. Device may not be on app details page.', 7, { path: 'preflight' });
}
checkpoints.push({ id: 'install_started', status: 'ok', note: hasUpdate ? 'Update action was available and install flow can proceed.' : 'Install action was available on the Play details page.' });

// --- Execute install ---

const installExec = buildInstallExecution(hasUpdate ? 'Update' : 'Install');
logSkillProgress(skillId, `Triggering Play ${hasUpdate ? 'update' : 'install'} action from the details page...`);
const { ok, error } = runClawperator(installExec, deviceId, operatorPkg);

if (!ok) {
  checkpoints.push({ id: 'install_completed', status: 'failed', note: 'Install execution did not reach a verified terminal state.' });
  emitFailureAndExit(`Install execution failed: ${error}`, 8, {
    path: 'install',
    appTitle: candidate.title,
    installState: 'install-failed',
    selectedResult: candidate,
  });
}

logSkillProgress(skillId, 'Polling the Play details page until the action button becomes Open...');
const installWaitResult = waitForInstalledState(candidate.title);

if (!installWaitResult.ok) {
  checkpoints.push({ id: 'install_completed', status: 'failed', note: 'Final details-page polling did not observe Open.' });
  emitFailureAndExit(`Install verification failed: ${installWaitResult.error}`, 9, {
    path: 'install-verification',
    appTitle: candidate.title,
    installState: 'unverified',
    selectedResult: candidate,
  });
}

const state = installWaitResult.installState === 'installed' ? 'installed (settled)' : 'installed (transition)';
checkpoints.push({ id: 'install_completed', status: 'ok', note: `Play Store reached ${state}.` });
emitSuccessAndExit(`✅ App installed. State: ${state}`, {
  appTitle: candidate.title,
  installState: installWaitResult.installState,
  selectedResult: candidate,
});
