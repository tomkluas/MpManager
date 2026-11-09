import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../src/store.mjs';
import {reconcileDraft} from '../src/reconcile.mjs';

function withUnknown(platform,run) {
  const root=mkdtempSync(join(tmpdir(),'reconcile-url-')),store=createStore(root);
  try {
    const draft=store.put('drafts',{platform,status:'needs_input',taskId:'task'});
    const approval=store.put('approvals',{draftId:draft.id,taskId:'task',status:'unknown',usedCalls:0,maxCalls:0});
    store.put('tasks',{id:'task',status:'needs_input',uncertain:true,usedCalls:4,maxCalls:12});
    store.put('usage',{id:'usage',taskId:'task',totalTokens:100});
    run(store,draft,approval);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
}

for(const [platform,url] of [
  ['wechat','https://mp.weixin.qq.com/cgi-bin/home'],
  ['wechat','https://mp.weixin.qq.com/s/'],
  ['wechat','https://mp.weixin.qq.com:444/s/test'],
  ['wechat','https://user:pass@mp.weixin.qq.com/s/test'],
  ['toutiao','https://mp.toutiao.com/profile_v4/index/'],
  ['xiaohongshu','https://creator.xiaohongshu.com/publish/publish'],
]) {
  test(`historical reconciliation rejects ${url} before any changes`,()=>withUnknown(platform,(store,draft)=>{
    const kinds=['drafts','tasks','approvals','events','usage','metricsJobs'];
    const before=kinds.map(kind=>store.list(kind));
    assert.throws(()=>reconcileDraft(store,draft.id,{status:'published',url,confirmed:true}),/文章链接/);
    assert.deepEqual(kinds.map(kind=>store.list(kind)),before);
  }));
}

for(const [platform,url] of [
  ['wechat','https://mp.weixin.qq.com/s/test'],
  ['wechat','https://mp.weixin.qq.com/s?__biz=MzA%3D&mid=123&idx=1&sn=abc'],
  ['toutiao','https://www.toutiao.com/article/123456789/'],
  ['xiaohongshu','https://www.xiaohongshu.com/explore/64abcdef0123456789abcdef?xsec_token=test'],
]) {
  test(`historical reconciliation accepts ${url} with human verification`,()=>withUnknown(platform,(store,draft,approval)=>{
    const usage=store.list('usage');
    const result=reconcileDraft(store,draft.id,{status:'published',url,confirmed:true});
    assert.equal(result.status,'published');
    assert.deepEqual(result.receipt,{url,source:'human_verified'});
    assert.equal(store.get('approvals',approval.id).status,'published');
    assert.equal(store.get('approvals',approval.id).receipt.source,'human_verified');
    assert.equal(store.get('tasks','task').usedCalls,4);
    assert.equal(store.get('tasks','task').maxCalls,12);
    assert.deepEqual(store.list('usage'),usage);
  }));
}

test('not_published reconciliation still ignores article URL and releases unknown state',()=>withUnknown('wechat',(store,draft,approval)=>{
  const result=reconcileDraft(store,draft.id,{status:'not_published',url:'invalid',confirmed:true});
  assert.equal(result.status,'awaiting_review');
  assert.equal(result.receipt,undefined);
  assert.equal(store.get('approvals',approval.id).status,'cancelled');
  assert.equal(store.get('tasks','task').uncertain,false);
}));
