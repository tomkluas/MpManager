import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../src/store.mjs';

const start=Date.parse('2026-11-04T12:00:00Z'),day=86400000;
async function setup(t,options={}){
  const {createScheduler}=await import('../src/scheduler.mjs');
  const root=await mkdtemp(join(tmpdir(),'operator-scheduler-'));
  const store=createStore(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  let time=start;const tasks=[],collections=[];
  store.put('products',{id:'p',confirmed:true});
  store.put('settings',{id:'default',monitoringEnabled:true,schedule:{enabled:true,productId:'p',platforms:['wechat'],intervalDays:7,nextRunAt:new Date(start).toISOString(),maxCalls:12}});
  const callbacks={createTask:async input=>{tasks.push(input);return {id:'new-task'};},collectMetrics:async job=>{collections.push(job);return {views:12};},...options};
  const scheduler=createScheduler({store,now:()=>time,...callbacks});
  return {scheduler,store,tasks,collections,setTime:value=>{time=value;}};
}

test('due schedule creates one review task and advances before external work',async t=>{
  const {scheduler,store,tasks}=await setup(t);
  await scheduler.tick();await scheduler.tick();
  assert.equal(tasks.length,1);assert.equal(tasks[0].productId,'p');
  assert.deepEqual(tasks[0].platforms,['wechat']);assert.equal(tasks[0].maxCalls,12);
  assert.equal(Date.parse(store.get('settings','default').schedule.nextRunAt),start+7*day);
});

test('invalid product and active product task skip creation after claiming the due slot',async t=>{
  for(const reason of ['unconfirmed','busy']){
    const {scheduler,store,tasks}=await setup(t);
    if(reason==='unconfirmed')store.put('products',{id:'p',confirmed:false});
    else store.put('tasks',{id:'existing',productId:'p',status:'reviewing'});
    await scheduler.tick();await scheduler.tick();
    assert.equal(tasks.length,0);assert.ok(store.get('settings','default').schedule.lastError);
    assert.equal(Date.parse(store.get('settings','default').schedule.nextRunAt),start+7*day);
  }
});

test('disabled schedule stays idle and callback failures remain visible without immediate retry',async t=>{
  let attempts=0;
  const {scheduler,store}=await setup(t,{createTask:async()=>{attempts++;throw Error('queue unavailable');}});
  const settings=store.get('settings','default');
  store.put('settings',{...settings,schedule:{...settings.schedule,enabled:false}});
  await scheduler.tick();assert.equal(attempts,0);
  store.put('settings',settings);await scheduler.tick();await scheduler.tick();
  assert.equal(attempts,1);assert.match(store.get('settings','default').schedule.lastError,/queue unavailable/);
});

test('overlapping ticks cannot duplicate a claimed weekly task',async t=>{
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  let attempts=0;
  const {scheduler,store}=await setup(t,{createTask:async()=>{attempts++;entered();await blocked;}});
  const tick=scheduler.tick();await started;
  await scheduler.tick();assert.equal(attempts,1);
  assert.equal(Date.parse(store.get('settings','default').schedule.nextRunAt),start+7*day);
  release();await tick;
});

test('published draft gets idempotent 24/48/72 hour jobs without resetting previous outcomes',async t=>{
  const {scheduler,store}=await setup(t);
  const draft={id:'d',taskId:'t',accountId:'a',status:'published',publishedAt:new Date(start).toISOString()};
  scheduler.schedulePost(draft);
  store.put('metricsJobs',{...store.get('metricsJobs','d-24'),status:'done',usedCalls:1});
  scheduler.schedulePost({...draft,publishedAt:new Date(start+day).toISOString()});
  assert.equal(store.list('metricsJobs').length,3);
  for(const hours of [24,48,72]){
    const job=store.get('metricsJobs',`d-${hours}`);
    assert.equal(Date.parse(job.dueAt),start+hours*3600000);
    assert.equal(job.maxCalls,2);assert.equal(job.taskId,'t');assert.equal(job.accountId,'a');
  }
  assert.equal(store.get('metricsJobs','d-24').status,'done');assert.equal(store.get('metricsJobs','d-24').usedCalls,1);
  scheduler.schedulePost({...draft,id:'unpublished',status:'awaiting_review'});
  assert.equal(store.list('metricsJobs').length,3);
});

test('each tick collects at most one due job and monitoring can be disabled',async t=>{
  const {scheduler,store,collections,setTime}=await setup(t);
  scheduler.schedulePost({id:'d',taskId:'t',accountId:'a',status:'published',publishedAt:new Date(start).toISOString()});
  setTime(start+4*day);
  const settings=store.get('settings','default');store.put('settings',{...settings,monitoringEnabled:false});
  await scheduler.tick();assert.equal(collections.length,0);
  store.put('settings',settings);await scheduler.tick();
  assert.equal(collections.length,1);assert.equal(collections[0].status,'running');
  assert.equal(store.get('metricsJobs','d-24').status,'done');
  assert.equal(store.get('metricsJobs','d-48').status,'queued');
});

test('failed collection and restarted running jobs need user input and never auto-retry',async t=>{
  const {createScheduler}=await import('../src/scheduler.mjs');
  let attempts=0;
  const {scheduler,store,setTime}=await setup(t,{collectMetrics:async()=>{attempts++;throw Error('login expired');}});
  scheduler.schedulePost({id:'d',taskId:'t',accountId:'a',status:'published',publishedAt:new Date(start).toISOString()});
  setTime(start+day);await scheduler.tick();await scheduler.tick();
  assert.equal(attempts,1);assert.equal(store.get('metricsJobs','d-24').status,'needs_input');
  assert.match(store.get('metricsJobs','d-24').error,/login expired/);
  store.put('metricsJobs',{...store.get('metricsJobs','d-48'),status:'running'});
  createScheduler({store,createTask:()=>{},collectMetrics:()=>{throw Error('must not run');},now:()=>start});
  assert.equal(store.get('metricsJobs','d-48').status,'needs_input');
  assert.ok(store.get('metricsJobs','d-48').error);
});
