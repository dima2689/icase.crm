(()=>{
const out=[],W=innerWidth;
const modal=document.querySelector('#scrim:not([hidden]) #modal');
const prv=document.getElementById('prv');
if(window.__wantModal&&!modal)return ['NO-MODAL'];
const root=modal||document.querySelector('.app')||document.body;
const vis=e=>{if(!e.isConnected)return false;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;const cs=getComputedStyle(e);return cs.visibility!=='hidden'&&cs.opacity!=='0'};
const nm=e=>(e.id?'#'+e.id:e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):''))+' «'+((e.innerText||e.value||e.placeholder||'').trim().replace(/\s+/g,' ').slice(0,28))+'»';
const scrollX=e=>{for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll'||o==='hidden'||o==='clip')return p}return null};
const pinned=e=>{for(let p=e;p&&p!==document.body;p=p.parentElement){const ps=getComputedStyle(p).position;if(ps==='sticky'||ps==='fixed')return p}return null};
if(document.documentElement.scrollWidth>W+1)out.push('page-hscroll '+document.documentElement.scrollWidth);
const all=[...root.querySelectorAll('*')].filter(e=>!e.closest('#rail,.tabbar,.camscrim')&&!['SCRIPT','STYLE','OPTION','svg','path','SVG','BR'].includes(e.tagName)&&!e.closest('svg'));
const V=all.filter(vis);
// 1 вылезает за экран
for(const e of V){const r=e.getBoundingClientRect();if((r.right>W+1||r.left<-1)&&!scrollX(e)&&!e.closest('.camscrim'))out.push('offscreen '+nm(e)+' '+Math.round(r.left)+'..'+Math.round(r.right))}
// 2 обрезанный текст (контейнер обрезает, без многоточия)
for(const e of V){if(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.tagName==='SELECT')continue;const cs=getComputedStyle(e);
  if((cs.overflowX==='hidden'||cs.overflowX==='clip')&&cs.textOverflow!=='ellipsis'&&e.scrollWidth>e.clientWidth+2&&e.innerText&&e.innerText.trim()&&!e.matches('.pl-body,.chips,.tabs'))out.push('clipped '+nm(e))}
// 3 значения и подсказки в полях не помещаются
const cv=document.createElement('canvas').getContext('2d');
for(const e of V.filter(x=>x.tagName==='INPUT'&&!['checkbox','radio','hidden','file','range','color'].includes(x.type))){
  const cs=getComputedStyle(e);cv.font=cs.font;const avail=e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-(e.type==='search'?18:0)-(e.type==='date'?30:0);
  if(e.value&&cv.measureText(e.value).width>avail+1)out.push('value-cut '+nm(e));
  else if(!e.value&&e.placeholder&&cv.measureText(e.placeholder).width>avail+1)out.push('ph-cut '+nm(e))}
for(const e of V.filter(x=>x.tagName==='SELECT')){const cs=getComputedStyle(e);cv.font=cs.font;const t=e.options[e.selectedIndex]?e.options[e.selectedIndex].text:'';const avail=e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);if(t&&cv.measureText(t).width>avail+1)out.push('select-cut '+nm(e))}
// 4 короткие подписи и кнопки ломаются на строки
const lines=n=>{const rg=document.createRange();rg.selectNodeContents(n);const rs=[...rg.getClientRects()].filter(r=>r.width>1&&r.height>1).sort((a,b)=>a.top-b.top);let L=0,bot=-1e9;for(const r of rs){if(r.top>=bot-3){L++;bot=r.bottom}else bot=Math.max(bot,r.bottom)}return L};
for(const e of V){const tn=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());if(!tn.length)continue;
  const t=e.innerText.trim();if(!t)continue;
  const short=t.length<=18&&t.split(/\s+/).length<=3;
  const isBtn=e.matches('button,.btn,.chip,.pill,label,dt,th,.tab,a.btn');
  if([...e.children].some(c=>getComputedStyle(c).display==='block')||e.closest('.csum,.hb-l,.rcard')||e.matches('.sub,small')&&e.parentElement&&getComputedStyle(e).display==='block')continue;if((short||(isBtn&&t.length<=34))&&lines(e)>=2)out.push('wraps '+nm(e))}
// 5 наложения текста и элементов
const items=V.filter(e=>{if(e.matches('button,.btn,input:not([type=hidden]),select,textarea,.pill,.chip'))return true;return [...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())}).map(e=>{const rg=document.createRange();rg.selectNodeContents(e);const cs0=getComputedStyle(e);let r=(e.matches('button,.btn,input,select,textarea,.pill,.chip')||cs0.textOverflow==='ellipsis'||cs0.overflow!=='visible')?e.getBoundingClientRect():rg.getBoundingClientRect();return [e,r,pinned(e)]}).filter(x=>x[1].width>0&&x[1].height>0);
items.sort((a,b)=>a[1].top-b[1].top);
for(let i=0;i<items.length;i++){const [a,ra,pa]=items[i];for(let j=i+1;j<items.length;j++){const [b,rb,pb]=items[j];if(rb.top>=ra.bottom)break;
  if(a.contains(b)||b.contains(a))continue;if(pa!==pb&&(pa||pb))continue;
  const ox=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left),oy=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
  if(ox>3&&oy>3)out.push('overlap '+nm(a)+' × '+nm(b))}}
return [...new Set(out)].slice(0,40)})()
