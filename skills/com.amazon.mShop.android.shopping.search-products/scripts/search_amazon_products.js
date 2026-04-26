#!/usr/bin/env node
const { execFileSync } = require('child_process');
const {
  runClawperator,
  findAttribute,
  resolveOperatorPackage,
  logSkillProgress
} = require('../../utils/common');
const {
  decodeXmlEntities,
  mergeProductsFromSnapshots,
  normalizeWhitespace
} = require('./amazon_parser');

const SKILL_RESULT_FRAME_PREFIX = '[Clawperator-Skill-Result]';
const SKILL_RESULT_CONTRACT_VERSION = '1.0.0';
const APPLICATION_ID = 'com.amazon.mShop.android.shopping';
const SEARCH_BOX_ID = `${APPLICATION_ID}:id/chrome_search_box`;
const SEARCH_ENTRY_BAR_ID = `${APPLICATION_ID}:id/rs_search_entry_bar`;
const SEARCH_FIELD_ID = `${APPLICATION_ID}:id/rs_search_src_text`;
const MAX_QUERY_LENGTH = 256;
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

function buildExecution({ surface, clickSuggestion, suggestionLabel, commandId }) {
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
        submit: false
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

function buildSnapshotExecution(commandId, waitMs = 0) {
  const actions = [];

  if (waitMs > 0) {
    actions.push({ id: 'wait', type: 'sleep', params: { durationMs: waitMs } });
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

function isAutocompleteSurface(snapshotText) {
  if (!snapshotText) {
    return false;
  }

  return snapshotText.includes('Amazon Search Suggestions')
    || snapshotText.includes('sac-suggestion-row-')
    || snapshotText.includes('iss_autocomplete_ux_container');
}

function isResultsSurface(snapshotText) {
  if (!snapshotText || isAutocompleteSurface(snapshotText)) {
    return false;
  }

  return snapshotText.includes('text="Results"')
    || snapshotText.includes('Amazon.com.au : ')
    || snapshotText.includes('resource-id="search"');
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

  return null;
}

function runExecution(execution) {
  const outcome = runClawperator(execution, deviceId, operatorPkg);
  if (!outcome.ok) {
    throw new Error(`Skill execution failed: ${outcome.error}`);
  }
  return outcome.result;
}

function pressEnterKey() {
  execFileSync('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '66'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
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

function buildSkillResult({ status, inputs, checkpoints, terminalVerification, execEnvelopes, diagnostics, result = null }) {
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
      kind: 'search_products'
    },
    inputs,
    result: evidenceResult,
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
    result: null,
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
  emitFailureAndExit(summarizeExecutionErrorMessage(error.message), {
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
    clickSuggestion: false,
    suggestionLabel: null,
    commandId: `skill-amazon-search-probe-${Date.now()}`
  }));
} catch (error) {
  emitFailureAndExit(summarizeExecutionErrorMessage(error.message), {
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
    : 'Exact suggestion row not detected. Re-running with Enter-key submit fallback.'
);

let finalResult;
try {
  finalResult = runExecution(buildExecution({
    surface: 'search_field',
    clickSuggestion: useSuggestion,
    suggestionLabel: exactSuggestionLabel,
    commandId: `skill-amazon-search-${Date.now()}`
  }));
} catch (error) {
  emitFailureAndExit(summarizeExecutionErrorMessage(error.message), {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      landingSurface: searchSurface,
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'enter_key_submit',
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
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'enter_key_submit',
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
      suggestionStrategy: useSuggestion ? 'exact_suggestion_click' : 'enter_key_submit'
    }
  });
}

let finalSnapshotText = finalSnapshot;
let suggestionStrategy = useSuggestion ? 'exact_suggestion_click' : 'enter_key_submit';

if (!useSuggestion && !isResultsSurface(finalSnapshotText)) {
  logSkillProgress(
    skillId,
    isAutocompleteSurface(finalSnapshotText)
      ? 'Autocomplete remained open after typing. Sending Enter key to submit the query.'
      : 'Results were not reached after typing. Sending Enter key to submit the query.'
  );

  try {
    pressEnterKey();
  } catch (error) {
    emitFailureAndExit(`Failed to submit Amazon search with Enter key: ${error.message}`, {
      inputs,
      checkpoints,
      execEnvelopes,
      diagnostics: {
        runtimeState: 'unknown',
        landingSurface: searchSurface,
        suggestionStrategy,
        warnings: ['Amazon query remained on the autocomplete surface after typing.']
      }
    });
  }

  let submitProbeResult;
  try {
    submitProbeResult = runExecution(buildSnapshotExecution(`skill-amazon-search-submit-probe-${Date.now()}`, 5000));
  } catch (error) {
    emitFailureAndExit(summarizeExecutionErrorMessage(error.message), {
      inputs,
      checkpoints,
      execEnvelopes,
      diagnostics: {
        runtimeState: 'unknown',
        landingSurface: searchSurface,
        suggestionStrategy,
        warnings: ['Failed to capture a post-submit Amazon snapshot after sending Enter.']
      }
    });
  }

  execEnvelopes.push(sanitizeEnvelope(submitProbeResult.envelope));
  const submitProbeSnapshotSteps = getSnapshotStepResults(submitProbeResult);
  const submitProbeForeignSnapshot = findForeignSnapshot(submitProbeSnapshotSteps);
  if (submitProbeForeignSnapshot) {
    emitFailureAndExit(`Amazon submit probe lost foreground to ${submitProbeForeignSnapshot.data.foreground_package}.`, {
      inputs,
      checkpoints,
      execEnvelopes,
      diagnostics: {
        runtimeState: 'poisoned',
        landingSurface: searchSurface,
        suggestionStrategy,
        snapshotPackages: summarizeSnapshotPackages(submitProbeSnapshotSteps),
        warnings: ['Another app took focus after Enter-key submission.']
      }
    });
  }

  finalSnapshotText = getSnapshotText(submitProbeResult);
}

if (!isResultsSurface(finalSnapshotText)) {
  emitFailureAndExit(
    isAutocompleteSurface(finalSnapshotText)
      ? 'Amazon search did not leave the autocomplete surface for a readable results page.'
      : 'Amazon search did not reach a readable results page.',
    {
    inputs,
    checkpoints,
    execEnvelopes,
    diagnostics: {
      runtimeState: 'unknown',
      landingSurface: searchSurface,
      suggestionStrategy,
      autocompleteStillVisible: isAutocompleteSurface(finalSnapshotText)
    }
  });
}

checkpoints.push({
  id: 'results_reached',
  status: 'ok',
  evidence: {
    kind: 'text',
    text: suggestionStrategy
  },
  note: 'Reached the results surface after the final search pass.'
});

logSkillProgress(skillId, `Reached results using ${suggestionStrategy}.`);
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
        suggestionStrategy,
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
        suggestionStrategy,
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

const snapshotSeries = [finalSnapshotText, ...additionalSnapshots];
const products = mergeProductsFromSnapshots(snapshotSeries, query);

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
    result: null,
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
      suggestionStrategy,
      scrollCount: MAX_SCROLLS,
      snapshotCount: snapshotSeries.length
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
  result: { kind: 'json', value: { query, items: structuredResults } },
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
    suggestionStrategy,
    scrollCount: MAX_SCROLLS,
    snapshotCount: snapshotSeries.length
  }
}));
