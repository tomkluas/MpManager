import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {imageDimensions} from './cover-agent.mjs';

export function productMedia(store,productId){return store.list('assets').filter(a=>a.productId===productId&&['qrcode','screenshot'].includes(a.role)&&!a.disabled);}
export function selectProductMedia(product,ids,platform){
 const selected=new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]);
 return (product.media||[]).filter(a=>selected.has(a.id)&&a.platforms?.includes(platform)&&!a.disabled).slice(0,4);
}
export async function saveProductMedia({store,root,productId,input}){
 if(!store.get('products',productId))throw Error('产品不存在');
 if(!['qrcode','screenshot'].includes(input.kind))throw Error('请选择二维码或页面截图');
 if(typeof input.description!=='string'||!input.description.trim()||input.description.length>500)throw Error('请填写500字以内的图片用途说明');
 if(!Array.isArray(input.platforms)||!input.platforms.length||input.platforms.some(p=>!['wechat','toutiao','xiaohongshu'].includes(p)))throw Error('请选择允许使用图片的平台');
 if(typeof input.base64!=='string'||input.base64.length>14e6||!input.base64.length||input.base64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw Error('图片格式或大小无效，最大10 MiB');
 const bytes=Buffer.from(input.base64,'base64');if(bytes.length>10*1024*1024)throw Error('图片不能超过10 MiB');
 let image;try{image=imageDimensions(bytes);}catch{throw Error('请上传完整的 PNG 或 JPEG 图片');}
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const scope=createHash('sha256').update(productId).digest('hex').slice(0,16);
 const id=`product-${scope}-${input.kind}-${sha256}`,directory=join(resolve(root),'assets','products',scope),path=join(directory,`${id}.${image.ext}`);
 await mkdir(directory,{recursive:true});await writeFile(path,bytes);
 return store.put('assets',{id,productId,role:input.kind,name:String(input.filename||'产品图片').slice(0,150),description:input.description.trim(),platforms:[...new Set(input.platforms)],path,sha256,...image,disabled:false});
}
