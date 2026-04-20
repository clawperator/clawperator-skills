#!/usr/bin/env node

const { findAttribute } = require("../../utils/common");

function detectOpenWithChooser(snapshotText) {
  return snapshotText.includes('text="Open with"')
    && snapshotText.includes('text="Google Play Store"');
}

function detectPlayDetailsSurface(snapshotText) {
  const hasActionButton = ['Install', 'Open', 'Uninstall', 'Update'].some((label) => (
    snapshotText.includes(`text="${label}"`) || snapshotText.includes(`content-desc="${label}"`)
  ));

  const hasDetailsMarkers = snapshotText.includes('Ask Play about this app')
    || snapshotText.includes('Downloaded ')
    || snapshotText.includes('Average rating')
    || snapshotText.includes('Installed on all devices');

  return hasActionButton && hasDetailsMarkers;
}

function parseInstallSignals(snapshotText) {
  const lines = snapshotText.split('\n');
  const signals = {
    hasInstall: false,
    hasOpen: false,
    hasUninstall: false,
    hasUpdate: false,
    hasCancel: false,
    hasSignIn: false,
    hasPriceText: false,
  };

  for (const line of lines) {
    const text = findAttribute(line, 'text') || '';
    const contentDesc = findAttribute(line, 'content-desc') || '';

    if (contentDesc === 'Install' || text === 'Install') signals.hasInstall = true;
    if (contentDesc === 'Open' || text === 'Open') signals.hasOpen = true;
    if (contentDesc === 'Uninstall' || text === 'Uninstall') signals.hasUninstall = true;
    if (contentDesc === 'Update' || text === 'Update') signals.hasUpdate = true;
    if (contentDesc === 'Cancel' || text === 'Cancel') signals.hasCancel = true;
    if (text.includes('Sign in') || contentDesc.includes('Sign in')) signals.hasSignIn = true;
    if (/\$[0-9]+\.[0-9]{2}/.test(text)) signals.hasPriceText = true;
  }

  return signals;
}

module.exports = {
  detectOpenWithChooser,
  detectPlayDetailsSurface,
  parseInstallSignals,
};
