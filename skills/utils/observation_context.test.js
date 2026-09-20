const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeCompact, projectObservation, ancestors, bytes} = require('./observation_context');
const node = (nodePath,parentPath,extra={}) => ({nodePath,parentPath,text:'',resourceId:'',bounds:'[0,0][100,100]',visibleToUser:true,enabled:true,...extra});
const snapshot = nodes => ({envelope:{status:'success',commandId:'capture',taskId:'task',stepResults:[{actionType:'snapshot',success:true,data:{foreground_package:'test.settings'}}]},compact:{schemaVersion:1,commandId:'capture',taskId:'task',nodes,totalNodes:nodes.length,returnedNodes:nodes.length,omittedNodes:0,truncated:false,rawArtifactPath:'source.xml'}});
const context = {device:'test-device',operatorPackage:'test.operator',receivedAt:'2026-01-01T00:00:01Z',sourceReference:'capture.json',viewport:{bounds:{left:0,top:0,right:100,bottom:100},reference:'viewport.png',observedAt:'2026-01-01T00:00:00Z',sourceKind:'image-dimensions',atomicWithTree:false}};
const normalize = s => normalizeCompact(s,context);
const select = (s,paths,specs=[],limits={}) => projectObservation(normalize(s),{selectPaths:paths,candidateSpecs:specs,...limits});
test('retains anonymous ancestry, exact values, four state cases and provenance without path inference',()=>{
 const s=snapshot([node('row',null,{checked:false,selected:null}),node('unrelated.name','row',{text:'Build number'}),node('value','row',{text:'  synthetic.build  ',checked:true}),node('row.fake',null,{text:'Other row'})]);
 const result=select(s,['unrelated.name','value']);
 assert.deepEqual(result.nodes.map(n=>n.nodePath),['row','unrelated.name','value']);
 assert.equal(result.nodes[0].checked,false);assert.equal(result.nodes[0].selected,null);
 assert.equal(Object.hasOwn(result.nodes[1],'checked'),false);assert.equal(result.nodes[2].checked,true);
 assert.equal(result.nodes[2].text,'  synthetic.build  ');
 assert.equal(result.coverage.projection.deliberateOmissions,1);
 assert.equal(result.coverage.source.source,'complete');
 assert.equal(result.provenance.rawReference,'source.xml');assert.equal(result.provenance.device,'test-device');
 assert.equal(result.provenance.viewport.atomicWithTree,false);
 assert.deepEqual(ancestors(result.nodes[1],new Map(result.nodes.map(n=>[n.nodePath,n]))).map(n=>n.nodePath),['row']);
});
test('distinguishes capture incompleteness, projection filtering and budget refusal',()=>{
 const s=snapshot([node('root',null),node('label','root',{text:'Label'}),node('value','root',{text:'Value'})]);
 const limited=select(s,['label','value'],[],{maxNodes:2});
 assert.deepEqual(limited.nodes,[]);assert.equal(limited.coverage.projection.budgetOmissions,3);
 assert.equal(limited.coverage.source.source,'complete');assert.equal(limited.needsRicherEvidence,true);
 s.compact.totalNodes=4;s.compact.omittedNodes=1;s.compact.truncated=true;
 const partial=select(s,['label']);assert.equal(partial.coverage.source.source,'incomplete');assert.equal(partial.coverage.projection.truncated,false);
 assert.equal(partial.needsRicherEvidence,true);
 const tiny=select(snapshot([node('root',null,{text:'x'.repeat(4000)})]),['root'],[],{maxBytes:1500});
 assert.ok(bytes(tiny)<=1500);assert.equal(tiny.nodes.length,0);
 assert.throws(()=>select(s,['root'],[],{maxBytes:10}),/budget/);
});
test('duplicate IDs, hidden text collisions, disabled and offscreen nodes stay discovery hints',()=>{
 const s=snapshot([node('a',null,{text:'About phone',clickable:true}),node('b',null,{text:'About phone',visibleToUser:false}),node('c',null,{text:'System',clickable:true,enabled:false}),node('d',null,{text:'Software information',clickable:true,bounds:'[100,100][200,200]'}),node('e',null,{scrollable:true,resourceId:'list'}),node('f',null,{scrollable:true,resourceId:'list'})]);
 const specs=s.compact.nodes.map(n=>({id:n.nodePath,nodePath:n.nodePath,kind:n.scrollable?'scroll':'click'}));
 const p=select(s,[],specs);assert.equal(p.candidates.length,0);assert.equal(p.discoveryHints.length,6);
 assert.ok(p.discoveryHints[0].reasons.includes('selector_not_unique_or_supported'));
 assert.ok(p.discoveryHints[2].reasons.includes('enabled_not_true'));
 assert.equal(p.discoveryHints[3].viewportIntersection,false);
});
test('unique targets map to observed nodes and clickable anonymous parents; scroll containers remain separate',()=>{
 const s=snapshot([node('root',null,{scrollable:true,resourceId:'outer'}),node('short','root',{scrollable:true,resourceId:'inner'}),node('anonymous','short',{clickable:true}),node('long.path.with.dots','anonymous',{text:'About phone'})]);
 const p=select(s,[],[{id:'about',kind:'click',nodePath:'long.path.with.dots'},{id:'outer',kind:'scroll',nodePath:'root'},{id:'inner',kind:'scroll',nodePath:'short'}]);
 assert.equal(p.candidates.length,3);
 assert.deepEqual(p.candidates[0].selector,{textEquals:'About phone'});
 assert.equal(p.candidates[0].actionNodePath,'anonymous');assert.equal(p.nodes.length,4);
 assert.equal(p.candidates[2].selector.resourceId,'inner');
 const unknown=projectObservation(normalizeCompact(s),{selectPaths:[],candidateSpecs:[{id:'about',kind:'click',nodePath:'long.path.with.dots'}]});
 assert.equal(unknown.candidates.length,0);assert.ok(unknown.discoveryHints[0].reasons.includes('viewport_unknown'));
});
test('invalid sources fail while orphaned/truncated capture remains explicitly incomplete and nonactionable',()=>{
 const s=snapshot([node('a',null,{text:'About phone',clickable:true})]);
 for(const change of [v=>v.compact.nodes.push({...v.compact.nodes[0]}),v=>v.compact.commandId='other',v=>v.compact.nodes[0].enabled='false',v=>v.compact.nodes[0].parentPath='a',v=>v.compact.schemaVersion=2]) {
  const altered=structuredClone(s);change(altered);assert.throws(()=>normalize(altered));
 }
 s.compact.nodes[0].parentPath='missing';
 const orphan=select(s,[],[{id:'a',kind:'click',nodePath:'a'}]);assert.equal(orphan.coverage.source.missingParents,1);assert.equal(orphan.candidates.length,0);
 s.compact.nodes[0].parentPath=null;s.compact.nodes[0].textTruncated=true;
 assert.equal(select(s,['a']).coverage.source.textTruncated,true);
});
test('selection budget cannot leave a candidate whose supporting nodes were dropped',()=>{
 const s=snapshot([node('parent',null,{clickable:true}),node('label','parent',{text:'About phone'})]);
 const p=select(s,[],[{id:'about',nodePath:'label',kind:'click'}],{maxNodes:1});
 assert.equal(p.candidates.length,0);assert.equal(p.coverage.projection.truncated,true);
});

test('false or unknown eligibility and invalid geometry never become actionable',()=>{
 for(const extra of [{enabled:null},{visibleToUser:null},{bounds:'[0,0][0,100]'},{bounds:'[10,10][0,0]'},{bounds:null}]) {
  const s=snapshot([node('target',null,{text:'About phone',clickable:true,...extra})]);
  assert.equal(select(s,[],[{id:'tap',kind:'click',nodePath:'target'}]).candidates.length,0);
 }
 const s=snapshot([node('parent',null,{clickable:true,visibleToUser:false}),node('child','parent',{text:'About phone',clickable:true})]);
 assert.equal(select(s,[],[{id:'tap',kind:'click',nodePath:'child'}]).candidates.length,0);
});
