// A shared scene description feeds both the PNG and SVG renderers.
export function coverSize(platform){return platform==='wechat'?{width:1200,height:510}:platform==='xiaohongshu'?{width:1080,height:1440}:{width:1200,height:800};}
export function comicScene({title='',body=''}){
 const scene=/饭局|聚餐|劝酒|应酬|朋友/.test(title+body)?'dinner':/家人|孩子|爸爸|妈妈|家庭/.test(title+body)?'family':'evening';
 const shapes=[];
 const add=(type,x,y,w,h,fill)=>shapes.push({type,x,y,w,h,fill});
 add('rect',0,0,1200,800,'#FFF4DA');
 add('rect',40,40,545,530,'#F5D9BC');add('rect',610,40,550,530,'#CCE4DF');
 add('rect',690,75,370,200,scene==='evening'?'#394E75':'#92C7D4');
 add('ellipse',950,95,65,65,'#FFE6A0');
 function person(x,y,color,smile){
  add('ellipse',x-30,y+95,150,190,color);add('ellipse',x,y,90,110,'#F0BF97');
  add('ellipse',x-4,y-8,98,45,'#343841');
  add('ellipse',x+20,y+50,7,8,'#343841');add('ellipse',x+60,y+50,7,8,'#343841');
  add('line',x+32,y+82,24,smile?6:0,'#343841');
  add('line',x-15,y+130,-60,60,color);add('line',x+105,y+130,65,35,color);
 }
 person(210,150,'#C77766',false);person(780,150,'#538D82',true);
 if(scene==='family')person(980,270,'#E6B75E',true);
 add('rect',90,435,430,30,'#BA8A66');add('rect',660,435,435,30,'#BA8A66');
 // A bottle left behind, a glass of water and a notebook on the right.
 add('rect',405,335,45,95,'#8D9E68');add('rect',418,310,20,25,'#8D9E68');
 add('rect',695,355,50,75,'#F4FDFA');add('rect',701,390,38,34,'#8CC7D6');
 add('rect',950,400,90,30,'#E5B358');
 add('line',560,280,75,0,'#343841');add('line',610,260,25,20,'#343841');add('line',610,300,25,-20,'#343841');
 return {scene,shapes};
}
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function drawComicCover({title,body,platform}){
 const {width,height}=coverSize(platform),{scene,shapes}=comicScene({title,body});
 const rows=Array.from(title).reduce((a,c,i)=>{const row=Math.floor(i/22);a[row]=(a[row]||'')+c;return a;},[]);
 const lines=rows.slice(0,3);if(rows.length>3)lines[2]=lines[2].slice(0,-1)+'…';
 // Fit the entire composition in every platform canvas; never stretch or crop people.
 const scale=Math.min(width/1200,height/800),ox=(width-1200*scale)/2,oy=(height-800*scale)/2;
 if(process.platform==='win32'){
  const payload=Buffer.from(JSON.stringify({width,height,scale,ox,oy,shapes,lines})).toString('base64');
  const script=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPERATOR_IMAGE_DATA))|ConvertFrom-Json
$b=New-Object Drawing.Bitmap([int]$d.width,[int]$d.height)
$g=[Drawing.Graphics]::FromImage($b)
try {
$g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([Drawing.ColorTranslator]::FromHtml('#FFF4DA'))
$g.TranslateTransform([single]$d.ox,[single]$d.oy)
$g.ScaleTransform([single]$d.scale,[single]$d.scale)
foreach($s in $d.shapes){
 $brush=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml($s.fill))
 $pen=New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#343841'),4)
 try {
 if($s.type -eq 'line'){$pen.Color=$brush.Color;$pen.Width=10;$g.DrawLine($pen,[single]$s.x,[single]$s.y,[single]($s.x+$s.w),[single]($s.y+$s.h))}
 elseif($s.type -eq 'ellipse'){$g.FillEllipse($brush,[single]$s.x,[single]$s.y,[single]$s.w,[single]$s.h);$g.DrawEllipse($pen,[single]$s.x,[single]$s.y,[single]$s.w,[single]$s.h)}
 else{$g.FillRectangle($brush,[single]$s.x,[single]$s.y,[single]$s.w,[single]$s.h)}
 }finally{$brush.Dispose();$pen.Dispose()}
}
$font=New-Object Drawing.Font('Microsoft YaHei',28,[Drawing.FontStyle]::Bold)
$ink=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#343841'))
try{$y=605;foreach($line in $d.lines){$g.DrawString([string]$line,$font,$ink,80,$y);$y+=58}}finally{$font.Dispose();$ink.Dispose()}
$stream=New-Object IO.MemoryStream
try{$b.Save($stream,[Drawing.Imaging.ImageFormat]::Png);[Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))}finally{$stream.Dispose()}
}finally{$g.Dispose();$b.Dispose()}`;
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:20000,maxBuffer:8*1024*1024,env:{...process.env,OPERATOR_IMAGE_DATA:payload}});
  const bytes=Buffer.from(stdout.trim(),'base64');if(bytes.subarray(1,4).toString()!=='PNG')throw Error('漫画封面 PNG 输出无效');
  return {bytes,mime:'image/png',ext:'png',width,height,scene};
 }
 const art=shapes.map(s=>s.type==='line'?`<line x1="${s.x}" y1="${s.y}" x2="${s.x+s.w}" y2="${s.y+s.h}" stroke="${s.fill}" stroke-width="10"/>`:s.type==='ellipse'?`<ellipse cx="${s.x+s.w/2}" cy="${s.y+s.h/2}" rx="${s.w/2}" ry="${s.h/2}" fill="${s.fill}" stroke="#343841" stroke-width="4"/>`:`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.fill}"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#FFF4DA"/><g transform="translate(${ox} ${oy}) scale(${scale})">${art}${lines.map((line,i)=>`<text x="80" y="${650+i*58}" font-family="Microsoft YaHei,sans-serif" font-size="38" font-weight="bold" fill="#343841">${esc(line)}</text>`).join('')}</g></svg>`;
 return {bytes:Buffer.from(svg),mime:'image/svg+xml',ext:'svg',width,height,scene};
}
