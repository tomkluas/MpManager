import {articleLayout} from './article-layout.mjs';
import {selectProductMedia} from './product-media.mjs';
import {drawComicCover} from './comic-cover.mjs';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import MarkdownIt from 'markdown-it';

const MAX_FILE=10*1024*1024, MAX_EXPANDED=30*1024*1024;
const xmlParser=new XMLParser({ignoreAttributes:false,processEntities:true,removeNSPrefix:true});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:value==null?[]:[value];
const xmlNumeric=value=>String(value??'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,code)=>{
  const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):parseInt(code,10);
  return n<=0x10ffff?String.fromCodePoint(n):'';
});
function safeXML(text){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('文档包含禁止的 XML 实体或 DTD');
  if(XMLValidator.validate(text)!==true)throw new Error('XML 文档格式无效');
  return xmlParser.parse(text);
}
function sectionsFrom(text){
  const sections=[];let current={title:'正文',text:''};
  for(const line of text.split('\n')){
    const heading=/^#{1,6}\s+(.+)$/.exec(line);
    if(heading){if(current.text.trim())sections.push({...current,text:current.text.trim()});current={title:heading[1],text:''};}
    else current.text+=line+'\n';
  }
  if(current.text.trim())sections.push({...current,text:current.text.trim()});
  return sections;
}
export function extractDocument({bytes,filename}){
  if(!(bytes instanceof Uint8Array))throw new Error('缺少文档二进制数据');
  if(bytes.byteLength>MAX_FILE)throw new Error('文档不能超过 10MiB');
  const ext=extname(String(filename)).toLowerCase();let text='';const warnings=[];
  if(ext==='.txt'||ext==='.md'){
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('文本文件必须使用 UTF-8 编码');}
    if(text.includes('\0'))throw new Error('文本包含二进制数据');
  }else if(ext==='.docx'){
    let size=0,count=0;
    const files=unzipSync(bytes,{filter:entry=>{
      if(++count>500||(size+=entry.originalSize)>MAX_EXPANDED)throw new Error('DOCX 解压大小或文件数量超出限制');
      if(/(^|\/)\.\.(\/|$)|^[\\/]|^[A-Za-z]:/.test(entry.name)||entry.name.includes('\\'))throw new Error('DOCX 包含不安全路径');
      return /\.xml$|\.rels$/i.test(entry.name);
    }});
    for(const [name,content] of Object.entries(files)){
      if(content.length>MAX_EXPANDED)throw new Error('DOCX 解压超出限制');
      const xml=strFromU8(content),parsed=safeXML(xml);
      if(name.endsWith('.rels')){
        for(const relation of list(parsed.Relationships?.Relationship)){
          const target=xmlNumeric(relation['@_Target']).trim(),mode=xmlNumeric(relation['@_TargetMode']);
          if(mode.toLowerCase()==='external'||/^[a-z][a-z0-9+.-]*:|^[\\/]{2}/i.test(target)){
            const type=xmlNumeric(relation['@_Type']);
            if(['http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink','http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink'].includes(type)){
              if(!warnings.some(w=>w.includes('超链接')))warnings.push('文档包含外部超链接，仅提取显示文字；链接目标已忽略，未访问外部地址。');
            }else throw new Error('DOCX 包含外部对象、图片或模板关系，不能安全导入');
          }
        }
      }
    }
    if(!files['word/document.xml'])throw new Error('DOCX 缺少正文');
    const xml=strFromU8(files['word/document.xml']);
    // Preserve paragraph/run order rather than relying on object key grouping.
    const ordered=new XMLParser({preserveOrder:true,ignoreAttributes:true,removeNSPrefix:true,processEntities:true}).parse(xml);
    const paragraphs=[];
    function walk(nodes,inParagraph=false){let value='';for(const node of list(nodes))for(const [key,children] of Object.entries(node)){
      if(key==='p'){paragraphs.push(walk(children,true));}
      else if(key==='#text')value+=String(children);
      else if(key==='tab')value+='\t';
      else if(key==='br'||key==='cr')value+='\n';
      else if(key!==':@')value+=walk(children,inParagraph);
    }return value;}
    walk(ordered);text=paragraphs.join('\n');warnings.push('仅提取 DOCX 正文文字，表格按段落顺序展开；图片、批注和页眉页脚未导入。');
  }else throw new Error('仅支持 DOCX、TXT、MD 文件');
  text=text.replace(/\r\n?/g,'\n').trim();
  if(!text)warnings.push('文档未提取到正文文字。');
  return {text,sections:sectionsFrom(text),warnings};
}

