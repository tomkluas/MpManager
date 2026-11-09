// Validate public article URL shapes locally. Publication remains the user's
// confirmation; this does not fetch the article or verify its availability.
export function parseArticleUrl(platform, value) {
  let url;
  try {url=new URL(value);} catch {throw Error('请填写真实文章链接');}
  if(url.protocol!=='https:'||url.username||url.password||url.port) {
    throw Error('文章链接与平台不匹配');
  }
  let article=false;
  if(platform==='wechat'&&url.hostname==='mp.weixin.qq.com') {
    article=/^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname)||
      (url.pathname==='/s'&&['__biz','mid','idx','sn'].every(key=>url.searchParams.get(key)?.trim()));
  } else if(platform==='toutiao'&&url.hostname==='www.toutiao.com') {
    article=/^\/(?:article\/\d+|i\d+)\/?$/.test(url.pathname);
  } else if(platform==='xiaohongshu'&&url.hostname==='www.xiaohongshu.com') {
    article=/^\/(?:explore|discovery\/item)\/[a-fA-F0-9]+\/?$/.test(url.pathname);
  }
  if(!article)throw Error('文章链接与平台不匹配');
  return url;
}
