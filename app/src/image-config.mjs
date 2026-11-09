import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CredentialVault} from './credential-vault.mjs';
export const DEFAULT_IMAGE_MODEL='doubao-seedream-5-0-flash-260915';
export function createImageConfig({dataDir,legacyPath,env=process.env,vault}){
 vault??=new CredentialVault({keyFile:join(dataDir,'.credential.key')});
 const file=join(dataDir,'volcengine.encrypted');
 async function read(){
  let saved={};if(existsSync(file)){try{saved=JSON.parse(await readFile(file,'utf8'));}catch{throw Error('火山绘图配置损坏，请在运行设置重新保存');}}
  return {apiKey:env.ARK_API_KEY||env.VOLCENGINE_API_KEY||(saved.ciphertext?await vault.open(saved.ciphertext):''),model:saved.model||env.ARK_IMAGE_MODEL||DEFAULT_IMAGE_MODEL};
 }
 async function save({apiKey,model}){
  let saved={};if(existsSync(file))saved=JSON.parse(await readFile(file,'utf8'));
  if(model!==undefined){if(typeof model!=='string'||!model.trim()||!/^[a-zA-Z0-9_.-]{1,150}$/.test(model.trim()))throw Error('请填写有效的图片模型或 ep- 接入点 ID');saved.model=model.trim();}
  if(apiKey!==undefined&&apiKey!==''){if(typeof apiKey!=='string'||apiKey.trim().length<12)throw Error('火山 API Key 格式不正确');saved.ciphertext=await vault.seal(apiKey.trim());}
  await writeFile(file,JSON.stringify(saved),{mode:0o600});
 }
 async function migrate(){
  if(existsSync(file)||!legacyPath||!existsSync(legacyPath)||env.ARK_API_KEY||env.VOLCENGINE_API_KEY)return false;
  const db=new DatabaseSync(legacyPath,{readOnly:true});
  try{
   const secret=db.prepare('SELECT ciphertext FROM secrets WHERE id=?').get('ai:volcengine');if(!secret)return false;
   const config=JSON.parse(db.prepare('SELECT value FROM catalog_settings WHERE key=?').get('ai')?.value||'{}');
   // Copy the original Windows-protected blob without exposing or decrypting the key.
   // Legacy blobs contain JSON {key}; read() supports that below.
   await writeFile(file,JSON.stringify({ciphertext:secret.ciphertext,legacy:true,model:config.imageModel||DEFAULT_IMAGE_MODEL}),{mode:0o600});return true;
  }finally{db.close();}
 }
 async function config(){const result=await read();if(result.apiKey?.startsWith('{')){try{result.apiKey=JSON.parse(result.apiKey).key||'';}catch{throw Error('火山绘图密钥格式无效，请重新配置');}}return result;}
 async function status(){let saved={};if(existsSync(file))saved=JSON.parse(await readFile(file,'utf8'));return {imageConfigured:!!(env.ARK_API_KEY||env.VOLCENGINE_API_KEY||saved.ciphertext),imageModel:saved.model||env.ARK_IMAGE_MODEL||DEFAULT_IMAGE_MODEL};}
 return {read:config,save,migrate,status};
}
