const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function manualUploadPanel(draft){
  const platform=draft.platform==='toutiao'?{name:'今日头条',url:'https://mp.toutiao.com/'}:{name:'小红书',url:'https://creator.xiaohongshu.com/'};
  return `<section class="manual-upload"><h3>${platform.name}：手动保存草稿</h3><p class="help section-space">内容已生成。当前尚未接通${platform.name}自动草稿上传，请按下面步骤导入；无需选择公众号账号。</p><details class="manual-steps section-space"><summary>查看导入步骤</summary><ol><li>打开${platform.name}创作后台，由你本人登录。</li><li>新建图文内容，分别粘贴标题和正文，检查排版。</li><li>把图片素材添加到正文，再使用封面图设置文章封面。</li><li>检查内容并保存草稿；是否发表由你决定。</li></ol></details><div class="actions section-space"><a class="button secondary" href="${platform.url}" target="_blank" rel="noopener">打开${platform.name}后台</a><button type="button" class="secondary" id="copy-draft-title">复制标题</button><button type="button" class="secondary" id="copy-draft-body">复制正文</button></div><div class="actions section-space">${(draft.assets||[]).map(a=>`<a class="button secondary" href="/api/assets/${encodeURIComponent(a.id)}" download="${escape(a.role==='cover'?'文章封面':a.role==='qrcode'?'小程序二维码':a.role==='screenshot'?'页面截图':'正文漫画插图')}.${a.mime==='image/svg+xml'?'svg':a.mime==='image/jpeg'?'jpg':'png'}">下载${a.role==='cover'?'封面':a.role==='qrcode'?'二维码':a.role==='screenshot'?'页面截图':'正文漫画插图'}</a>`).join('')}<a class="quiet" href="/api/drafts/${encodeURIComponent(draft.id)}/export" download>导出 HTML</a></div><p class="help section-space">封面和正文插图需要分别添加。这里不会自动操作或发表，也不会将复制、下载记录成上传成功。</p></section>`;
}

// The preview is parsed in an inert template, never loaded into a readable iframe.
// Rebuild only formatting tags: no URLs, images, attributes or active content survive.
export function extractBodyContent(main){
  if(!main)throw new Error('正文预览尚未准备好');
  const allowed=new Set(['P','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','U','S','UL','OL','LI','BLOCKQUOTE','PRE','CODE','BR','HR']);
  const blocked=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','IMG','PICTURE','VIDEO','AUDIO','SOURCE','FORM','INPUT','BUTTON','TEMPLATE']);
  const blocks=new Set(['P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','UL','OL','DIV','SECTION']);
  function read(node){
    if(node.nodeType===3)return {html:escape(node.textContent),text:node.textContent};
    if(node.nodeType!==1||blocked.has(node.tagName))return {html:'',text:''};
    const parts=Array.from(node.childNodes).map(read);
    const tag=node.tagName.toLowerCase(),inside=parts.map(p=>p.html).join('');
    return {html:allowed.has(node.tagName)?`<${tag}>${inside}${['br','hr'].includes(tag)?'':`</${tag}>`}`:inside,
      text:parts.map(p=>p.text).join('')+(blocks.has(node.tagName)||['BR','HR'].includes(node.tagName)?'\n':'')};
  }
  const content=read(main);
  return {html:content.html,text:content.text.replace(/\n{3,}/g,'\n\n').trim()};
}
export function plainDraftBody(markdown){
  return String(markdown||'')
    .replace(/```[^\n]*\n([\s\S]*?)```/g,'$1')
    .replace(/!\[[^\]]*\]\([^\n)]*\)/g,'')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g,'$1')
    .replace(/^\s{0,3}#{1,6}\s+|^\s*>\s?|^\s*(?:[-+*]|\d+[.)])\s+/gm,'')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm,'')
    .replace(/(\*\*|__)([\s\S]+?)\1/g,'$2')
    .replace(/(\*|_)([^\n]+?)\1/g,'$2')
    .replace(/~~([^\n]+?)~~/g,'$1').replace(/`([^`]+)`/g,'$1')
    .replace(/\n{3,}/g,'\n\n').trim();
}
function bounded(promise,milliseconds=5000){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('复制超时，请重试')),milliseconds);})]).finally(()=>clearTimeout(timer));
}
async function loadBodyContent(draft){
  const response=await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/preview`,{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('正文预览读取失败');
  const template=document.createElement('template');
  template.innerHTML=await response.text();
  return extractBodyContent(template.content.querySelector('main'));
}
export async function copyDraftBody(draft,options={}){
  const clipboard=options.clipboard??globalThis.navigator?.clipboard;
  const Item=options.ClipboardItem??globalThis.ClipboardItem;
  let content={text:plainDraftBody(draft.body)};
  if(options.preferRich!==false&&clipboard?.write&&Item){
    try{
      content=await bounded((options.loadContent??loadBodyContent)(draft));
      await bounded(clipboard.write([new Item({'text/html':new Blob([content.html],{type:'text/html'}),'text/plain':new Blob([content.text],{type:'text/plain'})})]));
      return 'rich';
    }catch{/* Unsupported rich clipboard or unavailable preview: copy plain text. */}
  }
  try{
    if(!clipboard?.writeText)throw new Error('clipboard unavailable');
    await bounded(clipboard.writeText(content.text));
    return 'plain';
  }catch{throw new Error('浏览器未允许复制。请导出 HTML，在打开的文章中选中正文复制。');}
}
