const DAY=86400000;
const activeTaskStatuses=new Set(['queued','researching','writing','reviewing','revising']);
const timeOf=value=>typeof value==='number'?value:Date.parse(value);
const errorText=error=>String(error?.message||error||'调度执行失败').slice(0,2000);

/** Persistent due-time claims precede callbacks; this component never approves or publishes. */
export function createScheduler({store,createTask,collectMetrics,now=()=>Date.now()}){
  if(!store||typeof createTask!=='function'||typeof collectMetrics!=='function')throw Error('调度器缺少存储或执行回调');
  let busy=false;
  const date=()=>new Date(now()).toISOString();
  const updateSchedule=patch=>{
    const current=store.get('settings','default')||{id:'default'};
    return store.put('settings',{...current,schedule:{...(current.schedule||{}),...patch}});
  };

  // Called once at service construction, before any new callback can run.
  store.transaction(()=>{
    for(const job of store.list('metricsJobs'))if(job.status==='running')store.put('metricsJobs',{
      ...job,status:'needs_input',uncertain:true,error:'服务重启：上次数据采集结果待核实，已停止自动重试',endedAt:date()});
  });

  function schedulePost(draft){
    if(draft?.status!=='published')return [];
    if(!draft.id||!draft.taskId||!draft.accountId)throw Error('发布稿件缺少任务或账号，无法安排数据回收');
    const value=draft.publishedAt??draft.receipt?.publishedAt??draft.updatedAt??now();
    const publishedAt=timeOf(value);
    if(!Number.isFinite(publishedAt))throw Error('稿件发布时间无效');
    return store.transaction(()=>[24,48,72].map(hours=>{
      const id=`${draft.id}-${hours}`,existing=store.get('metricsJobs',id);
      if(existing)return existing;
      return store.put('metricsJobs',{id,taskId:draft.taskId,draftId:draft.id,accountId:draft.accountId,
        dueAt:new Date(publishedAt+hours*3600000).toISOString(),hours,status:'queued',maxCalls:2,usedCalls:0,createdAt:date()});
    }));
  }

  async function scheduleTask(){
    try {
      const claimed=store.transaction(()=>{
        const settings=store.get('settings','default'),schedule=settings?.schedule;
        if(!schedule?.enabled)return null;
        const due=timeOf(schedule.nextRunAt);
        if(!Number.isFinite(due))throw Error('定时选题的下次运行时间无效');
        if(due>now())return null;
        const interval=Number(schedule.intervalDays??7);
        if(!Number.isFinite(interval)||interval<1||interval>365)throw Error('选题间隔须为1至365天');
        // A missed slot is consumed once. Restart never catches up by creating a burst of tasks.
        updateSchedule({nextRunAt:new Date(now()+interval*DAY).toISOString(),lastRunAt:date(),lastError:null});
        return {...schedule};
      });
      if(!claimed)return;
      const product=store.get('products',claimed.productId);
      if(!product?.confirmed)throw Error('定时选题未执行：请先确认产品资料');
      if(store.list('tasks').some(task=>task.productId===product.id&&activeTaskStatuses.has(task.status)))
        throw Error('定时选题未执行：该产品已有进行中的任务');
      const maxCalls=Number(claimed.maxCalls??12);
      if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>30)throw Error('定时选题调用上限须为1至30');
      const platforms=claimed.platforms||['wechat'];
      if(!Array.isArray(platforms)||!platforms.length||platforms.some(platform=>!['wechat','toutiao','xiaohongshu'].includes(platform)))throw Error('定时选题平台无效');
      const task=await createTask({productId:product.id,platforms:[...platforms],maxCalls,
        title:'定期内容策划：'+(product.name||product.id),input:'根据已确认产品资料、最近一周参考来源及已有内容表现，策划下一期内容。交付后等待人工审核与批准。'});
      updateSchedule({lastTaskId:task?.id??null,lastError:null});
    }catch(error){updateSchedule({lastError:errorText(error),lastErrorAt:date()});}
  }

  async function collectOne(){
    if(store.get('settings','default')?.monitoringEnabled===false)return;
    const job=store.transaction(()=>{
      const due=store.list('metricsJobs').filter(item=>item.status==='queued'&&Number.isFinite(timeOf(item.dueAt))&&timeOf(item.dueAt)<=now())
        .sort((a,b)=>timeOf(a.dueAt)-timeOf(b.dueAt)||a.id.localeCompare(b.id))[0];
      return due?store.put('metricsJobs',{...due,status:'running',startedAt:date()}):null;
    });
    if(!job)return;
    try {
      const result=await collectMetrics(job);
      if(result?.status&&!['collected','done'].includes(result.status))throw Error(result.message||'数据采集未取得可确认的成功结果');
      store.put('metricsJobs',{...store.get('metricsJobs',job.id),status:'done',result:result??null,error:null,endedAt:date()});
    }catch(error){store.put('metricsJobs',{...store.get('metricsJobs',job.id),status:'needs_input',error:errorText(error),uncertain:error?.outcome==='unknown',endedAt:date()});}
  }

  async function tick({collect=true}={}){
    if(busy)return;
    busy=true;
    try{await scheduleTask();if(collect)await collectOne();}finally{busy=false;}
  }
  return {tick,schedulePost};
}
