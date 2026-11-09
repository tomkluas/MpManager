import {createHash} from 'node:crypto';
const key=value=>createHash('sha256').update(value).digest('hex');
const fields=['views','likes','comments','shares','miniVisits'];
const cleanMetrics=raw=>Object.fromEntries(fields.filter(k=>typeof raw?.[k]==='number'&&Number.isFinite(raw[k])&&raw[k]>=0).map(k=>[k,raw[k]]));
const normalize=s=>String(s||'').replace(/\s/g,'');
export function canonicalPostUrl(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol))return null;u.hash='';const keep=['__biz','mid','idx','sn'];for(const k of [...u.searchParams.keys()])if(!keep.includes(k))u.searchParams.delete(k);return u.href;}catch{return null;}}
export function createAutoAnalytics({store,scan,classify,now=()=>Date.now()}){
 let busy=false,syncing=false;
 async function tick({force=false,accountId}={}){
  if(busy){if(force)throw Error('已有数据同步正在执行，请稍候');return;}if(!force&&store.get('settings','default')?.monitoringEnabled===false)return;busy=true;
  try{
   const account=store.list('accounts').filter(a=>!a.archived&&a.status==='connected').find(a=>(!accountId||a.id===accountId)&&(force||Date.parse(store.get('monitorRuns',a.id)?.nextRunAt||0)<=now()||!store.get('monitorRuns',a.id)));if(!account)return;
   const prior=store.get('monitorRuns',account.id),run=store.put('monitorRuns',{...prior,id:account.id,accountId:account.id,status:'running',startedAt:new Date(now()).toISOString(),nextRunAt:force?null:new Date(now()+3600000).toISOString(),mode:force?'manual_sync':'scheduled'});
   const job=store.put('metricsJobs',{id:'discovery-'+account.id+'-'+now(),accountId:account.id,status:'running',maxCalls:3,usedCalls:0,source:'auto_discovery'});
   try{
    const result=await scan(account),products=store.list('products').filter(p=>p.confirmed);let attributed=0,modelAttempts=0;
    for(const article of (result.articles||[]).slice(0,30)){
     const url=canonicalPostUrl(article.url);if(!url)continue;
     const id=key(account.id+'|'+url),previous=store.get('observedPosts',id);
     const drafts=store.list('drafts').filter(d=>d.platform===account.platform&&canonicalPostUrl(d.receipt?.url||d.publishedUrl)===url);
     const titleDrafts=store.list('drafts').filter(d=>d.platform===account.platform&&normalize(d.title)===normalize(article.title)&&(!d.accountId||d.accountId===account.id)&&!d.deletedAt);const titleProducts=[...new Set(titleDrafts.map(d=>store.get('tasks',d.taskId)?.productId).filter(Boolean))];
     const draftProducts=[...new Set(drafts.map(d=>store.get('tasks',d.taskId)?.productId).filter(Boolean))];
     const content=String(article.text||'').slice(0,16000),matches=products.filter(p=>[p.appId,p.name].filter(v=>v&&v.length>=4).some(v=>content.includes(v)));
     let productId=null,reason='未取得唯一产品证据，下次同步继续补查',draft=null;
     if(draftProducts.length===1){productId=draftProducts[0];draft=drafts[0];reason='文章链接与本地稿件一致';}
     else if(titleProducts.length===1&&products.some(p=>p.id===titleProducts[0]&&normalize(p.name)===normalize(account.name))){productId=titleProducts[0];draft=titleDrafts[0];reason='后台账号与产品同名，文章标题与本地唯一稿件一致';}
     else if(matches.length===1){productId=matches[0].id;reason='正文出现唯一产品名称或AppID';}
     else if(previous?.productId&&previous.text===content&&products.some(p=>p.id===previous.productId)){productId=previous.productId;reason=previous.attributionReason;}
     else if(classify&&content.length>=80&&modelAttempts<job.maxCalls){
      modelAttempts++;
      try{const r=await classify({article:{title:article.title,text:content},products:products.map(p=>({id:p.id,name:p.name,appId:p.appId,positioning:p.profile?.positioning})),jobId:job.id});if(products.some(p=>p.id===r.productId)&&r.confidence>=0.9&&typeof r.evidence==='string'&&r.evidence.length>=4&&content.includes(r.evidence)){productId=r.productId;reason='模型判断：'+r.evidence;}}catch{reason='归属分析暂未完成，下次同步继续补查';}
     }
     // Do not preserve an old attribution if the current article is ambiguous.
     const post=store.put('observedPosts',{...previous,id,accountId:account.id,platform:account.platform,url,title:String(article.title||'未命名文章').slice(0,200),text:content,contentReadAt:article.contentReadAt||previous?.contentReadAt||null,productId,attributionReason:reason,taskId:draft?.taskId||null,draftId:draft?.id||null,metrics:cleanMetrics(article.metrics),observedAt:new Date(now()).toISOString()});
     store.put('metrics',{...post,id:'auto-'+id,...post.metrics,source:'auto_browser',createdAt:post.observedAt});if(productId)attributed++;
    }
    if(result.productMetrics){const candidates=products.filter(p=>normalize(p.name)===normalize(result.productName));if(candidates.length===1)store.put('productMetrics',{id:account.id+'-'+result.productMetrics.date,accountId:account.id,productId:candidates[0].id,...result.productMetrics,source:'mini_program_dashboard',observedAt:new Date(now()).toISOString()});}
    store.put('monitorRuns',{...run,status:result.warning?'waiting_session':'done',message:result.warning||`已扫描${(result.articles||[]).length}篇，自动归属${attributed}篇`,failures:0,endedAt:new Date(now()).toISOString()});store.put('metricsJobs',{...store.get('metricsJobs',job.id),status:'done'});
   }catch(e){const failures=(prior?.failures||0)+1;store.put('monitorRuns',{...run,status:force?'failed':'retrying',message:String(e.message).slice(0,500),failures,nextRunAt:force?null:new Date(now()+[60000,300000,900000][Math.min(failures-1,2)]).toISOString()});store.put('metricsJobs',{...store.get('metricsJobs',job.id),status:'failed',error:String(e.message).slice(0,500)});}
  }finally{busy=false;}
 }
 async function sync(){if(syncing||busy)throw Error('已有数据同步正在执行，请稍候');syncing=true;try{const accounts=store.list('accounts').filter(a=>!a.archived&&a.status==='connected');if(!accounts.length)throw Error('没有已连接的平台账号，请先检查账号连接');for(const a of accounts)await tick({force:true,accountId:a.id});return {accounts:accounts.length,results:accounts.map(a=>store.get('monitorRuns',a.id))};}finally{syncing=false;}}
 return {tick,sync};
}
export function analyticsReport(store){
 const latest=new Map();for(const row of store.list('metrics').slice().reverse()){const draft=row.draftId&&store.get('drafts',row.draftId),task=store.get('tasks',row.taskId||draft?.taskId||null);const url=canonicalPostUrl(row.url||draft?.receipt?.url||draft?.publishedUrl),id=url||row.draftId||row.id;latest.set(id,{...row,title:row.title||draft?.title,productId:row.productId??task?.productId,productName:store.get('products',row.productId||task?.productId||null)?.name});}
 const posts=[...latest.values()],products=store.list('products').filter(p=>p.confirmed).map(p=>{const own=posts.filter(r=>r.productId===p.id);return {id:p.id,name:p.name,posts:own.length,views:own.reduce((n,r)=>n+(r.views||0),0),likes:own.reduce((n,r)=>n+(r.likes||0),0)};});
 const recordableDrafts=store.list('drafts').filter(d=>{const task=store.get('tasks',d.taskId);return task&&!task.deletedAt&&!d.deletedAt&&d.status!=='superseded';}).map(d=>({id:d.id,taskId:d.taskId,title:d.title,platform:d.platform}));
 return {posts,products,recordableDrafts,productMetrics:store.list('productMetrics'),monitoring:store.list('monitorRuns'),summary:{posts:posts.length,totalViews:posts.reduce((n,r)=>n+(r.views||0),0)},insights:products.filter(p=>p.posts).map(p=>`${p.name}：已识别 ${p.posts} 篇推广文章，已取得阅读量合计 ${p.views}；缺少指标不补零，数据不代表新增用户。`),limitations:['自动读取已登录账号的可见数据；搜索摘要和无标签数字不当作统计。','小程序整体访问与单篇推广文章分别记录，不把整体增长归因于某一篇文章。']};
}
