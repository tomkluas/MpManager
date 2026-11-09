import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CredentialVault} from '../src/credential-vault.mjs';

test('macOS and Linux credentials use a private local key and authenticated encryption',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'credential-vault-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const keyFile=join(dir,'credential.key');
  const vault=new CredentialVault({platform:'linux',keyFile});
  const ciphertext=await vault.seal('fictional-cross-platform-secret');
  assert.match(ciphertext,/^aes-gcm-v1:/);
  assert.doesNotMatch(ciphertext,/fictional-cross-platform-secret/);
  assert.equal(await vault.open(ciphertext),'fictional-cross-platform-secret');
  assert.equal((await readFile(keyFile)).length,32);
  if(process.platform!=='win32')assert.equal((await stat(keyFile)).mode&0o777,0o600);
  await assert.rejects(vault.open(ciphertext.slice(0,-2)+'AA'));
});

test('non-Windows vault explains that legacy DPAPI ciphertext cannot be migrated',async()=>{
  const vault=new CredentialVault({platform:'darwin',keyFile:'/unused'});
  await assert.rejects(vault.open('legacy-windows-ciphertext'),/Windows.*重新配置/);
});
