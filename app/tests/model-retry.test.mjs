import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {createWorkflow} from '../src/workflow.mjs';
test('content generation retries transient unknown outcomes and records diagnosis',async()=>{
 const store=createStore(mkdtempSync(join(tmpdir(),'retry-')));
 try{const p=store.put('products',{});store.put('documents',{productId:p.id,text:'产品说明'});
 const t=store.put('tasks',{kind:'analyze',productId:p.id,maxCalls:4,usedCalls:0});let calls=0;
 const w=createWorkflow({store,retryDelayMs:0,runtime:{generate:async()=>{calls++;if(calls<3)throw Object.assign(Error('连接中断'),{outcome:'unknown',retryable:true,callId:'trace-'+calls});return {text:'{"positioning":"记录"}'};}}});
 await w.run(t);assert.equal(calls,3);assert.equal(store.get('tasks',t.id).status,'awaiting_review');assert.ok(store.list('events').some(e=>e.message.includes('trace-1')));
 }finally{store.close();}
});

for(const permanent of [false,true])test(permanent?'permanent error is not retried':'transient failures stop after three attempts',async()=>{const store=createStore(mkdtempSync(join(tmpdir(),'retry-limit-')));try{const p=store.put('products',{});store.put('documents',{productId:p.id,text:'说明'});const t=store.put('tasks',{kind:'analyze',productId:p.id,maxCalls:5,usedCalls:0});let calls=0;await createWorkflow({store,retryDelayMs:0,runtime:{generate:async()=>{calls++;throw Object.assign(Error('失败'),{outcome:permanent?'rejected':'unknown',retryable:!permanent});}}}).run(t);assert.equal(calls,permanent?1:3);assert.equal(store.get('tasks',t.id).uncertain,false);}finally{store.close();}});

test('historical model interruption recovers once without touching upload uncertainty',()=>{const store=createStore(mkdtempSync(join(tmpdir(),'retry-recover-')));try{const t=store.put('tasks',{status:'needs_input',uncertain:true,errorStage:'model',usedCalls:1,maxCalls:12});const upload=store.put('tasks',{status:'needs_input',uncertain:true,errorStage:'browser',usedCalls:1,maxCalls:12});store.recover();assert.equal(store.get('tasks',t.id).status,'queued');assert.equal(store.get('tasks',t.id).resume,true);assert.equal(store.get('tasks',upload.id).status,'needs_input');store.put('tasks',{...store.get('tasks',t.id),status:'needs_input',uncertain:true});store.recover();assert.equal(store.get('tasks',t.id).status,'needs_input');}finally{store.close();}});
