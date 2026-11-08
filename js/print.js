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
  const items=(s.items||[]).map((i,k)=>({n:k+1,name:i.name,spec:[i.model,i.memory,i.color].filter(Boolean).join(", "),cond:i.condition||"",serial:i.serial||"",
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
const CSS_A4=`@page{size:A4;margin:12mm 12mm 12mm 14mm}
*{box-sizing:border-box}body{margin:0;font:10pt/1.35 "Helvetica Neue",Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #000;padding-bottom:8px}
.logo{font:800 22pt/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:-.5px}.logo small{display:block;font:600 7.5pt/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}
.req{text-align:right;font-size:8.5pt;line-height:1.45;max-width:65%}
h1{font:800 15pt/1.2 "Helvetica Neue",Arial,sans-serif;margin:14px 0 4px}
.meta{display:flex;gap:24px;flex-wrap:wrap;font-size:9pt;margin-bottom:10px}.meta b{font-weight:700}
table{width:100%;border-collapse:collapse;font-size:8.6pt}th,td{border:1px solid #000;padding:4px 5px;vertical-align:top}
th{background:#e8e8e8;font-weight:700;text-align:left;font-size:8pt}td.n,th.n{text-align:right;white-space:nowrap}td.c{text-align:center}
.sub{display:block;font-size:7.5pt;color:#333}
.bottom{display:flex;gap:16px;margin-top:10px;align-items:flex-start}.bottom .left{flex:1}
.sums{width:78mm;flex:none;border-collapse:collapse}.sums td{border:0;border-bottom:1px solid #bbb;padding:3px 0}.sums td.n{padding-left:12px}.sums tr.tot td{border-bottom:2px solid #000;font-weight:800;font-size:10.5pt;padding-top:5px}
.box{border:1px solid #000;padding:6px 8px;margin-top:8px;font-size:9pt}
.words{margin-top:8px;font-size:9pt}
.ack{border:1.5px solid #000;padding:8px 10px;margin-top:12px}.ack p{margin:0 0 14px}
.sig{display:flex;justify-content:space-between;gap:24px;margin-top:20px;font-size:9pt}.sig div{flex:1}
.line{display:inline-block;border-bottom:1px solid #000;min-width:120px;margin:0 4px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:18px;border-top:1px solid #000;padding-top:8px;font-size:7.8pt;color:#222}
.qrs{display:flex;gap:14px}.qr{text-align:center;font-size:7.5pt;width:24mm}.qr svg{width:22mm;height:22mm;display:block;margin:0 auto 2px}`;

App.receiptA4=function(s){
  const D=App.saleDocData(s),{st,c,items}=D;
  const qrs=[[st.siteUrl,"Наш сайт"],[st.reviewUrl,"Оставить отзыв"]].filter(q=>q[0]).map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${esc(l)}</div>`).join("");
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Товарный чек ${esc(s.num)}</title><style>${CSS_A4}</style></head><body>
  <div class="top"><div class="logo">${esc(st.shopName||"iCase")}${D.pointName?`<small>${esc(D.pointName)}</small>`:""}</div>
    <div class="req"><b>${esc(D.seller)}</b>${D.address?"<br>"+esc(D.address):""}${D.phone?"<br>Тел. "+esc(D.phone):""}${D.site?"<br>"+esc(siteLabel(D.site)):""}</div></div>
  <h1>Товарный чек № ${esc(s.num)} от ${date(s.createdAt)}</h1>
  <div class="meta"><span>Время: <b>${time(s.createdAt)}</b></span><span>Продавец: <b>${esc(D.staff)}</b></span>${c?`<span>Покупатель: <b>${esc(c.name)}</b>${c.phone?" · "+esc(c.phone):""}</span>`:""}</div>
  <table><thead><tr><th class="c">№</th><th>Наименование</th><th>Модель, память, цвет</th><th>Состояние</th><th>IMEI / серийный номер</th><th class="n">Кол-во</th><th class="n">Цена</th><th class="n">Скидка</th><th class="n">Сумма</th></tr></thead><tbody>
  ${items.map(i=>`<tr><td class="c">${i.n}</td><td>${esc(i.name)}${i.warranty?`<span class="sub">Гарантия ${i.warranty} мес.</span>`:""}</td><td>${esc(i.spec)||"—"}</td><td>${esc(i.cond)||"—"}</td><td>${esc(i.serial)||"—"}</td>
    <td class="n">${i.qty}</td><td class="n">${rub(i.price)}</td><td class="n">${i.disc?rub(i.disc):"—"}</td><td class="n">${rub(i.sum)}</td></tr>`).join("")}
  </tbody></table>
  <div class="bottom"><div class="left">
    ${s.tradeIn?`<div class="box"><b>Зачёт Trade-in:</b> ${esc(s.tradeIn.device)}${s.tradeIn.imei?", IMEI "+esc(s.tradeIn.imei):""} — <b>${rub(s.tradeIn.amount)}</b></div>`:""}
    <div class="box"><b>Оплата:</b> ${esc(D.pays)}</div>
    <div class="words">Всего наименований ${items.length}, на сумму ${rub(s.total)}<br><b>${esc(App.rubWords(s.total))}</b></div>
  </div><table class="sums"><tbody>
    <tr><td>Сумма по товарам</td><td class="n">${rub(D.goods)}</td></tr>
    ${num(s.discount)?`<tr><td>Скидка на чек</td><td class="n">−${rub(s.discount)}</td></tr>`:""}
    ${s.tradeIn?`<tr><td>Зачёт Trade-in</td><td class="n">−${rub(s.tradeIn.amount)}</td></tr>`:""}
    <tr class="tot"><td>${s.tradeIn?"Доплата":"Итого к оплате"}</td><td class="n">${rub(s.total)}</td></tr>
  </tbody></table></div>
  <div class="ack"><p>${esc(st.receiptAck||App.DEFAULTS.receiptAck)}</p>
    <div>Покупатель <span class="line"></span> / <span class="line">${c?esc(c.name):""}</span> /</div></div>
  <div class="sig"><div>Продавец <span class="line"></span> / ${esc(D.staff)} /</div><div style="text-align:right">М. П. (при наличии)</div></div>
  <div class="foot"><div>Товарный чек выдан в дополнение к кассовому чеку и не заменяет его.<br>Отметка покупателя не ограничивает его права по Закону РФ «О защите прав потребителей».${st.receiptFooter?"<br><b>"+esc(st.receiptFooter)+"</b>":""}</div>
    ${qrs?`<div class="qrs">${qrs}</div>`:""}</div>
  </body></html>`;
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
