#!/usr/bin/env node
const {
  runClawperator,
  findAttribute,
  resolveOperatorPackage,
  logSkillProgress
} = require('../../utils/common');

const SKILL_RESULT_FRAME_PREFIX = '[Clawperator-Skill-Result]';
const SKILL_RESULT_CONTRACT_VERSION = '1.0.0';
const APPLICATION_ID = 'com.amazon.mShop.android.shopping';
const SEARCH_BOX_ID = `${APPLICATION_ID}:id/chrome_search_box`;
const SEARCH_ENTRY_BAR_ID = `${APPLICATION_ID}:id/rs_search_entry_bar`;
const SEARCH_FIELD_ID = `${APPLICATION_ID}:id/rs_search_src_text`;
const MAX_QUERY_LENGTH = 256;
const MAX_RESULTS = 20;
const MAX_SCROLLS = 3;
const SCROLL_SETTLE_DELAY_MS = 1800;
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

function escapeXmlAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildOpenProbeExecution(commandId) {
  return {
    commandId,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions: [
      { id: 'close', type: 'close_app', params: { applicationId: APPLICATION_ID } },
      { id: 'wait_close', type: 'sleep', params: { durationMs: 1500 } },
      { id: 'open', type: 'open_app', params: { applicationId: APPLICATION_ID } },
      { id: 'wait_open', type: 'sleep', params: { durationMs: 8000 } },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

function buildExecution({ surface, submit, clickSuggestion, suggestionLabel, commandId }) {
  const actions = [];

  if (surface === 'home_search_box') {
    actions.push(
      { id: 'click_search', type: 'click', params: { matcher: { resourceId: SEARCH_BOX_ID } } },
      { id: 'wait_search', type: 'sleep', params: { durationMs: 1500 } }
    );
  } else if (surface === 'search_entry_bar') {
    actions.push(
      { id: 'click_search', type: 'click', params: { matcher: { resourceId: SEARCH_ENTRY_BAR_ID } } },
      { id: 'wait_search', type: 'sleep', params: { durationMs: 1200 } }
    );
  }

  actions.push(
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
  );

  if (clickSuggestion) {
    actions.push(
      {
        id: 'click_exact_suggestion',
        type: 'click',
        params: { matcher: { contentDescEquals: suggestionLabel || query } }
      },
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

function buildScrollExecution(commandId) {
  return {
    commandId,
    taskId: commandId,
    source: 'clawperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions: [
      {
        id: 'scroll',
        type: 'scroll',
        params: { direction: 'down', settleDelayMs: SCROLL_SETTLE_DELAY_MS }
      },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

function getSnapshotText(result) {
  const steps = (result && result.envelope && result.envelope.stepResults) || [];
  const snapStep = steps.find((step) => step.id === 'snap');
  return snapStep && snapStep.data ? snapStep.data.text || '' : '';
}

function getSnapshotStepResults(result, prefix = null) {
  const steps = (result && result.envelope && result.envelope.stepResults) || [];
  return steps.filter((step) => {
    if (step.actionType !== 'snapshot_ui' || !step.data) {
      return false;
    }
    if (prefix === null) {
      return step.id === 'snap';
    }
    return step.id && step.id.startsWith(prefix);
  });
}

function summarizeSnapshotPackages(stepResults) {
  return stepResults.map((step) => ({
    stepId: step.id,
    foregroundPackage: step.data.foreground_package || null,
    overlayPackage: step.data.overlay_package || null
  }));
}

function findForeignSnapshot(stepResults) {
  return stepResults.find((step) => {
    const foregroundPackage = step.data.foreground_package || '';
    return foregroundPackage && foregroundPackage !== APPLICATION_ID;
  }) || null;
}

function detectSearchSurface(snapshotText) {
  if (!snapshotText) return null;
  if (snapshotText.includes(`resource-id="${SEARCH_FIELD_ID}"`)) {
    return 'search_field';
  }
  if (snapshotText.includes(`resource-id="${SEARCH_ENTRY_BAR_ID}"`)) {
    return 'search_entry_bar';
  }
  if (snapshotText.includes(`resource-id="${SEARCH_BOX_ID}"`)) {
    return 'home_search_box';
  }
  return null;
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

function runExecution(execution) {
  const outcome = runClawperator(execution, deviceId, operatorPkg);
  if (!outcome.ok) {
    throw new Error(`Skill execution failed: ${outcome.error}`);
  }
  return outcome.result;
}

function sanitizeStepData(actionType, data) {
  const sanitized = { ...data };
  if (actionType === 'snapshot_ui' && typeof sanitized.text === 'string') {
    sanitized.snapshot_text_omitted = 'true';
    sanitized.snapshot_text_length = String(sanitized.text.length);
    delete sanitized.text;
  }
  return sanitized;
}

function sanitizeEnvelope(envelope) {
  return {
    ...envelope,
    stepResults: (envelope.stepResults || []).map((step) => ({
      ...step,
      data: sanitizeStepData(step.actionType, step.data || {})
    }))
  };
}

function summarizeExecutionErrorMessage(message) {
  if (!message) {
    return 'Skill execution failed.';
  }

  const [firstLine] = String(message).split('\n');
  const compact = firstLine.replace(/\s+/g, ' ').trim();
  return compact || 'Skill execution failed.';
}

function writeSkillResult(payload) {
  console.log(SKILL_RESULT_FRAME_PREFIX);
  console.log(JSON.stringify(payload));
}

function buildSkillResult({ status, inputs, checkpoints, terminalVerification, execEnvelopes, diagnostics }) {
  return {
    contractVersion: SKILL_RESULT_CONTRACT_VERSION,
    skillId,
    goal: {
      kind: 'search_products'
    },
    inputs,
    status,
    checkpoints,
    terminalVerification,
    execEnvelopes,
    diagnostics
  };
}

function emitFailureAndExit(message, context) {
  writeSkillResult(buildSkillResult({
    status: 'failed',
    inputs: context.inputs,
    checkpoints: context.checkpoints,
    terminalVerification: {
      status: 'failed',
      expected: {
        kind: 'text',
        text: 'Readable Amazon results page with structured product rows'
      },
      observed: {
        kind: 'text',
        text: message
      },
      note: message
    },
    execEnvelopes: context.execEnvelopes,
    diagnostics: context.diagnostics
  }));
  console.error(message);
  process.exit(2);
}

const inputs = { query };
const checkpoints = [];
const execEnvelopes = [];

logSkillProgress(skillId, 'Opening Amazon Shopping...');

let openProbeResult;
try {
  openProbeResult = runExecution(buildOpenProbeExecution(`skill-amazon-open-probe-${Date.now()}`));
} catch (error) {
  emitFailureAndExit(error.message, {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      warnings: ['Failed to open Amazon Shopping for the initial probe.']
    }
  });
}

execEnvelopes.push(sanitizeEnvelope(openProbeResult.envelope));
const openProbeSnapshotSteps = getSnapshotStepResults(openProbeResult);
const openProbeForeignSnapshot = findForeignSnapshot(openProbeSnapshotSteps);
if (openProbeForeignSnapshot) {
  emitFailureAndExit(`Amazon open probe lost foreground to ${openProbeForeignSnapshot.data.foreground_package}.`, {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'poisoned',
      snapshotPackages: summarizeSnapshotPackages(openProbeSnapshotSteps),
      warnings: ['Another app took focus during the initial Amazon open probe.']
    }
  });
}
const openProbeSnapshot = getSnapshotText(openProbeResult);
const searchSurface = detectSearchSurface(openProbeSnapshot);

checkpoints.push({
  id: 'amazon_opened',
  status: 'ok',
  evidence: {
    kind: 'text',
    text: searchSurface || 'no-search-surface-detected'
  },
  note: 'Opened Amazon Shopping and inspected the landing surface.'
});

if (!searchSurface) {
  emitFailureAndExit('Amazon search surface was not reachable after opening the app.', {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      warnings: ['Amazon did not expose a known search entry surface after app open.']
    }
  });
}

logSkillProgress(skillId, `Detected landing surface: ${searchSurface}.`);
logSkillProgress(skillId, `Probing search flow for "${query}"...`);

let probeResult;
try {
  probeResult = runExecution(buildExecution({
    surface: searchSurface,
    submit: false,
    clickSuggestion: false,
    suggestionLabel: null,
    commandId: `skill-amazon-search-probe-${Date.now()}`
  }));
} catch (error) {
  emitFailureAndExit(error.message, {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      landingSurface: searchSurface,
      warnings: ['Probe typing pass failed before suggestion detection.']
    }
  });
}

execEnvelopes.push(sanitizeEnvelope(probeResult.envelope));
const probeSnapshotSteps = getSnapshotStepResults(probeResult);
const probeForeignSnapshot = findForeignSnapshot(probeSnapshotSteps);
if (probeForeignSnapshot) {
  emitFailureAndExit(`Amazon search probe lost foreground to ${probeForeignSnapshot.data.foreground_package}.`, {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'poisoned',
      landingSurface: searchSurface,
      snapshotPackages: summarizeSnapshotPackages(probeSnapshotSteps),
      warnings: ['Another app took focus during Amazon suggestion probing.']
    }
  });
}
const probeSnapshot = getSnapshotText(probeResult);
const exactSuggestionLabel = findExactSuggestionLabel(probeSnapshot, query);
const useSuggestion = exactSuggestionLabel !== null;

checkpoints.push({
  id: 'search_probe_completed',
  status: 'ok',
  evidence: {
    kind: 'json',
    value: {
      landingSurface: searchSurface,
      exactSuggestionDetected: useSuggestion,
      exactSuggestionLabel
    }
  },
  note: 'Typed the query once and inspected the suggestion surface.'
});

logSkillProgress(
  skillId,
  useSuggestion
    ? 'Exact suggestion row detected. Re-running with suggestion click.'
    : 'Exact suggestion row not detected. Re-running with IME submit.'
);

let finalResult;
try {
  finalResult = runExecution(buildExecution({
    surface: 'search_field',
    submit: !useSuggestion,
    clickSuggestion: useSuggestion,
    suggestionLabel: exactSuggestionLabel,
    commandId: `skill-amazon-search-${Date.now()}`
  }));
} catch (error) {
  emitFailureAndExit(error.message, {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      landingSurface: searchSurface,
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit',
      warnings: ['Final search pass failed before a readable results snapshot was captured.']
    }
  });
}

execEnvelopes.push(sanitizeEnvelope(finalResult.envelope));
const finalSnapshotSteps = getSnapshotStepResults(finalResult);
const finalForeignSnapshot = findForeignSnapshot(finalSnapshotSteps);
if (finalForeignSnapshot) {
  emitFailureAndExit(`Amazon final search snapshot lost foreground to ${finalForeignSnapshot.data.foreground_package}.`, {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'poisoned',
      landingSurface: searchSurface,
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit',
      snapshotPackages: summarizeSnapshotPackages(finalSnapshotSteps),
      warnings: ['Another app took focus before the results snapshot was captured.']
    }
  });
}
const finalSnapshot = getSnapshotText(finalResult);

if (!finalSnapshot) {
  emitFailureAndExit('Could not capture Amazon search snapshot.', {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      landingSurface: searchSurface,
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit'
    }
  });
}

checkpoints.push({
  id: 'results_reached',
  status: 'ok',
  evidence: {
    kind: 'text',
    text: useSuggestion ? 'exact_suggestion_click' : 'ime_submit'
  },
  note: 'Reached the results surface after the final search pass.'
});

logSkillProgress(skillId, `Reached results using ${useSuggestion ? 'exact suggestion click' : 'IME submit'}.`);
logSkillProgress(skillId, `Collecting additional results with ${MAX_SCROLLS} scrolls...`);

let scrollCollectionResult;
const additionalSnapshots = [];
const scrollSnapshotPackages = [];

for (let scrollIndex = 0; scrollIndex < MAX_SCROLLS; scrollIndex += 1) {
  try {
    scrollCollectionResult = runExecution(buildScrollExecution(
      `skill-amazon-search-collect-${Date.now()}-${scrollIndex + 1}`
    ));
  } catch (error) {
    emitFailureAndExit(summarizeExecutionErrorMessage(error.message), {
      inputs,
      checkpoints,
      execEnvelopes,
      diagnostics: {
        runtimeState: 'unknown',
        landingSurface: searchSurface,
        suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit',
        completedScrollCount: scrollIndex,
        warnings: ['Additional result collection failed during scrolling.']
      }
    });
  }

  execEnvelopes.push(sanitizeEnvelope(scrollCollectionResult.envelope));
  const currentScrollSnapshotSteps = getSnapshotStepResults(scrollCollectionResult);
  scrollSnapshotPackages.push(...summarizeSnapshotPackages(currentScrollSnapshotSteps));
  const currentScrollForeignSnapshot = findForeignSnapshot(currentScrollSnapshotSteps);
  if (currentScrollForeignSnapshot) {
    emitFailureAndExit(`Amazon scroll collection lost foreground to ${currentScrollForeignSnapshot.data.foreground_package}.`, {
      inputs,
      checkpoints,
      execEnvelopes,
      diagnostics: {
        runtimeState: 'poisoned',
        landingSurface: searchSurface,
        suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit',
        completedScrollCount: scrollIndex,
        snapshotPackages: scrollSnapshotPackages,
        warnings: ['Another app took focus during result scrolling, so parsed rows are not trustworthy.']
      }
    });
  }

  const currentSnapshot = getSnapshotText(scrollCollectionResult);
  if (currentSnapshot) {
    additionalSnapshots.push(currentSnapshot);
  }
}

const snapshotSeries = [finalSnapshot, ...additionalSnapshots];
const products = mergeProductsFromSnapshots(snapshotSeries, query);
const reachedResults = finalSnapshot.includes('text="Results"') || products.length > 0;

if (!reachedResults) {
  emitFailureAndExit('Amazon search did not reach a readable results page.', {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      landingSurface: searchSurface,
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit'
    }
  });
}

