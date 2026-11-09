import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../src/store.mjs';
import {markManuallyPublished} from '../src/draft-mode.mjs';

function withDraft(platform, run) {
  const root=mkdtempSync(join(tmpdir(),'article-url-'));
  const store=createStore(root);
  try {
    const draft=store.put('drafts',{platform,status:'draft_saved',taskId:'task',receipt:{platformDraftId:'saved'}});
    store.put('tasks',{id:'task',status:'draft_saved',maxCalls:12,usedCalls:4});
    store.put('usage',{id:'usage',taskId:'task',phase:'after',totalTokens:100});
    run(store,draft);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
}

const invalid={
  wechat:['https://mp.weixin.qq.com/cgi-bin/home','https://mp.weixin.qq.com/','https://mp.weixin.qq.com/login','https://mp.weixin.qq.com/s/','https://mp.weixin.qq.com/s','https://mp.weixin.qq.com/s?__biz=b&mid=1&idx=1','https://mp.weixin.qq.com/s?__biz=&mid=1&idx=1&sn=s','http://mp.weixin.qq.com/s/test','https://user:pass@mp.weixin.qq.com/s/test','https://mp.weixin.qq.com:444/s/test','https://mp.weixin.qq.com.evil.test/s/test','https://mp.weixin.qq.com/s/test/other'],
  toutiao:['https://mp.toutiao.com/profile_v4/index/','https://www.toutiao.com/','https://www.toutiao.com/login','https://www.toutiao.com/article/','https://www.toutiao.com/article/test/','https://www.toutiao.com/i/','https://www.toutiao.com/article/123/other','https://www.toutiao.com:444/article/123/'],
  xiaohongshu:['https://creator.xiaohongshu.com/publish/publish','https://www.xiaohongshu.com/','https://www.xiaohongshu.com/login','https://www.xiaohongshu.com/explore/','https://www.xiaohongshu.com/explore/not-hex','https://www.xiaohongshu.com/discovery/item/','https://www.xiaohongshu.com:444/explore/64abcdef0123456789abcdef'],
};
for(const [platform,urls] of Object.entries(invalid)) for(const url of urls) {
  test(`manual publication rejects ${url} without changing state or budget`,()=>withDraft(platform,(store,draft)=>{
    const kinds=['drafts','tasks','usage','events','approvals','metricsJobs'];
    const before=kinds.map(kind=>store.list(kind));
    assert.throws(()=>markManuallyPublished(store,draft.id,{url,confirmed:true}),/文章链接/);
    assert.deepEqual(kinds.map(kind=>store.list(kind)),before);
  }));
}

const valid={
  wechat:['https://mp.weixin.qq.com/s/test','https://mp.weixin.qq.com/s/Abc_123-xyz?scene=1#wechat_redirect','https://mp.weixin.qq.com/s?__biz=MzA%3D%3D&mid=2650001&idx=1&sn=abc123&chksm=xyz','https://mp.weixin.qq.com:443/s/test'],
  toutiao:['https://www.toutiao.com/article/1234567890123456789/','https://www.toutiao.com/article/1234567890123456789?source=share','https://www.toutiao.com/i1234567890123456789/'],
  xiaohongshu:['https://www.xiaohongshu.com/explore/64abcdef0123456789abcdef?xsec_token=test&xsec_source=pc_share','https://www.xiaohongshu.com/discovery/item/64abcdef0123456789abcdef?app_platform=android'],
};
for(const [platform,urls] of Object.entries(valid)) for(const url of urls) {
  test(`manual publication accepts ${url} and preserves human verification`,()=>withDraft(platform,(store,draft)=>{
    const task=store.get('tasks','task'),usage=store.list('usage');
    const result=markManuallyPublished(store,draft.id,{url,confirmed:true});
    assert.equal(result.status,'published');
    assert.equal(result.receipt.url,new URL(url).href);
    assert.equal(result.receipt.source,'human_verified');
    assert.equal(result.receipt.operation,'manual_publication');
    assert.equal(result.receipt.platformDraftId,'saved');
    assert.equal(store.get('tasks','task').usedCalls,task.usedCalls);
    assert.equal(store.get('tasks','task').maxCalls,task.maxCalls);
    assert.deepEqual(store.list('usage'),usage);
  }));
}
