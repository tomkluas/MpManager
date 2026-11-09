import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../src/store.mjs';
import {markManuallyPublished} from '../src/draft-mode.mjs';

function withStore(run) {
  const root=mkdtempSync(join(tmpdir(),'manual-publication-account-')),store=createStore(root);
  try {run(store);} finally {store.close();rmSync(root,{recursive:true,force:true});}
}
const ttUrl='https://www.toutiao.com/article/123456789/';
function draft(store,overrides={}) {
  store.put('tasks',{id:'task',status:'draft_saved',usedCalls:4,maxCalls:12});
  return store.put('drafts',{platform:'toutiao',taskId:'task',status:'draft_saved',...overrides});
}

test('manual Toutiao publication without account remains possible and marks manual metrics',()=>withStore(store=>{
  const d=draft(store);
  const result=markManuallyPublished(store,d.id,{confirmed:true,url:ttUrl});
  assert.equal(result.status,'published');
  assert.equal(result.accountId,undefined);
  assert.equal(result.receipt.metricsMode,'manual');
  assert.equal(result.receipt.source,'human_verified');
}));

for(const scenario of ['missing','wrong platform','archived']) {
  test(`manual publication rejects ${scenario} account without changing state`,()=>withStore(store=>{
    const d=draft(store);
    if(scenario!=='missing')store.put('accounts',{id:'account',platform:scenario==='wrong platform'?'wechat':'toutiao',archived:scenario==='archived'});
    const kinds=['drafts','tasks','accounts','events','usage','approvals'];
    const before=kinds.map(kind=>store.list(kind));
    assert.throws(()=>markManuallyPublished(store,d.id,{confirmed:true,url:ttUrl,accountId:'account'}),/账号/);
    assert.deepEqual(kinds.map(kind=>store.list(kind)),before);
  }));
}

test('manual publication stores selected matching Toutiao account',()=>withStore(store=>{
  const d=draft(store);
  store.put('accounts',{id:'tt',platform:'toutiao',archived:false});
  const result=markManuallyPublished(store,d.id,{confirmed:true,url:ttUrl,accountId:'tt'});
  assert.equal(result.accountId,'tt');
  assert.equal(result.receipt.source,'human_verified');
  assert.equal(store.get('tasks','task').usedCalls,4);
}));

test('uploaded WeChat draft cannot be reassigned to another matching account',()=>withStore(store=>{
  const d=draft(store,{platform:'wechat',accountId:'original'});
  store.put('accounts',{id:'original',platform:'wechat'});
  store.put('accounts',{id:'other',platform:'wechat'});
  const kinds=['drafts','tasks','accounts','events','usage','approvals'];
  const before=kinds.map(kind=>store.list(kind));
  assert.throws(()=>markManuallyPublished(store,d.id,{confirmed:true,url:'https://mp.weixin.qq.com/s/test',accountId:'other'}),/账号/);
  assert.deepEqual(kinds.map(kind=>store.list(kind)),before);
  assert.equal(markManuallyPublished(store,d.id,{confirmed:true,url:'https://mp.weixin.qq.com/s/test',accountId:'original'}).accountId,'original');
}));
