import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createStore} from '../src/store.mjs';import {createWorkflow} from '../src/workflow.mjs';import {canResumePartial} from '../public/task-error.js';
test('cover configuration failure preserves writing checkpoints and retry only resumes the image agent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cover-flow-')),store=createStore(join(root,'data'));let calls=0,images=0,purposes=[];
 try{
 const p=store.put('products',{name:'戒酒记录',confirmed:true,profile:{positioning:'记录不喝酒的每一天'}}),t=store.put('tasks',{productId:p.id,platforms:['toutiao'],maxCalls:3,usedCalls:0,status:'queued'});
 const runtime={generate:async({role,prompt})=>{calls++;if(role==='writer'||role==='reviewer')assert.match(prompt,/生活故事/);return {text:JSON.stringify(role==='planner'?{queries:[],angle:'饭局'}:{title:'饭局上不喝酒',body:'设想这样一个场景：朋友举起酒杯，你端起了水。',digest:'换一种选择'})};}};
 const fixture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVvoAAAAASUVORK5CYII=','base64');
 const coverAgent={generate:async({draft,purpose})=>{purposes.push(purpose);images++;assert.equal(draft.platform,'toutiao');if(images===1)throw Object.assign(Error('请配置火山绘图'),{stage:'image',outcome:'not_started'});return {bytes:fixture,mime:'image/png',ext:'png',width:1,height:1,style:'ai-comic',provider:'volcengine',model:'ep-test'};}};
 const workflow=createWorkflow({root,store,runtime,coverAgent});await workflow.run(t);
 const failed=store.get('tasks',t.id),drafts=store.list('drafts');assert.equal(failed.errorStage,'image');assert.equal(drafts[0].status,'needs_input');assert.equal(calls,3);assert.equal(canResumePartial(failed,drafts),true);
 const resumed=store.put('tasks',{...failed,status:'queued',resume:true});await workflow.run(resumed);
 assert.equal(calls,3);assert.equal(images,3);assert.deepEqual(purposes,['cover','cover','inline']);assert.equal(store.list('drafts').length,1);const draft=store.list('drafts')[0];assert.equal(draft.status,'awaiting_review');assert.equal(draft.assets[0].style,'ai-comic');assert.equal(draft.assets[0].provider,'volcengine');assert.deepEqual(await readFile(draft.assets[0].path),fixture);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
