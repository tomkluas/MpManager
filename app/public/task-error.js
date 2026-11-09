export function taskErrorHelp(task){
  if(task.uncertain)return {message:'上次调用结果未能确认，任务已停止。请核实调用记录，程序不会自动重试。',action:'核实后尝试继续',account:false};
  if(/NETWORK_PERMISSION|LOCAL_PERMISSION|STORAGE_PERMISSION/.test(task.errorCode||''))return {message:'这是服务运行权限问题，无需补充主题或产品资料。请检查服务进程的联网、端口或目录权限，修复后再继续；填写 API Key 不会解除运行环境限制。',action:'修复权限后重新检查并继续',href:'#settings',linkLabel:'查看运行设置',account:false};
  if(/写入结果与审核版本不一致/.test(task.message||''))return {message:'上传正文与审核版本不一致，无需补充写作资料。请核对平台草稿与本地审核稿；已有内容保留，不要重新生成正文。',action:'处理后尝试继续',account:true};
  if(/CONFIG|HTTP_40[13]/.test(task.errorCode||''))return {message:'服务配置或访问权限检查未通过，无需补充写作资料。请在运行设置检查对应密钥、模型配置，并在服务商后台确认权限。',action:'配置后重新检查并继续',href:'#settings',account:false};
  if(task.errorStage==='image')return {message:'漫画配图生成遇到问题，正文与审稿结果已保留。请处理火山绘图配置后继续，无需重新写稿。',action:'继续生成配图',href:'#settings',account:false};
  if(task.errorStage==='model'||/OpenClaw|模型|DeepSeek|调用前检查/.test(task.message||''))return {message:'内容生成遇到模型问题，与平台登录无关。已保留任务和原调用记录。',action:task.usedCalls===0?'重新生成内容':'继续生成内容',account:false};
  return {message:'请查看上方具体原因。已有内容和调用记录会保留。',action:'处理后尝试继续',account:task.errorStage==='browser'};
}
export function taskStatusLabel(task){
 if(task.status!=='needs_input')return task.status;
 if(task.uncertain)return '中断结果待核实';
 if(/NETWORK_PERMISSION/.test(task.errorCode||''))return '联网权限受阻';
 if(/LOCAL_PERMISSION|STORAGE_PERMISSION/.test(task.errorCode||''))return '运行权限受阻';
 if(/写入结果与审核版本不一致/.test(task.message||''))return '正文上传校验失败';
 if(/CONFIG|HTTP_40[13]/.test(task.errorCode||''))return '服务配置待处理';
 if(task.errorStage==='image')return '配图生成失败';
 if(task.errorStage==='model')return '模型服务异常';
 if(task.errorStage==='browser')return '平台操作待处理';
 return '任务暂停，查看原因';
}
export function canResumePartial(task,drafts){return !task.uncertain&&(task.errorStage==='model'||task.errorStage==='image'||task.errorStage==='storage'||task.recoveryReason==='interrupted')&&(task.platforms||[]).some(p=>!drafts.some(d=>d.platform===p&&!d.deletedAt&&['awaiting_review','draft_saved','published'].includes(d.status)));}

const roleLabels={planner:'选题策划',writer:'内容写作',reviewer:'内容审核',analyst:'产品分析'};
const stageLabels={model:'模型调用',image:'配图生成',browser:'平台操作',storage:'文件保存',content:'内容处理',queued:'任务排队',researching:'选题研究',writing:'内容写作',reviewing:'内容审核',uploading:'草稿上传'};

