import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {extractDocument,researchTopics,renderDraft} from '../src/content-tools.mjs';

test('extracts UTF-8 headings and DOCX paragraphs while rejecting unsafe imports', async()=>{
  const md=await extractDocument({filename:'资料.md',bytes:Buffer.from('# 产品\n支持记录任务\n## 限制\n不提供诊断')});
  assert.match(md.text,/支持记录任务/); assert.equal(md.sections[0].title,'产品');
  const doc=zipSync({'word/document.xml':strToU8('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>真实产品</w:t></w:r></w:p><w:p><w:r><w:t>功能说明</w:t></w:r></w:p></w:body></w:document>')});
  assert.equal((await extractDocument({filename:'a.docx',bytes:doc})).text,'真实产品\n功能说明');
  for(const [filename,bytes] of [['a.exe',Buffer.from('a')],['a.txt',Buffer.alloc(10*1024*1024+1)],['a.docx',zipSync({'word/document.xml':strToU8('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///x">]><x/>')})],['a.docx',zipSync({'word/document.xml':strToU8('<x/>'),'word/_rels/document.xml.rels':strToU8('<Relationships><Relationship TargetMode="External" Target="https://evil.test"/></Relationships>')})],['a.docx',zipSync({'word/document.xml':strToU8('a'.repeat(31*1024*1024))})]]) {
    await assert.rejects(async()=>extractDocument({filename,bytes}));
  }
});

test('domestic research returns real article links and treats undated snippets as unverified',async()=>{
 let requested;const result=await researchTopics({queries:['拒绝劝酒'],fetch:async url=>{requested=url;return new Response('<h3 class="vr-title"><a href="https://mp.weixin.qq.com/s/real">饭局上怎样拒绝劝酒</a></h3><div class="space-txt">与朋友相处的沟通方法</div><h3><a href="javascript:alert(1)">不安全来源</a></h3><h3><a href="https://foreign.example/story">境外来源</a></h3>');}});
 assert.equal(new URL(requested).hostname,'www.sogou.com');assert.equal(result.sources.length,1);assert.equal(result.sources[0].publishedAt,null);assert.equal(result.sources[0].evidence,'search_snippet');assert.match(result.sources[0].text,/沟通/);assert.ok(result.warnings.some(w=>w.includes('日期未知')));
 const empty=await researchTopics({queries:['a'],fetch:async()=>new Response('blocked',{status:403})});assert.equal(empty.sources.length,0);assert.ok(empty.warnings.some(w=>w.includes('未取得')));
});

test('DOCX rejects entity-encoded external relationships',async()=>{
  const bytes=zipSync({'word/document.xml':strToU8('<x/>'),'word/_rels/document.xml.rels':strToU8('<Relationships><Relationship TargetMode="Ex&#116;ernal" Target="&#104;ttps://evil.test"/></Relationships>')});
  await assert.rejects(async()=>extractDocument({filename:'encoded.docx',bytes}));
});

test('DOCX imports hyperlink display text without following or retaining its relationship',async()=>{
  const bytes=zipSync({'word/document.xml':strToU8('<w:document xmlns:w="urn:w"><w:body><w:p><w:hyperlink><w:r><w:t>查看产品介绍</w:t></w:r></w:hyperlink></w:p></w:body></w:document>'),'word/_rels/document.xml.rels':strToU8('<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.org/private-token"/></Relationships>')});
  const result=extractDocument({filename:'links.docx',bytes});
  assert.equal(result.text,'查看产品介绍');assert.ok(result.warnings.some(w=>w.includes('超链接')));
  assert.doesNotMatch(JSON.stringify(result),/example\.org|private-token/);
  for(const type of ['image','oleObject','attachedTemplate']){
    const unsafe=zipSync({'word/document.xml':strToU8('<x/>'),'word/_rels/document.xml.rels':strToU8(`<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" TargetMode="External" Target="https://evil.test/file"/></Relationships>`)});
    assert.throws(()=>extractDocument({filename:'unsafe.docx',bytes:unsafe}));
  }
});

test('domestic research falls back to 360 and deduplicates article URLs',async()=>{
 const requests=[];const result=await researchTopics({queries:['生活场景','生活场景'],fetch:async url=>{requests.push(url);if(new URL(url).hostname==='www.sogou.com')return new Response('<title>验证码</title>');return new Response('<h3 class="res-title"><a href="https://www.toutiao.com/article/123">记录生活的具体方法</a></h3><p class="res-desc">一篇中文文章摘要</p>');}});
 assert.equal(requests.length,4);assert.equal(new URL(requests[1]).hostname,'www.so.com');assert.equal(result.sources.length,1);assert.equal(result.sources[0].provider,'360中文搜索');assert.ok(result.warnings.some(w=>w.includes('备用')));
});

test('render sanitizes Markdown and writes hash-addressed cover and infographic',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'operator-content-'));
  try{
    const result=await renderDraft({draft:{id:'../evil',title:'产品指南 <img src=x onerror=evil()>',body:'# 使用方法\n<script>alert(1)</script>\n[危险](javascript:alert(1))\n![跟踪](https://evil.test/tracker.png)\n**支持记录**'},product:{name:'真实产品',profile:{features:['记录任务','查看进度'],restrictions:['不提供医疗诊断']}},outputDir:dir});
    assert.doesNotMatch(result.html,/<script|<img[^>]+evil\.test|href="javascript:/);
    assert.match(result.html,/<strong>支持记录<\/strong>/);
    assert.deepEqual(result.assets.map(x=>x.role),['cover','infographic']);
    for(const asset of result.assets){
      assert.ok(asset.path.startsWith(dir));const bytes=await readFile(asset.path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      assert.ok(['image/png','image/svg+xml'].includes(asset.mime));
      if(process.platform==='win32')assert.equal(bytes.subarray(1,4).toString(),'PNG');
      assert.ok(result.html.includes(`/api/assets/${asset.id}`));
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
