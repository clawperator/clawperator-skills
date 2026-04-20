#!/usr/bin/env node

const { findAttribute } = require("../../utils/common");

const MAX_RESULTS = 5;

function normalizeWhitespace(value) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineValue(value) {
  return value
    .split("\n")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
    .join("\n");
}

function decodeXmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractLineValue(line, attrName) {
  return normalizeMultilineValue(decodeXmlEntities(findAttribute(line, attrName) || ""));
}

function isSearchResultsSurface(snapshotText) {
  if (!snapshotText) {
    return false;
  }

  return snapshotText.includes('text="Search"')
    || snapshotText.includes('content-desc="Search Google Play"')
    || snapshotText.includes('Downloaded ');
}

function isResultCandidateLine(line) {
  const contentDesc = extractLineValue(line, "content-desc");
  if (!contentDesc || !contentDesc.includes("\n")) {
    return false;
  }

  const parts = contentDesc
    .split("\n")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  if (parts.length < 2) {
    return false;
  }

  const title = parts[0];
  const secondaryText = parts[1];
  const rejectStarts = [
    "Search Google Play",
    "Google Play Store",
    "Navigate up",
    "Voice Search",
    "More options",
    "Average rating",
    "Downloaded ",
    "Content rating",
    "Can content be downloaded",
    "What video and audio quality",
    "Ask a question",
  ];

  if (rejectStarts.some((prefix) => title.startsWith(prefix))) {
    return false;
  }

  if (!secondaryText || secondaryText === "Install" || secondaryText === "Open" || secondaryText === "Update") {
    return false;
  }

  return true;
}

function inferInstallState(lines, startIndex) {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 12); index += 1) {
    const text = extractLineValue(lines[index], "text");
    const contentDesc = extractLineValue(lines[index], "content-desc");
    const values = [text, contentDesc];

    if (values.includes("Install")) {
      return "not-installed";
    }
    if (values.includes("Open")) {
      return "installed";
    }
    if (values.includes("Update")) {
      return "update-available";
    }
    if (values.includes("Installed")) {
      return "installed";
    }
  }

  return "unknown";
}

function inferSponsored(lines, index) {
  const previousNode = lines[index - 1];
  if (!previousNode) {
    return false;
  }

  return extractLineValue(previousNode, "text") === "Sponsored";
}

function extractSearchResults(snapshotText) {
  if (!snapshotText) {
    return [];
  }

  const results = [];
  const seenTitles = new Set();
  const metadataNodePattern = /<node\b[^>]*content-desc="([^"]*\n[^"]*)"[^>]*\/>/g;
  const candidates = [];

  let match;
  while ((match = metadataNodePattern.exec(snapshotText)) !== null) {
    candidates.push({
      contentDesc: normalizeMultilineValue(decodeXmlEntities(match[1] || "")),
      index: match.index,
    });
  }

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const contentDesc = candidate.contentDesc;
    if (!contentDesc) {
      continue;
    }

    const parts = contentDesc
      .split("\n")
      .map((part) => normalizeWhitespace(part))
      .filter(Boolean);

    const title = parts[0];
    const secondaryText = parts[1] || null;
    const developer = secondaryText && !secondaryText.startsWith("Star rating:")
      ? secondaryText
      : null;
    const rating = secondaryText && secondaryText.startsWith("Star rating:")
      ? secondaryText
      : null;
    const dedupeKey = title.toLowerCase();

    if (seenTitles.has(dedupeKey)) {
      continue;
    }

    seenTitles.add(dedupeKey);
    const previousBoundary = candidateIndex > 0 ? candidates[candidateIndex - 1].index : 0;
    const nextBoundary = candidateIndex + 1 < candidates.length ? candidates[candidateIndex + 1].index : candidate.index + 1200;
    const beforeWindow = snapshotText.slice(previousBoundary, candidate.index);
    const afterWindow = snapshotText.slice(candidate.index, nextBoundary);
    results.push({
      title,
      developer,
      secondaryText,
      rating,
      sponsored: beforeWindow.includes('text="Sponsored"'),
      installState: afterWindow.includes('content-desc="Install"') || afterWindow.includes('text="Install"')
        ? "not-installed"
        : afterWindow.includes('content-desc="Open"') || afterWindow.includes('text="Open"') || afterWindow.includes('Installed\n')
          ? "installed"
          : afterWindow.includes('content-desc="Update"') || afterWindow.includes('text="Update"') || afterWindow.includes('Update available')
            ? "update-available"
            : "unknown",
    });

    if (results.length >= MAX_RESULTS) {
      break;
    }
  }

  return results;
}

function mergeSearchResults(snapshotTexts) {
  const ordered = [];
  const seenTitles = new Set();

  for (const snapshotText of snapshotTexts) {
    const results = extractSearchResults(snapshotText);
    for (const result of results) {
      const key = result.title.toLowerCase();
      if (seenTitles.has(key)) {
        continue;
      }
      seenTitles.add(key);
      ordered.push(result);
      if (ordered.length >= MAX_RESULTS) {
        return ordered;
      }
    }
  }

  return ordered;
}

module.exports = {
  decodeXmlEntities,
  extractSearchResults,
  mergeSearchResults,
  isSearchResultsSurface,
  normalizeWhitespace,
};
