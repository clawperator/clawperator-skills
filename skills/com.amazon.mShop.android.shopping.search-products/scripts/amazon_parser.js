const { findAttribute } = require('../../utils/common');

const MAX_RESULTS = 20;
const PRICE_PATTERN = /\$[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|\$[0-9]+(?:\.[0-9]{2})?/;

function normalizeWhitespace(value) {
  return value
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function looksLikeProductTitle(value, searchQuery) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length < 12 || normalized.length > 220) {
    return false;
  }

  const lower = normalized.toLowerCase();
  const queryLower = searchQuery.toLowerCase();
  const rejectContains = [
    'append suggestion',
    'search amazon',
    'all filters icon',
    'prime filter',
    'delivery options',
    'availability',
    'subscribe & save',
    'shop the store',
    'shop the ',
    'view sponsored information',
    'leave feedback on sponsored ad',
    'pause sponsored video',
    'mute sponsored video',
    'scan it',
    'free delivery',
    'prime savings save',
    'prime tomorrow',
    'prime two-day',
    'amazon prime',
    'results',
    '4 stars & up',
    'apply the filter',
    'fight the burn',
    'more like this',
    'add to cart',
    'out of 5 stars',
    'bought in past month',
    'unbeatably smooth shave',
    'shop gillette',
    'options:',
    "amazon's choice"
  ];

  if (normalized === searchQuery) {
    return false;
  }

  if (lower === queryLower || lower === `${queryLower} products`) {
    return false;
  }

  if (rejectContains.some((term) => lower.includes(term))) {
    return false;
  }

  if (/\$\d/.test(normalized)) {
    return false;
  }

  if (lower.startsWith('ref=')) {
    return false;
  }

  if (/^\d+\s+count\b/i.test(normalized)) {
    return false;
  }

  if (/\bcount\s+\(pack of\b/i.test(normalized)) {
    return false;
  }

  if (/(^|[\s-])(rrp|delivery|save\s+\d|today|tomorrow|mon,|tue,|wed,|thu,|fri,|sat,|sun,)/i.test(normalized)) {
    return false;
  }

  return /[a-z]/i.test(normalized);
}

function extractLineValue(line) {
  return normalizeWhitespace(
    decodeXmlEntities(findAttribute(line, 'content-desc') || findAttribute(line, 'text') || '')
  );
}

function isTitleCandidateLine(line, searchQuery) {
  if (!line.includes('clickable="true"')) {
    return false;
  }

  if (line.includes('class="android.widget.Button"') || line.includes('class="android.widget.ToggleButton"')) {
    return false;
  }

  const value = extractLineValue(line);
  if (!value) {
    return false;
  }

  return looksLikeProductTitle(value, searchQuery);
}

function extractPriceFromWindow(lines, startIndex, endIndex) {
  for (let i = startIndex; i < endIndex; i += 1) {
    const value = extractLineValue(lines[i]);
    if (!value) {
      continue;
    }

    if (value.startsWith('$')) {
      const match = value.match(PRICE_PATTERN);
      if (match) {
        return match[0];
      }
    }
  }

  for (let i = startIndex; i < endIndex; i += 1) {
    const value = extractLineValue(lines[i]);
    if (!value || !value.includes('$') || /\bRRP:/i.test(value)) {
      continue;
    }

    const match = value.match(PRICE_PATTERN);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function cleanTitle(rawTitle) {
  const detailPageMatch = rawTitle.match(/^Go to detail page for\s+"([^"]+)"/i);
  if (detailPageMatch) {
    return detailPageMatch[1].trim();
  }

  return rawTitle
    .replace(/^Sponsored Ad\s+[-–]\s+/i, '')
    .replace(/^Sponsored ad from\s+/i, '')
    .trim();
}

function extractProducts(snapshotText, searchQuery) {
  const allLines = snapshotText.split('\n');
  const resultsStartIndex = allLines.findIndex((line) => line.includes('text="Results"'));
  const lines = resultsStartIndex >= 0 ? allLines.slice(resultsStartIndex) : allLines;
  const titleCandidates = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isTitleCandidateLine(line, searchQuery)) {
      continue;
    }

    const normalized = extractLineValue(line);
    const cleaned = cleanTitle(normalized);
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    titleCandidates.push({ index: i, title: normalized, cleanedTitle: cleaned });
    if (titleCandidates.length >= MAX_RESULTS) {
      break;
    }
  }

  const merged = [];
  const byTitle = new Map();

  for (let idx = 0; idx < titleCandidates.length; idx += 1) {
    const candidate = titleCandidates[idx];
    const nextIndex = idx + 1 < titleCandidates.length ? titleCandidates[idx + 1].index : lines.length;
    const price = extractPriceFromWindow(lines, candidate.index + 1, nextIndex);
    const sponsored = /^Sponsored Ad\s+[-–]\s+/i.test(candidate.title) || /^Sponsored ad from\s+/i.test(candidate.title);
    const normalizedTitle = normalizeWhitespace(candidate.cleanedTitle);

    if (!normalizedTitle || !looksLikeProductTitle(normalizedTitle, searchQuery)) {
      continue;
    }

    const key = normalizedTitle.toLowerCase();
    const existing = byTitle.get(key);
    if (existing) {
      existing.sponsored = existing.sponsored || sponsored;
      existing.price = existing.price || price;
      continue;
    }

    const product = {
      title: normalizedTitle,
      sponsored,
      price
    };
    byTitle.set(key, product);
    merged.push(product);
  }

  return merged.slice(0, MAX_RESULTS);
}

function mergeProductsFromSnapshots(snapshotTexts, searchQuery) {
  const ordered = [];
  const byTitle = new Map();

  for (const snapshotText of snapshotTexts) {
    const products = extractProducts(snapshotText, searchQuery);
    for (const product of products) {
      const key = product.title.toLowerCase();
      const existing = byTitle.get(key);
      if (existing) {
        existing.sponsored = existing.sponsored || product.sponsored;
        existing.price = existing.price || product.price;
        continue;
      }

      const mergedProduct = { ...product };
      byTitle.set(key, mergedProduct);
      ordered.push(mergedProduct);

      if (ordered.length >= MAX_RESULTS) {
        return ordered;
      }
    }
  }

  return ordered;
}

module.exports = {
  cleanTitle,
  extractLineValue,
  extractPriceFromWindow,
  extractProducts,
  looksLikeProductTitle,
  mergeProductsFromSnapshots,
  normalizeWhitespace
};
