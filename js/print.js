/* iCase CRM v3 · печатные формы: товарный чек (3 шаблона A4 и лента 80 мм), ценники */
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
  const items=(s.items||[]).map((i,k)=>({n:k+1,name:i.name,spec:[i.model,i.memory,i.color].filter(Boolean).join(", "),model:i.model||"",memory:i.memory||"",color:i.color||"",cond:i.condition||"",serial:i.serial||"",ser:i.productId?App.codeLbl(i.productId):(/^\d{15}$/.test(i.serial||"")?"IMEI":"S/N"),
    qty:num(i.qty),price:num(i.price),disc:num(i.disc),sum:num(i.qty)*num(i.price)-num(i.disc),warranty:num(i.warranty)}));
  const goods=items.reduce((a,i)=>a+i.sum,0);
  return {st,s,c,items,goods,
    seller:[st.legalName||st.shopName,st.inn?"ИНН "+st.inn:"",st.ogrnip?"ОГРНИП "+st.ogrnip:""].filter(Boolean).join(", "),
    address:[st.city,pt&&pt.address||st.address].filter(Boolean).join(", "),phone:pt&&pt.phone||st.phone,site:st.siteUrl,
    pointName:pt?pt.name:"",staff:App.nameOf(s.by),
    pays:(s.payments||[]).filter(p=>num(p.amount)).map(p=>(App.PAY[p.method]||p.method)+" "+rub(p.amount)).join(", ")||"—"};
};
const siteLabel=u=>String(u||"").replace(/^https?:\/\//,"").replace(/\/$/,"");

/* =====================================================================
   ТОВАРНЫЙ ЧЕК: настройки и три шаблона (фирменный, классический, минимал)
   ===================================================================== */
App.DOC_TEMPLATES=[["brand","Фирменный"],["classic","Классический"],["minimal","Минимал"]];
App.DOC_DEFAULT={template:"brand",title:"Товарный чек",showPoint:true,showStaff:true,chips:true,words:true,tradein:true,ack:true,legal:true,qrSite:true,qrReview:true,scale:100,
  legal1:"Товарный чек выдан в дополнение к кассовому чеку и не заменяет его.",
  legal2:"Отметка покупателя не ограничивает его права по Закону РФ «О защите прав потребителей»."};
App.docCfg=function(over){
  const st=App.settings();
  return Object.assign({},App.DOC_DEFAULT,st.docConfig||{},{ackText:st.receiptAck||App.DEFAULTS.receiptAck,thanks:st.receiptFooter||""},over||{});
};

/* общие части */
function parts(s,cfg){
  const D=App.saleDocData(s),{st,c}=D;
  const qrs=[[cfg.qrSite&&st.siteUrl,"Наш сайт"],[cfg.qrReview&&st.reviewUrl,"Оставить отзыв"]].filter(q=>q[0]);
  const legal=cfg.legal?[cfg.legal1,cfg.legal2].filter(Boolean):[];
  const reqLine=[st.inn?"ИНН "+st.inn:"",st.ogrnip?"ОГРНИП "+st.ogrnip:""].filter(Boolean).join(" · ");
  const contact=[D.phone,D.site?siteLabel(D.site):""].filter(Boolean).join(" · ");
  const chips=i=>cfg.chips?[i.memory,i.color,i.cond].filter(Boolean).map(x=>`<span class="chip">${esc(x)}</span>`).join("")+(i.warranty?`<span class="chip d">гарантия ${i.warranty} мес.</span>`:""):"";
  return {D,st,c,qrs,legal,reqLine,contact,chips,
    title:esc(cfg.title||"Товарный чек"),num:esc(s.num),dt:date(s.createdAt)+", "+time(s.createdAt),
    logo:esc(st.shopName||"iCase"),point:cfg.showPoint&&D.pointName?esc(D.pointName):"",
    ti:cfg.tradein&&s.tradeIn?s.tradeIn:null};
}
const scaleCss=cfg=>`html{font-size:${Math.max(80,Math.min(125,num(cfg.scale)||100))}%}`;
const wrap=(title,css,body)=>`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;

/* ---------- 1. Фирменный ---------- */
const CSS_BRAND=`@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0}
body{font:.6rem/1.45 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;padding:14mm 15mm 12mm;background:#fff;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start}
.logo{font:800 1.63rem/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-1px}
.logo span{display:inline-block;vertical-align:middle;margin-left:8px;font:700 .47rem/1 Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;background:#111;color:#fff;border-radius:99px;padding:5px 10px}
.doc{text-align:right}.doc .t{font:800 1.25rem/1.05 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.5px}
.doc .n{display:inline-block;margin-top:6px;background:#EDEDED;border-radius:99px;padding:4px 11px;font-weight:700;font-size:.56rem}
.lbl{font:700 .43rem/1.2 Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#666;margin-bottom:4px}
.info{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:8px;margin-top:12mm}
.card{background:#fff;border:1px solid #CFCFCF;border-radius:10px;padding:9px 11px}.card b{font-size:.61rem}.card .m{color:#444;font-size:.54rem}
.items{margin-top:7mm;border:1px solid #CFCFCF;border-radius:12px;overflow:hidden}
.ih,.ir{display:grid;grid-template-columns:7mm 1fr 14mm 25mm 23mm 26mm;gap:6px;align-items:start;padding:8px 12px}
.ih{background:#111;color:#fff;font:700 .43rem/1.2 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:7px 12px}
.ir+.ir{border-top:1px solid #E2E2E2}.r{text-align:right}.k{color:#888;font-weight:700}
.nm{font-weight:800;font-size:.65rem;line-height:1.25}.md{font-size:.53rem;color:#444}
.chips{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
.chip{border:1px solid #999;border-radius:99px;padding:2px 8px;font-size:.48rem;font-weight:600;white-space:nowrap}.chip.d{background:#111;color:#fff;border-color:#111}
.imei{margin-top:4px;font:.5rem/1.2 "SF Mono",Menlo,Consolas,monospace;color:#444}.sum{font-weight:800;font-size:.65rem}
.bottom{display:grid;grid-template-columns:1fr 74mm;gap:10px;margin-top:7mm;align-items:start}
.tot{background:#EDEDED;border-radius:12px;padding:11px 13px}.tl{display:flex;justify-content:space-between;padding:3px 0;font-size:.58rem}
.big{border-top:1.5px solid #111;margin-top:6px;padding-top:8px;display:flex;justify-content:space-between;align-items:baseline}
.big span{font-weight:700;font-size:.63rem}.big b{font:800 1.19rem/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.5px}
.words{margin-top:7px;font-size:.49rem;line-height:1.35}.ti{border-left:3px solid #111}.gap{margin-top:8px}
.ack{margin-top:7mm;border:1.5px dashed #999;border-radius:12px;padding:11px 13px}.ack p{margin:0 0 16px;font-weight:600}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:18px}.sg{font-size:.53rem;color:#444}
.sg .ln{border-bottom:1px solid #000;height:20px;margin-bottom:3px;display:flex;align-items:flex-end;justify-content:flex-end;font-size:.54rem;color:#000;padding-bottom:2px}
.foot{margin-top:auto;padding-top:8mm;display:flex;justify-content:space-between;align-items:flex-end;gap:14px}
.thanks{font:800 .94rem/1.15 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.3px;max-width:105mm}
.legal{margin-top:6px;font-size:.45rem;color:#666;line-height:1.4}
.qrs{display:flex;gap:8px}.qr{border:1px solid #CFCFCF;border-radius:10px;padding:7px 7px 5px;text-align:center;font-size:.44rem;font-weight:700;width:27mm}
.qr svg{width:21mm;height:21mm;display:block;margin:0 auto 4px}
@media screen{body{background:#d0d0d0}.page{margin:0 auto}}`;
function brand(s,cfg){
  const P=parts(s,cfg),{D,st,c}=P;
  const sigs=`<div class="sigs"><div class="sg"><div class="ln">${c?esc(c.name):""}</div>Покупатель — подпись, расшифровка</div><div class="sg"><div class="ln">${cfg.showStaff?esc(D.staff):""}</div>Продавец — подпись, расшифровка</div></div>`;
  return wrap("Товарный чек "+P.num,scaleCss(cfg)+CSS_BRAND,`<div class="page">
  <div class="top"><div class="logo">${P.logo}${P.point?`<span>${P.point}</span>`:""}</div><div class="doc"><div class="t">${P.title}</div><div class="n">№ ${P.num} · ${P.dt}</div></div></div>
  <div class="info">
    <div class="card"><div class="lbl">Продавец</div><b>${esc(st.legalName||st.shopName||"")}</b><div class="m">${esc(P.reqLine)||"&nbsp;"}</div></div>
    <div class="card"><div class="lbl">Магазин</div><b>${esc(D.address||D.pointName||"—")}</b><div class="m">${esc(P.contact)||"&nbsp;"}</div></div>
    <div class="card"><div class="lbl">Покупатель</div><b>${c?esc(c.name):"—"}</b><div class="m">${c&&c.phone?esc(c.phone):"&nbsp;"}</div></div></div>
  <div class="items"><div class="ih"><span>№</span><span>Товар</span><span class="r">Кол-во</span><span class="r">Цена</span><span class="r">Скидка</span><span class="r">Сумма</span></div>
    ${D.items.map(i=>`<div class="ir"><span class="k">${String(i.n).padStart(2,"0")}</span><div><div class="nm">${esc(i.name)}</div>${i.model&&i.model!==i.name?`<div class="md">${esc(i.model)}</div>`:""}${P.chips(i)?`<div class="chips">${P.chips(i)}</div>`:""}${i.serial?`<div class="imei">${i.ser} ${esc(i.serial)}</div>`:""}</div>
      <span class="r">${i.qty}</span><span class="r">${rub(i.price)}</span><span class="r">${i.disc?"−"+rub(i.disc):"—"}</span><span class="r sum">${rub(i.sum)}</span></div>`).join("")}</div>
  <div class="bottom"><div>
    ${P.ti?`<div class="card ti"><div class="lbl">Зачёт Trade-in</div><b>${esc(P.ti.device)}</b><div class="m">${P.ti.imei?"IMEI "+esc(P.ti.imei)+" · ":""}зачтено ${rub(P.ti.amount)}</div></div>`:""}
    <div class="card ${P.ti?"gap":""}"><div class="lbl">Оплата</div><b>${esc(D.pays)}</b>${cfg.showStaff?`<div class="m">Продавец-консультант: ${esc(D.staff)}</div>`:""}</div></div>
  <div class="tot"><div class="tl"><span>Товары</span><span>${rub(D.goods)}</span></div>${num(s.discount)?`<div class="tl"><span>Скидка на чек</span><span>−${rub(s.discount)}</span></div>`:""}
    ${s.tradeIn?`<div class="tl"><span>Зачёт Trade-in</span><span>−${rub(s.tradeIn.amount)}</span></div>`:""}
    <div class="big"><span>${s.tradeIn?"Доплата":"Итого"}</span><b>${rub(s.total)}</b></div>${cfg.words?`<div class="words">${esc(App.rubWords(s.total))}</div>`:""}</div></div>
  ${cfg.ack?`<div class="ack"><p>${esc(cfg.ackText)}</p>${sigs}</div>`:`<div class="ack" style="border-style:solid">${sigs}</div>`}
  <div class="foot"><div>${cfg.thanks?`<div class="thanks">${esc(cfg.thanks)}</div>`:""}${P.legal.length?`<div class="legal">${P.legal.map(esc).join("<br>")}</div>`:""}</div>
    ${P.qrs.length?`<div class="qrs">${P.qrs.map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${esc(l)}</div>`).join("")}</div>`:""}</div></div>`);
}

/* ---------- 2. Классический ---------- */
const CSS_CLASSIC=`@page{size:A4;margin:12mm 12mm 12mm 15mm}*{box-sizing:border-box}html,body{margin:0}
body{font:.62rem/1.4 Georgia,"Times New Roman",serif;color:#000}
.head{display:grid;grid-template-columns:1fr auto;gap:12px;border-bottom:3px double #000;padding-bottom:8px}
.logo{font:700 1.4rem/1 Georgia,serif}.logo small{display:block;font:italic .55rem/1.4 Georgia,serif;margin-top:3px}
.req{font-size:.54rem;text-align:right;line-height:1.5}
h1{text-align:center;font:700 .95rem/1.2 Georgia,serif;letter-spacing:.12em;text-transform:uppercase;margin:12px 0 2px}
.sub{text-align:center;font-size:.6rem;margin-bottom:10px}
.meta{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:.6rem;margin-bottom:10px}.meta dt{font-style:italic}.meta dd{margin:0;border-bottom:1px dotted #000}
table{width:100%;border-collapse:collapse;font:.55rem/1.35 Arial,sans-serif}th,td{border:1px solid #000;padding:4px 5px;vertical-align:top}
th{font-weight:700;text-align:center;background:#F0F0F0}td.n{text-align:right;white-space:nowrap}td.c{text-align:center}
tfoot td{font-weight:700}.small{font-size:.48rem;color:#333;display:block}
.tot{margin-top:8px;display:grid;grid-template-columns:1fr auto;gap:2px 16px;font-size:.62rem;max-width:95mm;margin-left:auto}.tot .n{text-align:right}
.tot .g{font-weight:700;font-size:.75rem;border-top:1px solid #000;padding-top:3px}
.words{margin-top:8px;font-size:.6rem}.words i{display:block;border-bottom:1px solid #000;padding-bottom:2px;margin-top:2px;font-style:italic}
.box{margin-top:8px;border:1px solid #000;padding:6px 8px;font-size:.58rem}
.ack{margin-top:12px;font-size:.6rem}.sigs{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:16px;font-size:.58rem}
.sg .ln{border-bottom:1px solid #000;height:18px;text-align:right;font-style:italic}.sg small{display:block;text-align:center;font-size:.46rem}
.foot{margin-top:16px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px;font-size:.47rem;border-top:1px solid #000;padding-top:6px}
.qrs{display:flex;gap:10px}.qr{text-align:center;font:.44rem Arial,sans-serif;width:22mm}.qr svg{width:20mm;height:20mm;display:block;margin:0 auto 2px}`;
function classic(s,cfg){
  const P=parts(s,cfg),{D,st,c}=P;
  return wrap("Товарный чек "+P.num,scaleCss(cfg)+CSS_CLASSIC,`
  <div class="head"><div class="logo">${P.logo}${P.point?`<small>${P.point}</small>`:""}</div>
    <div class="req"><b>${esc(st.legalName||st.shopName||"")}</b>${P.reqLine?"<br>"+esc(P.reqLine):""}${D.address?"<br>"+esc(D.address):""}${P.contact?"<br>"+esc(P.contact):""}</div></div>
  <h1>${P.title}</h1><div class="sub">№ ${P.num} от ${P.dt}</div>
  <dl class="meta">${c?`<dt>Покупатель:</dt><dd>${esc(c.name)}${c.phone?", "+esc(c.phone):""}</dd>`:""}${cfg.showStaff?`<dt>Продавец:</dt><dd>${esc(D.staff)}</dd>`:""}</dl>
  <table><thead><tr><th>№</th><th>Наименование</th><th>Модель, память, цвет</th><th>Состояние</th><th>IMEI / S/N</th><th>Кол.</th><th>Цена</th><th>Скидка</th><th>Сумма</th></tr></thead><tbody>
  ${D.items.map(i=>`<tr><td class="c">${i.n}</td><td>${esc(i.name)}${cfg.chips&&i.warranty?`<span class="small">гарантия ${i.warranty} мес.</span>`:""}</td><td>${esc(i.spec)||"—"}</td><td>${esc(i.cond)||"—"}</td><td>${esc(i.serial)||"—"}</td>
    <td class="c">${i.qty}</td><td class="n">${rub(i.price)}</td><td class="n">${i.disc?rub(i.disc):"—"}</td><td class="n">${rub(i.sum)}</td></tr>`).join("")}
  </tbody></table>
  <div class="tot"><span>Итого по товарам:</span><span class="n">${rub(D.goods)}</span>${num(s.discount)?`<span>Скидка на чек:</span><span class="n">−${rub(s.discount)}</span>`:""}
    ${s.tradeIn?`<span>Зачёт Trade-in:</span><span class="n">−${rub(s.tradeIn.amount)}</span>`:""}<span class="g">${s.tradeIn?"Доплата:":"Всего к оплате:"}</span><span class="g n">${rub(s.total)}</span></div>
  ${cfg.words?`<div class="words">Всего наименований ${D.items.length}, на сумму ${rub(s.total)}<i>${esc(App.rubWords(s.total))}</i></div>`:""}
  ${P.ti?`<div class="box"><b>Зачёт Trade-in:</b> ${esc(P.ti.device)}${P.ti.imei?", IMEI "+esc(P.ti.imei):""} — ${rub(P.ti.amount)}</div>`:""}
  <div class="box"><b>Оплата:</b> ${esc(D.pays)}</div>
  ${cfg.ack?`<div class="ack">${esc(cfg.ackText)}</div>`:""}
  <div class="sigs"><div class="sg"><div class="ln">${c?esc(c.name):""}</div><small>покупатель (подпись, расшифровка)</small></div><div class="sg"><div class="ln">${cfg.showStaff?esc(D.staff):""}</div><small>продавец (подпись, расшифровка) · М. П. при наличии</small></div></div>
  <div class="foot"><div>${cfg.thanks?`<b style="font-size:.6rem">${esc(cfg.thanks)}</b><br>`:""}${P.legal.map(esc).join("<br>")}</div>
    ${P.qrs.length?`<div class="qrs">${P.qrs.map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${esc(l)}</div>`).join("")}</div>`:""}</div>`);
}

/* ---------- 3. Минимал ---------- */
const CSS_MIN=`@page{size:A4;margin:16mm 18mm}*{box-sizing:border-box}html,body{margin:0}
body{font:300 .62rem/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#000}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #000;padding-bottom:10px}
.logo{font:800 1.15rem/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.5px}.pt{font-size:.55rem;color:#555;margin-left:8px;font-weight:400}
.dn{font-size:.56rem;text-align:right}
h1{font:200 2.1rem/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-1.5px;margin:14mm 0 2mm}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:8mm 0;font-size:.56rem}
.lbl{font-size:.45rem;letter-spacing:.14em;text-transform:uppercase;color:#777;margin-bottom:3px;font-weight:500}.cols b{font-weight:600}
.it{display:grid;grid-template-columns:1fr auto;gap:14px;padding:9px 0;border-top:1px solid #DDD}.it:last-child{border-bottom:1px solid #000}
.nm{font-weight:600;font-size:.72rem}.ds{color:#555;font-size:.54rem;margin-top:2px}.pr{text-align:right;white-space:nowrap}.pr b{font-weight:600;font-size:.7rem;display:block}
.pr small{color:#777}
.sum{display:grid;grid-template-columns:1fr auto;max-width:80mm;margin:8mm 0 0 auto;gap:3px 18px;font-size:.6rem}.sum .r{text-align:right}
.grand{display:flex;justify-content:space-between;align-items:baseline;max-width:80mm;margin:6px 0 0 auto;border-top:1px solid #000;padding-top:8px}
.grand span{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase}.grand b{font:300 1.6rem/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-1px}
.words{max-width:80mm;margin:6px 0 0 auto;text-align:right;font-size:.5rem;color:#555}
.note{margin-top:10mm;font-size:.58rem}.sigs{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:12mm;font-size:.5rem;color:#555}
.sigs div{border-top:1px solid #000;padding-top:4px}
.foot{margin-top:12mm;display:flex;justify-content:space-between;align-items:flex-end;font-size:.47rem;color:#666}
.qrs{display:flex;gap:12px}.qr{text-align:center;font-size:.44rem;width:20mm}.qr svg{width:18mm;height:18mm;display:block;margin:0 auto 3px}`;
function minimal(s,cfg){
  const P=parts(s,cfg),{D,st,c}=P;
  return wrap("Товарный чек "+P.num,scaleCss(cfg)+CSS_MIN,`
  <div class="top"><div><span class="logo">${P.logo}</span>${P.point?`<span class="pt">${P.point}</span>`:""}</div><div class="dn">№ ${P.num}<br>${P.dt}</div></div>
  <h1>${P.title}</h1>
  <div class="cols"><div><div class="lbl">Продавец</div><b>${esc(st.legalName||st.shopName||"")}</b><br>${esc(P.reqLine)}</div>
    <div><div class="lbl">Магазин</div>${esc(D.address||"—")}<br>${esc(P.contact)}</div>
    <div><div class="lbl">Покупатель</div>${c?`<b>${esc(c.name)}</b><br>${esc(c.phone||"")}`:"—"}</div></div>
  ${D.items.map(i=>`<div class="it"><div><div class="nm">${esc(i.name)}</div><div class="ds">${[i.model&&i.model!==i.name?i.model:"",cfg.chips?i.memory:"",cfg.chips?i.color:"",cfg.chips?i.cond:"",i.serial?i.ser+" "+i.serial:"",cfg.chips&&i.warranty?"гарантия "+i.warranty+" мес.":""].filter(Boolean).map(esc).join(" · ")}</div></div>
    <div class="pr"><b>${rub(i.sum)}</b><small>${i.qty} × ${rub(i.price)}${i.disc?" − "+rub(i.disc):""}</small></div></div>`).join("")}
  <div class="sum"><span>Товары</span><span class="r">${rub(D.goods)}</span>${num(s.discount)?`<span>Скидка</span><span class="r">−${rub(s.discount)}</span>`:""}
    ${s.tradeIn?`<span>Trade-in${P.ti?": "+esc(P.ti.device)+(P.ti.imei?", IMEI "+esc(P.ti.imei):""):""}</span><span class="r">−${rub(s.tradeIn.amount)}</span>`:""}<span>Оплата</span><span class="r">${esc(D.pays)}</span></div>
  <div class="grand"><span>${s.tradeIn?"Доплата":"Итого"}</span><b>${rub(s.total)}</b></div>${cfg.words?`<div class="words">${esc(App.rubWords(s.total))}</div>`:""}
  ${cfg.ack?`<div class="note">${esc(cfg.ackText)}</div>`:""}
  <div class="sigs"><div>Покупатель${c?" · "+esc(c.name):""}</div><div>Продавец${cfg.showStaff?" · "+esc(D.staff):""}</div></div>
  <div class="foot"><div>${cfg.thanks?`<b style="font-size:.62rem;color:#000;font-weight:600">${esc(cfg.thanks)}</b><br>`:""}${P.legal.map(esc).join("<br>")}</div>
    ${P.qrs.length?`<div class="qrs">${P.qrs.map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${esc(l)}</div>`).join("")}</div>`:""}</div>`);
}
App.receiptA4=function(s,over){const cfg=App.docCfg(over);return ({brand,classic,minimal}[cfg.template]||brand)(s,cfg)};

/* ---------- лента 80 мм ---------- */
const CSS_80=`@page{size:80mm auto;margin:3mm 4mm}
*{box-sizing:border-box}body{margin:0;width:72mm;font:8.6pt/1.35 Arial,sans-serif;color:#000}
.c{text-align:center}.logo{font:800 15pt/1.1 Arial,sans-serif}.small{font-size:7.4pt}
hr{border:0;border-top:1px dashed #000;margin:5px 0}h1{font-size:9.6pt;margin:4px 0 2px;text-align:center;text-transform:uppercase}
.it{margin:4px 0}.it b{display:block}.row{display:flex;justify-content:space-between;gap:6px}.tot{font-weight:800;font-size:10.5pt}
.ack{border:1px solid #000;padding:4px 5px;margin-top:6px;font-size:7.6pt}.sl{border-bottom:1px solid #000;height:16px;margin-top:4px}
.qrs{display:flex;justify-content:center;gap:10px;margin-top:6px}.qr{width:24mm;text-align:center;font-size:7pt}.qr svg{width:22mm;height:22mm;display:block}`;
App.receipt80=function(s,over){
  const cfg=App.docCfg(over),P=parts(s,cfg),{D,st,c}=P,items=D.items;
  return wrap("Чек "+P.num,CSS_80,`
  <div class="c"><div class="logo">${P.logo}</div><div class="small">${esc(D.seller)}${D.address?"<br>"+esc(D.address):""}${D.phone?"<br>Тел. "+esc(D.phone):""}${D.site?"<br>"+esc(siteLabel(D.site)):""}</div></div>
  <hr><h1>${P.title} № ${P.num}</h1><div class="c small">${P.dt}${cfg.showStaff?" · продавец "+esc(D.staff):""}</div>
  ${c?`<div class="small c">Покупатель: ${esc(c.name)}${c.phone?" · "+esc(c.phone):""}</div>`:""}<hr>
  ${items.map(i=>`<div class="it"><b>${i.n}. ${esc(i.name)}</b>${i.spec?`<div class="small">${esc(i.spec)}</div>`:""}${i.cond||i.serial?`<div class="small">${[i.cond,i.serial?i.ser+" "+i.serial:""].filter(Boolean).map(esc).join(" · ")}</div>`:""}
    <div class="row"><span>${i.qty} × ${rub(i.price)}${i.disc?" − "+rub(i.disc):""}</span><span>${rub(i.sum)}</span></div>${i.warranty?`<div class="small">Гарантия ${i.warranty} мес.</div>`:""}</div>`).join("")}
  <hr><div class="row"><span>Сумма по товарам</span><span>${rub(D.goods)}</span></div>
  ${num(s.discount)?`<div class="row"><span>Скидка на чек</span><span>−${rub(s.discount)}</span></div>`:""}
  ${s.tradeIn?`<div class="row"><span>Trade-in</span><span>−${rub(s.tradeIn.amount)}</span></div>${P.ti?`<div class="small">${esc(P.ti.device)}${P.ti.imei?", IMEI "+esc(P.ti.imei):""}</div>`:""}`:""}
  <div class="row tot"><span>${s.tradeIn?"ДОПЛАТА":"ИТОГО"}</span><span>${rub(s.total)}</span></div>
  ${cfg.words?`<div class="small">${esc(App.rubWords(s.total))}</div>`:""}<div class="small">Оплата: ${esc(D.pays)}</div>
  ${cfg.ack?`<div class="ack">${esc(cfg.ackText)}<div class="sl"></div>подпись покупателя</div>`:`<div class="sl"></div><div class="small">подпись покупателя</div>`}
  <div class="small" style="margin-top:6px">Продавец ____________ ${cfg.showStaff?esc(D.staff):""}</div>
  <hr><div class="small c">${P.legal.length?esc(P.legal[0]):""}${cfg.thanks?"<br><b>"+esc(cfg.thanks)+"</b>":""}</div>
  ${P.qrs.length?`<div class="qrs">${P.qrs.map(([u,l])=>`<div class="qr">${App.qrSvg(u)}${esc(l.replace("Наш сайт","Сайт").replace("Оставить отзыв","Отзыв"))}</div>`).join("")}</div>`:""}`);
};

/* пример продажи для предпросмотра, если продаж ещё нет */
App.demoSale=function(){
  const real=App.sortDesc?App.sortDesc(App.S.sales,"createdAt")[0]:App.S.sales[0];
  if(real)return real;
  return {id:"demo",num:"П-0000",createdAt:new Date().toISOString(),pointId:(App.point()||{}).id,customerId:null,by:App.me.id,discount:0,
    tradeIn:{device:"iPhone 11 64 ГБ",imei:"350000000000000",amount:12000},total:36490,payments:[{method:"card",amount:36490}],
    items:[{name:"iPhone 14 128 ГБ",model:"iPhone 14",memory:"128 ГБ",color:"синий",condition:"Б/у",serial:"350000000000001",qty:1,price:47500,disc:0,warranty:App.settings().deviceWarrantyMonths||0},
      {name:"Чехол силиконовый",condition:"Новый",qty:1,price:990,disc:0,warranty:0}]};
};

/* =====================================================================
   ЦЕННИКИ: шаблон = размер + блоки со своими координатами (мм), шрифтом и цветами
   ===================================================================== */
const TAG_FIELDS=[["logo","Логотип"],["shop","Название магазина"],["name","Название товара"],["model","Модель"],["chips","Память и цвет"],["cond","Состояние"],
  ["battery","Ёмкость АКБ"],["warranty","Гарантия"],["kit","Комплектация"],["used","Б/у: ремонт, детали"],["imei","IMEI / серийный №"],["sku","Артикул"],
  ["barcode","Штрихкод"],["qr","QR на сайт"],["price","Цена"],["oldprice","Старая цена"],["discount","Скидка, %"],["credit","Рассрочка"],["note","Своя надпись"]];
App.TAG_FIELDS=TAG_FIELDS;
const PILLS=["chips","cond","battery","warranty"];
App.TAG_BLOCKS={logo:"Логотип",shop:"Магазин",name:"Название",model:"Модель",pills:"Плашки",kit:"Комплектация",used:"Б/у: ремонт",imei:"IMEI / S/N",
  sku:"Артикул",barcode:"Штрихкод",qr:"QR-код",note:"Своя надпись",credit:"Рассрочка",discount:"Скидка",oldprice:"Старая цена",price:"Цена"};
const BKEYS=Object.keys(App.TAG_BLOCKS);
App.tagBlockOf=k=>PILLS.includes(k)?"pills":k;
App.TAG_FONTS=[["helv","Обычный","'Helvetica Neue',Helvetica,Arial,sans-serif"],["narrow","Узкий","'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif"],
  ["round","Округлый","'Trebuchet MS',Verdana,sans-serif"],["serif","С засечками","Georgia,'Times New Roman',serif"],["mono","Моноширинный","'Courier New',Courier,monospace"]];
const fontOf=t=>(App.TAG_FONTS.find(f=>f[0]===t.font)||App.TAG_FONTS[0])[2];
const blockOn=(t,k)=>{const f=t.fields||{};return k==="pills"?PILLS.some(x=>f[x]):!!f[k]};
App.tagBlockOn=blockOn;
const F=(...on)=>Object.fromEntries(TAG_FIELDS.map(([k])=>[k,on.includes(k)]));
App.TAG_PRESETS=[
  {id:"dev70",name:"Устройство 70×50",w:70,h:50,media:"sheet",border:true,round:true,invert:false,priceSize:"L",note:"",fields:F("shop","name","chips","cond","battery","warranty","price")},
  {id:"acc58",name:"Аксессуар 58×40",w:58,h:40,media:"sheet",border:true,round:false,invert:false,priceSize:"M",note:"",fields:F("name","sku","barcode","price")},
  {id:"show100",name:"Витрина 100×70",w:100,h:70,media:"sheet",border:true,round:true,invert:true,priceSize:"L",note:"Принимаем ваше устройство в Trade-in",fields:F("shop","name","chips","cond","battery","kit","warranty","price","note","qr")},
  {id:"sale70",name:"Акция 70×50",w:70,h:50,media:"sheet",border:true,round:true,invert:false,priceSize:"M",note:"",fields:F("shop","name","chips","warranty","price","oldprice","discount","credit")},
  {id:"used70",name:"Б/у устройство 70×50",w:70,h:50,media:"sheet",border:true,round:true,invert:false,priceSize:"L",note:"",fields:F("name","chips","cond","battery","kit","used","warranty","price")},
  {id:"label40",name:"Этикетка 40×30 (термопринтер)",w:40,h:30,media:"label",border:false,round:false,invert:false,priceSize:"M",note:"",fields:F("name","barcode","price")}
];

/** Автоматическая раскладка блоков под размер и набор полей. Блоки считаются для всех полей, выключенные просто не печатаются. */
function autoBlocks(t){
  const w=num(t.w)||60,h=num(t.h)||40,on=k=>blockOn(t,k);
  const base=Math.min(h,w*.75),pad=Math.max(1.5,Math.round(base*.14)/2),W=w-2*pad,R=v=>Math.round(v*2)/2;
  const B={};const put=(k,x,y,bw,bh,o)=>{B[k]=Object.assign({b:0,i:0,up:0,al:"l",c:"#000000",bg:""},o,
    {x:R(Math.max(0,x)),y:R(Math.max(0,y)),w:R(Math.min(w,Math.max(3,bw))),h:R(Math.max(2,bh)),fs:+(o.fs||1).toFixed(2)})};
  const gap=Math.max(.5,base*.025);
  // верх: логотип и магазин
  let y=pad;const topH=base*.11,lg=on("logo");
  put("logo",pad,y,W*.4,topH*1.2,{fs:base*.075,b:1});
  put("shop",lg?pad+W*.42:pad,y,lg?W*.58:W,topH,{fs:base*.075,b:1,al:lg?"r":"l"});
  if(lg||on("shop"))y+=topH*(lg?1.2:1)+gap;
  // низ, правая колонка: цена, над ней старая цена со скидкой, выше рассрочка
  const left=on("qr")||on("barcode"),rx=pad+W*(left?.42:.25),RW=pad+W-rx,bot=h-pad;
  const pfs=base*({S:.16,M:.21,L:.27}[t.priceSize]||.21)*(left&&w<60?.85:1),ph=pfs*1.05;
  let rTop=bot;
  put("price",rx,bot-ph,RW,ph,{fs:pfs,b:1,al:"r"});if(on("price"))rTop-=ph+gap*.5;
  const ofs=pfs*.42,oh=ofs*1.3;
  put("oldprice",rx+(on("discount")?RW*.42:0),rTop-oh,on("discount")?RW*.58:RW,oh,{fs:ofs,al:"r",c:"#555555"});
  put("discount",rx,rTop-oh,on("oldprice")?RW*.4:RW*.45,oh,{fs:ofs*.95,b:1,al:"c",c:"#ffffff",bg:"#000000"});
  if(on("discount")&&!on("oldprice"))B.discount.x=R(pad+W-B.discount.w);
  if(on("oldprice")||on("discount"))rTop-=oh+gap*.5;
  const cfs=base*.058,chh=cfs*1.4;
  put("credit",rx,rTop-chh,RW,chh,{fs:cfs,b:1,al:"r"});if(on("credit"))rTop-=chh+gap*.5;
  // низ, левая колонка: QR и штрихкод
  let lTop=bot;const lw=rx-pad-gap;
  const qs=R(Math.min(h*.36,Math.max(bot-rTop,h*.24),lw*(on("barcode")?.45:1),bot-y-2));
  put("qr",pad,bot-qs,qs,qs,{fs:2});
  const bx=on("qr")?pad+qs+gap:pad,bw=Math.max(8,rx-gap-bx),bh=Math.max(6,Math.min(h*.2,bw*.45));
  put("barcode",bx,bot-bh,bw,bh,{fs:2});
  if(on("qr"))lTop=bot-qs;if(on("barcode"))lTop=Math.min(lTop,bot-bh);
  let top=Math.min(rTop,lTop)-gap;
  const nfs=base*.06,nh=nfs*(t.invert?1.7:1.35);
  put("note",pad,top-nh,W,nh,{fs:nfs,b:1,c:t.invert?"#ffffff":"#000000",bg:t.invert?"#000000":""});if(on("note"))top-=nh+gap;
  // середина сверху вниз; если не помещается — уменьшаем пропорционально
  const nfz=base*.1,mfs=base*.065,pfz=base*.062;
  const mk=(lines,rows)=>[["name",nfz,nfz*1.13*lines,{b:1}],["model",mfs,mfs*1.3,{c:"#333333"}],["pills",pfz,pfz*2.05*rows,{b:1}],
    ["kit",pfz,pfz*1.4,{c:"#222222"}],["used",pfz,pfz*1.4,{c:"#222222"}],["imei",pfz,pfz*1.4,{c:"#222222"}],["sku",pfz,pfz*1.4,{c:"#222222"}]];
  const needOf=m=>m.filter(x=>on(x[0])).reduce((a,x)=>a+x[2]+gap*.6,0),avail=top-y;
  // сначала плашки в один ряд, потом название в одну строку, и только потом уменьшаем шрифт
  const L=h>=60?3:2,opts=[[L,h>=45?2:1],[L,1],[1,1]].map(([l,r])=>mk(l,r));
  let mid=opts.find(m=>needOf(m)<=avail/.72)||opts[opts.length-1];
  const need=needOf(mid),s=need>avail&&need>0?Math.max(.45,avail/need):1;
  for(const [k,fs,hh,o] of mid){put(k,pad,y,W,hh*s,Object.assign({fs:fs*s},o));if(on(k))y+=hh*s+gap*.6*s}
  return B;
}
App.tagAutoBlocks=autoBlocks;
/** Шаблон в рабочем виде: у старых и готовых шаблонов блоки достраиваются автоматически. */
function normTpl(t0){
  const t=JSON.parse(JSON.stringify(t0||App.TAG_PRESETS[0]));
  t.fields=Object.assign(F(),t.fields||{});
  const auto=autoBlocks(t);t.blocks=Object.assign({},auto,t.blocks||{});
  if(!Array.isArray(t.order))t.order=BKEYS.slice();for(const k of BKEYS)if(!t.order.includes(k))t.order.push(k);
  if(!t.font)t.font="helv";if(!t.bg)t.bg="#ffffff";if(t.creditMonths==null)t.creditMonths=12;if(t.gap==null)t.gap=1;if(t.creditRate==null)t.creditRate=0;
  return t;
}
App.tagNorm=normTpl;
App.tagTemplates=()=>[...App.TAG_PRESETS.map(t=>({...normTpl(t),builtin:true})),...((App.settings().tagTemplates)||[]).map(normTpl)];
App.tagTemplate=id=>App.tagTemplates().find(t=>t.id===id)||App.tagTemplates()[0];

function barcodeSvg(code,css){
  if(!code||typeof JsBarcode!=="function")return "";
  try{const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    const ean=/^\d{13}$/.test(code);
    try{JsBarcode(svg,code,{format:ean?"EAN13":"CODE128",displayValue:true,fontSize:14,textMargin:1,height:50,margin:0,width:2,flat:true})}
    catch(e){JsBarcode(svg,code,{format:"CODE128",displayValue:true,fontSize:14,textMargin:1,height:50,margin:0,width:2})}
    const w=svg.getAttribute("width"),hh=svg.getAttribute("height");svg.setAttribute("viewBox",`0 0 ${parseFloat(w)} ${parseFloat(hh)}`);
    svg.removeAttribute("width");svg.removeAttribute("height");svg.setAttribute("preserveAspectRatio","xMinYMid meet");svg.style.cssText=css;
    return svg.outerHTML}catch(e){return ""}
}
const TR={"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"};
/** Тот же адрес страницы, что отдаёт API сайта (site-api / shape.ts). */
App.siteSlug=(name,sku)=>{const base=String(name||"").toLowerCase().split("").map(c=>TR[c]??c).join("").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);
  const tail=String(sku||"").toLowerCase().replace(/[^a-z0-9]+/g,"").slice(-8);return tail?`${base}-${tail}`:base};
App.tagQrUrl=(p,t)=>{const site=String(App.settings().siteUrl||"").replace(/\/+$/,"");
  const pat=String(t.qrUrl||"").trim()||(site?site+"/product/{slug}":"");if(!pat)return "";
  const sku=p.sku||p.barcode||("CRM-"+String(p.id||"").slice(0,8));
  return pat.replace(/\{slug\}/g,App.siteSlug(p.name,sku)).replace(/\{sku\}/g,encodeURIComponent(sku)).replace(/\{id\}/g,encodeURIComponent(p.id||""))};
App.tagWarranty=p=>num(p.warrantyMonths)||(App.isDevice&&App.isDevice(p)?num(App.settings().deviceWarrantyMonths):0);
const trub=v=>Math.round(num(v)).toLocaleString("ru-RU");
App.tagCredit=(p,t)=>{const m=Math.max(1,num(t.creditMonths)||12);return Math.ceil(num(p.price)*(1+num(t.creditRate)/100)/m)};
App.tagDiscount=p=>{const o=num(p.oldPrice),pr=num(p.price);return o>pr&&pr>0?Math.round((1-pr/o)*100):0};

/** Содержимое блока. Пустая строка — нечего печатать (у товара нет таких данных). */
function blockText(k,p,t){
  const st=App.settings();
  switch(k){
    case "shop":return esc(st.shopName||"iCase");
    case "name":return esc(p.name||"");
    case "model":return p.model?esc(p.model):"";
    case "kit":return p.kit?"Комплект: "+esc(p.kit):"";
    case "used":{const u=p.uattrs||{};return esc([u.repair==="Был"?"Был ремонт"+((u.repairParts||[]).length?": "+u.repairParts.join(", "):""):u.repair==="Не было"?"Без ремонта":"",u.parts==="Оригинальные"?"детали оригинальные":""].filter(Boolean).join(", "))}
    case "imei":return p.serial?App.codeLbl(p)+" "+esc(p.serial):"";
    case "sku":return p.sku?"Арт. "+esc(p.sku):"";
    case "note":return t.note?esc(t.note).replace(/-/g,"‑"):"";
    case "price":return num(p.price)?trub(p.price):"";
    case "oldprice":return num(p.oldPrice)>num(p.price)?trub(p.oldPrice):"";
    case "discount":{const d=App.tagDiscount(p);return d?"−"+d+"%":""}
    case "credit":return num(p.price)?"от "+trub(App.tagCredit(p,t))+" ₽/мес":"";
  }
  return "";
}
const PH={shop:"Магазин",name:"Название товара",model:"Модель",kit:"Комплект: …",used:"Б/у: ремонт",imei:"IMEI / S/N",sku:"Артикул",note:"Своя надпись",price:"0",oldprice:"Старая цена",discount:"−0%",credit:"от … ₽/мес",logo:"Логотип",qr:"QR",barcode:"Штрихкод",pills:"Плашки"};
const ONE_LINE=["shop","model","kit","used","imei","sku","price","oldprice","discount","credit"];
function blockHtml(k,b,p,t,o){
  const f=t.fields||{},edit=o&&o.edit;
  const al={l:"left",c:"center",r:"right"}[b.al]||"left",jc={l:"flex-start",c:"center",r:"flex-end"}[b.al]||"flex-start";
  let fs=num(b.fs)||2,inner="",lh=1.12,empty=false;
  const box=`position:absolute;left:${b.x}mm;top:${b.y}mm;width:${b.w}mm;height:${b.h}mm;overflow:hidden;`;
  const look=`color:${b.c||"#000"};${b.bg?`background:${b.bg};border-radius:${Math.min(b.h/2,1.2).toFixed(2)}mm;`:""}font-weight:${b.b?800:400};${b.i?"font-style:italic;":""}${b.up?"text-transform:uppercase;letter-spacing:.02em;":""}`;
  const padX=b.bg?Math.min(1.2,b.w*.06):0,iw=b.w-2*padX;
  if(k==="logo"){
    if(t.logo)inner=`<img src="${t.logo}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block;${t.logoBw?"filter:grayscale(1) contrast(1.4);":""}">`;
    else{const s=esc(App.settings().shopName||"iCase");fs=Math.min(fs,b.h/1.1,iw/(s.length*.6));inner=s}
  }else if(k==="qr"){const u=App.tagQrUrl(p,t);if(u)inner=App.qrSvg(u).replace("<svg",`<svg style="width:100%;height:100%;display:block"`);else empty=true}
  else if(k==="barcode"){const code=p.barcode||p.sku||p.serial||"";if(code)inner=barcodeSvg(code,`height:100%;width:auto;max-width:100%;display:block`);else empty=true}
  else if(k==="pills"){
    const cs=[f.chips&&p.memory,f.chips&&p.color,f.cond&&p.condition].filter(Boolean).map(x=>[esc(x),0]);
    if(f.battery&&p.batteryHealth!=null&&p.batteryHealth!=="")cs.push(["АКБ "+num(p.batteryHealth)+"%",0]);
    if(f.warranty&&App.tagWarranty(p))cs.push(["гарантия "+App.tagWarranty(p)+" мес.",1]);
    const ink=b.c||"#000",paper=t.bg||"#fff";
    const wrapOk=b.h>=fs*3.6;
    inner=cs.length?`<div style="display:flex;flex-wrap:${wrapOk?"wrap":"nowrap"};gap:${(fs*.4).toFixed(2)}mm;justify-content:${jc}">${cs.map(([x,d])=>`<span style="border:.25mm solid ${ink};border-radius:99px;padding:${(fs*.18).toFixed(2)}mm ${(fs*.55).toFixed(2)}mm;white-space:nowrap;line-height:1.1;${d?`background:${ink};color:${paper};`:""}">${x}</span>`).join("")}</div>`:"";
    if(!inner)empty=true;
  }else{
    const txt=blockText(k,p,t);if(!txt)empty=true;
    const plain=String(txt).replace(/&[a-z#0-9]+;/gi,"_");
    if(ONE_LINE.includes(k)&&txt){const len=k==="price"?plain.length+.8:plain.length;fs=Math.max(.8,Math.min(fs,b.h/1.02,iw/(len*(b.b?.63:.56))));lh=1}
    if(k==="price"&&txt)inner=`${txt}<span style="font-size:.45em;margin-left:.08em">₽</span>`;
    else if(k==="oldprice"&&txt)inner=`<span style="text-decoration:line-through">${txt} ₽</span>`;
    else if(k==="name"&&txt){const n=Math.max(1,Math.floor(b.h/(fs*1.12)));inner=`<div style="display:-webkit-box;-webkit-line-clamp:${n};-webkit-box-orient:vertical;overflow:hidden">${txt}</div>`}
    else inner=txt;
  }
  if(empty){if(!edit)return "";inner=`<span style="opacity:.35;font-style:italic">${PH[k]||k}</span>`;fs=Math.min(fs,b.h/1.2)}
  const media=["logo","qr","barcode"].includes(k)&&!empty;
  if(!media&&k!=="pills"&&k!=="name")inner=`<div>${inner}</div>`; // текст и «₽» — одна строка, а не два флекс-элемента
  const flex=`display:flex;flex-direction:column;justify-content:${k==="price"||k==="oldprice"||k==="discount"||k==="credit"?"flex-end":b.bg||media?"center":"flex-start"};${media?`align-items:${jc};`:""}`;
  return `<div data-blk="${k}"${edit&&o.sel===k?' class="sel"':""} style="${box}${flex}${look}font-size:${fs.toFixed(2)}mm;line-height:${lh};text-align:${al};white-space:${ONE_LINE.includes(k)?"nowrap":"normal"};${padX?`padding:0 ${padX.toFixed(2)}mm;`:""}">${inner}${edit&&o.sel===k?'<i class="rh"></i>':""}</div>`;
}
/** Один ценник. o.edit — режим редактора: пустые блоки видны как подсказки, у выбранного есть уголок для размера. */
function tagHtml(p,t0,o){
  const t=t0.blocks?t0:normTpl(t0),w=num(t.w)||60,h=num(t.h)||40,base=Math.min(h,w*.75);
  const bl=(t.order||BKEYS).filter(k=>blockOn(t,k)&&t.blocks[k]).map(k=>blockHtml(k,t.blocks[k],p,t,o)).join("");
  return `<div class="tag${t.border?"":" nb"}" style="position:relative;flex:none;width:${w}mm;height:${h}mm;overflow:hidden;background:${t.bg||"#fff"};color:#000;font-family:${fontOf(t)};${t.border?`border:.3mm solid ${t.borderColor||"#000"};`:""}${t.round&&t.border?`border-radius:${(base*.08).toFixed(2)}mm;`:""}">${bl}</div>`;
}
App.tagHtml=tagHtml;
const tagCss=t=>{const w=num(t.w)||60,h=num(t.h)||40,g=Math.max(0,Math.min(10,t.gap==null?1:num(t.gap)));
  return `*{box-sizing:border-box}html,body{margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
${t.media==="label"?`@page{size:${w}mm ${h}mm;margin:0}.tag{page-break-after:always;break-after:page}.sheet{display:block}`:`@page{size:A4;margin:8mm}.sheet{display:flex;flex-wrap:wrap;align-content:flex-start;gap:${g}mm}.tag{break-inside:avoid;page-break-inside:avoid}`}
.tag.nb{outline:.2mm dashed #bbb;outline-offset:-.1mm}@media print{.tag.nb{outline:none}}
@media screen{body{background:#e5e5e5;padding:6mm}}`};
App.tagsHtml=function(list,t0){
  const t=normTpl(t0);
  const tags=[];list.forEach(({p,copies})=>{for(let i=0;i<Math.max(0,Math.min(200,num(copies)));i++)tags.push(tagHtml(p,t))});
  return wrap("Ценники",tagCss(t),`<div class="sheet">${tags.join("")}</div>`);
};

/* ---------- печать через скрытый фрейм ---------- */
App.printHtml=function(html){
  let f=document.getElementById("printFrame");if(f)f.remove();
  f=document.createElement("iframe");f.id="printFrame";f.title="Печать";
  f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const w=f.contentWindow;w.document.open();w.document.write(html);w.document.close();
  setTimeout(()=>{try{w.focus();w.print()}catch(e){App.toast("Не удалось открыть печать")}},300);
};
App.ACT.printReceipt=(arg)=>{const [id,fmt]=String(arg).split("|");const s=App.byId("sales",id);if(!s)return;
  App.printHtml(fmt==="80"?App.receipt80(s):App.receiptA4(s))};
})();
