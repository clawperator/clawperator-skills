const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveClawperatorBin, resolveOperatorPackage } = require('./common');
const { LABELS, normalize, validateRead, digest } = require('./settings_version_model');
const directory = () => {
  const value=process.env.VERSION_RUN_DIR;
  if (!value || !path.isAbsolute(value)) throw Error('VERSION_RUN_DIR must be an absolute evidence directory');
  return value;
};
const file = name => path.join(directory(),name);
const read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
const save = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2));
function command(args) {
  if (!process.env.CLAWPERATOR_BIN?.trim() || !process.env.CLAWPERATOR_DEVICE_ID?.trim()) throw Error('Explicit CLAWPERATOR_BIN and device required');
  const bin=resolveClawperatorBin();
  const events=fs.existsSync(file('events.json')) ? read('events.json') : [];
  const index=events.length;
  const started=performance.now();
  const argv=[...bin.args,...args,'--device',process.env.CLAWPERATOR_DEVICE_ID,'--operator-package',resolveOperatorPackage(),'--no-daemon','--output','json'];
  const child=spawnSync(bin.cmd,argv,{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,env:process.env});
  const elapsedMs=performance.now()-started;
  fs.writeFileSync(file(`command-${index}.stdout`),child.stdout ?? '');
  fs.writeFileSync(file(`command-${index}.stderr`),child.stderr ?? '');
  let response;
  try { response=JSON.parse(child.stdout); } catch { response={error:{code:'UNPARSEABLE_OUTPUT'}}; }
  save(`command-${index}.json`,response);
  events.push({index,args,device:process.env.CLAWPERATOR_DEVICE_ID,runId:process.env.CLAWPERATOR_SKILL_RUN_ID,elapsedMs,exitCode:child.status,signal:child.signal,commandId:response.envelope?.commandId,taskId:response.envelope?.taskId});
  save('events.json',events);
  if (child.status!==0 || response.envelope?.status!=='success' || response.envelope.stepResults.some(s=>!s.success)) throw Error(`Clawperator command ${index} failed; inspect retained evidence`);
  return {response,index};
}
function observe() {
  const {response,index}=command(['snapshot','--compact','--max-nodes','200','--max-text-chars','1024']);
  const state=fs.existsSync(file('state.json')) ? read('state.json') : {fields:{},actions:0};
  const metadata=response.envelope.stepResults.find(s=>s.actionType==='snapshot').data;
  if(metadata.foreground_package==='com.android.settings' && metadata.has_overlay==='true' && metadata.overlay_package!==state.overlayApproval?.package) {
    const screenshotPath=file(`overlay-${index}.png`);
    command(['screenshot','--path',screenshotPath]);
    state.pendingOverlay={captureId:response.envelope.commandId,package:metadata.overlay_package,screenshotPath,observedAt:Date.now()};
    save('state.json',state);
    return {status:'overlay_review_required',...state.pendingOverlay,note:'Use the image tool to inspect this screenshot. If this is an unobstructive overlay and Settings is usable, approve-overlay <captureId> for this run. Otherwise stop truthfully.'};
  }
  const observation=normalize(response,{allowedOverlayPackage:state.overlayApproval?.package});
  state.observation=observation;
  state.captureIndex=index;
  state.observedAt=Date.now();
  for (const [field,observed] of Object.entries(observation.fields)) {
    if (state.fields[field]?.value === observed.value) continue;
    const result=command(['read-value','--label',LABELS[field]]);
    const step=validateRead(result.response,field,observed);
    state.fields[field]={...observed,readIndex:result.index,snapshotIndex:index,stepResultId:step.id};
  }
  save('state.json',state);
  return publicState(state);
}
function publicState(state) {
  return { ...state.observation, collected:state.fields, actions:state.actions, complete:Object.keys(LABELS).every(k=>state.fields[k]), evidenceDirectory:directory() };
}
function approveOverlay(captureId) {
  const state=read('state.json');
  const pending=state.pendingOverlay;
  if(!pending?.package || pending.captureId!==captureId || Date.now()-pending.observedAt>45000) throw Error('Overlay review is stale; observe again');
  if(!fs.existsSync(pending.screenshotPath)) throw Error('Overlay screenshot missing');
  state.overlayApproval={...pending,note:'Runtime Codex explicitly accepted the unobstructive overlay after image inspection; valid only for this run and overlay package.'};
  delete state.pendingOverlay;
  save('state.json',state);
  return observe();
}
function act(id,captureId) {
  const state=read('state.json');
  if (state.pendingOverlay) throw Error('Review pending overlay before acting');
  if (state.observation.captureId!==captureId || Date.now()-state.observedAt>45000) throw Error('Stale capture; observe again');
  if (state.actions>=18) throw Error('Run action limit reached');
  const candidate=state.observation.candidates.find(c=>c.id===id);
  if (!candidate) throw Error('Choose an offered candidate');
  state.actions++;
  save('state.json',state);
  command(candidate.command);
  return observe();
}
function verifyEvidence(frame) {
  const events=read('events.json');
  const state=read('state.json');
  if(state.pendingOverlay) throw Error('Unreviewed overlay remains');
  const lastSnapshot=events.findLast(e=>e.args[0]==='snapshot');
  if(!lastSnapshot) throw Error('Final snapshot missing');
  normalize(read(`command-${lastSnapshot.index}.json`),{allowedOverlayPackage:state.overlayApproval?.package});
  if (frame.status!=='success' || frame.result?.kind!=='json' || frame.skillId!==process.env.CLAWPERATOR_SKILL_ID || frame.contractVersion!=='1.0.0' || frame.terminalVerification?.status!=='verified') throw Error('Missing valid success frame');
  for (const field of Object.keys(LABELS)) {
    const evidence=state.fields[field];
    if (!evidence || frame.result.value[field]!==evidence.value) throw Error(`Missing or changed ${field}`);
    const snap=read(`command-${evidence.snapshotIndex}.json`);
    const observed=normalize(snap,{allowedOverlayPackage:state.overlayApproval?.package}).fields[field];
    if (!observed || observed.value!==evidence.value) throw Error('Snapshot row proof mismatch');
    const response=read(`command-${evidence.readIndex}.json`);
    const step=validateRead(response,field,observed);
    const ref=frame.result.value.evidence[field];
    if (ref.execEnvelopeIndex!==evidence.readIndex || ref.stepResultId!==step.id || digest(frame.execEnvelopes[ref.execEnvelopeIndex])!==digest(response.envelope)) throw Error('Envelope reference mismatch');
    for (const i of [evidence.readIndex,evidence.snapshotIndex]) if(events[i].device!==process.env.CLAWPERATOR_DEVICE_ID || events[i].runId!==process.env.CLAWPERATOR_SKILL_RUN_ID) throw Error('Evidence belongs to another run or device');
  }
  const screenshot=events.findLast(e=>e.args[0]==='screenshot');
  if (!screenshot || screenshot.exitCode!==0 || events.at(-1).args[0]!=='screenshot') throw Error('Final screenshot missing');
  const png=fs.readFileSync(file('final.png'));
  if (png.length<24 || png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || !png.readUInt32BE(16) || !png.readUInt32BE(20)) throw Error('Invalid screenshot');
  return true;
}
function finish() {
  observe();
  const state=read('state.json');
  if(state.pendingOverlay) throw Error('Review overlay before finishing');
  if (!Object.keys(LABELS).every(k=>state.fields[k])) throw Error('Both UI fields required');
  command(['screenshot','--path',file('final.png')]);
  const events=read('events.json');
  const envelopes=events.map(e=>read(`command-${e.index}.json`).envelope);
  const evidence=Object.fromEntries(Object.entries(state.fields).map(([k,v])=>[k,{execEnvelopeIndex:v.readIndex,stepResultId:v.stepResultId}]));
  const value={...Object.fromEntries(Object.entries(state.fields).map(([k,v])=>[k,v.value])),evidence};
  const result={result:{kind:'json',value},status:'success',contractVersion:'1.0.0',skillId:process.env.CLAWPERATOR_SKILL_ID,goal:{kind:'get_android_version_details'},inputs:{},checkpoints:[{id:'settings_opened',status:'ok',note:'Settings foreground observed in retained snapshots'},...Object.entries(state.fields).map(([k,v])=>({id:k+'_observed',status:'ok',evidence:{kind:'result_envelope_ref',...evidence[k]},note:`Exact ${v.label} label and sibling value matched live read-value`})),{id:'terminal_state_verified',status:'ok',note:'Both UI rows verified and final screenshot retained'}],terminalVerification:{status:'verified',observed:{kind:'json',value},note:'Exact snapshot row values independently matched successful read-value results'},execEnvelopes:envelopes,diagnostics:{runtimeState:'healthy',evidenceDirectory:directory()}};
  verifyEvidence(result);
  save('verified-result.json',result);
  return result;
}
module.exports={command,observe,approveOverlay,act,finish,verifyEvidence,file,read,save,publicState};
