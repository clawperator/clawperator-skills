const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractSearchResults,
  mergeSearchResults,
  isSearchResultsSurface,
} = require("./search_play_store_parser");

test("extractSearchResults parses the first Play Store app rows in order", () => {
  const snapshotText = [
    '<node text="Sponsored" />',
    '<node clickable="true" content-desc="Paramount+\nViacomCBS Streaming\nEntertainment\nStreaming content\nInstalled\n" />',
    '<node text="Open" />',
    '<node clickable="true" content-desc="HBO Max: Watch Movies &amp; TV\nWarnerMedia Global Digital Services, LLC\nContains ads\n" />',
    '<node text="Install" />',
    '<node clickable="true" content-desc="Disney+\nDisney\nEntertainment\n" />',
    '<node text="Install" />',
  ].join("\n");

  assert.deepStrictEqual(extractSearchResults(snapshotText), [
    {
      title: "Paramount+",
      developer: "ViacomCBS Streaming",
      secondaryText: "ViacomCBS Streaming",
      rating: null,
      sponsored: true,
      installState: "installed",
    },
    {
      title: "HBO Max: Watch Movies & TV",
      developer: "WarnerMedia Global Digital Services, LLC",
      secondaryText: "WarnerMedia Global Digital Services, LLC",
      rating: null,
      sponsored: false,
      installState: "not-installed",
    },
    {
      title: "Disney+",
      developer: "Disney",
      secondaryText: "Disney",
      rating: null,
      sponsored: false,
      installState: "not-installed",
    },
  ]);
});

test("isSearchResultsSurface detects a readable Play results snapshot", () => {
  const snapshotText = [
    '<node content-desc="Search Google Play" />',
    '<node content-desc="HBO Max: Watch Movies &amp; TV\nWarnerMedia Global Digital Services, LLC\nContains ads\n" />',
    '<node text="Downloaded 100 million plus times" />',
  ].join("\n");

  assert.equal(isSearchResultsSurface(snapshotText), true);
});

test("isSearchResultsSurface rejects Play app details snapshots", () => {
  const snapshotText = [
    '<node content-desc="Search Google Play" />',
    '<node text="HBO Max: Watch Movies & TV" />',
    '<node text="Install" />',
    '<node text="Ask Play about this app" />',
    '<node text="Downloaded 100 million plus times" />',
  ].join("\n");

  assert.equal(isSearchResultsSurface(snapshotText), false);
});

test("mergeSearchResults preserves first-seen UI order across scrolled snapshots", () => {
  const firstSnapshot = [
    '<node text="Sponsored" />',
    '<node content-desc="Paramount+\nViacomCBS Streaming\nEntertainment\nStreaming content\nInstalled\n" />',
    '<node text="Open" />',
    '<node content-desc="HBO Max: Watch Movies &amp; TV\nWarnerMedia Global Digital Services, LLC\nContains ads\n" />',
    '<node text="Install" />',
  ].join("\n");

  const secondSnapshot = [
    '<node content-desc="HBO Max: Watch Movies &amp; TV\nWarnerMedia Global Digital Services, LLC\nContains ads\n" />',
    '<node text="Install" />',
    '<node content-desc="Disney+\nDisney\nEntertainment\n" />',
    '<node text="Install" />',
    '<node content-desc="Netflix\nNetflix, Inc.\nEntertainment\n" />',
    '<node text="Update" />',
  ].join("\n");

  assert.deepStrictEqual(mergeSearchResults([firstSnapshot, secondSnapshot]), [
    {
      title: "Paramount+",
      developer: "ViacomCBS Streaming",
      secondaryText: "ViacomCBS Streaming",
      rating: null,
      sponsored: true,
      installState: "installed",
    },
    {
      title: "HBO Max: Watch Movies & TV",
      developer: "WarnerMedia Global Digital Services, LLC",
      secondaryText: "WarnerMedia Global Digital Services, LLC",
      rating: null,
      sponsored: false,
      installState: "not-installed",
    },
    {
      title: "Disney+",
      developer: "Disney",
      secondaryText: "Disney",
      rating: null,
      sponsored: false,
      installState: "not-installed",
    },
    {
      title: "Netflix",
      developer: "Netflix, Inc.",
      secondaryText: "Netflix, Inc.",
      rating: null,
      sponsored: false,
      installState: "update-available",
    },
  ]);
});
