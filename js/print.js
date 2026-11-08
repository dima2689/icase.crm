/* iCase CRM v3 · печатные формы: товарный чек (A4 и лента 80 мм) */
"use strict";
(function(){
const {esc,num}=App;
const rub=n=>(Math.round(num(n)*100)/100).toLocaleString("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2})+" ₽";
const d2=n=>String(n).padStart(2,"0");
const date=iso=>{const d=new Date(iso);return d2(d.getDate())+"."+d2(d.getMonth()+1)+"."+d.getFullYear()};
const time=iso=>{const d=new Date(iso);return d2(d.getHours())+":"+d2(d.getMinutes())};

/* ---------- сумма прописью ---------- */
const ONES=[["","один","два","три","четыре","пять","шесть","семь","восемь","девять"],["","одна","две","три","четыре","пять","шесть","семь","восемь","девять"]];
const TEENS=["десять","одиннадцать","двенадцать","тринадцать","четырнадцать","пятнадцать","шестнадцать","семнадцать","восемнадцать","девятнадцать"];
const TENS=["","","двадцать","тридцать","сорок","пятьдесят","шестьдесят","семьдесят","восемьдесят","девяносто"];
const HUND=["","сто","двести","триста","четыреста","пятьсот","шестьсот","семьсот","восемьсот","девятьсот"];
const plural=(n,f)=>{n=Math.abs(n)%100;const n1=n%10;return n>10&&n<20?f[2]:n1>1&&n1<5?f[1]:n1===1?f[0]:f[2]};
function triad(n,fem){const h=Math.floor(n/100),t=Math.floor(n%100/10),o=n%10,w=[HUND[h]];
  if(t===1)w.push(TEENS[o]);else{w.push(TENS[t]);w.push(ONES[fem?1:0][o])}return w.filter(Boolean).join(" ")}
App.rubWords=function(sum){
  sum=Math.round(num(sum)*100);const r=Math.floor(sum/100),k=sum%100;
  const groups=[[1,["рубль","рубля","рублей"],0],[1e3,["тысяча","тысячи","тысяч"],1],[1e6,["миллион","миллиона","миллионов"],0]];
  let words=[];
  for(let i=groups.length-1;i>=1;i--){const v=Math.floor(r/groups[i][0])%1000;if(v)words.push(triad(v,groups[i][2]),plural(v,groups[i][1]))}
  const u=r%1000;if(u)words.push(triad(u,false));if(!r)words.push("ноль");
  words.push(plural(r,groups[0][1]));
  const s=words.join(" ").replace(/\s+/g," ").trim();
  return s.charAt(0).toUpperCase()+s.slice(1)+" "+d2(k)+" "+plural(k,["копейка","копейки","копеек"]);
};

/* ---------- QR-код (SVG, без интернета) ---------- */
App.qrSvg=function(text){
  if(!text||typeof qrcode!=="function")return "";
  try{qrcode.stringToBytes=qrcode.stringToBytesFuncs["UTF-8"];const q=qrcode(0,"M");q.addData(String(text));q.make();
    return q.createSvgTag({cellSize:4,margin:0,scalable:true})}catch(e){return ""}
};

/* ---------- данные продажи для документов ---------- */
App.saleDocData=function(s){
  const st=App.settings(),pt=s.pointId?App.byId("points",s.pointId):null,c=App.cust(s.customerId);
  const items=(s.items||[]).map((i,k)=>({n:k+1,name:i.name,spec:[i.model,i.memory,i.color].filter(Boolean).join(", "),model:i.model||"",memory:i.memory||"",color:i.color||"",cond:i.condition||"",serial:i.serial||"",
    qty:num(i.qty),price:num(i.price),disc:num(i.disc),sum:num(i.qty)*num(i.price)-num(i.disc),warranty:num(i.warranty)}));
  const goods=items.reduce((a,i)=>a+i.sum,0);
  return {st,s,c,items,goods,
    seller:[st.legalName||st.shopName,st.inn?"ИНН "+st.inn:"",st.ogrnip?"ОГРНИП "+st.ogrnip:""].filter(Boolean).join(", "),
    address:[st.city,pt&&pt.address||st.address].filter(Boolean).join(", "),phone:pt&&pt.phone||st.phone,site:st.siteUrl,
    pointName:pt?pt.name:"",staff:App.nameOf(s.by),
    pays:(s.payments||[]).filter(p=>num(p.amount)).map(p=>(App.PAY[p.method]||p.method)+" "+rub(p.amount)).join(", ")||"—"};
};
const siteLabel=u=>String(u||"").replace(/^https?:\/\//,"").replace(/\/$/,"");

/* ---------- товарный чек A4 ---------- */
const CSS_A4=`@page{size:A4;margin:0}
*{box-sizing:border-box}html,body{margin:0}
body{font:9.6pt/1.45 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#17170F;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;padding:14mm 15mm 12mm;background:#F6F3EA;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start}
.logo{font:800 26pt/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-1px}
.logo span{display:inline-block;vertical-align:middle;margin-left:8px;font:700 7.5pt/1 Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;background:#3B4A2A;color:#F6F3EA;border-radius:99px;padding:5px 10px}
.doc{text-align:right}.doc .t{font:800 20pt/1.05 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.5px}
.doc .n{display:inline-block;margin-top:6px;background:#DCE4D2;color:#2E3A20;border-radius:99px;padding:4px 11px;font-weight:700;font-size:9pt}
.lbl{font:700 6.8pt/1.2 Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#6B705F;margin-bottom:4px}
.info{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:8px;margin-top:12mm}
.card{background:#FFFDF7;border:1px solid #E4DFCF;border-radius:10px;padding:9px 11px}
.card b{font-size:9.8pt}.card .m{color:#4A4D40;font-size:8.6pt}
.items{margin-top:7mm;background:#FFFDF7;border:1px solid #E4DFCF;border-radius:12px;overflow:hidden}
.ih,.ir{display:grid;grid-template-columns:7mm 1fr 14mm 25mm 23mm 26mm;gap:6px;align-items:start;padding:8px 12px}
.ih{background:#3B4A2A;color:#F6F3EA;font:700 6.8pt/1.2 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:7px 12px}
.ir+.ir{border-top:1px solid #ECE7D8}.r{text-align:right}.k{color:#8A8D7E;font-weight:700}
.nm{font-weight:800;font-size:10.4pt;line-height:1.25}
.chips{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
.chip{background:#EEF1E6;color:#3B4A2A;border-radius:99px;padding:2px 8px;font-size:7.6pt;font-weight:600;white-space:nowrap}
.chip.d{background:#3B4A2A;color:#F6F3EA}
.imei{margin-top:4px;font:8pt/1.2 "SF Mono",Menlo,Consolas,monospace;color:#4A4D40}
.sum{font-weight:800;font-size:10.4pt}.old{color:#8A8D7E;font-size:8pt}
.bottom{display:grid;grid-template-columns:1fr 74mm;gap:10px;margin-top:7mm;align-items:start}
.tot{background:#DCE4D2;border-radius:12px;padding:11px 13px}
.tl{display:flex;justify-content:space-between;padding:3px 0;font-size:9.2pt;color:#2E3A20}
.big{border-top:1.5px solid #3B4A2A;margin-top:6px;padding-top:8px;display:flex;justify-content:space-between;align-items:baseline}
.big span{font-weight:700;font-size:10pt}.big b{font:800 19pt/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.5px}
.words{margin-top:7px;font-size:7.8pt;color:#2E3A20;line-height:1.35}
.ti{border-left:3px solid #3B4A2A}
.ack{margin-top:7mm;border:1.5px dashed #9AA88A;border-radius:12px;padding:11px 13px;background:#FFFDF7}
.ack p{margin:0 0 16px;font-weight:600}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.sg{font-size:8.4pt;color:#4A4D40}.sg .ln{border-bottom:1px solid #17170F;height:20px;margin-bottom:3px;display:flex;align-items:flex-end;justify-content:flex-end;font-size:8.6pt;color:#17170F;padding-bottom:2px}
.foot{margin-top:auto;padding-top:8mm;display:flex;justify-content:space-between;align-items:flex-end;gap:14px}
.thanks{font:800 15pt/1.15 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.3px;max-width:105mm}
.legal{margin-top:6px;font-size:7.2pt;color:#6B705F;line-height:1.4}
.qrs{display:flex;gap:8px}.qr{background:#FFFDF7;border:1px solid #E4DFCF;border-radius:10px;padding:7px 7px 5px;text-align:center;font-size:7pt;font-weight:700;color:#3B4A2A;width:27mm}
.qr svg{width:21mm;height:21mm;display:block;margin:0 auto 4px}
@media screen{body{background:#d9d6cc}.page{margin:0 auto}}`;

App.receiptA4=function(s){
  const D=App.saleDocData(s),{st,c,items}=D;
  const qrs=[[st.siteUrl,"Наш сайт"],[st.reviewUrl,"Оставить отзыв"]].filter(q=>q[0]).map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${esc(l)}</div>`).join("");
  const chips=i=>[i.memory,i.color,i.cond].filter(Boolean).map(x=>`<span class="chip">${esc(x)}</span>`).join("")+(i.warranty?`<span class="chip d">гарантия ${i.warranty} мес.</span>`:"");
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Товарный чек ${esc(s.num)}</title><style>${CSS_A4}</style></head><body><div class="page">
  <div class="top"><div class="logo">${esc(st.shopName||"iCase")}${D.pointName?`<span>${esc(D.pointName)}</span>`:""}</div>
    <div class="doc"><div class="t">Товарный чек</div><div class="n">№ ${esc(s.num)} · ${date(s.createdAt)}, ${time(s.createdAt)}</div></div></div>
  <div class="info">
    <div class="card"><div class="lbl">Продавец</div><b>${esc(st.legalName||st.shopName||"")}</b><div class="m">${[st.inn?"ИНН "+st.inn:"",st.ogrnip?"ОГРНИП "+st.ogrnip:""].filter(Boolean).map(esc).join(" · ")||"&nbsp;"}</div></div>
    <div class="card"><div class="lbl">Магазин</div><b>${esc(D.address||D.pointName||"—")}</b><div class="m">${[D.phone,D.site?siteLabel(D.site):""].filter(Boolean).map(esc).join(" · ")||"&nbsp;"}</div></div>
    <div class="card"><div class="lbl">Покупатель</div><b>${c?esc(c.name):"—"}</b><div class="m">${c&&c.phone?esc(c.phone):"&nbsp;"}</div></div>
  </div>
  <div class="items">
    <div class="ih"><span>№</span><span>Товар</span><span class="r">Кол-во</span><span class="r">Цена</span><span class="r">Скидка</span><span class="r">Сумма</span></div>
    ${items.map(i=>`<div class="ir"><span class="k">${String(i.n).padStart(2,"0")}</span>
      <div><div class="nm">${esc(i.name)}</div>${i.model&&i.model!==i.name?`<div style="font-size:8.4pt;color:#4A4D40">${esc(i.model)}</div>`:""}<div class="chips">${chips(i)}</div>${i.serial?`<div class="imei">IMEI / SN ${esc(i.serial)}</div>`:""}</div>
      <span class="r">${i.qty}</span><span class="r">${rub(i.price)}</span><span class="r">${i.disc?"−"+rub(i.disc):"—"}</span><span class="r sum">${rub(i.sum)}</span></div>`).join("")}
  </div>
  <div class="bottom"><div>
    ${s.tradeIn?`<div class="card ti"><div class="lbl">Зачёт Trade-in</div><b>${esc(s.tradeIn.device)}</b><div class="m">${s.tradeIn.imei?"IMEI "+esc(s.tradeIn.imei)+" · ":""}зачтено ${rub(s.tradeIn.amount)}</div></div>`:""}
    <div class="card" style="margin-top:${s.tradeIn?8:0}px"><div class="lbl">Оплата</div><b>${esc(D.pays)}</b><div class="m">Продавец-консультант: ${esc(D.staff)}</div></div>
  </div>
  <div class="tot"><div class="tl"><span>Товары</span><span>${rub(D.goods)}</span></div>
    ${num(s.discount)?`<div class="tl"><span>Скидка на чек</span><span>−${rub(s.discount)}</span></div>`:""}
    ${s.tradeIn?`<div class="tl"><span>Зачёт Trade-in</span><span>−${rub(s.tradeIn.amount)}</span></div>`:""}
    <div class="big"><span>${s.tradeIn?"Доплата":"Итого"}</span><b>${rub(s.total)}</b></div>
    <div class="words">${esc(App.rubWords(s.total))}</div></div></div>
  <div class="ack"><p>${esc(st.receiptAck||App.DEFAULTS.receiptAck)}</p>
    <div class="sigs"><div class="sg"><div class="ln">${c?esc(c.name):""}</div>Покупатель — подпись, расшифровка</div><div class="sg"><div class="ln">${esc(D.staff)}</div>Продавец — подпись, расшифровка</div></div></div>
  <div class="foot"><div><div class="thanks">${esc(st.receiptFooter||"Спасибо за покупку!")}</div>
    <div class="legal">Товарный чек выдан в дополнение к кассовому чеку и не заменяет его.<br>Отметка покупателя не ограничивает его права по Закону РФ «О защите прав потребителей».</div></div>
    ${qrs?`<div class="qrs">${qrs}</div>`:""}</div>
  </div></body></html>`;
};

/* ---------- товарный чек на ленте 80 мм ---------- */
const CSS_80=`@page{size:80mm auto;margin:3mm 4mm}
*{box-sizing:border-box}body{margin:0;width:72mm;font:8.6pt/1.35 Arial,sans-serif;color:#000}
.c{text-align:center}.logo{font:800 15pt/1.1 Arial,sans-serif}.small{font-size:7.4pt}
hr{border:0;border-top:1px dashed #000;margin:5px 0}h1{font-size:9.6pt;margin:4px 0 2px;text-align:center}
.it{margin:4px 0}.it b{display:block}.row{display:flex;justify-content:space-between;gap:6px}.tot{font-weight:800;font-size:10.5pt}
.ack{border:1px solid #000;padding:4px 5px;margin-top:6px;font-size:7.6pt}.sl{border-bottom:1px solid #000;height:16px;margin-top:4px}
.qrs{display:flex;justify-content:center;gap:10px;margin-top:6px}.qr{width:24mm;text-align:center;font-size:7pt}.qr svg{width:22mm;height:22mm;display:block}`;

App.receipt80=function(s){
  const D=App.saleDocData(s),{st,c,items}=D;
  const qrs=[[st.siteUrl,"Сайт"],[st.reviewUrl,"Отзыв"]].filter(q=>q[0]).map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${l}</div>`).join("");
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Чек ${esc(s.num)}</title><style>${CSS_80}</style></head><body>
  <div class="c"><div class="logo">${esc(st.shopName||"iCase")}</div><div class="small">${esc(D.seller)}${D.address?"<br>"+esc(D.address):""}${D.phone?"<br>Тел. "+esc(D.phone):""}${D.site?"<br>"+esc(siteLabel(D.site)):""}</div></div>
  <hr><h1>ТОВАРНЫЙ ЧЕК № ${esc(s.num)}</h1><div class="c small">${date(s.createdAt)} ${time(s.createdAt)} · продавец ${esc(D.staff)}</div>
  ${c?`<div class="small c">Покупатель: ${esc(c.name)}${c.phone?" · "+esc(c.phone):""}</div>`:""}<hr>
  ${items.map(i=>`<div class="it"><b>${i.n}. ${esc(i.name)}</b>${i.spec?`<div class="small">${esc(i.spec)}</div>`:""}${i.cond||i.serial?`<div class="small">${[i.cond,i.serial?"IMEI/SN "+i.serial:""].filter(Boolean).map(esc).join(" · ")}</div>`:""}
    <div class="row"><span>${i.qty} × ${rub(i.price)}${i.disc?" − "+rub(i.disc):""}</span><span>${rub(i.sum)}</span></div>${i.warranty?`<div class="small">Гарантия ${i.warranty} мес.</div>`:""}</div>`).join("")}
  <hr><div class="row"><span>Сумма по товарам</span><span>${rub(D.goods)}</span></div>
  ${num(s.discount)?`<div class="row"><span>Скидка на чек</span><span>−${rub(s.discount)}</span></div>`:""}
  ${s.tradeIn?`<div class="row"><span>Trade-in</span><span>−${rub(s.tradeIn.amount)}</span></div><div class="small">${esc(s.tradeIn.device)}${s.tradeIn.imei?", IMEI "+esc(s.tradeIn.imei):""}</div>`:""}
  <div class="row tot"><span>${s.tradeIn?"ДОПЛАТА":"ИТОГО"}</span><span>${rub(s.total)}</span></div>
  <div class="small">Оплата: ${esc(D.pays)}</div>
  <div class="ack">${esc(st.receiptAck||App.DEFAULTS.receiptAck)}<div class="sl"></div>подпись покупателя</div>
  <div class="small" style="margin-top:6px">Продавец ____________ ${esc(D.staff)}</div>
  <hr><div class="small c">Выдан в дополнение к кассовому чеку.${st.receiptFooter?"<br><b>"+esc(st.receiptFooter)+"</b>":""}</div>
  ${qrs?`<div class="qrs">${qrs}</div>`:""}
  </body></html>`;
};

/* ---------- печать через скрытый фрейм ---------- */
App.printHtml=function(html){
  let f=document.getElementById("printFrame");if(f)f.remove();
  f=document.createElement("iframe");f.id="printFrame";f.title="Печать";
  f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const w=f.contentWindow;w.document.open();w.document.write(html);w.document.close();
  setTimeout(()=>{try{w.focus();w.print()}catch(e){App.toast("Не удалось открыть печать")}},250);
};
App.ACT.printReceipt=(arg)=>{const [id,fmt]=String(arg).split("|");const s=App.byId("sales",id);if(!s)return;
  App.printHtml(fmt==="80"?App.receipt80(s):App.receiptA4(s))};
})();