export {researchTopics} from './domestic-research.mjs';

export async function renderDraft({draft,product={},outputDir,coverAgent,mediaProvider=()=>product.media}){
  if(!outputDir)throw new Error('缺少图片输出目录');
  const directory=resolve(outputDir);await mkdir(directory,{recursive:true});const assets=[],warnings=[];
  const title=String(draft.title??'产品使用指南').slice(0,100);
  for(const role of ['cover','infographic']){
    const purpose=role==='cover'?'cover':'inline';
    const image=coverAgent?await coverAgent.generate({draft,product,outputDir:directory,purpose}):await drawComicCover({title,body:draft.body,platform:purpose==='inline'?'toutiao':draft.platform});
    const sha256=createHash('sha256').update(image.bytes).digest('hex'),id=`${role}-${sha256}`;const path=join(directory,`${id}.${image.ext}`);
    await writeFile(path,image.bytes);assets.push({id,role,path,mime:image.mime,sha256,...(image.width?{width:image.width,height:image.height,style:image.style||'comic',scene:image.scene,provider:image.provider,model:image.model}:{})});
    if(image.ext==='svg')warnings.push('本机 PNG 渲染不可用，生成 SVG 预览；发布前需转为平台支持的 PNG/JPEG。');
  }
  assets.push(...selectProductMedia({...product,media:mediaProvider()},draft.imageAssetIds,draft.platform));
  const md=new MarkdownIt({html:false,linkify:false,typographer:false});
  // Imported remote images can track readers and are not approved local assets.
  md.renderer.rules.image=(tokens,index)=>`<span class="omitted-image">[外部图片已省略：${esc(tokens[index].content)}]</span>`;
  md.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('rel','noopener noreferrer');return self.renderToken(tokens,index,options);};
  let body=md.render(String(draft.body??''));
  const illustration='<figure><img src="/api/assets/'+assets[1].id+'" alt="正文漫画插图"></figure>';
  let paragraphs=0,inserted=false;body=body.replace(/<\/p>/g,end=>{paragraphs++;if(paragraphs===2){inserted=true;return end+illustration;}return end;});if(!inserted)body+=illustration;
  body+=assets.slice(2).map(a=>'<figure><img src="/api/assets/'+a.id+'" alt="'+esc(a.role==='qrcode'?'小程序二维码':'小程序页面截图')+'"'+(a.role==='qrcode'?' style="max-width:320px;margin:auto;border-radius:0"':'')+'></figure>').join('');
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>body{margin:auto;padding:24px;max-width:760px;color:#20352c;background:#fff;font:17px/1.85 system-ui,sans-serif}h1{line-height:1.4;font-size:30px}h2{font-size:23px}img{display:block;width:100%;max-width:100%;height:auto;object-fit:contain;border-radius:12px}a{color:#216b50}blockquote{border-left:4px solid #8fb99a;padding-left:18px;color:#52655b}.omitted-image{color:#65736a}</style></head><body><article><h1>${esc(title)}</h1><img src="/api/assets/${assets[0].id}" width="${assets[0].width}" height="${assets[0].height}" style="display:block;width:100%;max-width:100%;height:auto;object-fit:contain" alt="文章封面"><main>${body}</main></article></body></html>`;
  return {html:articleLayout(html),assets,warnings};
}
