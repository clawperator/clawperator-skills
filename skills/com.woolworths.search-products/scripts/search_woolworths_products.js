#!/usr/bin/env node
const { runClawperator, runClawperatorCommand, findAttribute, resolveOperatorPackage, logSkillProgress } = require('../../utils/common');

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const rawQuery = process.argv[3] || process.env.QUERY || '';
const query = rawQuery.trim();
const operatorPkg = resolveOperatorPackage(process.argv[4]);
const MAX_QUERY_LENGTH = 256;
const skillId = "com.woolworths.search-products";
const FRAME = '[Clawperator-Skill-Result]';
const CONTRACT_VERSION = '1.0.0';
const SEARCH_RESULTS_POLL_TIMEOUT_MS = 12000;
const SEARCH_RESULTS_POLL_INTERVAL_MS = 500;

function writeFramed(payload) {
  console.log(FRAME);
  console.log(JSON.stringify(payload));
}

function failFramed(message) {
  logSkillProgress(skillId, message);
  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: 'search_products' },
    inputs: { query },
    result: null,
    status: 'failed',
    checkpoints: [{ id: 'search_results', status: 'failed', note: message }],
    terminalVerification: {
      status: 'failed',
      expected: { kind: 'text', text: 'Woolworths search results snapshot' },
      observed: { kind: 'text', text: message },
      note: message,
    },
    diagnostics: { runtimeState: 'unknown' },
  });
  console.error(`⚠️ ${message}`);
}

function captureDirectSnapshot() {
  const outcome = runClawperatorCommand('snapshot', [
    '--device',
    deviceId,
    '--operator-package',
    operatorPkg,
    '--json',
  ], { encoding: 'utf8' });

  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }

  try {
    const parsed = JSON.parse(outcome.result);
    const steps = (parsed && parsed.envelope && parsed.envelope.stepResults) || [];
    const snapStep = steps.find((step) => step && step.actionType === 'snapshot_ui')
      || steps.find((step) => step && step.data && typeof step.data.text === 'string');
    return {
      ok: true,
      text: snapStep && snapStep.data && typeof snapStep.data.text === 'string' ? snapStep.data.text : '',
    };
  } catch (error) {
    return { ok: false, error: `Failed to parse direct snapshot output: ${error.message}` };
  }
}

function isWoolworthsSearchResultsReady(text) {
  if (!text || text.length < 120) {
    return false;
  }
  const lower = text.toLowerCase();
  if (!lower.includes('woolworths')) {
    return false;
  }
  const priceHits = (text.match(/\$\d+\.\d{2}/g) || []).length;
  return priceHits >= 2;
}

