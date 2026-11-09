import test from 'node:test';
import assert from 'node:assert/strict';
import {coverSize,comicScene} from '../src/comic-cover.mjs';
import {selectWritingApproach,writingGuidance} from '../src/writing-approaches.mjs';
test('platform cover sizes distinguish article cards and preserve full scene',()=>{
 assert.deepEqual(coverSize('toutiao'),{width:1200,height:800});
 assert.deepEqual(coverSize('wechat'),{width:1200,height:510});
 assert.deepEqual(coverSize('xiaohongshu'),{width:1080,height:1440});
 const scene=comicScene({title:'今晚不喝酒',body:'饭局上有人劝酒'});
 assert.ok(scene.shapes.length>15);assert.equal(scene.scene,'dinner');
 assert.equal(comicScene({title:'夜里想喝酒',body:''}).scene,'evening');
});
test('writing approaches rotate away from recent usage and persist across retries',()=>{
 const first=selectWritingApproach([]);const second=selectWritingApproach([{writingApproach:first.id}]);
 assert.notEqual(first.id,second.id);
 assert.equal(selectWritingApproach([{writingApproach:second.id}],first.id).id,first.id);
 assert.match(writingGuidance(first),/虚构/);assert.match(writingGuidance(first),/戒酒/);
});
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderDraft} from '../src/content-tools.mjs';
test('rendered Toutiao PNG and inserted cover share dimensions without forced stretching',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'comic-cover-'));
 try{
 const result=await renderDraft({draft:{platform:'toutiao',title:'饭局上不喝酒',body:'饭局上有人劝酒'},outputDir:dir});
 const cover=result.assets[0];assert.equal(cover.style,'comic');assert.equal(cover.width,1200);assert.equal(cover.height,800);
 const bytes=await readFile(cover.path);
 if(cover.mime==='image/png'){assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),800);}
 else assert.match(bytes.toString(),/width="1200" height="800"/);
 assert.match(result.html,/width="1200" height="800" style="[^"]*height:auto;object-fit:contain/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