checkpoints.push({
  id: 'results_collected',
  status: 'ok',
  evidence: {
    kind: 'json',
    value: {
      scrollCount: MAX_SCROLLS,
      snapshotCount: snapshotSeries.length,
      resultCount: products.length
    }
  },
  note: 'Collected initial and scrolled result snapshots and merged them into one ordered result set.'
});

console.log(`✅ Amazon search results for '${query}':`);

if (products.length === 0) {
  console.log('- Results page opened, but no product titles were parsed from the current accessibility snapshot.');
  writeSkillResult(buildSkillResult({
    status: 'indeterminate',
    inputs,
    checkpoints,
    terminalVerification: {
      status: 'failed',
      expected: {
        kind: 'text',
        text: 'At least one structured product result'
      },
      observed: {
        kind: 'text',
        text: 'Results page opened, but no structured products were parsed.'
      },
      note: 'Amazon results were visible but the parser did not extract any structured product rows.'
    },
    execEnvelopes,
    diagnostics: {
      runtimeState: 'healthy',
      landingSurface: searchSurface,
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit',
      scrollCount: MAX_SCROLLS,
      snapshotCount: snapshotSeries.length,
      results: []
    }
  }));
  process.exit(0);
}

const structuredResults = products.map((product, index) => ({
  order: index + 1,
  title: product.title,
  sponsored: product.sponsored,
  price: product.price
}));

for (const product of products) {
  console.log(`- ${product.title}`);
  console.log(`  sponsored: ${product.sponsored ? 'YES' : 'NO'}`);
  console.log(`  price: ${product.price || 'UNKNOWN'}`);
}

writeSkillResult(buildSkillResult({
  status: 'success',
  inputs,
  checkpoints,
  terminalVerification: {
    status: 'verified',
    expected: {
      kind: 'text',
      text: 'Structured Amazon search results in UI order'
    },
    observed: {
      kind: 'json',
      value: {
        query,
        results: structuredResults
      }
    },
    note: 'Structured product rows were extracted from the visible and scrolled Amazon results snapshots.'
  },
  execEnvelopes,
  diagnostics: {
    runtimeState: 'healthy',
    landingSurface: searchSurface,
    suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'ime_submit',
    scrollCount: MAX_SCROLLS,
    snapshotCount: snapshotSeries.length,
    results: structuredResults
  }
}));