function waitForWoolworthsSearchResults({ previousText = '', timeoutMs = SEARCH_RESULTS_POLL_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  let lastText = '';

  while (Date.now() < deadline) {
    const snap = captureDirectSnapshot();
    if (snap.ok) {
      lastText = snap.text || '';
      if (lastText && isWoolworthsSearchResultsReady(lastText) && lastText !== previousText) {
        return { ok: true, text: lastText };
      }
    } else {
      lastError = snap.error || '';
    }

    if (Date.now() >= deadline) {
      break;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SEARCH_RESULTS_POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    error: lastError
      ? `Timed out waiting for readable Woolworths search results: ${lastError}`
      : 'Timed out waiting for readable Woolworths search results.',
    text: lastText,
  };
}

if (!deviceId || !query) {
  console.error('Usage: node search_woolworths_products.js <device_id> <query> [operator_package]');
  process.exit(1);
}

if (query.length > MAX_QUERY_LENGTH) {
  console.error(`Query too long (max ${MAX_QUERY_LENGTH})`);
  process.exit(1);
}

const commandId = `skill-woolworths-search-${Date.now()}`;

const execution = {
  commandId,
  taskId: commandId,
  source: 'clawperator-skill',
  expectedFormat: 'android-ui-automator',
  timeoutMs: 120000,
  actions: [
    { id: 'close', type: 'close_app', params: { applicationId: 'com.woolworths' } },
    { id: 'open', type: 'open_app', params: { applicationId: 'com.woolworths' } },
    {
      id: 'wait_search_affordance',
      type: 'wait_for_node',
      params: { matcher: { contentDescContains: 'Search products' }, timeoutMs: 20000 },
    },
    { id: 'click-search', type: 'click', params: { matcher: { contentDescContains: 'Search products' } } },
    {
      id: 'wait_field',
      type: 'wait_for_node',
      params: { matcher: { role: 'textfield' }, timeoutMs: 15000 },
    },
    {
      id: 'type-query',
      type: 'enter_text',
      params: { matcher: { role: 'textfield' }, text: query, clear: true, submit: true },
    },
    { id: 'snap', type: 'snapshot_ui' },
  ],
};

logSkillProgress(skillId, "Opening Woolworths app...");
logSkillProgress(skillId, `Searching for \"${query}\"...`);
logSkillProgress(skillId, "Capturing search results...");

const { ok, result, error } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  failFramed(String(error || 'Skill execution failed'));
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === 'snap');
let snapText = snapStep && snapStep.data ? snapStep.data.text : null;

if (snapText && !isWoolworthsSearchResultsReady(snapText)) {
  const hydrated = waitForWoolworthsSearchResults({ previousText: snapText, timeoutMs: SEARCH_RESULTS_POLL_TIMEOUT_MS });
  if (hydrated.ok) {
    snapText = hydrated.text;
  }
}

if (snapText) {
  logSkillProgress(skillId, "Parsing product listings...");
  console.log(`✅ Woolworths search results for '${query}':`);
  const lines = snapText.split('\n');
  const items = [];

  for (const line of lines) {
    const content = findAttribute(line, 'content-desc') || findAttribute(line, 'text') || '';
    const nameRaw = content.split('\n')[0] || '';
    const name = nameRaw.trim();

    if (content.includes('$') && content.length > 5 && name.length > 1) {
      const priceMatch = content.match(/\$([0-9]+\.[0-9]{2})/);
      const wasMatch = content.match(/Was \$([0-9]+\.[0-9]{2})/i);
      const specialMatch = content.toLowerCase().includes('special') || content.toLowerCase().includes('save');
      const current = priceMatch ? '$' + priceMatch[1] : 'NA';
      const original = wasMatch ? '$' + wasMatch[1] : 'NA';
      const onSale = specialMatch || wasMatch ? 'YES' : 'NO';
      items.push({ name, current_price: current, on_sale: onSale, original_price: original });
      console.log(`- ${name}`);
      console.log(`  current_price: ${current}`);
      console.log(`  on_sale: ${onSale}`);
      console.log(`  original_price: ${original}`);
    }
  }

  if (items.length === 0) {
    writeFramed({
      contractVersion: CONTRACT_VERSION,
      skillId,
      goal: { kind: 'search_products' },
      inputs: { query },
      result: null,
      status: 'indeterminate',
      checkpoints: [{ id: 'results_collected', status: 'ok', note: 'Snapshot present but no product rows parsed.' }],
      terminalVerification: {
        status: 'failed',
        expected: { kind: 'text', text: 'Structured product rows with prices' },
        observed: { kind: 'text', text: 'No product lines matched the Woolworths heuristics.' },
        note: 'Search surface was captured but the parser found no product rows.',
      },
      diagnostics: { runtimeState: 'healthy', parseHint: 'zero_rows' },
    });
    process.exit(0);
  }

  writeFramed({
    contractVersion: CONTRACT_VERSION,
    skillId,
    goal: { kind: 'search_products' },
    inputs: { query },
    result: { kind: 'json', value: { query, items } },
    status: 'success',
    checkpoints: [{ id: 'results_collected', status: 'ok', note: `Parsed ${items.length} product row(s) from the snapshot.` }],
    terminalVerification: {
      status: 'verified',
      expected: { kind: 'text', text: 'Structured Woolworths result rows' },
      observed: { kind: 'json', value: { query, count: items.length } },
      note: 'Product rows were extracted from the accessibility snapshot.',
    },
    diagnostics: { runtimeState: 'healthy' },
  });
} else {
  failFramed('Could not capture Woolworths search snapshot');
  process.exit(2);
}
