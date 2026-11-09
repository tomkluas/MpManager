import {deflateSync} from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCoverAgent,coverCanvas} from '../src/cover-agent.mjs';
function memoryStore(){const m=new Map();return {get:(_k,id)=>m.get(id),put:(_k,r)=>(m.set(r.id,r),r),list:()=>[...m.values()]};}
function png(width,height){
 function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const byte of b.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;}
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t){const outputDir=await mkdtemp(join(tmpdir(),'cover-agent-'));t.after(()=>rm(outputDir,{recursive:true,force:true}));return {draft:{taskId:'t',platform:'toutiao',title:'饭局上不喝酒',body:'一杯水代替酒。'},product:{name:'戒酒记录'},outputDir};}
test('comic agent saves actual image and reuses durable result without another charged request',async t=>{
 const input=await fixture(t),store=memoryStore();let calls=0;
 const agent=createCoverAgent({store,readConfig:async()=>({apiKey:'secret'}),fetch:async(_url,req)=>{calls++;assert.equal(store.list()[0].status,'working');const payload=JSON.parse(req.body);assert.equal(payload.size,'2496x1664');assert.match(payload.prompt,/漫画/);assert.match(payload.prompt,/饭局上不喝酒/);return Response.json({data:[{b64_json:png(2496,1664).toString('base64')}]});}});
 const result=await agent.generate(input);assert.equal(result.width,2496);assert.equal(result.style,'ai-comic');assert.equal(result.mime,'image/png');
 const next=createCoverAgent({store,readConfig:async()=>({apiKey:'secret'}),fetch:()=>assert.fail('must use saved result')});assert.deepEqual((await next.generate(input)).bytes,result.bytes);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(store.list()),/secret|b64_json/);
 await writeFile(store.list()[0].path,'damaged');await assert.rejects(next.generate(input),/损坏/);
});
test('unknown charged result is never retried after network failure or restart',async t=>{
 const input=await fixture(t),store=memoryStore();let calls=0;const options={store,readConfig:async()=>({apiKey:'key'}),fetch:async()=>{calls++;throw Error('secret upstream');}};
 await assert.rejects(createCoverAgent(options).generate(input),e=>e.outcome==='unknown'&&!e.message.includes('secret upstream'));
 await assert.rejects(createCoverAgent(options).generate(input),/核对/);assert.equal(calls,1);
});
test('wrong ratio or non-image output fails without falling back',async t=>{
 const input=await fixture(t);for(const bytes of [png(1200,1200),Buffer.from('html'),png(2496,1664).subarray(0,45)]){
 const store=memoryStore(),agent=createCoverAgent({store,readConfig:async()=>({apiKey:'key'}),fetch:async()=>Response.json({data:[{b64_json:bytes.toString('base64')}]})});await assert.rejects(agent.generate(input));assert.equal(store.list()[0].status,'unknown');
 }
 assert.equal(coverCanvas('xiaohongshu').width/coverCanvas('xiaohongshu').height,.75);
});
test('explicit next invocation can retry rejected request after credentials are corrected',async t=>{
 const input=await fixture(t),store=memoryStore();let calls=0;
 const agent=createCoverAgent({store,readConfig:async()=>({apiKey:calls?'corrected':'old'}),fetch:async()=>{calls++;return calls===1?Response.json({error:{message:'secret provider detail'}},{status:401}):Response.json({data:[{b64_json:png(2496,1664).toString('base64')}]});}});
 await assert.rejects(agent.generate(input),e=>e.outcome==='rejected'&&!e.message.includes('secret provider detail'));
 assert.equal(calls,1);await agent.generate(input);assert.equal(calls,2);
 const cached=createCoverAgent({store,readConfig:async()=>{throw Error('DPAPI unavailable');}});assert.equal((await cached.generate(input)).style,'ai-comic');
});
test('concurrent invocations reserve a paid attempt once',async t=>{
 const input=await fixture(t),store=memoryStore();let calls=0,release;const pending=new Promise(resolve=>release=resolve);
 const options={store,readConfig:async()=>({apiKey:'key'}),fetch:async()=>{calls++;await pending;return Response.json({data:[{b64_json:png(2496,1664).toString('base64')}]});}};
 const first=createCoverAgent(options).generate(input);
 while(!calls)await new Promise(resolve=>setTimeout(resolve,1));
 await assert.rejects(createCoverAgent(options).generate(input));release();await first;assert.equal(calls,1);
});

test('inline comic uses its own content prompt and cached generation distinct from cover',async t=>{const input=await fixture(t),store=memoryStore(),payloads=[];const agent=createCoverAgent({store,readConfig:async()=>({apiKey:'secret'}),fetch:async(_url,req)=>{payloads.push(JSON.parse(req.body));return Response.json({data:[{b64_json:png(2496,1664).toString('base64')}]});}});await agent.generate(input);await agent.generate({...input,purpose:'inline'});await agent.generate({...input,purpose:'inline'});assert.equal(payloads.length,2);assert.match(payloads[1].prompt,/全图无文字/);assert.match(payloads[1].prompt,/一杯水代替酒/);assert.notEqual(payloads[0].prompt,payloads[1].prompt);assert.equal(store.list().filter(r=>r.purpose==='inline').length,1);});
