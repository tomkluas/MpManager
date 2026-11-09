import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {createWorkflow} from '../src/workflow.mjs';
test('workflow produces actual reviewable draft and assets without publishing',async()=>{const root=mkdtempSync(join(tmpdir(),'workflow-')),store=createStore(join(root,'data'));const p=store.put('products',{name:'记录工具',confirmed:true,profile:{positioning:'记录每天行动',features:['每日记录']}});const t=store.put('tasks',{productId:p.id,platforms:['wechat'],input:'测试',status:'queued',maxCalls:3,usedCalls:0});const runtime={generate:async({role})=>{const cur=store.get('tasks',t.id);store.put('tasks',{...cur,usedCalls:cur.usedCalls+1});return {text:JSON.stringify(role==='planner'?{queries:[],angle:'记录今天'}:{title:'今天先记一笔',body:'## 先记录今天\n打开工具，记录今天的行动。',digest:'行动记录',review:{summary:'产品事实已核对',issues:['入口需核实']}})};}};const w=createWorkflow({root,store,runtime});await w.tick();assert.equal(store.get('tasks',t.id).status,'awaiting_review');const ds=store.list('drafts');assert.equal(ds.length,1);assert.equal(ds[0].assets.length,2);assert.match(ds[0].review,/审核结论：产品事实已核对/);assert.doesNotMatch(ds[0].review,/\\[object Object\\]/);assert.equal(store.list('approvals').length,0);assert.equal(store.get('tasks',t.id).usedCalls,3);store.close();});
