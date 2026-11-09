import test from 'node:test';
import assert from 'node:assert/strict';
import * as taskErrors from '../public/task-error.js';

test('task log merges execution events and call snapshots into chronological readable lines',()=>{
  assert.equal(typeof taskErrors.buildTaskRunLog,'function');
  const rows=taskErrors.buildTaskRunLog({
    events:[
      {id:'event-2',createdAt:'2026-11-06T02:02:00.000Z',type:'warning',message:'系统准备自动重试'},
      {id:'event-1',createdAt:'2026-11-06T02:00:00.000Z',type:'info',message:'正在生成内容'}
    ],
    usage:[
      {callId:'call-12345678',createdAt:'2026-11-06T02:01:00.000Z',startedAt:'2026-11-06T02:00:30.000Z',phase:'before',role:'writer',outcome:'unknown'},
      {callId:'call-12345678',createdAt:'2026-11-06T02:03:00.000Z',endedAt:'2026-11-06T02:03:00.000Z',phase:'diagnostic',role:'writer',outcome:'unknown',httpStatus:503,errorCode:'UPSTREAM_INTERRUPTED',durationMs:150000,retryable:true}
    ]
  });

  assert.deepEqual(rows.map(row=>row.kind),['event','call','event','call']);
  assert.equal(rows[1].step,'内容写作');
  assert.equal(rows[1].message,'开始模型调用');
  assert.equal(rows[1].resultLabel,'调用中，尚未返回');
  assert.equal(rows[1].durationLabel,'尚未结束');
  assert.equal(rows[3].message,'调用失败：HTTP 503 · UPSTREAM_INTERRUPTED');
  assert.equal(rows[3].retryLabel,'可自动重试');
  assert.equal(rows[3].resultLabel,'本次结果未确认');
  assert.equal(rows[3].durationLabel,'2分30秒');
  assert.equal(rows[3].callId,'call-12345678');
});

test('completed call details use clear Chinese instead of internal outcome names',()=>{
  const [row]=taskErrors.buildTaskRunLog({usage:[{
    callId:'done',phase:'after',role:'reviewer',outcome:'response_received',durationMs:15800
  }]});

  assert.equal(row.resultLabel,'已收到完整结果');
  assert.equal(row.durationLabel,'15.8秒');
  assert.equal(row.requestIdLabel,'未提供');
});

test('task run summary blocks an unknown paid result and explains the next action',()=>{
  assert.equal(typeof taskErrors.taskRunSummary,'function');
  const summary=taskErrors.taskRunSummary({
    status:'needs_input',errorStage:'model',errorCode:'UPSTREAM_INTERRUPTED',
    message:'模型调用结果未知',uncertain:true,usedCalls:2,maxCalls:12
  },[]);

  assert.equal(summary.step,'模型调用');
  assert.equal(summary.retry.mode,'blocked');
  assert.match(summary.retry.label,/不可重试/);
  assert.match(summary.action,/核实/);
});

test('task run summary offers checkpoint continuation only for a safe failed task',()=>{
  const summary=taskErrors.taskRunSummary({
    status:'needs_input',errorStage:'model',errorCode:'MODEL_HTTP_503',
    message:'模型服务暂时不可用',uncertain:false,usedCalls:3,maxCalls:12,
    platforms:['wechat']
  },[]);

  assert.equal(summary.retry.mode,'manual');
  assert.equal(summary.retry.label,'可以继续');
  assert.match(summary.retry.detail,/已完成步骤/);
});
