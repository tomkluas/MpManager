import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile, access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkModelService,checkWritable,preflightError} from './preflight.mjs';

function failure(message,outcome='not_started',callId) {
  return Object.assign(new Error(message),{outcome,callId,retryable:false});
}

async function executeOpenClaw({configPath,stateDir,workspace,role,sessionId,prompt,signal,openclawPath,nodePath}) {
  // Clear inherited provider credentials and OpenClaw overrides: only the local proxy is configured.
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>
    !/^(OPENCLAW_|PI_CODING_AGENT_DIR$|.*(?:API_KEY|AUTH_TOKEN)$)/i.test(name)));
  Object.assign(env,{OPENCLAW_STATE_DIR:stateDir,OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_AGENT_DIR:join(stateDir,'agents',role,'agent')});
  return await new Promise((resolveResult,reject)=>{
    const child=spawn(nodePath,[openclawPath,'agent','--local','--agent',role,'--session-id',sessionId,'--message',prompt,'--json','--thinking','off','--timeout','120'],
      {cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',bytes=0;
    const stop=()=>child.kill();
    signal.addEventListener('abort',stop,{once:true});
    if(signal.aborted) stop();
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024) stop();else stdout+=chunk;});
    // Do not expose stderr: upstream libraries can echo authorization or prompt material.
    child.stderr.resume();
    child.on('error',()=>{signal.removeEventListener('abort',stop);reject(failure('OpenClaw 无法启动'));});
    child.on('close',code=>{
      signal.removeEventListener('abort',stop);
      if(signal.aborted||code!==0||bytes>4*1024*1024) return reject(failure('OpenClaw 执行中断；请检查调用记录，勿自动重试'));
      try{resolveResult(JSON.parse(stdout));}catch{reject(failure('OpenClaw 返回格式无效；勿自动重试'));}
    });
  });
}

