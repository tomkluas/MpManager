const text=(value,max)=>String(value??'').slice(0,max);
export function contentContext(store,task,product){
  const productTasks=new Set(store.list('tasks').filter(t=>t.productId===task.productId&&!t.deletedAt).map(t=>t.id));
  const history=store.list('drafts').filter(d=>d.taskId!==task.id&&!d.deletedAt&&productTasks.has(d.taskId)).slice(0,8).map(d=>({title:text(d.title,120),platform:d.platform,writingApproach:d.writingApproach,digest:text(d.digest,180),review:text(d.review,300)}));
  const externalHistory=store.list('history').slice(0,10).map(h=>({title:text(h.title,120),url:h.url,excerpt:text(h.text||h.context,180)}));
  const metrics=store.list('metrics').filter(m=>productTasks.has(m.taskId)).slice(0,12).map(m=>({draftId:m.draftId,platform:m.platform,views:m.views,likes:m.likes,comments:m.comments,shares:m.shares,miniVisits:m.miniVisits,source:m.source}));
  return {product:{name:product.name,appId:product.appId,entryPath:product.entryPath,profile:product.profile,media:(product.media||[]).slice(0,30).map(a=>({id:a.id,kind:a.role,description:text(a.description,500),platforms:a.platforms}))},history,externalHistory,metrics};
}
export function previousContent(drafts){return drafts.filter(d=>!d.deletedAt).slice(0,2).map(d=>({title:text(d.title,120),body:text(d.body,4000),digest:text(d.digest,180),review:text(d.review,600)}));}
export function researchContext(research){return {sources:(research.sources||[]).slice(0,8).map(s=>({title:text(s.title,150),url:s.url,publishedAt:s.publishedAt,text:text(s.text,500),provider:s.provider})),warnings:(research.warnings||[]).slice(-4)};}
