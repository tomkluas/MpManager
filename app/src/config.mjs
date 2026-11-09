import {resolve,join,isAbsolute} from 'node:path';
import {DEFAULT_IMAGE_MODEL} from './image-config.mjs';

function integer(name,value,fallback,min,max){
  if(value===undefined||value==='')return fallback;
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw Error(`${name} 必须是 ${min} 到 ${max} 的整数`);
  return parsed;
}
function boolean(name,value,fallback){
  if(value===undefined||value==='')return fallback;
  if(['true','1','yes','on'].includes(String(value).toLowerCase()))return true;
  if(['false','0','no','off'].includes(String(value).toLowerCase()))return false;
  throw Error(`${name} 必须是 true 或 false`);
}
function url(name,value,fallback){
  const text=String(value||fallback).replace(/\/+$/,'');
  let parsed;try{parsed=new URL(text);}catch{throw Error(`${name} 必须是有效的 HTTP 地址`);}
  if(!['http:','https:'].includes(parsed.protocol))throw Error(`${name} 必须是有效的 HTTP 地址`);
  return text;
}
function path(root,value,fallback){const text=value||fallback;return isAbsolute(text)?resolve(text):resolve(root,text);}

export function loadAppConfig({root,env=process.env}={}){
  if(!root)throw Error('缺少应用目录');
  const projectRoot=resolve(root,'..');
  return {
    port:integer('APP_PORT',env.APP_PORT,4330,1,65535),
    defaultMaxCalls:integer('DEFAULT_MAX_CALLS',env.DEFAULT_MAX_CALLS,12,1,30),
    dataDir:env.APP_DATA_DIR?path(projectRoot,env.APP_DATA_DIR,'app/data'):join(root,'data'),
    deepseek:{apiKey:String(env.DEEPSEEK_API_KEY||'').trim(),model:String(env.DEEPSEEK_MODEL||'deepseek-flash').trim(),baseUrl:url('DEEPSEEK_BASE_URL',env.DEEPSEEK_BASE_URL,'https://api.deepseek.com')},
    image:{apiKey:String(env.ARK_API_KEY||env.VOLCENGINE_API_KEY||'').trim(),model:String(env.ARK_IMAGE_MODEL||DEFAULT_IMAGE_MODEL).trim()},
    openclawPath:env.OPENCLAW_PATH?path(projectRoot,env.OPENCLAW_PATH,'app/node_modules/openclaw/openclaw.mjs'):join(root,'node_modules','openclaw','openclaw.mjs'),
    egoBrowserCommand:String(env.EGO_BROWSER_COMMAND||'ego-browser').trim(),
    paperclip:{enabled:boolean('PAPERCLIP_ENABLED',env.PAPERCLIP_ENABLED,false),baseUrl:url('PAPERCLIP_BASE_URL',env.PAPERCLIP_BASE_URL,'http://127.0.0.1:4320/api')}
  };
}