function callLine(record){
 const step=roleLabels[record.role]||stageLabels[record.stage]||record.role||'模型调用';
 const status=[record.httpStatus&&'HTTP '+record.httpStatus,record.errorCode].filter(Boolean).join(' · ');
 if(record.phase==='before')return {step,message:'开始模型调用',level:'info',retryLabel:'等待结果'};
 if(record.phase==='diagnostic')return {step,message:'调用失败'+(status?'：'+status:''),level:'error',retryLabel:record.retryable?'可自动重试':record.outcome==='unknown'?'结果待核实':'不可自动重试'};
 if(record.outcome==='response_received')return {step,message:'模型调用完成',level:'success',retryLabel:'无需重试'};
 if(record.outcome==='rejected')return {step,message:'调用被服务拒绝'+(status?'：'+status:''),level:'error',retryLabel:'修复配置后可继续'};
 if(record.outcome==='not_started')return {step,message:'调用未发起'+(status?'：'+status:''),level:'warning',retryLabel:'修复后可继续'};
 return {step,message:'调用结果未确认'+(status?'：'+status:''),level:'warning',retryLabel:'先核实，勿重试'};
}

function callResultLabel(record){
 if(record.phase==='before')return '调用中，尚未返回';
 if(record.outcome==='response_received')return '已收到完整结果';
 if(record.outcome==='rejected')return '服务已拒绝请求';
 if(record.outcome==='not_started')return '请求尚未发出';
 if(record.outcome==='unknown')return '本次结果未确认';
 return '未记录结果';
}

function durationLabel(record){
 const ms=Number(record.durationMs);
 if(!Number.isFinite(ms))return record.phase==='before'?'尚未结束':'未记录';
 if(ms>=60000){const minutes=Math.floor(ms/60000),seconds=Math.round(ms%60000/1000);return minutes+'分'+(seconds?seconds+'秒':'');}
 if(ms>=1000)return (ms/1000).toFixed(ms%1000?1:0)+'秒';
 return ms+'毫秒';
}

export function buildTaskRunLog({events=[],usage=[]}={}){
 const eventRows=events.map((event,index)=>({id:event.id||'event-'+index,kind:'event',time:event.createdAt||event.updatedAt||'',step:'任务执行',message:event.message||'执行状态已更新',level:event.type==='error'?'error':event.type==='warning'?'warning':'info',retryLabel:''}));
 const callRows=usage.map((record,index)=>({id:(record.callId||'call-'+index)+'-'+(record.phase||index),kind:'call',time:record.createdAt||record.endedAt||record.startedAt||'',callId:record.callId||'',durationMs:record.durationMs,durationLabel:durationLabel(record),requestId:record.requestId||'',requestIdLabel:record.requestId||'未提供',httpStatus:record.httpStatus,errorCode:record.errorCode||'',outcome:record.outcome||'',resultLabel:callResultLabel(record),phase:record.phase||'',...callLine(record)}));
 return [...eventRows,...callRows].sort((a,b)=>String(a.time).localeCompare(String(b.time))||String(a.id).localeCompare(String(b.id)));
}

export function taskRunSummary(task,drafts=[]){
 const help=taskErrorHelp(task),failed=['failed','needs_input'].includes(task.status);
 const step=stageLabels[task.errorStage]||stageLabels[task.phase]||'任务执行';
 let retry={mode:'none',label:'当前无需重试',detail:'任务会按当前状态继续执行。'};
 if(failed&&task.uncertain)retry={mode:'blocked',label:'暂不可重试',detail:'上次操作是否成功尚未确认。先核实服务账单或平台结果，避免重复扣费或重复上传。'};
 else if(failed&&Number.isFinite(task.maxCalls)&&task.usedCalls>=task.maxCalls)retry={mode:'blocked',label:'调用预算已用完',detail:'当前任务没有剩余调用次数，不能继续发起模型请求。'};
 else if(failed&&(!drafts.length||canResumePartial(task,drafts)))retry={mode:'manual',label:'可以继续',detail:'会保留已完成步骤，从最近的安全检查点继续；不会清空原调用记录。'};
 else if(failed)retry={mode:'separate',label:'请在稿件处处理',detail:'正文已经生成，不重跑写作；上传失败请在对应稿件重新确认上传。'};
 return {step,code:task.errorCode||'',reason:task.message||help.message,action:help.message,retry};
}
