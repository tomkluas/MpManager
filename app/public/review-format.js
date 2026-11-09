const labels={summary:'审核结论',issues:'发现的问题',suggestions:'修改建议',warnings:'注意事项',checks:'检查结果',passed:'是否通过',reason:'原因',message:'说明',title:'事项',description:'详情',severity:'程度',status:'状态',revisions:'已修改内容',corrections:'已修正内容',needsVerification:'待核实',factCheck:'事实核查',compliance:'表述检查'};
export function formatReview(value){
  if(value==null)return '';
  if(typeof value==='string'){
    if(value.trim()==='[object Object]')return '这份历史审核意见未被正确保存，请重新审核；不能据此判断已通过。';
    if(/^[\[{]/.test(value.trim())){try{return formatReview(JSON.parse(value));}catch{}}
    return value;
  }
  if(Array.isArray(value))return value.map(formatReview).filter(Boolean).map((v,i)=>`${i+1}. ${v}`).join('\n');
  if(typeof value==='object')return Object.entries(value).map(([key,v])=>`${labels[key]||key}：${formatReview(v)}`).join('\n');
  return typeof value==='boolean'?(value?'是':'否'):String(value);
}
