#!/usr/bin/env node
const {
  runClawperator,
  findAttribute,
  resolveOperatorPackage,
  logSkillProgress
} = require('../../utils/common');

const APPLICATION_ID = 'com.amazon.mShop.android.shopping';
const SEARCH_BOX_ID = `${APPLICATION_ID}:id/chrome_search_box`;
const SEARCH_FIELD_ID = `${APPLICATION_ID}:id/rs_search_src_text`;
const MAX_QUERY_LENGTH = 256;
const MAX_RESULTS = 8;
const skillId = 'com.amazon.mShop.android.shopping.search-products';

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const rawQuery = process.argv[3] || process.env.QUERY || '';
const query = rawQuery.trim();
const operatorPkg = resolveOperatorPackage(process.argv[4]);

if (!deviceId || !query) {
  console.error('Usage: node search_amazon_products.js <device_id> <query> [operator_package]');
  process.exit(1);
}

if (query.length > MAX_QUERY_LENGTH) {
  console.error(`Query too long (max ${MAX_QUERY_LENGTH})`);
  process.exit(1);
}

function buildExecution({ submit, clickSuggestion, suggestionLabel, commandId }) {
  const actions = [
    { id: 'close', type: 'close_app', params: { applicationId: APPLICATION_ID } },
    { id: 'wait_close', type: 'sleep', params: { durationMs: 1500 } },
    { id: 'open', type: 'open_app', params: { applicationId: APPLICATION_ID } },
    { id: 'wait_open', type: 'sleep', params: { durationMs: 8000 } },
    { id: 'click_search', type: 'click', params: { matcher: { resourceId: SEARCH_BOX_ID } } },
    { id: 'wait_search', type: 'sleep', params: { durationMs: 1500 } },
    {
      id: 'type_query',
      type: 'enter_text',
      params: {
        matcher: { resourceId: SEARCH_FIELD_ID },
        text: query,
        clear: true,
        submit
      }
    },
    { id: 'wait_input', type: 'sleep', params: { durationMs: 2500 } }
  ];

  if (clickSuggestion) {
    actions.push(
      { id: 'click_exact_suggestion', type: 'click', params: { matcher: { contentDescEquals: suggestionLabel || query } } },
      { id: 'wait_results', type: 'sleep', params: { durationMs: 5000 } }
    );
  } else if (submit) {
    actions.push({ id: 'wait_results', type: 'sleep', params: { durationMs: 7000 } });
  }

  actions.push({ id: 'snap', type: 'snapshot_ui' });

  return {
    commandId,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions
  };
}

function getSnapshotText(result) {
  const steps = (result && result.envelope && result.envelope.stepResults) || [];
  const snapStep = steps.find((step) => step.id === 'snap');
  return snapStep && snapStep.data ? snapStep.data.text || '' : '';
}

function escapeXmlAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function findExactSuggestionLabel(snapshotText, searchQuery) {
  const queryLower = normalizeWhitespace(searchQuery).toLowerCase();
  const lines = snapshotText.split('\n');

  for (const line of lines) {
    if (!line.includes('class="android.widget.Button"')) {
      continue;
    }

    const contentDesc = decodeXmlEntities(findAttribute(line, 'content-desc') || '');
    if (!contentDesc) {
      continue;
    }

    if (normalizeWhitespace(contentDesc).toLowerCase() === queryLower) {
      return contentDesc;
    }
  }

  const encodedQuery = escapeXmlAttribute(searchQuery);
  if (snapshotText.includes(`content-desc="${encodedQuery}"`)) {
    return searchQuery;
  }

  return null;
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
    'options:'
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
      const match = value.match(/\$[0-9]+(?:\.[0-9]{2})?/);
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

    const match = value.match(/\$[0-9]+(?:\.[0-9]{2})?/);
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
    .replace(/^Sponsored Ad\s+[–-]\s+/i, '')
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
    const sponsored = /^Sponsored Ad\s+[–-]\s+/i.test(candidate.title) || /^Sponsored ad from\s+/i.test(candidate.title);
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

function runExecution(execution) {
  const outcome = runClawperator(execution, deviceId, operatorPkg);
  if (!outcome.ok) {
    console.error(`Skill execution failed: ${outcome.error}`);
    process.exit(2);
  }
  return outcome.result;
}

logSkillProgress(skillId, 'Opening Amazon Shopping...');
logSkillProgress(skillId, `Probing search flow for "${query}"...`);
const probeCommandId = `skill-amazon-search-probe-${Date.now()}`;
const probeResult = runExecution(buildExecution({
  submit: false,
  clickSuggestion: false,
  suggestionLabel: null,
  commandId: probeCommandId
}));
const probeSnapshot = getSnapshotText(probeResult);
const exactSuggestionLabel = findExactSuggestionLabel(probeSnapshot, query);
const useSuggestion = exactSuggestionLabel !== null;

logSkillProgress(
  skillId,
  useSuggestion
    ? 'Exact suggestion row detected. Re-running with suggestion click.'
    : 'Exact suggestion row not detected. Re-running with IME submit.'
);

const finalCommandId = `skill-amazon-search-${Date.now()}`;
const finalResult = runExecution(buildExecution({
  submit: !useSuggestion,
  clickSuggestion: useSuggestion,
  suggestionLabel: exactSuggestionLabel,
  commandId: finalCommandId
}));
const finalSnapshot = getSnapshotText(finalResult);

if (!finalSnapshot) {
  console.error('Could not capture Amazon search snapshot.');
  process.exit(2);
}

const products = extractProducts(finalSnapshot, query);
const reachedResults = finalSnapshot.includes('text="Results"') || products.length > 0;

if (!reachedResults) {
  console.error('Amazon search did not reach a readable results page.');
  process.exit(2);
}

logSkillProgress(skillId, `Reached results using ${useSuggestion ? 'exact suggestion click' : 'IME submit'}.`);
console.log(`✅ Amazon search results for '${query}':`);

if (products.length === 0) {
  console.log('- Results page opened, but no product titles were parsed from the current accessibility snapshot.');
  process.exit(0);
}

for (const product of products) {
  console.log(`- ${product.title}`);
  console.log(`  sponsored: ${product.sponsored ? 'YES' : 'NO'}`);
  console.log(`  price: ${product.price || 'UNKNOWN'}`);
}
