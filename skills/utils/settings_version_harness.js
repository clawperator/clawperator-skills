const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const {resolveClawperatorBin}=require('./common');
const {digest}=require('./settings_version_model');
function childEnvironment(jev) {
  const env={};
  for(const key of ['HOME','CODEX_HOME','PATH','LANG','SHELL','TMPDIR','ADB_PATH','CLAWPERATOR_BIN','CLAWPERATOR_DEVICE_ID','CLAWPERATOR_OPERATOR_PACKAGE','CLAWPERATOR_SKILLS_REGISTRY','CLAWPERATOR_SKILL_RUN_ID','CLAWPERATOR_SKILL_ID','CLAWPERATOR_LOG_DIR','VERSION_RUN_DIR']) if(process.env[key]!==undefined) env[key]=process.env[key];
  if(jev && process.env.JEV_API_KEY!==undefined) env.JEV_API_KEY=process.env.JEV_API_KEY;
  return env;
}
async function run(jev) {
  let frame;
  try {
    if(!process.env.CLAWPERATOR_BIN?.trim() || !process.env.CLAWPERATOR_DEVICE_ID?.trim()) throw Error('Explicit CLI and device are required');
    if(jev && !process.env.JEV_API_KEY?.trim()) throw Error('JEV_API_KEY is missing');
    const dir=process.env.VERSION_RUN_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(),'version-details-'));
    fs.mkdirSync(dir,{recursive:true});
    if(fs.existsSync(path.join(dir,'events.json'))) throw Error('Evidence directory already used');
    process.env.VERSION_RUN_DIR=dir;
    const model=process.env.VERSION_CODEX_MODEL ?? 'gpt-6-astra';
    const effort=process.env.VERSION_CODEX_EFFORT ?? 'high';
    const skillProgram=fs.readFileSync(process.env.CLAWPERATOR_SKILL_PROGRAM,'utf8');
    const tool=path.join(__dirname,'settings_version_tool.js');
    const prompt=`You are a runtime Codex agent executing this read-only Android skill. Perform actual commands now; do not edit code, inspect repositories, or spawn other agents. Use the supplied deterministic helper through the shell tool. It invokes only the pinned Clawperator CLI, serializes actions and retains all UI evidence. Its candidate menu is evidence, not a preselected route. You choose the next action and handle deviations.\nHelper: node ${JSON.stringify(tool)} <operation>\nRun directory: ${dir}\nPinned CLI: ${process.env.CLAWPERATOR_BIN}\nTarget: ${process.env.CLAWPERATOR_DEVICE_ID}\nModel: ${model}, effort: ${effort}\nProgram:\n${skillProgram}\nYour final answer must be exactly the compact JSON receipt returned by finish. The launcher validates its hash and emits the retained full SkillResult frame; do not repeat the raw envelopes. If blocked, emit a failed frame with result:null, contractVersion:1.0.0, skillId:${process.env.CLAWPERATOR_SKILL_ID}, checkpoints:[], and a truthful diagnostics reason. Never invent evidence or values.`;
    fs.writeFileSync(path.join(dir,'prompt.txt'),prompt);
    const bin=resolveClawperatorBin();
    const version=spawnSync(bin.cmd,[...bin.args,'--version'],{encoding:'utf8'});
    if(version.status!==0) throw Error('Pinned CLI unavailable');
    const args=['exec','--ephemeral','--skip-git-repo-check','--sandbox','workspace-write','-c','sandbox_workspace_write.network_access=true','-c','project_doc_max_bytes=0','-c','shell_environment_policy.inherit="all"','-c','shell_environment_policy.include_only=["PATH","HOME","CODEX_HOME","LANG","SHELL","TMPDIR","ADB_PATH","CLAWPERATOR_*","VERSION_*","JEV_API_KEY"]','-c','shell_environment_policy.ignore_default_excludes=true','-c',`model_reasoning_effort="${effort}"`,'-m',model,'--json','--color','never','-C',dir,'-o',path.join(dir,'last-message.txt'),'-'];
    fs.writeFileSync(path.join(dir,'metadata.json'),JSON.stringify({model,effort,cliVersion:version.stdout.trim(),clawperatorBin:process.env.CLAWPERATOR_BIN,runId:process.env.CLAWPERATOR_SKILL_RUN_ID,jev,promptHash:digest(prompt),sandbox:'workspace-write',transport:'direct --no-daemon',keyPresentInChild:!!childEnvironment(jev).JEV_API_KEY,codexVersion:spawnSync(process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH,['--version'],{encoding:'utf8'}).stdout.trim(),args},null,2));
    const stdout=fs.openSync(path.join(dir,'codex.jsonl'),'w');
    const stderr=fs.openSync(path.join(dir,'codex.stderr'),'w');
    const child=spawn(process.env.CLAWPERATOR_SKILL_AGENT_CLI_PATH,args,{env:childEnvironment(jev),stdio:['pipe',stdout,stderr],detached:true});
    fs.closeSync(stdout);fs.closeSync(stderr);
    let timedOut=false;
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch{}};
    let escalation;
    const stop=()=>{timedOut=true;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),1500);};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
    const configured=Number(process.env.CLAWPERATOR_SKILL_AGENT_TIMEOUT_MS ?? 300000);
    const timeout=setTimeout(stop,Math.max(1000,Math.min(285000,configured-10000)));
    child.stdin.on('error',()=>{});child.stdin.end(prompt);
    let code;
    try { code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}); }
    finally { clearTimeout(timeout);if(escalation)clearTimeout(escalation); }
    kill('SIGKILL');
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    fs.writeFileSync(path.join(dir,'child-exit.json'),JSON.stringify({code,timedOut,groupCleanup:'SIGKILL sent to remaining group'}));
    if(timedOut || code!==0) throw Error(timedOut?'Codex deadline exceeded':`Codex exited ${code}`);
    const text=fs.readFileSync(path.join(dir,'last-message.txt'),'utf8').trim();
    const receipt=JSON.parse(text);
    frame=JSON.parse(fs.readFileSync(path.join(dir,'verified-result.json'),'utf8'));
    if(receipt.status!=='success' || receipt.verifiedResultHash!==digest(frame) || digest(receipt.result)!==digest(frame.result.value)) throw Error('Runtime receipt does not match captured result');
    if(frame.status==='success') require('./settings_version_runtime').verifyEvidence(frame);
    else throw Error('Runtime agent did not complete; retained child frame explains the failure');
  } catch(error) {
    frame={result:null,status:'failed',contractVersion:'1.0.0',skillId:process.env.CLAWPERATOR_SKILL_ID ?? 'version-details',checkpoints:[],terminalVerification:{status:'failed'},diagnostics:{reason:error.message}};
    process.exitCode=1;
  }
  console.log('[Clawperator-Skill-Result]\n'+JSON.stringify(frame));
}
module.exports={run,childEnvironment};
