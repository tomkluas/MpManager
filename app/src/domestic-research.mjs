const decode=s=>String(s).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ');
const text=s=>decode(String(s).replace(/<!--[^]*?-->|<script\b[^]*?<\/script>|<style\b[^]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const domestic=/^(?:.*\.)?(?:weixin\.qq\.com|toutiao\.com|toutiao\.com\.cn|zhihu\.com|sohu\.com|163\.com|sina\.com\.cn|baijiahao\.baidu\.com|people\.com\.cn|xinhuanet\.com|news\.cn|cctv\.com|thepaper\.cn|360kuai\.com|china\.com|chinanews\.com|cnr\.cn|gmw\.cn|gov\.cn|edu\.cn)$/i;
export function parseDomesticResults(html,provider){
 const headings=[...html.matchAll(/<h3\b[^>]*>[^]*?<\/h3>/gi)],results=[];
 for(let i=0;i<headings.length&&results.length<6;i++){
  const heading=headings[i],anchor=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^]*?)<\/a>/i.exec(heading[0]);if(!anchor)continue;
  let url;try{const original=/\bdata-mdurl=["']([^"']+)["']/i.exec(heading[0]);url=new URL(decode(original?.[1]||anchor[1]),provider.url);}catch{continue;}
  const redirect=url.hostname==='www.sogou.com'&&url.pathname==='/link';
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||(!redirect&&!domestic.test(url.hostname)))continue;
  const title=text(anchor[2]);if(title.length<4)continue;
  const block=html.slice(heading.index+heading[0].length,Math.min(headings[i+1]?.index??html.length,heading.index+14000));
  const snippet=/<(?:div|p)\b[^>]*class=["'][^"']*(?:space-txt|str_info|res-desc|res-rich|content)[^"']*["'][^>]*>([^]*?)<\/(?:div|p)>/i.exec(block);
  results.push({title:title.slice(0,180),url:url.href,publishedAt:null,text:text(snippet?.[1]||'').slice(0,1200),provider:provider.name,evidence:'search_snippet',dateVerified:false});
 }
 return results;
}
export async function researchTopics({queries,fetch=globalThis.fetch,signal}={}){
 const sources=[],warnings=[],seen=new Set();
 const providers=[{name:'搜狗中文搜索',url:'https://www.sogou.com/web',key:'query'},{name:'360中文搜索',url:'https://www.so.com/s',key:'q'}];
 for(const query of (Array.isArray(queries)?queries:[queries]).slice(0,3)){
  const clean=String(query||'').trim().slice(0,160);if(!clean)continue;
  for(const provider of providers){try{
   const url=new URL(provider.url);url.searchParams.set(provider.key,clean);
   const response=await fetch(url.href,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{accept:'text/html','user-agent':'Mozilla/5.0'}});
   if(!response.ok)throw Error('HTTP '+response.status);
   const chunks=[];let size=0;if(response.body?.getReader){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>2*1024*1024)throw Error('检索响应过大');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}}else{const raw=await response.text();if(Buffer.byteLength(raw)>2*1024*1024)throw Error('检索响应过大');chunks.push(Buffer.from(raw));}
   const results=parseDomesticResults(Buffer.concat(chunks).toString('utf8'),provider);
   if(!results.length){warnings.push(`${provider.name}未取得“${clean}”的可用国内文章，尝试备用来源。`);continue;}
   for(const source of results)if(!seen.has(source.url)&&sources.length<12){seen.add(source.url);sources.push(source);}break;
  }catch(error){if(signal?.aborted)throw error;warnings.push(`${provider.name}检索“${clean}”失败：${error.message}`);}}
 }
 if(!sources.length)warnings.push('国内检索未取得可用参考文章，本次不能声称已参考外部文章或发现热点。');
 warnings.push('国内搜索结果提供选题与表达线索，摘要不等于已读原文；日期未知的文章不作为近期热点依据，不推断阅读量、热度或医疗效果。');
 return {sources,warnings};
}
