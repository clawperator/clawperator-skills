#!/usr/bin/env node

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

function hasSearchBar(snapshotText) {
  return snapshotText.includes('text="Search"')
    || snapshotText.includes('content-desc="Search Google Play"');
}

function hasSearchResultRows(snapshotText) {
  return /<node\b[^>]*content-desc="[^"]*\n[^"]*"[^>]*\/>/.test(snapshotText);
}

function isDetailsSurface(snapshotText) {
  return snapshotText.includes('Ask Play about this app')
    || snapshotText.includes('text="Install"')
    || snapshotText.includes('text="Update"')
    || snapshotText.includes('text="Uninstall"')
    || snapshotText.includes('text="Open"');
}

function isSearchResultsSurface(snapshotText) {
  if (!snapshotText) {
    return false;
  }

  if (isDetailsSurface(snapshotText)) {
    return false;
  }

  return hasSearchBar(snapshotText)
    && (hasSearchResultRows(snapshotText) || snapshotText.includes('Downloaded '));
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
    const nextBoundary = candidateIndex + 1 < candidates.length
      ? candidates[candidateIndex + 1].index
      : snapshotText.length;
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
      const title = typeof result.title === "string"
        ? normalizeWhitespace(result.title)
        : "";
      if (!title) {
        continue;
      }
      const key = title.toLowerCase();
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
  MAX_RESULTS,
  decodeXmlEntities,
  extractSearchResults,
  mergeSearchResults,
  isSearchResultsSurface,
  normalizeWhitespace,
};
