import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const preflightError=(message,stage,code)=>Object.assign(Error(message),{stage,code,outcome:'not_started',retryable:false});

// Only query metadata. Never generate content to test connectivity or credentials.
export async function checkModelService({url,apiKey,stage,fetch=globalThis.fetch}){
 const name=stage==='image'?'火山绘图':'文字模型',prefix=stage==='image'?'COVER':'MODEL';
 let response;
 try{response=await fetch(url,{method:'GET',headers:{authorization:'Bearer '+apiKey},redirect:'error',signal:AbortSignal.timeout(8000)});}
 catch(e){const permission=['EACCES','EPERM'].includes(e?.cause?.code||e?.code);throw preflightError(name+(permission?'联网权限受阻，请修复服务进程的联网权限':'连接失败或超时，请检查服务网络后重试'),stage,prefix+(permission?'_NETWORK_PERMISSION':'_NETWORK'));}
 // Do not echo provider responses: they may contain credentials or account details.
 await response.body?.cancel();
 if(!response.ok)throw preflightError(name+'启动检查返回 HTTP '+response.status+'；'+([401,403].includes(response.status)?'请在运行设置检查密钥，并在服务商后台确认访问权限':'请检查服务状态、余额或配额后重试'),stage,prefix+'_HTTP_'+response.status);
 return {message:name+'连接和模型列表访问检查通过；不代表生成权限、余额和配额已全部验证'};
}

export async function checkWritable(directory){
 const path=join(directory,'.preflight-'+randomUUID());
 try{await mkdir(directory,{recursive:true});await writeFile(path,'',{flag:'wx'});await unlink(path);}
 catch{throw preflightError('任务文件目录不可写，请修复服务进程的目录权限后重试','storage','STORAGE_PERMISSION');}
}

export async function checkTaskDependencies({task,runtime,coverAgent,directories=[]}){
 const checks=[];
 for(const directory of directories)await checkWritable(directory);
 if(runtime.preflight)checks.push(await runtime.preflight());
 if(task.kind!=='analyze'&&coverAgent?.preflight)checks.push(await coverAgent.preflight());
 return {checkedAt:new Date().toISOString(),checks,warnings:['启动检查不生成内容，不消耗任务调用预算。生成权限、余额和配额仍以实际服务响应为准。','出稿不要求平台登录；上传草稿前需另行检查账号连接。']};
}
