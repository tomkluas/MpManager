import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {analyticsReport} from '../src/auto-analytics.mjs';

test('effect review exposes active drafts for optional manual metric entry',()=>{
  const store=createStore(mkdtempSync(join(tmpdir(),'effect-review-')));
  try{
    const task=store.put('tasks',{title:'本期内容'});
    const draft=store.put('drafts',{taskId:task.id,title:'文章标题',platform:'wechat',status:'draft_saved'});
    const removedTask=store.put('tasks',{title:'已删除任务',deletedAt:new Date().toISOString()});
    store.put('drafts',{taskId:removedTask.id,title:'不应出现',platform:'wechat'});
    store.put('drafts',{taskId:'missing-task',title:'孤立稿件',platform:'wechat'});
    store.put('drafts',{taskId:task.id,title:'旧版本',platform:'wechat',status:'superseded'});

    const report=analyticsReport(store);

    assert.deepEqual(Object.keys(report.summary),['posts','totalViews']);
    assert.deepEqual(report.recordableDrafts,[{
      id:draft.id,
      taskId:task.id,
      title:'文章标题',
      platform:'wechat'
    }]);
  }finally{
    store.close();
  }
});

test('workbench keeps planning and metric entry inside effect review',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/下一期内容计划/);
  assert.doesNotMatch(source,/效果数据与统计/);
  assert.match(source,/手动补录数据/);
  assert.match(source,/复盘结论与下一步/);
  assert.match(source,/href="#new">开始下一篇内容/);
  assert.doesNotMatch(source,/效果记录数|不再单独维护内容计划/);
});
