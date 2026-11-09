import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

async function fixture(t, overrides={}) {
  const {createAgentRuntime}=await import('../src/agent-runtime.mjs');
  const root=await mkdtemp(join(tmpdir(),'operator-runtime-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const keyFile=join(root,'key'); await writeFile(keyFile,'fictional-test-key');
  const events=[], requests=[], configs=[];
  const runtime=await createAgentRuntime({root,keyFile,onUsage:async event=>events.push(event),
    fetch:async(url,options)=>{
      assert.equal(events.at(-1).phase,'before');
      assert.equal(url,'https://api.deepseek.com/chat/completions');
      requests.push(JSON.parse(options.body));
      return Response.json({choices:[{message:{content:'模型正文'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}});
    },
    runAgent:async({configPath,prompt,sessionId,role})=>{
      const config=JSON.parse(await readFile(configPath,'utf8')); configs.push({config,sessionId,role});
      const response=await fetch(config.models.providers.operator.baseUrl+'/chat/completions',{
        method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+config.models.providers.operator.apiKey},body:JSON.stringify({model:'wrong-model',messages:[{role:'user',content:prompt}],tools:[{type:'function'}],max_tokens:99999})});
      const data=await response.json();
      if(!response.ok) throw Error('model failed');
      return {payloads:[{text:data.choices[0].message.content}]};
    },...overrides});
  t.after(()=>runtime.close());
  return {runtime,events,requests,configs,root};
}

test('returns actual text and usage, records before call and isolates role sessions',async t=>{
  const {runtime,events,requests,configs}=await fixture(t);
  assert.deepEqual(await runtime.generate({role:'writer',jobId:'job-1',prompt:'写稿',maxTokens:800}),
    {text:'模型正文',usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20},model:'deepseek-flash'});
  await runtime.generate({role:'reviewer',jobId:'job-1',prompt:'审稿'});
  assert.deepEqual(events.map(e=>e.phase),['before','after','before','after']);
  assert.equal(events[1].outcome,'response_received');
  assert.equal(events[0].jobId,'job-1');
  assert.equal(requests[0].model,'deepseek-flash');
  assert.equal(requests[0].max_tokens,800);
  assert.equal(requests[0].tools,undefined);
  assert.notEqual(configs[0].sessionId,configs[1].sessionId);
  assert.equal(configs[0].config.agents.defaults.compaction.reserveTokensFloor,4096);
  assert.ok(configs[0].config.agents.defaults.compaction.reserveTokens<6000);
  assert.notEqual(configs[0].config.agents.defaults.workspace,configs[1].config.agents.defaults.workspace);
  assert.ok(!JSON.stringify(configs).includes('fictional-test-key'));
});

test('context precheck failure is diagnosed without a paid request or a login instruction',async t=>{const {runtime,requests}=await fixture(t,{runAgent:async()=>({payloads:[{text:'Context overflow: prompt too large for the model.'}]})});await assert.rejects(runtime.generate({role:'planner',prompt:'资料'}),e=>e.code==='MODEL_CONTEXT_LIMIT'&&e.outcome==='not_started'&&e.message.includes('尚未发起付费'));assert.equal(requests.length,0);});

test('real OpenClaw processes a long Chinese context through the guarded local proxy',async t=>{const {runtime,requests}=await fixture(t,{runAgent:undefined,openclawPath:fileURLToPath(new URL('../node_modules/openclaw/openclaw.mjs',import.meta.url))});const result=await runtime.generate({role:'planner',prompt:'请原样返回模型正文。以下是参考资料：'+'产品定位和历史内容。'.repeat(1200),maxTokens:3500});assert.equal(result.text,'模型正文');assert.equal(requests.length,1);});

test('pre-call accounting failure prevents paid request',async t=>{
  let calls=0;
  const {runtime}=await fixture(t,{onUsage:async()=>{throw Error('ledger unavailable');},fetch:async()=>{calls++;throw Error('must not call');}});
  await assert.rejects(runtime.generate({role:'writer',jobId:'j',prompt:'x'}));
  assert.equal(calls,0);
});

test('upstream unknown outcome is reported once and child retries cannot spend again',async t=>{
  let calls=0;
  const {runtime,events}=await fixture(t,{fetch:async()=>{calls++;throw Error('connection reset');},runAgent:async({configPath})=>{
    const config=JSON.parse(await readFile(configPath,'utf8'));
    for(let i=0;i<3;i++) await fetch(config.models.providers.operator.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+config.models.providers.operator.apiKey},body:JSON.stringify({messages:[]})});
    return {payloads:[{text:'incorrect apparent success'}]};
  }});
  await assert.rejects(runtime.generate({role:'writer',jobId:'j',prompt:'x'}),e=>e.outcome==='unknown'&&e.retryable===true);
  assert.equal(calls,1);
  assert.deepEqual(events.map(e=>e.phase),['before','after','diagnostic']);
  assert.equal(events[1].outcome,'unknown');
});

test('close and pre-aborted requests cannot start model calls',async t=>{
  const {runtime,events}=await fixture(t);
  await assert.rejects(runtime.generate({role:'writer',prompt:'x',signal:AbortSignal.abort()}));
  await runtime.close();
  await assert.rejects(runtime.generate({role:'writer',prompt:'x'}));
  assert.equal(events.length,0);
});

