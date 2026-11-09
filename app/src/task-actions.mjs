const running=new Set(['researching','writing','reviewing','revising','uploading','publishing','rendering']);
export function taskDeleteReason(store,task){
  if(running.has(task.status))return '任务正在执行，请结束后再删除';
  if(store.list('drafts').some(d=>d.taskId===task.id&&running.has(d.status)))return '稿件正在处理，请结束后再删除';
  if(store.list('approvals').some(a=>a.taskId===task.id&&['uploading','publishing'].includes(a.status)))return '草稿正在上传，请结束后再删除';
  if(store.list('metricsJobs').some(j=>j.taskId===task.id&&j.status==='running'))return '正在读取效果数据，请结束后再删除';
  return '';
}
export function deleteTask(store,id,{confirmed}={}){
  if(confirmed!==true)throw Error('请确认删除该内容任务');
  return store.transaction(()=>{
    const task=store.get('tasks',id);if(!task||task.deletedAt)throw Error('任务不存在或已删除');
    const reason=taskDeleteReason(store,task);if(reason)throw Error(reason);
    const deletedAt=new Date().toISOString();
    // Keep accounting, receipts and the Paperclip identity for audit and import deduplication.
    store.put('tasks',{...task,status:'deleted',previousStatus:task.status,deletedAt});
    for(const d of store.list('drafts').filter(d=>d.taskId===id))store.put('drafts',{...d,status:'deleted',previousStatus:d.status,deletedAt});
    for(const a of store.list('approvals').filter(a=>a.taskId===id&&a.status==='queued'))store.put('approvals',{...a,status:'cancelled',cancelReason:'内容任务已删除'});
    for(const j of store.list('metricsJobs').filter(j=>j.taskId===id&&j.status==='queued'))store.put('metricsJobs',{...j,status:'cancelled',cancelReason:'内容任务已删除'});
    return {deleted:true,id};
  });
}