/** root is the app directory. Injection replaces external process/network only, retaining the paid-call guard. */
export async function createAgentRuntime({root,keyFile,onUsage=async()=>{},model='deepseek-flash',
  apiKey='',allowKeyFile=true,baseUrl='https://api.deepseek.com',runAgent,fetch:upstreamFetch=globalThis.fetch,openclawPath=join(resolve(root||'.'),'node_modules','openclaw','openclaw.mjs'),nodePath=process.execPath,timeoutMs=140000}={}) {
  if(!root||(allowKeyFile&&!keyFile)) throw failure('缺少运行目录或 DeepSeek Key 文件');
  const runtimeDir=join(resolve(root),'data','runtime');
  await mkdir(runtimeDir,{recursive:true});
  let closed=false;
  const active=new Map();

  async function generate({role,prompt,jobId,signal,maxTokens=3000}={}) {
    if(closed) throw failure('模型执行器已关闭');
    signal?.throwIfAborted();
    if(!/^[a-z][a-z0-9_-]{0,47}$/i.test(role||'')||typeof prompt!=='string'||!prompt.trim()||prompt.length>200000)
      throw failure('角色或提示内容无效');
    if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>8192) throw failure('输出上限须为 1 至 8192');
    if(!runAgent) {try{await access(openclawPath);}catch{throw failure('未找到 OpenClaw 执行文件');}}
    let key=String(apiKey||'').trim();
    try {
      if(!key&&allowKeyFile)key=(await readFile(keyFile,'utf8')).trim();
      if(key.startsWith('{')) {const data=JSON.parse(key);key=data.deepseekKey||data.key;}
      if(typeof key!=='string'||!key.trim()) throw Error();
      key=key.trim();
    } catch {throw failure('尚未配置有效的 DeepSeek Key');}
    if(closed) throw failure('模型执行器已关闭');
    signal?.throwIfAborted();
    const callId=randomUUID(),token=randomUUID();
    const callDir=join(runtimeDir,callId),stateDir=join(callDir,'state'),workspace=join(callDir,'workspace');
    await mkdir(workspace,{recursive:true}); await mkdir(stateDir,{recursive:true});
    const controller=new AbortController();
    let complete;
    const done=new Promise(resolveDone=>{complete=resolveDone;});
    active.set(callId,{controller,done});
    const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    const record={promptChars:prompt.length,callId,jobId:jobId??null,role,model,maxTokens,startedAt:new Date().toISOString(),outcome:'not_started'};
    const ledgerPath=join(callDir,'usage.json');
    const persist=()=>writeFile(ledgerPath,JSON.stringify(record,null,2));await persist();
    let attempted=false,paid=false,proxyError,settled;
    const server=createServer(async(req,res)=>{
      const respond=(status,data)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}};
      if(req.method!=='POST'||req.url!=='/v1/chat/completions'||req.headers.authorization!==`Bearer ${token}`)
        return respond(403,{error:{message:'Local runtime request denied'}});
      if(attempted||combined.aborted) return respond(409,{error:{message:'Request already attempted; automatic retry forbidden'}});
      // Claim before the first await: parallel child requests cannot both pass this gate.
      attempted=true;
      settled=(async()=>{
        try {
          const chunks=[];let bytes=0;
          for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error();chunks.push(chunk);}
          const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          body.model=model;body.max_tokens=maxTokens;body.thinking={type:'disabled'};
          delete body.tools;delete body.tool_choice;delete body.functions;delete body.function_call;
          if(body.stream) body.stream_options={include_usage:true};
          combined.throwIfAborted();
          record.outcome='unknown';
          await persist();
          await onUsage({...record,phase:'before'});
          combined.throwIfAborted();
          paid=true;
          const response=await upstreamFetch(String(baseUrl).replace(/\/+$/,'')+'/chat/completions',{
            method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body),signal:combined});
          record.httpStatus=response.status;record.requestId=response.headers.get('x-request-id')||response.headers.get('request-id')||null;
          const raw=await response.text();
          record.outcome=response.ok?'response_received':response.status>=400&&response.status<500?'rejected':'unknown';
          const isSse=(response.headers.get('content-type')||'').includes('text/event-stream');
          const parts=isSse?raw.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()):[raw];
          let received=false,finished=false;
          for(const part of parts){try{const data=JSON.parse(part);if(data.usage)record.usage=data.usage;if(data.choices?.length)received=true;if(data.choices?.some(choice=>choice.finish_reason))finished=true;}catch{}}
          if(response.ok&&(!received||(isSse&&(!finished||!parts.includes('[DONE]'))))) record.outcome='unknown';
          if(record.outcome!=='response_received') proxyError=failure('DeepSeek 未返回可确认的成功结果；勿自动重试',record.outcome,callId);
          if(!res.destroyed){res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});res.end(raw);}
        } catch (error) {
          record.errorType=error?.name||'Error';record.errorCode=String(error?.cause?.code||error?.code||'UPSTREAM_INTERRUPTED');
          record.outcome=paid?'unknown':'not_started';
          record.error=paid?'upstream_interrupted':'preflight_failed';
          proxyError=failure(paid?'模型调用结果未知；勿自动重试':'调用前检查或记账失败，未发起付费请求',record.outcome,callId);
          respond(502,{error:{message:'Local runtime stopped; automatic retry forbidden'}});
        } finally {
          record.endedAt=new Date().toISOString();record.durationMs=Date.now()-Date.parse(record.startedAt);
          try {await persist();if(paid)await onUsage({...record,phase:'after'});}
          catch {proxyError=failure('调用记录未能完整保存；勿自动重试',record.outcome,callId);}
        }
      })();
      await settled;
    });
    try {
      await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen);});
      const configPath=join(callDir,'openclaw.json');
      const config={agents:{defaults:{workspace,skipBootstrap:true,model:{primary:'operator/'+model,fallbacks:[]},timeoutSeconds:120,compaction:{reserveTokens:Math.max(4096,maxTokens+1024),reserveTokensFloor:4096}},list:[{id:role,default:true}]},
        models:{mode:'replace',providers:{operator:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:token,api:'openai-completions',models:[{id:model,name:model,contextWindow:32768,maxTokens}]}}},
        tools:{deny:['*']},plugins:{enabled:false},gateway:{mode:'local'}};
      await writeFile(configPath,JSON.stringify(config,null,2));
      const result=await (runAgent||executeOpenClaw)({configPath,stateDir,workspace,role,sessionId:`operator-${role}-${callId}`,prompt,signal:combined,openclawPath,nodePath});
      await settled;
      if(proxyError)throw proxyError;
      const parsed=typeof result==='string'?JSON.parse(result):result;
      if(!paid){const messages=(parsed?.payloads||parsed?.result?.payloads||[]).map(p=>p.text||'').join(' ');const overflow=/context overflow|prompt too large|context.length|上下文/i.test(messages);record.error=overflow?'context_precheck':'model_not_started';record.endedAt=new Date().toISOString();await persist();throw Object.assign(failure(overflow?'本次资料超过模型可处理长度，尚未发起付费调用。请保留任务，由程序压缩历史资料后继续。':'模型执行器未能发起请求，尚未产生付费调用；与平台登录无关。','not_started',callId),{code:overflow?'MODEL_CONTEXT_LIMIT':'MODEL_NOT_STARTED'});}
      const text=(parsed?.payloads||parsed?.result?.payloads||[]).map(payload=>payload.text||'').join('\n').trim();
      if(!text)throw failure('OpenClaw 未返回正文',record.outcome,callId);
      return {text,usage:record.usage||null,model};
    } catch(error) {
      controller.abort();
      await settled;
      const diagnosed=proxyError||Object.assign(failure(error?.outcome?error.message:'模型执行失败',paid?record.outcome:'not_started',callId),{code:error.code});
      diagnosed.retryable=!['EACCES','EPERM'].includes(record.errorCode)&&(record.outcome==='unknown'||record.httpStatus===429||record.httpStatus>=500);
      if(['EACCES','EPERM'].includes(record.errorCode)){diagnosed.outcome='blocked';diagnosed.code='MODEL_NETWORK_PERMISSION';diagnosed.message='模型服务连接被运行环境权限阻止，需要修复服务联网权限';}
      diagnosed.message=diagnosed.message.replace(/；勿自动重试|；请检查调用记录，勿自动重试/g,'')+(record.errorCode?'（'+record.errorCode+'）':'')+(record.httpStatus?'（HTTP '+record.httpStatus+'）':'');
      record.endedAt=new Date().toISOString();record.durationMs=Date.now()-Date.parse(record.startedAt);record.retryable=diagnosed.retryable;record.error=record.error||diagnosed.code||'execution_failed';
      await persist();await onUsage({...record,phase:'diagnostic'});throw diagnosed;
    } finally {
      controller.abort();key='';
      server.closeAllConnections();
      await new Promise(resolveClose=>server.close(()=>resolveClose()));
      active.delete(callId);complete();
    }
  }
  async function preflight(){
    if(closed)throw preflightError('模型执行器已关闭','model','MODEL_CONFIG');
    if(!runAgent){try{await access(openclawPath);await access(nodePath);}catch{throw preflightError('未找到模型执行文件，请修复 OpenClaw 与 Node.js 安装','model','MODEL_CONFIG');}}
    let key=String(apiKey||'').trim();
    try{if(!key&&allowKeyFile)key=(await readFile(keyFile,'utf8')).trim();if(key.startsWith('{')){const data=JSON.parse(key);key=data.deepseekKey||data.key;}if(typeof key!=='string'||!key.trim())throw Error();}
    catch{throw preflightError(allowKeyFile?'文字模型密钥不可读取，请重新配置 DeepSeek API Key':'文字模型密钥未配置，请在根目录 .env 填写 DEEPSEEK_API_KEY 后重启服务','model','MODEL_CONFIG');}
    await checkWritable(runtimeDir);
    // The local proxy must be able to bind before a paid call is attempted.
    const probe=createServer();
    try{await new Promise((ok,no)=>{probe.once('error',no);probe.listen(0,'127.0.0.1',ok);});}
    catch{throw preflightError('本机模型代理端口不可用，请检查服务监听权限','model','MODEL_LOCAL_PERMISSION');}
    finally{if(probe.listening)await new Promise(done=>probe.close(done));}
    return checkModelService({url:String(baseUrl).replace(/\/+$/,'')+'/models',apiKey:key.trim(),stage:'model',fetch:upstreamFetch});
  }
  return {generate,preflight,async close(){closed=true;const pending=[...active.values()];for(const {controller} of pending)controller.abort();await Promise.all(pending.map(call=>call.done));}};
}
