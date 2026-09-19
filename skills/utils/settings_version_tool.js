#!/usr/bin/env node
const runtime=require('./settings_version_runtime');
(async()=>{
  const [operation,...args]=process.argv.slice(2);
  let result;
  if(operation==='open') {runtime.command(['open','com.android.settings']);result=runtime.observe();}
  else if(operation==='observe') result=runtime.observe();
  else if(operation==='act') result=runtime.act(args[0],args[1]);
  else if(operation==='jev') result=await require('./settings_version_jev').loop();
  else if(operation==='finish') { const frame=runtime.finish(); result={verifiedResultHash:require('./settings_version_model').digest(frame),result:frame.result.value,status:frame.status}; }
  else throw Error('Use open, observe, act <candidate> <capture>, jev, or finish');
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(JSON.stringify({status:'escalate',reason:error.message}));process.exitCode=1;});
