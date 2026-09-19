#!/usr/bin/env node
// Runs one selected device at a time; raw evidence stays outside tracked sources.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const {resolveClawperatorBin}=require('../skills/utils/common');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const device=option('--device'),alias=option('--alias'),phase=option('--phase')??'timed',arm=option('--arm');
const research=process.env.VERSION_RESEARCH_DIR;
if(!device || !/^[a-z][a-z0-9-]+$/.test(alias??'') || !research || !process.env.CLAWPERATOR_BIN || !['pilot','timed'].includes(phase)) throw Error('Require --device, safe --alias, --phase pilot|timed, VERSION_RESEARCH_DIR and explicit CLAWPERATOR_BIN');
const base=path.resolve(research,'../artifacts/jev-rd',alias);
fs.mkdirSync(base,{recursive:true});
const bin=resolveClawperatorBin();
const operator=process.env.CLAWPERATOR_OPERATOR_PACKAGE??'com.clawperator.operator';
const env={...process.env,CLAWPERATOR_SKILLS_REGISTRY:path.join(root,'skills/skills-registry.json')};
function cli(argv,dir,name,timeout=30000) {
 const child=spawnSync(bin.cmd,[...bin.args,...argv],{cwd:root,env,encoding:'utf8',timeout,maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(dir,`${name}.stdout`),child.stdout??'');fs.writeFileSync(path.join(dir,`${name}.stderr`),child.stderr??'');
 let json;try{json=JSON.parse(child.stdout);}catch{json=null;}
 return {child,json};
}
const targeted=argv=>[...argv,'--device',device,'--operator-package',operator,'--no-daemon'];
function setup(dir) {
 for(const [i,argv] of [['close',['close','com.android.settings']],['home',['press','home']],['neutral',['snapshot','--compact','--max-nodes','200']]]) {
  const {child,json}=cli(targeted(argv),dir,`reset-${i}`);
  if(child.status!==0 || json?.envelope?.status!=='success') throw Error(`Setup ${i} failed; not a timed attempt`);
  if(i==='neutral' && !/launcher/i.test(json.envelope.stepResults[0].data.foreground_package)) throw Error('Neutral launcher not confirmed');
 }
}
function attempt(arm,repetition,sequence) {
 const id=phase==='pilot'?(option('--id')??`pilot-${arm}-${Date.now()}`):`${alias}-${arm}${repetition}`;
 const dir=path.join(base,id);
 const deviceFreeze=path.join(research,`frozen-config-${alias}.json`);
 const freezePath=fs.existsSync(deviceFreeze)?deviceFreeze:path.join(research,'frozen-config.json');
 const freeze=phase==='timed'&&fs.existsSync(freezePath)?JSON.parse(fs.readFileSync(freezePath)):null;
 if(phase==='timed') {
  if(!freeze) throw Error('Freeze configuration before timed runs');
  for(const [file,expected] of Object.entries(freeze.sourceHashes)) {
   const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
   if(actual!==expected) throw Error(`Frozen source changed: ${file}`);
  }
 }
 fs.mkdirSync(dir);setup(dir);
 env.VERSION_RUN_DIR=dir;
 const skillId=`com.android.settings.get-version-details-codex${arm==='b'?'-with-jev':''}`;
 const startedAt=new Date().toISOString(),t0=performance.now();
 const {child,json}=cli(['skills','run',skillId,'--device',device,'--operator-package',operator,'--timeout','300000'],dir,'wrapper',315000);
 let outcome='failed',failure=json?.skillResult?.diagnostics?.reason??json?.message??'Missing wrapper JSON';
 const events=fs.existsSync(path.join(dir,'events.json'))?JSON.parse(fs.readFileSync(path.join(dir,'events.json'))):[];
 const jev=fs.existsSync(path.join(dir,'jev.json'))?JSON.parse(fs.readFileSync(path.join(dir,'jev.json'))):[];
 const fallbacks=fs.existsSync(path.join(dir,'fallbacks.json'))?JSON.parse(fs.readFileSync(path.join(dir,'fallbacks.json'))):[];
 const childExit=fs.existsSync(path.join(dir,'child-exit.json'))?JSON.parse(fs.readFileSync(path.join(dir,'child-exit.json'))):null;
 if(child.status===0 && json?.skillResult?.status==='success') {
  try {
   process.env.VERSION_RUN_DIR=dir;process.env.CLAWPERATOR_DEVICE_ID=device;process.env.CLAWPERATOR_SKILL_ID=skillId;process.env.CLAWPERATOR_SKILL_RUN_ID=json.logs.skillRunId;
   require('../skills/utils/settings_version_runtime').verifyEvidence(json.skillResult);
   outcome='success';failure=null;
  } catch(error) {failure=error.message;}
 } else if(child.signal || childExit?.timedOut || json?.code?.includes('TIMEOUT')) outcome='timeout';
 const files=fs.readdirSync(dir).filter(n=>fs.statSync(path.join(dir,n)).isFile());
 const hashes=Object.fromEntries(files.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex')]));
 fs.writeFileSync(path.join(dir,'hashes.json'),JSON.stringify(hashes,null,2));
 const wallMs=performance.now()-t0;
 const transcript=fs.existsSync(path.join(dir,'codex.jsonl'))?fs.readFileSync(path.join(dir,'codex.jsonl'),'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch{return {};}}):[];
 const metadata=fs.existsSync(path.join(dir,'metadata.json'))?JSON.parse(fs.readFileSync(path.join(dir,'metadata.json'))):null;
 const value=outcome==='success'?json.skillResult.result.value:null;
 if(failure) failure=String(failure).replaceAll(dir,'<run_artifact_dir>').replace(/\/Users\/[^/\s]+/g,'/Users/<local_user>');
 const record={id,phase,deviceAlias:alias,arm,repetition,sequence,startedAt,finishedAt:new Date().toISOString(),wallMs,terminalFrameMs:null,outcome,failure,exitCode:child.status,wrapperStatus:json?.status??(child.status===0&&json?.skillResult?'success':'unknown'),nestedStatus:json?.skillResult?.status,androidVersion:value?.androidVersion??null,buildNumber:value?.buildNumber??null,commandCount:events.length,snapshots:events.filter(e=>e.args[0]==='snapshot').length,screenshots:events.filter(e=>e.args[0]==='screenshot').length,clawperatorMs:events.reduce((s,e)=>s+e.elapsedMs,0),codexToolCalls:transcript.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').length,codexTurns:transcript.filter(e=>e.type==='turn.started').length,jevCalls:jev.length,jevMs:jev.reduce((s,e)=>s+e.elapsedMs,0),jevLatenciesMs:jev.map(e=>e.elapsedMs),jevModels:[...new Set(jev.map(e=>e.response?.model).filter(Boolean))],jevInputTokens:jev.reduce((s,e)=>s+(e.response?.usage?.input_tokens??0),0),fallbacks:fallbacks.map(f=>f.reason),sourceRevision:freeze?.sourceRevision??null,sourceHashes:freeze?.sourceHashes??null,model:metadata?.model,effort:metadata?.effort,codexVersion:metadata?.codexVersion,cliVersion:metadata?.cliVersion,transport:'direct --no-daemon',deadlineMs:300000,childCleanup:childExit,artifactDirectory:`artifacts/jev-rd/${alias}/${id}`,hashManifest:`artifacts/jev-rd/${alias}/${id}/hashes.json`};
 fs.writeFileSync(path.join(dir,'record.json'),JSON.stringify(record,null,2));
 fs.appendFileSync(path.join(research,phase==='timed'?'measured-runs.jsonl':'pilot-runs.jsonl'),JSON.stringify(record)+'\n');
 fs.appendFileSync(path.join(research,'clawperator-usage-notes.md'),`\n- ${phase} ${id}: ${outcome}, ${(wallMs/1000).toFixed(2)} s; ${events.length} CLI commands; ${jev.length} Jev requests (${(record.jevMs/1000).toFixed(3)} s); ${fallbacks.length} fallbacks. Evidence: ${record.artifactDirectory}.${failure?' Failure: '+failure:''}\n`);
 const snapshots=events.filter(e=>e.args[0]==='snapshot').map(e=>{const p=path.join(dir,`command-${e.index}.json`);const s=JSON.parse(fs.readFileSync(p));return {bytes:fs.statSync(p).size,nodes:s.compact?.totalNodes,truncated:s.compact?.truncated};});
 fs.appendFileSync(path.join(research,'clawperator-snapshot-usage-notes.md'),`\n- ${id}: ${JSON.stringify(snapshots)}; structured helper output preserved capture references and label/summary parent association. ${record.codexToolCalls} Codex tool calls. Full snapshot files: ${record.artifactDirectory}.\n`);
 console.log(JSON.stringify(record));
}
if(phase==='pilot') {if(!['a','b'].includes(arm))throw Error('Pilot requires --arm a|b');attempt(arm,0,0);}
else {let sequence=0;for(let rep=1;rep<=5;rep++)for(const arm of rep%2?['a','b']:['b','a'])attempt(arm,rep,++sequence);}
