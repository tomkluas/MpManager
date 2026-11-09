import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveProductMedia,productMedia,selectProductMedia} from '../src/product-media.mjs';
import {createStore} from '../src/store.mjs';
import {exportDraftHtml} from '../src/offline-export.mjs';
import {renderDraft} from '../src/content-tools.mjs';
import {deflateSync} from 'node:zlib';
function png(){const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(6))),chunk('IEND',Buffer.alloc(0))]);}
test('product images keep original bytes, enforce ownership and platform, and reach rendered/exportable assets',async t=>{
 const root=await mkdtemp(join(tmpdir(),'product-media-'));const store=createStore(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});const p=store.put('products',{name:'记录工具'});
 const input={kind:'qrcode',filename:'code.png',description:'打开记录工具',platforms:['toutiao'],base64:png().toString('base64')};
 const qr=await saveProductMedia({store,root,productId:p.id,input});
 const screen=await saveProductMedia({store,root,productId:p.id,input:{...input,kind:'screenshot',description:'每日记录页'}});
 assert.equal(productMedia(store,p.id).length,2);assert.equal(productMedia(store,'other').length,0);
 assert.deepEqual(selectProductMedia({media:productMedia(store,p.id)},[qr.id],'wechat'),[]);
 await assert.rejects(saveProductMedia({store,root,productId:p.id,input:{...input,base64:Buffer.from('<svg/>').toString('base64')}}));
 let calls=[];const draft={title:'今天做一条记录',body:'第一段生活场景。\n\n第二段具体行动。\n\n第三段记录方法。',platform:'toutiao',imageAssetIds:[qr.id,screen.id,'foreign']};
 const result=await renderDraft({draft,product:{...p,media:productMedia(store,p.id)},outputDir:join(root,'render'),coverAgent:{generate:async args=>{calls.push(args);return {bytes:png(),ext:'png',mime:'image/png',width:2,height:2,style:'ai-comic'};}}});
 assert.deepEqual(calls.map(c=>c.purpose),['cover','inline']);assert.equal(result.assets.length,4);assert.ok(result.assets.some(a=>a.id===qr.id));assert.match(result.html,new RegExp('/api/assets/'+qr.id));assert.ok(result.html.indexOf('正文漫画插图')<result.html.indexOf('第三段'));
 assert.doesNotMatch(result.html,/本篇内容摘录/);
 for(const a of result.assets)if(!a.productId)store.put('assets',a);const exported=await exportDraftHtml({draft:{...draft,...result},store});assert.match(exported,/data:image\/png;base64,/);assert.doesNotMatch(exported,/src="\/api\/assets/);
 const noMedia=await renderDraft({draft,product:{...p,media:productMedia(store,p.id)},mediaProvider:()=>[],outputDir:join(root,'current'),coverAgent:{generate:async()=>({bytes:png(),ext:'png',mime:'image/png',width:2,height:2})}});assert.equal(noMedia.assets.length,2);
});

test('HTTP media upload/list/disable supports original files and rejects cross-product changes',async t=>{const {startServer}=await import('../src/server.mjs');const root=await mkdtemp(join(tmpdir(),'media-http-'));const app=await startServer({port:4356,dataDir:root,autoRun:false,injectedRuntime:{close:async()=>{}}});t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});const p=app.store.put('products',{name:'P'}),q=app.store.put('products',{name:'Q'});const post=(path,body)=>fetch('http://127.0.0.1:4356'+path,{method:'POST',headers:{'content-type':'application/json','x-operator-token':app.token},body:JSON.stringify(body)});const response=await post('/api/products/'+p.id+'/media',{kind:'screenshot',filename:'page.png',description:'每日记录页面',platforms:['toutiao'],base64:png().toString('base64')});assert.equal(response.status,200);const asset=await response.json();const products=await(await fetch('http://127.0.0.1:4356/api/products')).json();assert.equal(products.products.find(x=>x.id===p.id).media[0].id,asset.id);assert.deepEqual(Buffer.from(await(await fetch('http://127.0.0.1:4356/api/assets/'+asset.id)).arrayBuffer()),png());assert.equal((await post('/api/products/'+q.id+'/disable-media',{assetId:asset.id})).status,400);assert.equal((await post('/api/products/'+p.id+'/disable-media',{assetId:asset.id})).status,200);assert.equal(productMedia(app.store,p.id).length,0);});
