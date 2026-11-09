// Browsers give <figure> a 40px horizontal margin by default.
// Apply on delivery too, so previously saved articles use the same image width.
export function articleLayout(html){
 if(typeof html!=='string'||html.includes('id="article-image-layout"'))return html;
 return html.replace(/<\/head>/i,'<style id="article-image-layout">article figure{margin:24px 0;padding:0}article figure img{display:block;width:100%;max-width:100%;height:auto}</style></head>');
}
