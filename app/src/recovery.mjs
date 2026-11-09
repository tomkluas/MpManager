import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function readRuntimeRecovery(root){const records=[];let dirs;try{dirs=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return records;throw e;}for(const dir of dirs){if(!dir.isDirectory())continue;try{records.push(JSON.parse(await readFile(join(root,dir.name,'usage.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')records.push({jobId:null,outcome:'unreadable'});}}return records;}
