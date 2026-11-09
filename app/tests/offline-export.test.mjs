import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportDraftHtml} from '../src/offline-export.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
const page=src=>`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><style>strong{color:red}</style></head><body><h1>标题</h1><main><strong>保留正文</strong></main><img src="${src}" alt="封面"></body></html>`;
async function fixture(t,{bytes=png,mime='image/png',ext='png'}={}){
  const dir=await mkdtemp(join(tmpdir(),'offline-export-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const sha256=createHash('sha256').update(bytes).digest('hex'),id='cover-'+sha256,path=join(dir,`${id}.${ext}`);
  await writeFile(path,bytes);
  const asset={id,path,mime,sha256},draft={html:page('/api/assets/'+id),assets:[{...asset}]};
  const records=new Map([[id,asset]]),store={get:(kind,key)=>kind==='assets'?records.get(key):null};
  return {draft,store,asset,records};
}

test('exports actual PNG bytes inline and preserves sanitized body and styling',async t=>{
  const {draft,store}=await fixture(t),original=draft.html;
  const html=await exportDraftHtml({draft,store});
  const embedded=html.match(/src="data:image\/png;base64,([^"]+)"/);
  assert.ok(embedded);assert.deepEqual(Buffer.from(embedded[1],'base64'),png);
  assert.doesNotMatch(html,/\/api\/assets\//);
  assert.match(html,/<main><strong>保留正文<\/strong><\/main>/);
  assert.match(html,/<style>strong\{color:red\}<\/style>/);
  assert.match(html,/<head><meta http-equiv="Content-Security-Policy"/);
  assert.match(html,/img-src data:;/);assert.match(html,/script-src 'none'/);
  assert.equal((html.match(/Content-Security-Policy/g)||[]).length,1);
  assert.equal(draft.html,original);
});

test('rejects damaged or missing files explicitly',async t=>{
  const {draft,store,asset}=await fixture(t);
  await writeFile(asset.path,Buffer.from('changed file'));
  await assert.rejects(exportDraftHtml({draft,store}),/SHA256 校验失败/);
  await rm(asset.path);
  await assert.rejects(exportDraftHtml({draft,store}),/无法读取稿件图片/);
});

test('rejects draft/store hash conflicts and unregistered local asset references',async t=>{
  const {draft,store,asset}=await fixture(t);
  draft.assets[0].sha256='0'.repeat(64);
  await assert.rejects(exportDraftHtml({draft,store}),/记录冲突/);
  draft.assets=[asset];
  for(const source of ['/api/assets/unknown','/api/assets/../../secret','/api/assets/'+asset.id+'?file=secret']){
    draft.html=page(source);
    await assert.rejects(exportDraftHtml({draft,store}),/不存在或不属于当前稿件/);
  }
});

test('does not use a draft-supplied path or assets belonging only to another draft',async t=>{
  const {draft,store,asset}=await fixture(t);
  draft.assets[0].path=join(tmpdir(),'secret.txt');
  assert.match(await exportDraftHtml({draft,store}),/data:image\/png;base64,/);
  draft.assets=[];
  await assert.rejects(exportDraftHtml({draft,store}),/不属于当前稿件/);
  draft.assets=[asset];
  asset.path=join(tmpdir(),'secret.txt');
  await assert.rejects(exportDraftHtml({draft,store}),/路径无效/);
});

test('uses the registered copy when the same content-addressed image belongs to several draft directories',async t=>{
  const {draft,store,asset}=await fixture(t);
  const dir=await mkdtemp(join(tmpdir(),'offline-export-copies-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const copyDir=join(dir,'another-draft','v1');
  await mkdir(copyDir,{recursive:true});
  const oldPath=draft.assets[0].path;
  asset.path=join(copyDir,`${asset.id}.png`);
  await writeFile(asset.path,png);
  assert.notEqual(asset.path,oldPath);
  // Removing the original proves that only the trusted registered copy is read.
  await rm(oldPath);
  const html=await exportDraftHtml({draft,store});
  const embedded=html.match(/src="data:image\/png;base64,([^"]+)"/);
  assert.deepEqual(Buffer.from(embedded[1],'base64'),png);
});

test('remote images are not followed and the offline CSP permits only data images',async t=>{
  const {draft,store}=await fixture(t);
  draft.html=draft.html.replace('</body>','<img src="https://unreachable.invalid/tracker"><img src="file:///secret.png"></body>');
  let calls=0;const oldFetch=globalThis.fetch;
  globalThis.fetch=()=>{calls++;throw Error('must not fetch');};
  try{
    const html=await exportDraftHtml({draft,store});
    assert.equal(calls,0);assert.match(html,/img-src data:;/);
    assert.match(html,/https:\/\/unreachable.invalid\/tracker/);
  }finally{globalThis.fetch=oldFetch;}
});

test('accepts the inert SVG renderer fallback and rejects active or external SVG',async t=>{
  const safe='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="100%" height="100%" fill="#fff"/><g fill="#123" font-family="Microsoft YaHei,sans-serif"><text x="74" y="110" font-size="48" font-weight="bold">标题 &amp; 内容</text></g></svg>';
  const f=await fixture(t,{bytes:Buffer.from(safe),mime:'image/svg+xml',ext:'svg'});
  assert.match(await exportDraftHtml(f),/data:image\/svg\+xml;base64,/);
  for(const unsafe of ['<svg><script>alert(1)</script></svg>','<svg onload="alert(1)"/>','<svg><image href="https://evil.test/a"/></svg>','<svg><rect fill="url(https://evil.test/a)"/></svg>','<svg><rect fill="&#117;rl(https://evil.test/a)"/></svg>','<!DOCTYPE svg><svg/>']){
    const fixtureValue=await fixture(t,{bytes:Buffer.from(unsafe),mime:'image/svg+xml',ext:'svg'});
    await assert.rejects(exportDraftHtml(fixtureValue),/损坏或不安全/);
  }
});

test('rejects disallowed MIME and image bytes even if their SHA256 matches',async t=>{
  const unsupported=await fixture(t,{bytes:Buffer.from('<html>bad</html>'),mime:'text/html',ext:'html'});
  await assert.rejects(exportDraftHtml(unsupported),/不支持的图片 MIME/);
  const fakePng=await fixture(t,{bytes:Buffer.from('not a PNG')});
  await assert.rejects(exportDraftHtml(fakePng),/PNG 文件格式无效/);
});
