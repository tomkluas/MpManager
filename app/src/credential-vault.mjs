import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
class SafeError extends Error{constructor(code,message){super(message);this.code=code;}};
export class CredentialVault{
 constructor({runHelper,platform=process.platform,keyFile}={}){this.runHelper=runHelper;this.platform=platform;this.keyFile=keyFile;}
 executeWindows(request){return new Promise((resolve,reject)=>{const code=readFileSync(new URL('./dpapi.ps1',import.meta.url),'utf8');const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',done=false;const finish=(ok)=>{if(done)return;done=true;clearTimeout(timer);if(ok)resolve(output);else reject(new SafeError('VAULT','凭证加解密失败，请使用原 Windows 用户或重新配置密钥'));};const timer=setTimeout(()=>{child.kill();finish(false);},15000);child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{output+=s;if(output.length>100000){child.kill();finish(false);}});child.stderr.resume();child.on('error',()=>finish(false));child.on('close',c=>finish(c===0));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));});}
 async key(){
  if(!this.keyFile)throw new SafeError('VAULT','缺少本机凭证密钥路径，请重新配置');
  try{const key=await readFile(this.keyFile);if(key.length!==32)throw Error('invalid key');return key;}catch(error){
   if(error.code&&error.code!=='ENOENT')throw new SafeError('VAULT','本机凭证密钥不可用，请重新配置');
   const key=randomBytes(32);await mkdir(dirname(this.keyFile),{recursive:true});
   try{await writeFile(this.keyFile,key,{mode:0o600,flag:'wx'});return key;}catch(writeError){if(writeError.code==='EEXIST')return this.key();throw new SafeError('VAULT','无法创建本机凭证密钥');}
  }
 }
 async seal(value){
  if(this.runHelper)return this.runHelper({operation:'encrypt',value});
  if(this.platform==='win32')return this.executeWindows({operation:'encrypt',value});
  const key=await this.key(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return `aes-gcm-v1:${Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')}`;
 }
 async open(value){
  if(this.runHelper)return this.runHelper({operation:'decrypt',value});
  if(this.platform==='win32')return this.executeWindows({operation:'decrypt',value});
  if(!String(value).startsWith('aes-gcm-v1:'))throw new SafeError('VAULT','此凭证由 Windows 用户加密，macOS/Linux 无法解密，请重新配置密钥');
  try{const payload=Buffer.from(String(value).slice(11),'base64'),key=await this.key(),iv=payload.subarray(0,12),tag=payload.subarray(12,28),encrypted=payload.subarray(28),decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');}
  catch{throw new SafeError('VAULT','凭证加解密失败，请使用原系统用户或重新配置密钥');}
 }
}
