import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const labRoot=dirname(fileURLToPath(import.meta.url));
const projectRoot=resolve(labRoot,'../..');
const entry=join(labRoot,'node_modules/paperclipai/dist/index.js');
const config=resolve(projectRoot,process.env.PAPERCLIP_CONFIG||'research/runtime-lab/state/paperclip/instances/default/config.json');
if(!existsSync(entry))throw Error('Paperclip 依赖尚未安装，请先运行 ./Setup.ps1 -IncludePaperclip');
if(!existsSync(config))throw Error('Paperclip 尚未初始化。请先按 research/runtime-lab/README.md 完成 onboard。');
const env={...process.env,PAPERCLIP_HOME:join(labRoot,'state/paperclip'),PAPERCLIP_NO_BROWSER:'true',DO_NOT_TRACK:'1',PORT:process.env.PAPERCLIP_PORT||'4320'};
const child=spawn(process.execPath,[entry,'run','--config',config],{cwd:labRoot,env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
