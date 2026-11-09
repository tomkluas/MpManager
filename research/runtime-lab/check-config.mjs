import {readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadProductContext} from './product-context.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const context=await loadProductContext(root);
const account=JSON.parse(await readFile(join(root,'config','official-account.json'),'utf8'));
if(account.schemaVersion!==1||typeof account.account?.name!=='string'||typeof account.account?.appId!=='string')throw Error('公众号基本信息格式无效');
let verified=0;
for(const document of context.sourceDocuments){
 const path=resolve(root,document.relativePath),boundary=resolve(root,'materials')+sep;
 if(!path.startsWith(boundary))throw Error('资料路径必须位于 materials 目录');
 const digest=createHash('sha256').update(await readFile(path)).digest('hex');
 if(digest!==document.sha256)throw Error('资料文件已变化，请重新核实后更新其记录：'+document.filename);
 verified++;
}
console.log(JSON.stringify({product:context.profile.name,profileStatus:context.profile.status,features:context.profile.features.length,miniProgramAppIdConfigured:!!context.miniProgram?.appId,officialAccountName:account.account.name,officialAccountAppIdConfigured:!!account.account.appId,documentsVerified:verified,browserLoginVerified:false,realPublishingAvailable:false,paidCalls:0},null,2));
