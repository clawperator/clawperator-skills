#!/usr/bin/env node
const { runClawperator, findAttribute, resolveOperatorPackage, logSkillProgress } = require('../../utils/common');

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const rawQuery = process.argv[3] || process.env.QUERY || '';
const query = rawQuery.trim();
const operatorPkg = resolveOperatorPackage(process.argv[4]);
const MAX_QUERY_LENGTH = 256;

if (!deviceId || !query) {
  console.error('Usage: node search_woolworths_products.js <device_id> <query> [operator_package]');
  process.exit(1);
}

if (query.length > MAX_QUERY_LENGTH) {
  console.error(`Query too long (max ${MAX_QUERY_LENGTH})`);
  process.exit(1);
}

const commandId = `skill-woolworths-search-${Date.now()}`;
const skillId = "com.woolworths.search-products";
const execution = {
  commandId,
  taskId: commandId,
  source: 'clawperator-skill',
  expectedFormat: 'android-ui-automator',
  timeoutMs: 90000,
  actions: [
    { id: 'close', type: 'close_app', params: { applicationId: 'com.woolworths' } },
    { id: 'wait_close', type: 'sleep', params: { durationMs: 1500 } },
    { id: 'open', type: 'open_app', params: { applicationId: 'com.woolworths' } },
    { id: 'wait_open', type: 'sleep', params: { durationMs: 8000 } },
    { id: 'click-search', type: 'click', params: { matcher: { contentDescContains: 'Search products' } } },
    { id: 'wait_search', type: 'sleep', params: { durationMs: 1500 } },
    { id: 'type-query', type: 'enter_text', params: { matcher: { role: 'textfield' }, text: query, submit: true } },
    { id: 'wait_results', type: 'sleep', params: { durationMs: 10000 } },
    { id: 'snap', type: 'snapshot_ui' }
  ]
};

logSkillProgress(skillId, "Opening Woolworths app...");
logSkillProgress(skillId, `Searching for \"${query}\"...`);
logSkillProgress(skillId, "Capturing search results...");
const { ok, result, error, raw } = runClawperator(execution, deviceId, operatorPkg);

if (!ok) {
  console.error(`⚠️ Skill execution failed: ${error}`);
  process.exit(2);
}

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === 'snap');
const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

if (snapText) {
  logSkillProgress(skillId, "Parsing product listings...");
  console.log(`✅ Woolworths search results for '${query}':`);
  const lines = snapText.split('\n');
  
  lines.forEach(line => {
    const content = findAttribute(line, 'content-desc') || findAttribute(line, 'text') || '';
    const nameRaw = content.split('\n')[0] || '';
    const name = nameRaw.trim();

    if (content.includes('$') && content.length > 5 && name.length > 1) {
      const priceMatch = content.match(/\$([0-9]+\.[0-9]{2})/);
      const wasMatch = content.match(/Was \$([0-9]+\.[0-9]{2})/i);
      const specialMatch = content.toLowerCase().includes('special') || content.toLowerCase().includes('save');

      console.log(`- ${name}`);
      console.log(`  current_price: ${priceMatch ? '$' + priceMatch[1] : 'NA'}`);
      console.log(`  on_sale: ${specialMatch || wasMatch ? 'YES' : 'NO'}`);
      console.log(`  original_price: ${wasMatch ? '$' + wasMatch[1] : 'NA'}`);
    }
  });
} else {
  console.error('⚠️ Could not capture Woolworths search snapshot');
  process.exit(2);
}
