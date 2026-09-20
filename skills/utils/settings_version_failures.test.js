const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const runtime=require('./settings_version_runtime');
const {decide}=require('./settings_version_jev');
function environment(directory) {
 const previous={dir:process.env.VERSION_RUN_DIR,key:process.env.JEV_API_KEY};
 process.env.VERSION_RUN_DIR=directory;
 return ()=>{for(const [key,value] of [['VERSION_RUN_DIR',previous.dir],['JEV_API_KEY',previous.key]])if(value===undefined)delete process.env[key];else process.env[key]=value;};
}
test('stale and unknown candidates are rejected before a CLI command can run',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'version-stale-'));const restore=environment(directory);
 try {
  const state={observation:{captureId:'old',candidates:[]},observedAt:Date.now()-46000,actions:0};
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state));
  assert.throws(()=>runtime.act('anything','old'),/Stale/);
  state.observedAt=Date.now();fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify(state));
  assert.throws(()=>runtime.act('anything','old'),/offered candidate/);
  assert.equal(fs.existsSync(path.join(directory,'events.json')),false);
 }finally{restore();fs.rmSync(directory,{recursive:true,force:true});}
});
test('an unreviewed or stale overlay cannot grant a run allowance',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'version-overlay-'));const restore=environment(directory);
 try {
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({pendingOverlay:{package:'test.overlay',captureId:'old',observedAt:Date.now()-46000}}));
  assert.throws(()=>runtime.approveOverlay('old'),/stale/);
  assert.throws(()=>runtime.act('anything','old'),/Review pending overlay/);
  assert.equal(fs.existsSync(path.join(directory,'events.json')),false);
 }finally{restore();fs.rmSync(directory,{recursive:true,force:true});}
});
test('Jev request timeout is retained and returned without an unbounded retry',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'version-timeout-'));const restore=environment(directory);const previousFetch=global.fetch;
 try {
  process.env.JEV_API_KEY='synthetic';let calls=0;
  global.fetch=async()=>{calls++;throw new DOMException('fixture timeout','TimeoutError');};
  await assert.rejects(()=>decide({captureId:'test',headings:[],collected:{},candidates:[]}),/Jev request timeout/);
  assert.equal(calls,1);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'jev.json'))).length,1);
 }finally{global.fetch=previousFetch;restore();fs.rmSync(directory,{recursive:true,force:true});}
});
test('Codex watchdog terminates a stubborn child process group and reports failure', {skip:process.platform==='win32'},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'version-watchdog-'));
 try {
  const agent=path.join(directory,'fake-codex');
  fs.writeFileSync(agent,`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('fixture-codex');process.exit(0);}\nconst fs=require('node:fs');const {spawn}=require('node:child_process');\nprocess.on('SIGTERM',()=>{});\nconst child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(process.env.VERSION_RUN_DIR+'/fixture-child.pid',String(child.pid));\nsetInterval(()=>{},1000);\n`);fs.chmodSync(agent,0o755);
  const program=path.join(directory,'SKILL.md');fs.writeFileSync(program,'Synthetic watchdog fixture; no device operations.');
  const child=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(__dirname,'settings_version_harness'))}).run(false)`],{encoding:'utf8',timeout:15000,env:{...process.env,VERSION_RUN_DIR:directory,CLAWPERATOR_BIN:'/bin/echo',CLAWPERATOR_DEVICE_ID:'synthetic-device',CLAWPERATOR_SKILL_ID:'synthetic-skill',CLAWPERATOR_SKILL_PROGRAM:program,CLAWPERATOR_SKILL_AGENT_CLI_PATH:agent,CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS:'10500',VERSION_CODEX_MODEL:'fixture-model'}});
  assert.equal(child.status,1);assert.match(child.stdout,/Codex deadline exceeded/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'child-exit.json'))).timedOut,true);
  const pid=Number(fs.readFileSync(path.join(directory,'fixture-child.pid'),'utf8'));
  assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('runtime failures keep their actual reason without allowing a success-frame bypass',()=>{
 const {parseFailureFrame}=require('./settings_version_harness');
 const failure={result:null,status:'failed',contractVersion:'1.0.0',skillId:'test',checkpoints:[],diagnostics:{reason:'Observed blocking dialog'}};
 assert.deepEqual(parseFailureFrame('[Clawperator-Skill-Result]\n'+JSON.stringify(failure),'test'),failure);
 assert.deepEqual(parseFailureFrame(JSON.stringify(failure),'test'),failure);
 assert.throws(()=>parseFailureFrame('[Clawperator-Skill-Result]\n'+JSON.stringify({...failure,status:'success'}),'test'));
 assert.throws(()=>parseFailureFrame('[Clawperator-Skill-Result]\n'+JSON.stringify({...failure,skillId:'other'}),'test'));
});

test('initial observation failure returns to Codex and records fallback before any Jev request',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'version-initial-observation-'));const restore=environment(directory);const observe=runtime.observe;
 try {
  runtime.observe=()=>{throw Error('Synthetic missing preflight envelope');};
  const result=await require('./settings_version_jev').loop();
  assert.equal(result.status,'escalate');
  assert.equal(result.reason,'Synthetic missing preflight envelope');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'fallbacks.json')))[0].reason,result.reason);
  assert.equal(fs.existsSync(path.join(directory,'jev.json')),false);
 }finally{runtime.observe=observe;restore();fs.rmSync(directory,{recursive:true,force:true});}
});
