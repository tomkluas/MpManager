import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {loadAppConfig} from '../src/config.mjs';

test('loads public-install defaults from one environment source',()=>{
  const root=resolve('app');
  const config=loadAppConfig({root,env:{}});
  assert.equal(config.port,4330);
  assert.equal(config.defaultMaxCalls,12);
  assert.equal(config.dataDir,join(root,'data'));
  assert.equal(config.deepseek.model,'deepseek-flash');
  assert.equal(config.deepseek.baseUrl,'https://api.deepseek.com');
  assert.equal(config.image.model,'doubao-seedream-5-0-flash-260915');
  assert.equal(config.openclawPath,join(root,'node_modules','openclaw','openclaw.mjs'));
  assert.equal(config.egoBrowserCommand,'ego-browser');
  assert.equal(config.paperclip.enabled,false);
  assert.equal(config.paperclip.baseUrl,'http://127.0.0.1:4320/api');
});

test('validates and normalizes unified environment overrides',()=>{
  const root=resolve('app');
  const config=loadAppConfig({root,env:{APP_PORT:'4999',APP_DATA_DIR:'private-data',DEFAULT_MAX_CALLS:'9',DEEPSEEK_API_KEY:'deepseek-secret',DEEPSEEK_MODEL:'custom-chat',DEEPSEEK_BASE_URL:'https://gateway.example/v1/',ARK_API_KEY:'ark-secret-value',ARK_IMAGE_MODEL:'ep-image',OPENCLAW_PATH:'tools/openclaw.mjs',EGO_BROWSER_COMMAND:'ego-browser-custom',PAPERCLIP_ENABLED:'true',PAPERCLIP_BASE_URL:'http://localhost:4998/api/'}});
  assert.equal(config.port,4999);
  assert.equal(config.defaultMaxCalls,9);
  assert.equal(config.dataDir,resolve(root,'../private-data'));
  assert.deepEqual(config.deepseek,{apiKey:'deepseek-secret',model:'custom-chat',baseUrl:'https://gateway.example/v1'});
  assert.deepEqual(config.image,{apiKey:'ark-secret-value',model:'ep-image'});
  assert.equal(config.openclawPath,resolve(root,'../tools/openclaw.mjs'));
  assert.equal(config.egoBrowserCommand,'ego-browser-custom');
  assert.deepEqual(config.paperclip,{enabled:true,baseUrl:'http://localhost:4998/api'});
  assert.throws(()=>loadAppConfig({root,env:{APP_PORT:'70000'}}),/APP_PORT/);
  assert.throws(()=>loadAppConfig({root,env:{DEFAULT_MAX_CALLS:'0'}}),/DEFAULT_MAX_CALLS/);
  assert.throws(()=>loadAppConfig({root,env:{DEEPSEEK_BASE_URL:'not-a-url'}}),/DEEPSEEK_BASE_URL/);
  assert.throws(()=>loadAppConfig({root,env:{PAPERCLIP_ENABLED:'maybe'}}),/PAPERCLIP_ENABLED/);
});
