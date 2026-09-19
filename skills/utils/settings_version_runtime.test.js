const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {verifyEvidence}=require('./settings_version_runtime');
function fixture() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'version-proof-test-'));
 const env={VERSION_RUN_DIR:dir,CLAWPERATOR_DEVICE_ID:'test-device',CLAWPERATOR_SKILL_RUN_ID:'test-run',CLAWPERATOR_SKILL_ID:'test-skill'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 const fields={androidVersion:{label:'Android version',value:'synthetic-release',snapshotIndex:0,readIndex:1,stepResultId:'read'},buildNumber:{label:'Build number',value:'synthetic.build',snapshotIndex:0,readIndex:2,stepResultId:'read'}};
 const nodes=Object.values(fields).flatMap((v,i)=>[{nodePath:`${i}.0`,parentPath:`${i}`,text:v.label,resourceId:'android:id/title',visibleToUser:true,enabled:true},{nodePath:`${i}.1`,parentPath:`${i}`,text:v.value,resourceId:'android:id/summary',visibleToUser:true,enabled:true}]);
 const snap={envelope:{commandId:'s',taskId:'s',status:'success',stepResults:[{id:'snapshot',actionType:'snapshot',success:true,data:{foreground_package:'com.android.settings',has_overlay:'false'}}]},compact:{nodes,truncated:false}};
 save('command-0.json',snap);
 const envelopes=[snap.envelope];
 for(const v of Object.values(fields)){const envelope={commandId:`r${v.readIndex}`,taskId:`r${v.readIndex}`,status:'success',stepResults:[{id:'read',actionType:'read_key_value_pair',success:true,data:{label:v.label,value:v.value}}]};save(`command-${v.readIndex}.json`,{envelope});envelopes.push(envelope);}
 save('state.json',{fields});
 const events=['snapshot','read-value','read-value','screenshot'].map((arg,index)=>({index,args:[arg],exitCode:0,device:'test-device',runId:'test-run'}));save('events.json',events);
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);fs.writeFileSync(path.join(dir,'final.png'),png);
 const frame={status:'success',contractVersion:'1.0.0',skillId:'test-skill',terminalVerification:{status:'verified'},result:{kind:'json',value:{androidVersion:fields.androidVersion.value,buildNumber:fields.buildNumber.value,evidence:{androidVersion:{execEnvelopeIndex:1,stepResultId:'read'},buildNumber:{execEnvelopeIndex:2,stepResultId:'read'}}}},execEnvelopes:envelopes};
 return {dir,frame,events,save,cleanup(){fs.rmSync(dir,{recursive:true,force:true});for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}};
}
test('result verifier rejects altered values, broken references, cross-device evidence and missing screenshot',()=>{
 const f=fixture();try{
 assert.equal(verifyEvidence(f.frame),true);
 const changed=structuredClone(f.frame);changed.result.value.buildNumber='generated';assert.throws(()=>verifyEvidence(changed));
 const reference=structuredClone(f.frame);reference.result.value.evidence.buildNumber.execEnvelopeIndex=1;assert.throws(()=>verifyEvidence(reference));
 f.events[1].device='other-device';f.save('events.json',f.events);assert.throws(()=>verifyEvidence(f.frame));f.events[1].device='test-device';f.save('events.json',f.events);
 fs.unlinkSync(path.join(f.dir,'final.png'));assert.throws(()=>verifyEvidence(f.frame));
 }finally{f.cleanup();}
});
test('missing Jev key fails before creating any device evidence',()=>{
 const f=fixture();try{
 fs.unlinkSync(path.join(f.dir,'events.json'));
 const child=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(__dirname,'settings_version_harness'))}).run(true)`],{env:{...process.env,JEV_API_KEY:'',CLAWPERATOR_BIN:'synthetic-cli'},encoding:'utf8'});
 assert.equal(child.status,1);assert.match(child.stdout,/JEV_API_KEY is missing/);assert.equal(fs.existsSync(path.join(f.dir,'events.json')),false);
 }finally{f.cleanup();}
});
