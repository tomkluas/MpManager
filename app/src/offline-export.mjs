import {articleLayout} from './article-layout.mjs';
import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {basename,isAbsolute} from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

const policy="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'";
const tag=/<(?:img|meta)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const attr=/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const attributes=html=>Array.from(html.matchAll(attr),m=>({name:m[1].toLowerCase(),value:m[2]??m[3]??m[4],raw:m[0]}));

function safeSvg(bytes){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(/<!|<\?/.test(text)||XMLValidator.validate(text)!==true)throw Error('SVG 格式无效');
  const parsed=new XMLParser({ignoreAttributes:false,processEntities:false}).parse(text);
  if(Object.keys(parsed).length!==1||!parsed.svg)throw Error('SVG 缺少根元素');
  // The local fallback renderer only emits these inert shapes and text.
  const allowed={svg:['xmlns','width','height','viewBox'],rect:['width','height','x','y','fill'],g:['fill','font-family'],text:['x','y','font-size','font-weight']};
  function visit(name,node){
    if(!allowed[name])throw Error('SVG 包含不支持的元素');
    if(Array.isArray(node)){for(const item of node)visit(name,item);return;}
    if(typeof node!=='object'||node===null)return;
    for(const [key,value] of Object.entries(node)){
      if(key==='#text')continue;
      if(key.startsWith('@_')){
        if(!allowed[name].includes(key.slice(2))||/url\s*\(|[&\\\u0000-\u001f]/i.test(String(value)))throw Error('SVG 包含不安全属性');
        if(key==='@_xmlns'&&value!=='http://www.w3.org/2000/svg')throw Error('SVG 命名空间无效');
      }else visit(key,value);
    }
  }
  visit('svg',parsed.svg);
}

function validateImage(bytes,mime){
  if(mime==='image/png'){
    if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')throw Error('PNG 文件格式无效');
  }else if(mime==='image/jpeg'){
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('JPEG 文件格式无效');
  }else if(mime==='image/svg+xml')safeSvg(bytes);
  else throw Error('不支持的图片 MIME 类型');
}

/** Export sanitized renderer HTML using only this draft's registered local assets.
 * store is the trusted server store; paths supplied in HTML are never read.
 */
export async function exportDraftHtml({draft,store}){
  if(typeof draft?.html!=='string'||!draft.html.trim())throw Error('稿件尚未生成预览，无法导出');
  if(!store?.get)throw Error('缺少图片存储');
  const assets=new Map();
  for(const asset of draft.assets??[]){
    if(!asset?.id||assets.has(asset.id))throw Error('稿件图片记录重复或无效');
    assets.set(asset.id,asset);
  }
  const replacements=new Map();
  for(const match of draft.html.matchAll(tag)){
    if(!/^<img\b/i.test(match[0]))continue;
    const sources=attributes(match[0]).filter(a=>a.name==='src');
    if(sources.length!==1)throw Error('图片来源属性无效');
    const source=sources[0].value;
    if(!source.startsWith('/api/assets/'))continue; // External URLs are never followed, and CSP blocks them.
    const id=source.slice('/api/assets/'.length),asset=assets.get(id),registered=asset&&store.get('assets',id);
    if(!asset||!registered)throw Error(`稿件图片不存在或不属于当前稿件：${id}`);
    if(replacements.has(source))continue;
    // Content-addressed images may be copied into several draft directories.
    // Only the trusted registry chooses the file; draft.path is never consulted.
    for(const key of ['id','sha256','mime'])if(asset[key]!==registered[key])throw Error(`稿件图片记录冲突：${id}`);
    if(!/^[a-f0-9]{64}$/.test(registered.sha256??'')||!id.endsWith('-'+registered.sha256))throw Error(`稿件图片 SHA256 记录无效：${id}`);
    const extension={'image/png':'png','image/jpeg':'jpg','image/svg+xml':'svg'}[registered.mime];
    if(!extension)throw Error(`不支持的图片 MIME 类型：${id}`);
    if(typeof registered.path!=='string'||!isAbsolute(registered.path)||basename(registered.path)!==`${id}.${extension}`)throw Error(`稿件图片路径无效：${id}`);
    let bytes;
    try{
      const stat=await lstat(registered.path);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('不是普通图片文件');
      bytes=await readFile(registered.path);
    }catch(error){throw Error(`无法读取稿件图片 ${id}：${error.message}`);}
    if(createHash('sha256').update(bytes).digest('hex')!==registered.sha256)throw Error(`稿件图片 SHA256 校验失败：${id}`);
    try{validateImage(bytes,registered.mime);}catch(error){throw Error(`稿件图片损坏或不安全 ${id}：${error.message}`);}
    replacements.set(source,`data:${registered.mime};base64,${bytes.toString('base64')}`);
  }
  let html=draft.html.replace(tag,html=>{
    const attrs=attributes(html);
    if(/^<meta\b/i.test(html)&&attrs.some(a=>a.name==='http-equiv'&&a.value.toLowerCase()==='content-security-policy'))return '';
    if(!/^<img\b/i.test(html))return html;
    const src=attrs.find(a=>a.name==='src');
    return replacements.has(src?.value)?html.replace(src.raw,` src="${replacements.get(src.value)}"`):html;
  });
  const meta=`<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if(!/<head\b[^>]*>/i.test(html))throw Error('稿件 HTML 缺少 head，无法安全导出');
  html=html.replace(/<head\b[^>]*>/i,head=>head+meta);
  return articleLayout(html);
}
