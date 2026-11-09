import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentRuntime} from '../src/agent-runtime.mjs';
import {createWorkflow} from '../src/workflow.mjs';
import {createStore} from '../src/store.mjs';
import {taskErrorHelp,taskStatusLabel} from '../public/task-error.js';
import {startServer} from '../src/server.mjs';
import {createCoverAgent} from '../src/cover-agent.mjs';

test('creation endpoint blocks failed preflight without a task, usage or generated content',async()=>{
 let calls=0,checks=0;
 const app=await startServer({port:4368,dataDir:mkdtempSync(join(tmpdir(),'preflight-http-')),autoRun:false,injectedCoverAgent:{preflight:async()=>({})},injectedRuntime:{close:async()=>{},generate:async()=>{calls++;},preflight:async()=>{checks++;throw Object.assign(Error('模型联网权限受阻'),{code:'MODEL_NETWORK_PERMISSION'});}}});
 try{const p=app.store.put('products',{name:'产品',confirmed:true});const response=await fetch('http://127.0.0.1:4368/api/tasks',{method:'POST',headers:{'content-type':'application/json','x-operator-token':app.token},body:JSON.stringify({productId:p.id,platforms:['wechat']})});assert.equal(response.status,400);assert.match((await response.json()).error,/联网权限/);assert.equal(checks,1);assert.equal(calls,0);assert.equal(app.store.list('tasks').length,0);assert.equal(app.store.list('usage').length,0);}finally{await app.close();}
});

test('settings exposes separate non-generating connection checks for text and image services',async()=>{
 let modelChecks=0,imageChecks=0,generations=0;
 const app=await startServer({port:4369,dataDir:mkdtempSync(join(tmpdir(),'settings-check-http-')),autoRun:false,
  injectedRuntime:{close:async()=>{},generate:async()=>{generations++;},preflight:async()=>{modelChecks++;return {message:'文字模型检查通过'};}},
  injectedCoverAgent:{generate:async()=>{generations++;},preflight:async()=>{imageChecks++;return {message:'图片模型检查通过'};}}});
 try{
  const post=path=>fetch('http://127.0.0.1:4369'+path,{method:'POST',headers:{'content-type':'application/json','x-operator-token':app.token},body:'{}'});
  const model=await post('/api/settings/test-model');
  assert.equal(model.status,200);assert.deepEqual(await model.json(),{message:'文字模型检查通过'});
  assert.equal(modelChecks,1);assert.equal(imageChecks,0);assert.equal(generations,0);
  const image=await post('/api/settings/test-image');
  assert.equal(image.status,200);assert.deepEqual(await image.json(),{message:'图片模型检查通过'});
  assert.equal(modelChecks,1);assert.equal(imageChecks,1);assert.equal(generations,0);
 }finally{await app.close();}
});

test('missing image configuration is rejected before accessing a generation endpoint',async()=>{
 let requests=0;const cover=createCoverAgent({readConfig:async()=>({apiKey:'',model:'image-model'}),fetch:async()=>{requests++;}});
 await assert.rejects(cover.preflight(),e=>e.code==='COVER_CONFIG');assert.equal(requests,0);
});

test('metadata authentication rejection is actionable and does not leak provider secrets',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preflight-auth-')),keyFile=join(root,'key');writeFileSync(keyFile,'test-secret');
 const runtime=await createAgentRuntime({root,keyFile,runAgent:async()=>{},fetch:async()=>Response.json({error:'private-provider-detail'},{status:401})});
 try{await assert.rejects(runtime.preflight(),e=>e.code==='MODEL_HTTP_401'&&!e.message.includes('private-provider-detail'));}finally{await runtime.close();}
});

test('permission failure is caught by a non-generating request without usage accounting',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preflight-')),keyFile=join(root,'key');writeFileSync(keyFile,'test-secret');let usage=0,requests=[];
 const runtime=await createAgentRuntime({root,keyFile,runAgent:async()=>{throw Error('must not run');},onUsage:async()=>usage++,fetch:async(url,options)=>{requests.push({url,options});throw Object.assign(Error('denied'),{cause:{code:'EACCES'}});}});
 try{await assert.rejects(runtime.preflight(),e=>e.code==='MODEL_NETWORK_PERMISSION'&&e.stage==='model');assert.equal(usage,0);assert.equal(requests.length,1);assert.equal(requests[0].options.method,'GET');assert.match(requests[0].url,/\/models$/);}finally{await runtime.close();}
});

test('workflow checks dependencies before any generation and preserves existing work',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preflight-flow-')),store=createStore(root);let calls=0;
 try{const p=store.put('products',{confirmed:true}),t=store.put('tasks',{productId:p.id,platforms:['wechat'],status:'queued',usedCalls:2,maxCalls:12}),d=store.put('drafts',{taskId:t.id,status:'awaiting_review',body:'已完成正文'});
 await createWorkflow({root,store,runtime:{generate:async()=>{calls++;}},preflight:async()=>{throw Object.assign(Error('联网权限受阻'),{stage:'model',code:'MODEL_NETWORK_PERMISSION'});}}).run(t);
 assert.equal(calls,0);assert.equal(store.get('tasks',t.id).usedCalls,2);assert.equal(store.get('tasks',t.id).errorCode,'MODEL_NETWORK_PERMISSION');assert.equal(store.get('drafts',d.id).body,'已完成正文');
 }finally{store.close();}
});

test('task help distinguishes operator repairs from missing product information',()=>{
 const task={status:'needs_input',errorCode:'MODEL_NETWORK_PERMISSION',errorStage:'model'};
 assert.equal(taskStatusLabel(task),'联网权限受阻');assert.match(taskErrorHelp(task).message,/无需补充/);assert.equal(taskErrorHelp(task).href,'#settings');
 assert.equal(taskStatusLabel({status:'needs_input',message:'微信body写入结果与审核版本不一致'}),'正文上传校验失败');
 assert.equal(taskStatusLabel({status:'needs_input',uncertain:true}),'中断结果待核实');
});
