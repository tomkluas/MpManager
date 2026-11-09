import {parseArticleUrl} from './article-url.mjs';
export function enforceDraftOnly(store){store.transaction(()=>{const settings=store.get('settings','default')||{id:'default'};store.put('settings',{...settings,deliveryMode:'draft_only'});for(const a of store.list('accounts'))if(!a.archived)store.put('accounts',{...a,capabilities:{...a.capabilities,publish:false,draftUpload:a.status==='connected'&&a.platform==='wechat'}});for(const a of store.list('approvals')){if(a.action==='upload_draft'||['published','unknown','cancelled_by_mode_change'].includes(a.status))continue;if(['queued','approved','awaiting_browser','awaiting_confirmation','publishing'].includes(a.status)){const uncertain=a.status==='publishing'&&a.receipt?.submitted!==false;store.put('approvals',{...a,status:uncertain?'unknown':'cancelled_by_mode_change',message:'已切换为仅上传草稿，不执行自动发表'});const d=typeof a.draftId==='string'?store.get('drafts',a.draftId):null;if(d&&!['published','superseded','draft_saved'].includes(d.status)&&!uncertain){store.put('drafts',{...d,status:'awaiting_review'});const t=store.get('tasks',d.taskId);if(t)store.put('tasks',{...t,status:'awaiting_review',phase:'awaiting_review',message:'已改为仅上传草稿，审核后可上传正文及配图，由你在平台后台发表'});}}}});}
export function markManuallyPublished(store,id,{url,confirmed,accountId}) {
  if(confirmed!==true)throw Error('请确认已在平台后台完成发表');
  const d=store.get('drafts',id);
  if(!d||!['awaiting_review','draft_saved','published'].includes(d.status))throw Error('当前稿件状态不适合登记，请先处理进行中或结果未知的操作');
  const u=parseArticleUrl(d.platform,url);
  if(accountId!==undefined) {
    if(typeof accountId!=='string'||!accountId)throw Error('请选择有效的平台账号');
    if(d.accountId&&d.accountId!==accountId)throw Error('稿件已有平台账号，不能更换');
    const account=store.get('accounts',accountId);
    if(!account||account.archived||account.platform!==d.platform)throw Error('请选择未归档的对应平台账号');
  }
  const publicationAccountId=d.accountId||accountId;
  return store.transaction(()=>{
    const publishedAt=d.publishedAt||new Date().toISOString();
    const receipt={...d.receipt,status:'published',url:u.href,published:true,source:'human_verified',operation:'manual_publication',publishedAt};
    if(!publicationAccountId)receipt.metricsMode='manual';
    else delete receipt.metricsMode;
    const next=store.put('drafts',{...d,...(publicationAccountId?{accountId:publicationAccountId}:{}),status:'published',publishedAt,receipt});
    const task=store.get('tasks',d.taskId);
    if(task){
      const drafts=store.list('drafts').filter(x=>x.taskId===d.taskId&&x.status!=='superseded');
      const done=drafts.every(x=>x.status==='published');
      store.put('tasks',{...task,status:done?'published':'partial',phase:done?'published':'partial',message:'已登记你在平台后台手动发表的文章链接'});
    }
    store.event(d.taskId,'用户登记已手动发表：'+u.href);
    return next;
  });
}
