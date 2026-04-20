#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectOpenWithChooser,
  detectPlayDetailsSurface,
  parseInstallSignals,
} = require('./install_play_app_parser');

test('detectOpenWithChooser recognizes the Android app chooser surface', () => {
  const snapshotText = [
    '<node text="Open with" />',
    '<node text="Galaxy Store" />',
    '<node text="Google Play Store" />',
    '<node text="Just once" />',
  ].join('\n');

  assert.equal(detectOpenWithChooser(snapshotText), true);
});

test('detectPlayDetailsSurface recognizes a Play app details page', () => {
  const snapshotText = [
    '<node text="Google Chrome" />',
    '<node text="Open" />',
    '<node text="Uninstall" />',
    '<node text="Ask Play about this app" />',
    '<node content-desc="Downloaded 10 billion plus times" />',
  ].join('\n');

  assert.equal(detectPlayDetailsSurface(snapshotText), true);
});

test('parseInstallSignals extracts core install-state flags', () => {
  const snapshotText = [
    '<node text="Install" />',
    '<node text="Sign in" />',
    '<node text="$4.99" />',
  ].join('\n');

  assert.deepStrictEqual(parseInstallSignals(snapshotText), {
    hasInstall: true,
    hasOpen: false,
    hasUninstall: false,
    hasUpdate: false,
    hasCancel: false,
    hasSignIn: true,
    hasPriceText: true,
  });
});
