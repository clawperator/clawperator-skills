const crypto = require('node:crypto');
const LABELS = { androidVersion: 'Android version', buildNumber: 'Build number' };
const NAVIGATION = /^(About (?:phone|tablet|device|emulated device)|Software (?:information|info)|Device information|System|Android version)$/i;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalize(snapshot, options = {}) {
  const compact = snapshot.compact;
  const step = snapshot.envelope?.stepResults?.find(s => s.actionType === 'snapshot' && s.success);
  if (snapshot.envelope?.status !== 'success' || !step || !compact || compact.truncated || compact.nodes.some(n => n.textTruncated || n.contentDescriptionTruncated)) throw Error('Snapshot failed or truncated; reacquire before choosing actions');
  if (step.data.foreground_package !== 'com.android.settings') throw Error('Unexpected foreground; return control to Codex');
  if (step.data.has_overlay !== 'false' && !(step.data.has_overlay === 'true' && options.allowedOverlayPackage && step.data.overlay_package === options.allowedOverlayPackage)) throw Error('Unexpected overlay; Codex must inspect screenshot before continuing');
  const nodes = compact.nodes;
  const visible = nodes.filter(n => n.visibleToUser === true && n.enabled === true && n.accessibilityDataSensitive !== true);
  const byPath = new Map(nodes.map(n => [n.nodePath, n]));
  const clickable = node => {
    for (let current = node; current; current = byPath.get(current.parentPath)) if (current.clickable && current.visibleToUser && current.enabled) return true;
    return false;
  };
  const fields = {};
  for (const [field, label] of Object.entries(LABELS)) {
    const labels = visible.filter(n => n.text === label);
    if (labels.length !== 1) continue;
    const node = labels[0];
    // Samsung wraps the title in title_frame while the summary is its sibling.
    // Ascend only one extra transparent level; never search the next row for a value.
    let scopePath=node.parentPath;
    for(let depth=0;depth<2;depth++) {
      const inScope=n=>{
        let parent=n.parentPath;
        for(let hop=0;hop<nodes.length;hop++) {
          if(parent===scopePath) return true;
          const ancestor=byPath.get(parent);
          if(!ancestor) return false;
          parent=ancestor.parentPath;
        }
        return false;
      };
      const texts=visible.filter(n=>n.text?.trim() && inScope(n));
      const values=texts.filter(n=>n.nodePath!==node.nodePath);
      if(texts.length===2 && values.length===1 && values[0].resourceId.endsWith('/summary')) {
        fields[field]={label,value:values[0].text,labelPath:node.nodePath,valuePath:values[0].nodePath,parentPath:scopePath};
        break;
      }
      if(texts.length!==1) break;
      const scope=byPath.get(scopePath);
      if(!scope || (scope.resourceId && !scope.resourceId.endsWith('/title_frame'))) break;
      scopePath=scope.parentPath;
    }
  }
  const candidates = [];
  for (const n of visible) {
    if (!NAVIGATION.test(n.text) || !clickable(n) || visible.filter(other => other.text === n.text).length !== 1) continue;
    if (n.text === LABELS.androidVersion && fields.androidVersion) continue;
    candidates.push({ id: `tap-${candidates.length}`, description: `Open visible ${n.text} row`, command: ['click', '--text', n.text], nodePath: n.nodePath });
  }
  // Prefer the deepest uniquely identified list; an outer collapsing ScrollView can coexist.
  const scrolls = visible.filter(n => n.scrollable && n.resourceId && visible.filter(other => other.resourceId === n.resourceId).length === 1).sort((a,b) => b.nodePath.split('.').length - a.nodePath.split('.').length);
  if (scrolls[0]) for (const direction of ['down','up']) candidates.push({id:`scroll-${direction}`, description:`Scroll visible list ${direction}`, command:['scroll',direction,'--container-id',scrolls[0].resourceId], nodePath:scrolls[0].nodePath});
  const headings = visible.filter(n => NAVIGATION.test(n.text) || NAVIGATION.test(n.contentDescription) || ['Settings','Search Settings'].includes(n.text)).map(n => n.text || n.contentDescription);
  return { captureId: snapshot.envelope.commandId, headings:[...new Set(headings)], fields, candidates, signature: digest(visible.map(n => [n.nodePath,n.text,n.bounds])), totalNodes:compact.totalNodes, returnedNodes:compact.returnedNodes, truncated:compact.truncated };
}
function validateRead(response, field, observed) {
  const label = LABELS[field];
  const step = response.envelope?.stepResults?.find(s => s.actionType === 'read_key_value_pair' && s.success && s.data.label === label);
  if (response.envelope?.status !== 'success' || !step || typeof step.data.value !== 'string' || !step.data.value.trim() || step.data.value !== observed.value) throw Error(`UI read does not match associated snapshot row: ${field}`);
  return step;
}
function validateChoice(response, criteria, threshold = 0.6) {
  const answer = response.answers?.next_action;
  if (response.model !== 'jev-1.13.0' || answer?.type !== 'choice' || !Object.hasOwn(criteria,answer.choice) || !Number.isFinite(answer.confidence) || answer.confidence < threshold || answer.confidence > 1) throw Error('Invalid or uncertain Jev answer');
  const p=answer.probabilities;
  if (!p || Object.keys(p).length !== Object.keys(criteria).length || Object.keys(criteria).some(k => !Number.isFinite(p[k]) || p[k]<0 || p[k]>1) || Math.abs(Object.values(p).reduce((a,b)=>a+b,0)-1)>0.02 || p[answer.choice] < Math.max(...Object.values(p))) throw Error('Invalid Jev probability distribution');
  return answer.choice;
}
module.exports={ LABELS, normalize, validateRead, validateChoice, digest };
