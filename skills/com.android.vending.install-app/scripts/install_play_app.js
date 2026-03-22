#!/usr/bin/env node
/**
 * com.android.vending.install-app
 *
 * Installs an app from its Google Play Store details page.
 * Assumes the device is already showing the app details page.
 *
 * Usage:
 *   node install_play_app.js <device_id> [receiver_package]
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

const { runClawperator, findAttribute, resolveReceiverPackage, logSkillProgress } = require('../../utils/common');

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const receiverPkg = resolveReceiverPackage(process.argv[3]);

if (!deviceId) {
  console.error('Usage: node install_play_app.js <device_id> [receiver_package]');
  process.exit(1);
}

const commandId = `skill-play-install-${Date.now()}`;
const skillId = "com.android.vending.install-app";

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

// --- Preflight: detect current state ---

const preflightExec = buildPreflightExecution();
logSkillProgress(skillId, "Checking current install state...");
const { ok: prefOk, result: prefResult, error: prefError } = runClawperator(preflightExec, deviceId, receiverPkg);

if (!prefOk) {
  console.error(`Preflight snapshot failed: ${prefError}`);
  process.exit(2);
}

const prefSteps = (prefResult && prefResult.envelope && prefResult.envelope.stepResults) || [];
const prefSnap = prefSteps.find(s => s.id === 'snap');
const prefText = prefSnap && prefSnap.data ? prefSnap.data.text : '';

if (!prefText) {
  console.error('Preflight snapshot returned empty. Is the device on the app details page?');
  process.exit(3);
}

// Parse preflight state
const lines = prefText.split('\n');
let hasInstall = false;
let hasOpen = false;
let hasUninstall = false;
let hasUpdate = false;
let hasCancel = false;
let hasSignIn = false;

lines.forEach(line => {
  const t = findAttribute(line, 'text') || '';
  const c = findAttribute(line, 'content-desc') || '';
  if (c === 'Install' || t === 'Install') hasInstall = true;
  if (c === 'Open' || t === 'Open') hasOpen = true;
  if (c === 'Uninstall' || t === 'Uninstall') hasUninstall = true;
  if (c === 'Update' || t === 'Update') hasUpdate = true;
  if (c === 'Cancel' || t === 'Cancel') hasCancel = true;
  if (t.includes('Sign in') || c.includes('Sign in')) hasSignIn = true;
});

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
  const { ok, result, error } = runClawperator(waitExec, deviceId, receiverPkg);
  if (!ok) {
    console.error(`Wait for completion failed: ${error}`);
    process.exit(5);
  }
  console.log('✅ Install completed (was already in progress).');
  process.exit(0);
}

if (!hasInstall && !hasUpdate) {
  // Check for paywall: price text like "$4.99"
  const hasPriceText = lines.some(line => {
    const t = findAttribute(line, 'text') || '';
    return /\$[0-9]+\.[0-9]{2}/.test(t);
  });
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
const { ok, result, error } = runClawperator(installExec, deviceId, receiverPkg);

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
  snapText.split('\n').forEach(line => {
    const t = findAttribute(line, 'text') || '';
    const c = findAttribute(line, 'content-desc') || '';
    if (c === 'Open' || t === 'Open') finalHasOpen = true;
    if (c === 'Uninstall' || t === 'Uninstall') finalHasUninstall = true;
  });
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
