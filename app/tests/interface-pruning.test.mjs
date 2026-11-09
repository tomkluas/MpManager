import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const shell=readFileSync(new URL('../public/shell.css',import.meta.url),'utf8');

test('workbench goes directly from the page heading to the complete task table',()=>{
  assert.doesNotMatch(app,/workbench-hero|workbench-steps|产品资料是底稿/);
  assert.doesNotMatch(app,/attention-strip|处理最早一项|内容流水|task-status-filter|查看哪些状态/);
  assert.match(app,/<th>内容 \/ 产品<\/th><th>发布位置<\/th><th>进度<\/th>/);
  assert.match(app,/href="#new">新建内容任务<\/a>/);
});

test('secondary pages omit repeated onboarding and unrelated actions',()=>{
  assert.doesNotMatch(app,/每一步都有依据/);
  assert.doesNotMatch(app,/head\('运营资产'[^\n]+新建内容任务/);
  assert.match(app,/id="new-task" class="panel task-create-form"/);
  assert.match(app,/提交时先检查模型连接/);
});

test('global chrome keeps status controls without a repeated slogan',()=>{
  assert.doesNotMatch(index,/内容从这里走到草稿箱/);
  assert.match(index,/仅在本机运行/);
  assert.match(index,/>刷新</);
  assert.doesNotMatch(shell,/workbench-hero|workbench-intro|workbench-steps|workbench-step/);
});

test('brand and sidebar navigation use icons instead of single-character placeholders',()=>{
  assert.doesNotMatch(index,/aria-hidden="true">(?:微|作|备|看|设)<\/span>/);
  for(const name of ['glow','workspace','assets','analytics','settings']){
    assert.match(index,new RegExp(`<svg[^>]+data-icon="${name}"[^>]*>`));
  }
  assert.match(shell,/\.sidebar-icon\s*\{[^}]*width:\s*20px/);
});

test('automatic account selection does not count as an edit that stops task refresh',()=>{
  assert.match(app,/addEventListener\('input',event=>\{if\(event\.isTrusted\)state\.dirty=true/);
  assert.match(app,/addEventListener\('change',event=>\{if\(event\.isTrusted\)state\.dirty=true/);
  assert.match(app,/dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
  assert.match(app,/if\(!state\.dirty&&!document\.querySelector\('form :focus'\)&&!document\.hidden\)render\(true\)/);
});

test('runtime settings offers independent text and image connection checks',()=>{
  assert.match(app,/配置统一读取自根目录 \.env/);
  assert.doesNotMatch(app,/name="deepseekKey"|name="volcengineKey"|id="settings-form"/);
  assert.match(app,/id="test-model"[^>]*>测试文字模型连接/);
  assert.match(app,/id="test-image"[^>]*>测试图片模型连接/);
  assert.match(app,/\/api\/settings\/test-model/);
  assert.match(app,/\/api\/settings\/test-image/);
});