test('SSE usage is retained and upstream 401 is rejected without leaking error body',async t=>{
  let requestNumber=0;
  const {runtime,events}=await fixture(t,{fetch:async()=>{
    requestNumber++;
    if(requestNumber===2)return new Response('secret upstream diagnostics',{status:401});
    return new Response('data: {"choices":[{"delta":{"content":"流式正文"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  },runAgent:async({configPath})=>{
    const config=JSON.parse(await readFile(configPath,'utf8'));
    const response=await fetch(config.models.providers.operator.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+config.models.providers.operator.apiKey},body:JSON.stringify({stream:true,messages:[]})});
    await response.text();return {payloads:[{text:'流式正文'}]};
  }});
  const result=await runtime.generate({role:'writer',prompt:'x'});
  assert.deepEqual(result.usage,{prompt_tokens:3,completion_tokens:5,total_tokens:8});
  await assert.rejects(runtime.generate({role:'writer',prompt:'x'}),e=>e.outcome==='rejected'&&!e.message.includes('secret upstream diagnostics'));
  assert.equal(events.at(-1).httpStatus,401);
});

test('real installed OpenClaw accepts isolated generated configuration without running a model',async t=>{
  let validated=false;
  const {runtime}=await fixture(t,{runAgent:async({configPath,stateDir})=>{
    const openclawPath=fileURLToPath(new URL('../node_modules/openclaw/openclaw.mjs',import.meta.url));
    const {stdout}=await promisify(execFile)(process.execPath,[openclawPath,'config','validate'],{
      env:{...process.env,OPENCLAW_STATE_DIR:stateDir,OPENCLAW_CONFIG_PATH:configPath},windowsHide:true});
    assert.match(stdout,/valid/i);
    validated=true;
    return {payloads:[]};
  }});
  await assert.rejects(runtime.generate({role:'writer',prompt:'not sent to a model'}),e=>e.outcome==='not_started');
  assert.equal(validated,true);
});

test('truncated SSE is unknown even when the process returns partial text',async t=>{
  const {runtime,events}=await fixture(t,{fetch:async()=>new Response('data: {"choices":[{"delta":{"content":"部分正文"},"finish_reason":null}]}\n\n',{headers:{'content-type':'text/event-stream'}}),
    runAgent:async({configPath})=>{
      const config=JSON.parse(await readFile(configPath,'utf8'));
      await fetch(config.models.providers.operator.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+config.models.providers.operator.apiKey},body:JSON.stringify({stream:true,messages:[]})});
      return {payloads:[{text:'部分正文'}]};
    }});
  await assert.rejects(runtime.generate({role:'writer',prompt:'x'}),e=>e.outcome==='unknown');
  assert.equal(events.at(-1).outcome,'unknown');
});

test('close waits for in-flight unknown outcome to be recorded',async t=>{
  let started;const entered=new Promise(resolve=>{started=resolve;});
  const {runtime,events}=await fixture(t,{fetch:async(_url,{signal})=>{
    started();return await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  }});
  const rejected=assert.rejects(runtime.generate({role:'writer',prompt:'x'}),e=>e.outcome==='unknown');
  await entered;await runtime.close();
  assert.equal(events.at(-1).phase,'diagnostic');assert.equal(events.at(-1).outcome,'unknown');
  await rejected;
});


test('network permission denial is diagnosed as blocked rather than transient',async t=>{const {runtime,events}=await fixture(t,{fetch:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'EACCES'}});}});await assert.rejects(runtime.generate({role:'writer',prompt:'x'}),e=>e.code==='MODEL_NETWORK_PERMISSION'&&e.outcome==='blocked'&&e.retryable===false);assert.equal(events.at(-1).errorCode,'EACCES');});

test('unified configuration can provide the key, model and compatible endpoint without a key file',async t=>{
  const {createAgentRuntime}=await import('../src/agent-runtime.mjs');
  const root=await mkdtemp(join(tmpdir(),'operator-runtime-config-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let upstreamUrl;
  const runtime=await createAgentRuntime({root,keyFile:join(root,'missing-key'),apiKey:'configured-secret',model:'custom-chat',baseUrl:'https://gateway.example/v1',
    fetch:async(url)=>{upstreamUrl=url;return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]});},
    runAgent:async({configPath})=>{const config=JSON.parse(await readFile(configPath,'utf8'));const response=await fetch(config.models.providers.operator.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+config.models.providers.operator.apiKey},body:JSON.stringify({messages:[{role:'user',content:'x'}]})});const data=await response.json();return {payloads:[{text:data.choices[0].message.content}]};}});
  t.after(()=>runtime.close());
  const result=await runtime.generate({role:'writer',prompt:'x'});
  assert.equal(result.model,'custom-chat');
  assert.equal(upstreamUrl,'https://gateway.example/v1/chat/completions');
});

test('environment-only mode never falls back to a legacy local key file',async t=>{
  const {createAgentRuntime}=await import('../src/agent-runtime.mjs');
  const root=await mkdtemp(join(tmpdir(),'operator-runtime-env-only-')),keyFile=join(root,'key');
  t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(keyFile,'legacy-local-secret');
  let requests=0;const runtime=await createAgentRuntime({root,keyFile,allowKeyFile:false,runAgent:async()=>{},fetch:async()=>{requests++;return Response.json({});}});
  t.after(()=>runtime.close());
  await assert.rejects(runtime.preflight(),e=>e.code==='MODEL_CONFIG'&&e.message.includes('.env'));
  assert.equal(requests,0);
});
