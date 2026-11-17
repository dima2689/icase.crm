/* iCase CRM v3 · Приёмка товара: сканер, быстрое создание товаров и устройств, IMEI, цены, ценники */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.receive="Приёмка";
const LS=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||"null");localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};
/* склады для приёмки: продавец — только склады своей точки */
function rcvWhOpts(){const all=App.whOpts();if(App.can("stock"))return all;const pt=(App.point()||{}).id;const mine=new Set(S.warehouses.filter(w=>w.pointId===pt).map(w=>w.id));return all.filter(o=>mine.has(o[0]))}
const DEF0=()=>({cond:"Новый",region:"",sim:"",plug:"",act:"",grade:"",batt:"",kit:[]});
const blank=()=>({wh:"",supplierId:"",invoice:"",invTotal:"",note:"",extra:"",pays:[],poId:"",draftId:"",draftNum:"",def:DEF0(),lines:[]});
let R=(()=>{const o=Object.assign(blank(),LS("icase_recv")||{});o.def=Object.assign(DEF0(),o.def);if(!Array.isArray(o.pays))o.pays=[];return o})();
let last=null; // последняя проведённая приёмка
const save=()=>LS("icase_recv",R);
/* заполнить приёмку остатком заказа поставщику */
App.rcvLoad=function(o){R=Object.assign(blank(),{wh:o.wh||R.wh,supplierId:o.supplierId||"",invoice:o.invoice||"",note:o.note||"",poId:o.poId||"",
  lines:o.lines.map(l=>({productId:l.productId,qty:l.qty,cost:l.cost,price:"",units:[],poQty:l.qty}))});save()};
ACT.rcvPoOff=()=>{R.poId="";save();App.render()};
const P=id=>App.byId("products",id);
const isSer=l=>{const p=P(l.productId);return !!(p&&p.trackSerial)};
const lineQty=l=>isSer(l)?(l.units||[]).length:num(l.qty);
const codeOf=u=>u.imei||u.serial_no||"";
const allCodes=()=>R.lines.flatMap(l=>(l.units||[]).map(codeOf));
/* закупка по прайсу выбранного поставщика (если строка прайса привязана к товару) */
const supCost=p=>{if(!R.supplierId)return null;const x=S.sprices.find(y=>y.productId===p.id&&y.supplierId===R.supplierId&&num(y.price)>0);return x?num(x.price):null};
function autoCost(l){const p=P(l.productId);if(!p)return;const sc=supCost(p);if(sc!=null){l.cost=sc;l.costSrc="sup"}else if(num(p.lastCost||p.cost)){l.cost=num(p.lastCost||p.cost);l.costSrc="last"}}
/* параметры техники: регион, SIM, вилка Dyson, активация, оценка б/у, комплект */
const RG=["США","Япония","Европа","ОАЭ","Гонконг","РСТ/ЕАС"],SIMS=["eSIM only","SIM + eSIM","Dual nano-SIM"],PLUGS=["EU","UK","US"],ACTS=["Не активирован","Активирован"],GRADES=["A","B","C"],KITS=["Коробка","Кабель","Блок","Чек"];
const isDyson=p=>/dyson/i.test([p.brand,p.name,App.catPath(p.categoryId)].join(" "));
const isNewC=c=>!c||c==="Новый";
function defAttrs(p,cond){const d=R.def,a={};
  if(isDyson(p)){if(d.plug)a.plug=d.plug}else{if(d.region)a.region=d.region;if(App.isPhone(p)&&d.sim)a.sim=d.sim}
  if(isNewC(cond)){if(d.act&&App.isPhone(p))a.act=d.act}else{if(d.grade)a.grade=d.grade;if((d.kit||[]).length)a.kitList=d.kit.slice()}return a}
/* наценка по умолчанию из настроек и округление */
const rset=()=>{const r=App.settings().receive||{};return {m:num(r.markup),st:num(r.round)||10}};
const sugg=c=>{const {m,st}=rset();return m>0&&c>0?Math.ceil(c*(1+m/100)/st)*st:0};
function autoPrice(l){const p=P(l.productId);if(!p||!App.can("price"))return;if(l.priceSrc!=="mk"&&(l.price!==""&&l.price!=null))return;if(num(p.price)&&l.priceSrc!=="mk")return;
  const s=sugg(num(l.cost));if(s){l.price=String(s);l.priceSrc="mk"}else if(l.priceSrc==="mk"){l.price="";l.priceSrc=""}}
/* деньги: товары, доставка (делится пропорционально закупке), оплата с нескольких счетов */
const goodsSum=()=>R.lines.reduce((x,l)=>x+lineQty(l)*num(l.cost),0);
const extraK=()=>{const g=goodsSum(),e=num(R.extra);return g>0&&e>0?e/g:0};
const landed=l=>Math.round(num(l.cost)*(1+extraK())*100)/100;
const grand=()=>R.lines.reduce((x,l)=>x+lineQty(l)*landed(l),0);
const paidSum=()=>R.pays.reduce((a,p)=>a+num(p.amt),0);
const canPay=()=>App.can("finance")&&!!R.supplierId;
const payList=()=>canPay()?R.pays.filter(p=>p.acc&&num(p.amt)>0).map(p=>({account_id:p.acc,amount:Math.round(num(p.amt)*100)/100})):[];
/* разделить вставленный список кодов: строки, пробелы, запятые */
const splitCodes=v=>String(v||"").split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);

VIEWS.receive={
  ownSearch:true,
  actions:()=>`<button class="btn" data-act="rcvNewItem">+ Новый товар</button><button class="btn pri" data-act="rcvDevice">+ Устройство Apple</button>`,
  render(){
    if(!R.wh||!App.byId("warehouses",R.wh)||!rcvWhOpts().some(o=>o[0]===R.wh))R.wh=(rcvWhOpts().find(o=>o[0]===App.cashWh())||rcvWhOpts()[0]||[""])[0];
    R.lines=R.lines.filter(l=>P(l.productId));
    const cost=App.can("cost"),price=App.can("price");
    const tq=R.lines.reduce((a,l)=>a+lineQty(l),0),tc=R.lines.reduce((a,l)=>a+lineQty(l)*num(l.cost),0);
    const po=R.poId?App.byId("porders",R.poId):null;if(R.poId&&!po&&S.porders.length)R.poId="";
    return `<div class="recv" data-nodirty>
    ${po?`<div class="fbox pobar">Приёмка по заказу <b>${esc(po.num)}</b> · ${esc((App.byId("suppliers",po.supplierId)||{}).name||"")} — после проведения в заказе отметится, что пришло. <button class="btn sm ghost" data-act="rcvPoOff">Не по заказу</button></div>`:""}
    <section class="card">
      <div class="form">
        ${App.fld("rcvWh","На склад",App.sel("rcvWh",rcvWhOpts(),R.wh,'data-rh="wh"'))}
        <div class="fld"><label for="rcvSup">Поставщик</label><div class="row-f nowrap">${App.sel("rcvSup",[["","—"],...S.suppliers.map(s=>[s.id,s.name])],R.supplierId,'data-rh="supplierId"')}${App.can("stock")?'<button class="btn sm" data-act="rcvSupNew" aria-label="Новый поставщик">+</button>':""}</div></div>
        ${App.fld("rcvInv","Накладная / основание",App.inp("rcvInv",R.invoice,"text","№ и дата",'data-rh="invoice"'))}
        ${App.can("cost")?App.fld("rcvInvT","Сумма по накладной, ₽",App.inp("rcvInvT",R.invTotal,"number","для сверки",'data-rh="invTotal" min="0"')):""}
        ${App.can("cost")?App.fld("rcvExtra","Доставка и расходы, ₽",App.inp("rcvExtra",R.extra,"number","войдут в себестоимость",'data-rh="extra" min="0"')):""}
        ${App.fld("rcvNote","Комментарий",App.inp("rcvNote",R.note,"text","",'data-rh="note"'))}
      </div>
      ${!App.can("stock")?'<p class="muted">Закупочные цены подставятся из карточек товаров — управляющий проверит их по задаче. Новые товары могут потребовать подтверждения.</p>':""}
      ${defHtml()}
      <div class="scanbar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>
        <input id="rcvQ" type="search" autocomplete="off" placeholder="Штрихкод или IMEI" aria-label="Сканер или поиск товара"><div class="pick" id="rcvPick" hidden></div></div>
      <p class="muted hintline">Новый IMEI → выберите модель, и устройство создастся само. Новый штрихкод → откроется карточка нового товара.</p>
      <div class="rlines">${R.lines.map((l,i)=>lineHtml(l,i,{cost,price})).join("")||`<div class="empty big">Пока пусто. Отсканируйте первый товар или нажмите «+ Устройство Apple»</div>`}</div>
    </section>
    <aside class="card rsum">
      <h2>Итого</h2>
      ${R.draftId?`<p class="pill info">Черновик ${esc(R.draftNum||"")}</p>`:""}
      <div class="sumlines"><span>Позиций</span><span>${R.lines.length}</span><span>Штук</span><span id="rcvTq">${tq}</span>${cost?`<span>Товары по закупке</span><span id="rcvTc">${money(tc)}</span><span>Доставка и расходы</span><span id="rcvTe">${money(num(R.extra))}</span><span><b>Итого приход</b></span><span><b id="rcvTt">${money(grand())}</b></span>`:""}</div>
      ${cost?`<div id="rcvDiff">${diffHtml(tc)}</div>`:""}
      ${cost?payHtml():""}
      <button class="btn pri big" data-act="rcvPost" ${R.lines.length?"":"disabled"}>Провести приёмку</button>
      <div class="row-f"><button class="btn" data-act="rcvDraft" ${R.lines.length?"":"disabled"}>Сохранить черновик</button><button class="btn ghost" data-act="rcvClear" ${R.lines.length?"":"disabled"}>Очистить</button></div>
      <p class="muted">Приёмка сохраняется в этом браузере сама. «Сохранить черновик» — чтобы продолжить с другого компьютера.</p>
      ${draftsHtml()}
      ${last?`<div class="donebox"><b>Приёмка ${esc(last.num)} проведена</b><span>${last.qty} шт · ${esc(App.whName(last.wh))}</span>
        <button class="btn" data-act="rcvTags">Этикетки на принятое</button><button class="btn ghost" data-act="openDoc" data-id="${esc(last.id)}">Открыть документ</button></div>`:""}
    </aside></div>`;
  },
  after(){bind();loadDrafts()}
};

function defHtml(){const d=R.def,o=(k,opts,lbl)=>`<label class="mini">${lbl}<select data-rd="${k}"><option value="">—</option>${opts.map(x=>`<option${d[k]===x?" selected":""}>${x}</option>`).join("")}</select></label>`;
  const used=!isNewC(d.cond),open=App.ui.rcvDefOpen===true;
  const sum=[d.cond,d.region,d.sim,d.plug&&"вилка "+d.plug,used?d.grade&&"оценка "+d.grade:d.act,used&&d.batt?"АКБ "+d.batt+"%":"",used&&d.kit.length?d.kit.join(", "):""].filter(Boolean).join(" · ");
  return `<details class="rdef" id="rcvDef" ${open?"open":""}><summary>Для всей партии <span class="muted">${esc(sum)}</span></summary><div class="rdef-b">
    <label class="mini">Состояние<select data-rd="cond">${App.CONDS.map(c=>`<option${d.cond===c?" selected":""}>${c}</option>`).join("")}</select></label>
    ${o("region",RG,"Регион")}${o("sim",SIMS,"SIM")}${o("plug",PLUGS,"Вилка (Dyson)")}
    ${used?`${o("grade",GRADES,"Оценка вида")}<label class="mini">АКБ, %<input type="number" min="0" max="100" value="${esc(d.batt||"")}" data-rd="batt" style="width:80px"></label>
      <div class="mini">Комплект<div class="chips">${KITS.map(k=>`<button type="button" class="chip ${d.kit.includes(k)?"on":""}" data-act="rcvDefKit" data-id="${k}">${k}</button>`).join("")}</div></div>`:o("act",ACTS,"Активация")}
    ${R.lines.some(l=>(l.units||[]).length)?'<button type="button" class="btn sm" data-act="rcvDefApply">Применить к уже отсканированным</button>':""}
    <small class="muted">Подставится в каждое новое устройство. Поправить можно в строке.</small></div></details>`}
function payHtml(){
  const tot=grand(),pd=paidSum(),left=Math.round((tot-pd)*100)/100;
  if(!App.can("finance"))return "";
  if(!R.supplierId)return '<p class="muted">Выберите поставщика — тогда можно указать оплату и долг.</p>';
  const accs=S.finaccounts.filter(a=>a.active);
  return `<div class="rpays"><h3 class="sub-h">Оплата поставщику</h3>
    ${R.pays.map((p,k)=>`<div class="row-f nowrap payrow"><select data-rp="${k}|acc" aria-label="Счёт"><option value="">Счёт…</option>${accs.map(a=>`<option value="${esc(a.id)}"${p.acc===a.id?" selected":""}>${esc(a.name)}</option>`).join("")}</select><input type="number" min="0" value="${esc(p.amt)}" data-rp="${k}|amt" placeholder="0" aria-label="Сумма"><button type="button" class="btn sm ghost" data-act="rcvPayDel" data-id="${k}" aria-label="Убрать">${App.ico("x","sm")}</button></div>`).join("")}
    <div class="row-f"><button type="button" class="btn sm" data-act="rcvPayAdd">+ Счёт</button>${left>0.5?`<button type="button" class="btn sm" data-act="rcvPayRest">Оплатить остаток</button>`:""}</div>
    <div class="sumlines"><span>Оплачено</span><span id="rcvPd">${money(pd)}</span><span>Долг поставщику</span><b id="rcvDebt" class="${left<-0.5?"badc":""}">${left<-0.5?"переплата "+money(-left):money(Math.max(0,left))}</b></div>
    ${!accs.length?'<p class="muted">Счетов нет — заведите их в «Финансы → Счета и статьи».</p>':""}</div>`}
function draftsHtml(){const ds=(App.ui.rcvDrafts||[]).filter(d=>d.id!==R.draftId);if(!ds.length)return "";
  return `<div class="rdrafts"><h3 class="sub-h">Черновики приёмки</h3>${ds.slice(0,8).map(d=>{const q=d.lines.reduce((a,l)=>a+((l.newUnits||[]).length||num(l.qty)),0);
    return `<div class="row-f nowrap"><button type="button" class="linklike" data-act="rcvDraftOpen" data-id="${esc(d.id)}"><b>${esc(d.num)}</b> · ${App.dt(d.createdAt)} · ${q} шт${d.supplierId?" · "+esc((App.byId("suppliers",d.supplierId)||{}).name||""):""}<small> ${esc(App.nameOf(d.by)||"")}</small></button><button type="button" class="btn sm ghost" data-act="rcvDraftDel" data-id="${esc(d.id)}" aria-label="Удалить черновик">${App.ico("x","sm")}</button></div>`}).join("")}</div>`}
let drLoad=0;function loadDrafts(force){if(!force&&Date.now()-drLoad<60e3)return;drLoad=Date.now();App.api.rcvDrafts().then(ds=>{App.ui.rcvDrafts=ds;if(App.ui.view==="receive")App.render()}).catch(()=>{})}
function diffHtml(tc){if(R.invTotal===""||R.invTotal==null)return "";const d=Math.round(tc-num(R.invTotal));
  return Math.abs(d)<1?'<p class="hint ok">Сходится с накладной ✓</p>':`<p class="hint bad">Расхождение с накладной: ${d>0?"+":"−"}${money(Math.abs(d))} — проверьте количество и закупку</p>`}
const markup=(c,pr)=>c>0&&pr>0?Math.round((pr-c)/c*100):null;
function lineHtml(l,i,{cost,price}){
  const p=P(l.productId),ser=p.trackSerial,q=lineQty(l);
  const pr=num(l.price)||num(p.price),mk=markup(num(l.cost),pr);
  const prices=`${cost?`<label class="mini">Закупка, ₽<input type="number" min="0" value="${num(l.cost)||""}" data-rl="${i}|cost" placeholder="0">${l.costSrc==="sup"?'<small class="muted">по прайсу поставщика</small>':l.costSrc==="last"?'<small class="muted">как в прошлый раз</small>':""}${extraK()&&num(l.cost)?`<small class="muted" data-ld="${i}">с доставкой ${money(landed(l))}</small>`:""}</label>`:""}
    ${price?`<label class="mini">Цена продажи, ₽<input type="number" min="0" value="${num(l.price)||""}" data-rl="${i}|price" placeholder="${num(p.price)||0}">${cost&&mk!=null?`<small class="${mk<0?"badc":"muted"}" data-mk="${i}">${mk<0?"ниже закупки":(l.priceSrc==="mk"?"по наценке ":"наценка ")+mk+"%"}</small>`:!pr?'<small class="badc">цена не задана</small>':""}</label>`:""}`;
  return `<div class="rline">
    <div class="rhead"><div><b>${esc(p.name)}</b><span class="sub">${esc([App.catName(p),p.condition,p.barcode?"ШК "+p.barcode:"",App.skuShow(p.sku)?"арт. "+App.skuShow(p.sku):""].filter(Boolean).join(" · "))}</span></div>
      <div class="rq">${ser?`<span class="pill info">${App.codeLbl(p)}</span> <b>${q}</b> шт`:`<button class="btn sm" data-act="rcvQty" data-id="${i}|-1" aria-label="Меньше">−</button><input type="number" min="1" value="${q}" data-rl="${i}|qty" aria-label="Количество"><button class="btn sm" data-act="rcvQty" data-id="${i}|1" aria-label="Больше">+</button>`}</div>
      <div class="rprices">${prices}</div>
      <button class="btn sm ghost danger" data-act="rcvDel" data-id="${i}" aria-label="Убрать">${App.ico("x","sm")}</button></div>
    ${ser?`<div class="runits"><input class="uscan" data-rscan="${i}" placeholder="Сканируйте ${App.codeName(p)} и Enter или вставьте список" autocomplete="off" aria-label="${App.codeName(p)}">
      ${(l.units||[]).length?`<table class="units"><thead><tr><th>${App.codeLbl(p)}</th><th>Состояние</th><th>АКБ, %</th><th>Параметры</th>${price?"<th>Цена экз., ₽</th>":""}<th></th></tr></thead><tbody>
      ${l.units.map((u,j)=>`<tr><td><b>${esc(codeOf(u))}</b>${u.warn?`<span class="sub warn">${esc(u.warn)}</span>`:""}${u.condition&&u.condition!=="Новый"||u.attrs?`<div class="chips usum">${App.usedChips(u.attrs)}<button class="btn sm" data-act="rcvUsed" data-id="${i}|${j}">Параметры б/у</button></div>`:""}</td>
        <td><select data-ru="${i}|${j}|condition" aria-label="Состояние">${App.CONDS.map(c=>`<option${(u.condition||p.condition)===c?" selected":""}>${c}</option>`).join("")}</select></td>
        <td><input type="number" min="0" max="100" value="${esc(u.battery_health||"")}" data-ru="${i}|${j}|battery_health" aria-label="АКБ" style="width:70px"></td>
        <td class="uattr">${attrSel(p,u,i,j)}</td>
        ${price?`<td><input type="number" min="0" value="${esc(u.price||"")}" data-ru="${i}|${j}|price" placeholder="${num(l.price)||num(p.price)||""}" aria-label="Цена экземпляра" style="width:100px"></td>`:""}
        <td><button class="btn sm ghost" data-act="rcvUnitDel" data-id="${i}|${j}" aria-label="Убрать">${App.ico("x","sm")}</button></td></tr>`).join("")}</tbody></table>`:'<span class="muted">Отсканируйте каждое устройство</span>'}</div>`:""}
  </div>`;
}

function attrSel(p,u,i,j){const a=u.attrs||{},cond=u.condition||p.condition,s=(k,opts,lbl)=>`<select data-ru="${i}|${j}|attr:${k}" aria-label="${lbl}"><option value="">${lbl}</option>${opts.map(o=>`<option${a[k]===o?" selected":""}>${o}</option>`).join("")}</select>`;
  return isDyson(p)?s("plug",PLUGS,"Вилка"):(s("region",RG,"Регион")+(App.isPhone(p)?s("sim",SIMS,"SIM"):"")+(isNewC(cond)?(App.isPhone(p)?s("act",ACTS,"Активация"):""):s("grade",GRADES,"Оценка")))}
/* ---------- добавление ---------- */
function ensureLine(p){let i=R.lines.findIndex(l=>l.productId===p.id);
  if(i<0){const l={productId:p.id,qty:0,cost:"",price:"",units:[]};autoCost(l);autoPrice(l);R.lines.unshift(l);i=0}return i}
function addProduct(p,{focusScan=true}={}){
  const i=ensureLine(p);if(!p.trackSerial)R.lines[i].qty=num(R.lines[i].qty)+1;
  save();App.render();setTimeout(()=>focus(p.trackSerial&&focusScan?`[data-rscan="${i}"]`:"#rcvQ"),0);
}
function addUnit(p,code,extra={}){
  const pc=App.parseCode(code,App.isPhone(p));if(!pc)return false;const c=pc.imei||pc.serial_no;
  if(allCodes().some(x=>x.toLowerCase()===c.toLowerCase())){App.toast(App.codeLbl(p)+" "+c+" уже есть в приёмке");return false}
  const u=App.findUnit(c);
  if(u&&["in_stock","reserved","in_repair"].includes(u.status)){App.toast(App.codeLbl(p)+" "+c+" уже на складе «"+App.whName(u.whId)+"»");return false}
  if(u&&u.status==="sold"&&!extra.force){SOLD.push({pid:p.id,code:c,extra,uid:u.id});return false}
  if(u&&!extra.force)App.toast("Это устройство уже было в базе — вернётся на склад");else if(pc.warn)App.toast(pc.warn);
  const cond=extra.condition||(p.condition&&p.condition!=="Новый"?p.condition:R.def.cond||"Новый");
  const x=Object.assign({},extra);delete x.force;
  const unit=Object.assign({imei:pc.imei||"",serial_no:pc.serial_no||"",condition:cond,battery_health:isNewC(cond)?"":(R.def.batt||""),price:"",warn:pc.warn||""},x);
  unit.attrs=Object.assign(defAttrs(p,cond),extra.attrs||{});if(!Object.keys(unit.attrs).length)delete unit.attrs;
  const i=ensureLine(p);R.lines[i].units.push(unit);
  save();return true;
}
/* устройство мы уже продавали: возврат по чеку, выкуп или всё равно приход */
let SOLD=[];
function soldAsk(){if(!SOLD.length)return;const s=SOLD[0],u=App.byId("units",s.uid),p=P(s.pid);
  const sale=u&&S.sales.find(x=>(x.items||[]).some(it=>it.unitId===u.id)),c=sale&&App.cust(sale.customerId);
  App.openModal(App.head("Это устройство мы уже продавали")+`<p><b>${esc(p?p.name:"")}</b> · ${esc(s.code)}</p>
    <p>${sale?`Продано ${App.dt(sale.createdAt)} по чеку <b>${esc(sale.num)}</b>${c?" — "+esc(c.name||"")+(c.phone?", "+esc(c.phone):""):""}.`:"Числится проданным."} Как оформить?</p>
    <div class="list-mini">
      ${sale?`<button type="button" data-act="rcvSoldRet" data-id="${esc(sale.id)}"><span><b>Возврат по чеку</b><small>клиент вернул покупку — деньги вернутся из кассы, устройство на склад</small></span></button>`:""}
      <button type="button" data-act="rcvSoldDeal"><span><b>Выкуп или trade-in</b><small>покупаем у клиента: договор с паспортом, оплата клиенту</small></span></button>
      <button type="button" data-act="rcvSoldGo"><span><b>Всё равно принять от поставщика</b><small>например, устройство вернулось из сервиса поставщика</small></span></button>
    </div>${SOLD.length>1?`<p class="muted">Ещё таких устройств: ${SOLD.length-1}</p>`:""}
    <div class="acts"><button class="btn" data-act="rcvSoldSkip">Не добавлять</button></div>`)}
ACT.rcvSoldGo=()=>{const s=SOLD.shift();const p=s&&P(s.pid);if(p)addUnit(p,s.code,Object.assign({},s.extra,{force:true}));App.closeModal();App.render();if(SOLD.length)setTimeout(soldAsk,0)};
ACT.rcvSoldSkip=()=>{SOLD.shift();App.closeModal();if(SOLD.length)setTimeout(soldAsk,0)};
ACT.rcvSoldRet=id=>{SOLD=[];App.closeModal();location.hash="sales";setTimeout(()=>ACT.returnDlg(id),300)};
ACT.rcvSoldDeal=()=>{const s=SOLD.shift();SOLD=[];App.closeModal();if(!ACT.dealNew)return;ACT.dealNew();setTimeout(()=>{const e=document.getElementById("dlCode");if(e&&s){e.value=s.code;e.dispatchEvent(new Event("input",{bubbles:true}))}},50)};
function focus(sel){const el=document.querySelector(sel);if(el)el.focus()}
function handleCode(raw){
  const v=String(raw||"").trim();if(!v)return;
  const u=App.findUnit(v);
  if(u){const p=P(u.productId);if(p&&addUnit(p,v)){App.render();setTimeout(()=>focus("#rcvQ"),0)}soldAsk();return}
  const p=S.products.find(x=>!x.archived&&[x.barcode,x.sku].some(c=>c&&String(c).toLowerCase()===v.toLowerCase()));
  if(p)return addProduct(p);
  const digits=v.replace(/\s/g,"");
  if(/^\d{15}$/.test(digits))return ACT.rcvDevice(digits);           // новый IMEI → выбрать модель
  if(App.isPartNo(digits))return App.rcvDevicePart(digits);           // артикул Apple с коробки → модель, память, цвет
  const found=App.searchProducts(v,{limit:2});
  if(found.length===1)return addProduct(found[0]);
  if(/^\d{8,14}$/.test(digits))return ACT.rcvNewItem(digits);         // новый штрихкод → новый товар
  if(/^[A-Z0-9]{8,14}$/i.test(digits)&&/\d/.test(digits)&&/[A-Z]/i.test(digits))return ACT.rcvDevice(digits.toUpperCase()); // похоже на серийный номер Apple
  App.toast(found.length?"Найдено несколько — выберите из списка":"Не найдено. Создайте товар кнопкой «+ Новый товар»");
}

/* ---------- обработчики ---------- */
function bind(){
  const q=$("#rcvQ"),box=$("#rcvPick");if(!q)return;
  q.addEventListener("input",()=>{const s=q.value.trim();if(!s){box.hidden=true;return}
    const list=App.searchProducts(s,{limit:8});
    box.innerHTML=list.map(p=>`<button type="button" data-rpick="${esc(p.id)}"><span>${esc(p.name)}<small> · ${esc(App.catName(p))}${p.trackSerial?" · по "+App.codeLbl(p):""} · в наличии ${App.qtyTotal(p)}</small></span><b>${money(p.price)}</b></button>`).join("")
      +`<button type="button" data-rpick="__dev"><span>+ Новое устройство Apple…</span></button><button type="button" data-rpick="__item"><span>+ Новый товар «${esc(s)}»</span></button>`;
    box.hidden=false});
  q.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const v=q.value;q.value="";box.hidden=true;handleCode(v)}});
  box.addEventListener("click",e=>{const b=e.target.closest("[data-rpick]");if(!b)return;e.preventDefault();const id=b.dataset.rpick,s=q.value.trim();q.value="";box.hidden=true;
    if(id==="__dev")return ACT.rcvDevice("");if(id==="__item")return ACT.rcvNewItem("",s);const p=P(id);if(p)addProduct(p)});
  const addMany=(el,v)=>{const i=+el.dataset.rscan,p=P(R.lines[i].productId),codes=splitCodes(v);el.value="";if(!codes.length)return;
    let ok=0;codes.forEach(c=>{if(addUnit(p,c))ok++});
    if(codes.length>1)App.toast("Добавлено "+ok+" из "+codes.length+(ok<codes.length?" — остальные уже в приёмке или на складе":""));
    if(ok){App.render();setTimeout(()=>focus(`[data-rscan="${ensureLine(p)}"]`),0)}soldAsk()};
  document.querySelectorAll("[data-rscan]").forEach(el=>{
    el.addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();addMany(el,el.value)});
    el.addEventListener("paste",e=>{const t=(e.clipboardData||window.clipboardData).getData("text");if(splitCodes(t).length>1){e.preventDefault();addMany(el,t)}})});
  if(!document.activeElement||document.activeElement===document.body)q.focus();
}
document.addEventListener("input",e=>{const t=e.target;
  if(t.dataset.rh){R[t.dataset.rh]=t.value;
    if(t.dataset.rh==="supplierId"){R.lines.forEach(l=>{if(!l.cost||l.costSrc){autoCost(l);autoPrice(l)}});if(!R.supplierId)R.pays=[];save();App.render();return}
    save();if(t.dataset.rh==="invTotal"||t.dataset.rh==="extra")totals();if(t.dataset.rh==="extra"){clearTimeout(rT);rT=setTimeout(()=>App.render(),500)}return}
  if(t.dataset.rd){const k=t.dataset.rd;R.def[k]=t.value;save();if(k==="cond")App.render();return}
  if(t.dataset.rp){const [k,f]=t.dataset.rp.split("|");const p=R.pays[+k];if(p){p[f]=t.value;save();totals()}return}
  if(t.dataset.rl){const [i,f]=t.dataset.rl.split("|");const l=R.lines[+i];if(!l)return;l[f]=f==="qty"?Math.max(1,num(t.value)):t.value;if(f==="cost")l.costSrc="";if(f==="price")l.priceSrc="";
    if(f==="cost"){const was=l.price;autoPrice(l);const pe=document.querySelector(`[data-rl="${i}|price"]`);if(pe&&l.price!==was)pe.value=l.price}
    save();totals();
    if(f==="cost"||f==="price"){const p=P(l.productId),m=document.querySelector(`[data-mk="${i}"]`),mk=markup(num(l.cost),num(l.price)||num(p.price));if(m&&mk!=null){m.textContent=mk<0?"ниже закупки":(l.priceSrc==="mk"?"по наценке ":"наценка ")+mk+"%";m.className=mk<0?"badc":"muted"}}return}
  if(t.dataset.ru){const [i,j,f]=t.dataset.ru.split("|");const u=(R.lines[+i]||{}).units&&R.lines[+i].units[+j];if(!u)return;
    if(f.startsWith("attr:")){const k=f.slice(5);u.attrs=Object.assign({},u.attrs);if(t.value)u.attrs[k]=t.value;else delete u.attrs[k];save();return}
    u[f]=t.value;save();if(f==="condition"&&t.tagName==="SELECT")App.render()}
});
let rT=0;
document.addEventListener("change",e=>{const t=e.target;if((t.dataset.rh||t.dataset.ru||t.dataset.rd||t.dataset.rp)&&t.tagName==="SELECT")t.dispatchEvent(new Event("input",{bubbles:true}))});
document.addEventListener("toggle",e=>{if(e.target&&e.target.id==="rcvDef")App.ui.rcvDefOpen=e.target.open},true);
function totals(){const tc=goodsSum(),set=(id,v)=>{const e=$("#"+id);if(e)e.textContent=v};
  set("rcvTq",R.lines.reduce((x,l)=>x+lineQty(l),0));set("rcvTc",money(tc));set("rcvTe",money(num(R.extra)));set("rcvTt",money(grand()));
  const pd=paidSum(),left=Math.round((grand()-pd)*100)/100;set("rcvPd",money(pd));const db=$("#rcvDebt");if(db){db.textContent=left<-0.5?"переплата "+money(-left):money(Math.max(0,left));db.className=left<-0.5?"badc":""}
  const d=$("#rcvDiff");if(d)d.innerHTML=diffHtml(tc)}
ACT.rcvDefKit=k=>{const a=R.def.kit;const i=a.indexOf(k);i>=0?a.splice(i,1):a.push(k);save();App.render()};
ACT.rcvDefApply=()=>{let n=0;R.lines.forEach(l=>{const p=P(l.productId);(l.units||[]).forEach(u=>{if(!(p.condition&&p.condition!=="Новый"))u.condition=R.def.cond||u.condition;
  u.attrs=Object.assign({},u.attrs,defAttrs(p,u.condition));if(!isNewC(u.condition)&&R.def.batt)u.battery_health=R.def.batt;n++})});save();App.render();App.toast("Применено к "+n+" шт.")};
ACT.rcvPayAdd=()=>{const used=new Set(R.pays.map(p=>p.acc)),a=S.finaccounts.find(x=>x.active&&!used.has(x.id)),left=Math.round((grand()-paidSum())*100)/100;R.pays.push({acc:a?a.id:"",amt:left>0?String(left):""});save();App.render()};
ACT.rcvPayDel=k=>{R.pays.splice(+k,1);save();App.render()};
ACT.rcvPayRest=()=>{const left=Math.round((grand()-paidSum())*100)/100;if(left<=0)return;if(!R.pays.length)return ACT.rcvPayAdd();const p=R.pays[R.pays.length-1];p.amt=String(Math.round((num(p.amt)+left)*100)/100);save();App.render()};
ACT.rcvQty=v=>{const [i,d]=v.split("|").map(Number),l=R.lines[i];if(!l)return;l.qty=Math.max(1,num(l.qty)+d);save();App.render()};
ACT.rcvDel=i=>{R.lines.splice(+i,1);save();App.render()};
ACT.rcvUsed=v=>{const [i,j]=v.split("|").map(Number),u=R.lines[i]&&R.lines[i].units[j];if(!u)return;
  App.usedModal({title:"Параметры б/у · "+codeOf(u),attrs:u.attrs||{},battery:u.battery_health,onSave:r=>{u.attrs=r.attrs;if(r.kit)u.kit=r.kit;if(r.battery!=null)u.battery_health=r.battery;save();App.render()}})};
ACT.rcvUnitDel=v=>{const [i,j]=v.split("|").map(Number);R.lines[i].units.splice(j,1);save();App.render()};
ACT.rcvClear=(_,el)=>{if(!App.confirm2(el,"Очистить список? Ещё раз"))return;R=Object.assign(blank(),{wh:R.wh,supplierId:R.supplierId});save();App.render()};
ACT.rcvTags=()=>{if(!last)return;App.closeModal();
  const units=S.units.filter(u=>u.lastRef===last.num&&last.codes.includes(String(App.unitCode(u)).toLowerCase()));
  App.tagsAddUnits?App.tagsAddUnits(last.productIds,units):App.tagsAdd(last.productIds);App.ui.printTab="tags";location.hash="print"};

/* ---------- документ: черновик и проведение ---------- */
const clean=u=>{const o={};["imei","serial_no","condition","battery_health","price","kit","part_no"].forEach(k=>{if(u[k]!==""&&u[k]!=null)o[k]=String(u[k]).trim()});if(u.attrs&&Object.keys(u.attrs).length)o.attrs=u.attrs;return o};
async function saveDoc(forPost){
  const head={type:"in",wh_to:R.wh,supplier_id:R.supplierId||null,invoice:R.invoice||null,note:R.note||"Приёмка",po_id:R.poId||null,
    extra_cost:App.can("cost")?Math.max(0,num(R.extra)):0,payments:payList()};
  const lines=R.lines.map(l=>{const p=P(l.productId);return {product_id:p.id,qty:lineQty(l),cost:forPost?landed(l):num(l.cost),
    sale_price:l.price!==""&&l.price!=null?num(l.price):null,new_units:p.trackSerial?(l.units||[]).map(clean):[]}});
  let doc=null,created=false;
  if(R.draftId){try{await App.api.update("stock_docs",R.draftId,head);doc={id:R.draftId,num:R.draftNum}}catch(e){R.draftId="";R.draftNum=""}}
  if(doc)await App.api.remove("stock_doc_lines",doc.id,"doc_id");
  else{doc=await App.api.insert("stock_docs",head);created=true}
  try{await App.api.insertMany("stock_doc_lines",lines.map(l=>Object.assign({doc_id:doc.id},l)))}
  catch(e){if(created)try{await App.api.remove("stock_docs",doc.id)}catch(x){}throw e}
  return {id:doc.id,num:doc.num,created}}
ACT.rcvDraft=async(_,btn)=>{if(!R.lines.length)return;if(btn.disabled)return;btn.disabled=true;
  try{const d=await saveDoc(false);R.draftId=d.id;R.draftNum=d.num;save();loadDrafts(true);App.toast("Черновик "+d.num+" сохранён — его можно открыть с любого компьютера");App.render()}
  catch(e){App.toast(e.message)}finally{btn.disabled=false}};
ACT.rcvDraftOpen=(id,el)=>{const d=(App.ui.rcvDrafts||[]).find(x=>x.id===id);if(!d)return;
  if(R.lines.length&&R.draftId!==id&&!App.confirm2(el,"Заменить текущую приёмку? Нажмите ещё раз"))return;
  R=Object.assign(blank(),{wh:d.whTo||R.wh,supplierId:d.supplierId,invoice:d.invoice,note:d.note==="Приёмка"?"":d.note,extra:d.extraCost?String(d.extraCost):"",poId:d.poId||"",draftId:d.id,draftNum:d.num,def:R.def,
    pays:(d.payments||[]).map(p=>({acc:p.account_id,amt:String(p.amount)})),
    lines:d.lines.filter(l=>P(l.productId)).map(l=>({productId:l.productId,qty:l.qty||0,cost:l.cost?String(l.cost):"",price:l.salePrice!==""?String(l.salePrice):"",units:(l.newUnits||[]).map(u=>Object.assign({},u))}))});
  save();App.render();App.toast("Открыт черновик "+d.num)};
ACT.rcvDraftDel=async(id,el)=>{if(!App.confirm2(el,"Удалить черновик? Ещё раз"))return;
  try{await App.api.remove("stock_docs",id);if(R.draftId===id){R.draftId="";R.draftNum=""}save();loadDrafts(true);App.toast("Черновик удалён")}catch(e){App.toast(e.message)}};

ACT.rcvPost=async(_,btn)=>{
  if(!App.can("receive"))return App.toast("Нет права принимать товар");
  if(!R.wh)return App.toast("Выберите склад");
  for(const l of R.lines){const p=P(l.productId);if(p.trackSerial&&!(l.units||[]).length)return App.toast("Отсканируйте "+App.codeName(p)+" для «"+p.name+"»");if(!p.trackSerial&&num(l.qty)<1)return App.toast("Количество для «"+p.name+"»")}
  if(canPay()){if(R.pays.some(p=>num(p.amt)>0&&!p.acc))return App.toast("Выберите счёт для каждой оплаты");if(paidSum()>grand()+0.5)return App.toast("Оплата больше суммы прихода на "+money(paidSum()-grand()))}
  {const w=[];const noCost=App.can("cost")?R.lines.filter(l=>!(num(l.cost)>0)).length:0,noPrice=R.lines.filter(l=>!(num(l.price)||num(P(l.productId).price))&&!P(l.productId).trackSerial).length;
    if(noCost)w.push("без закупки: "+noCost);if(noPrice)w.push("без цены продажи: "+noPrice);
    if(App.can("cost")&&R.invTotal!==""&&R.invTotal!=null){const d=Math.round(goodsSum()-num(R.invTotal));if(Math.abs(d)>=1)w.push("не сходится с накладной на "+money(Math.abs(d)))}
    if(w.length&&!btn.dataset.sure){App.toast("Проверьте: "+w.join(", ")+". Нажмите ещё раз, чтобы провести как есть");App.confirm2(btn,"Провести как есть");return}}
  if(btn.disabled)return;btn.disabled=true;btn.textContent="Проводим…";
  let doc=null;const hadDraft=!!R.draftId;
  try{
    if(App.can("price"))for(const l of R.lines){const p=P(l.productId);if(l.price!==""&&l.price!=null&&num(l.price)!==num(p.price)&&(!p.trackSerial||isNewC(p.condition)))await App.api.update("products",p.id,{price:num(l.price)})}
    doc=await saveDoc(true);
    await App.api.rpc("post_doc",{p_doc:doc.id},["stock_docs","stock","stock_movements","products","audit_log","units","fin_ops","debts","fin_accounts"]);
    const codes=new Set(R.lines.flatMap(l=>(l.units||[]).map(u=>String(codeOf(u)).toLowerCase())));
    last={id:doc.id,num:doc.num,wh:R.wh,qty:R.lines.reduce((a,l)=>a+lineQty(l),0),total:grand(),paid:canPay()?paidSum():0,supplier:!!R.supplierId,productIds:R.lines.map(l=>l.productId),codes:[...codes],serial:R.lines.filter(l=>isSer(l)).reduce((a,l)=>a+lineQty(l),0)};
    R=Object.assign(blank(),{wh:R.wh,def:R.def});save();
    await App.reload(["products","units","docs","porders"]);loadDrafts(true);App.render();postDone();
  }catch(e){
    if(doc&&doc.created&&!hadDraft)try{await App.api.remove("stock_docs",doc.id)}catch(x){}
    else if(doc){R.draftId=doc.id;R.draftNum=doc.num;save()}
    btn.disabled=false;btn.textContent="Провести приёмку";App.toast(e.message||"Ошибка приёмки");
  }
};
/* после проведения: итог и печать этикеток только на принятое */
function postDone(){if(!last)return;const cost=App.can("cost"),debt=Math.max(0,Math.round((last.total-last.paid)*100)/100);
  App.openModal(App.head("Приёмка "+esc(last.num)+" проведена")+`<div class="tiles"><div class="tile"><span>Принято</span><b>${last.qty} шт</b><small>${esc(App.whName(last.wh))}</small></div>
    ${cost?`<div class="tile"><span>Приход</span><b>${money(last.total)}</b><small>с доставкой</small></div>`:""}
    ${cost&&last.supplier?`<div class="tile"><span>${debt>0?"Долг поставщику":"Оплачено"}</span><b>${money(debt>0?debt:last.paid)}</b><small>${debt>0&&last.paid?"оплачено "+money(last.paid):debt>0?"оплатить в «Финансах → Долги»":"полностью"}</small></div>`:""}</div>
    <p class="muted">Этикетки — на каждое принятое устройство (свой IMEI, параметры и цена) и по одной на остальные товары.</p>
    <div class="acts"><button class="btn" data-act="openDoc" data-id="${esc(last.id)}">Открыть документ</button><button class="btn" data-act="close">Закрыть</button><button class="btn pri" data-act="rcvTags">Печать этикеток</button></div>`)}
/* ---------- новый поставщик ---------- */
ACT.rcvSupNew=()=>{App.openModal(App.head("Новый поставщик")+`<div class="form">${App.fld("nsName","Название",App.inp("nsName"))}${App.fld("nsPhone","Телефон",App.inp("nsPhone","","tel"))}</div>
  <div class="acts"><button class="btn pri" data-act="rcvSupSave">Добавить</button></div>`)};
ACT.rcvSupSave=async(_,btn)=>{if(!App.val("nsName"))return App.toast("Укажите название");btn.disabled=true;
  try{const s=await App.api.insert("suppliers",{name:App.val("nsName"),phone:App.val("nsPhone")||null});await App.reload(["suppliers"]);R.supplierId=s.id;save();App.closeModal();App.render()}
  catch(e){btn.disabled=false;App.toast(e.message)}};

/* ---------- новый товар (аксессуар и т.п.) ---------- */
ACT.rcvNewItem=(barcode="",name="")=>{
  if(typeof barcode!=="string")barcode="";
  const cats=App.catOpts(false);
  App.openModal(App.head("Новый товар")+`<div class="form">
    ${App.fld("niName","Название",App.inp("niName",name,"text","Чехол MagSafe iPhone 16 Pro, прозрачный"),"full")}
    ${App.fld("niCat","Категория",`<select id="niCat">${cats.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join("")}<option value="__new">+ новая категория…</option></select>`)}
    ${App.fld("niCatNew","Новая категория",App.inp("niCatNew","","text","если выбрали «новая»"))}
    ${App.fld("niBar","Штрихкод",App.inp("niBar",barcode,"text","отсканируйте"))}${App.fld("niSku","Артикул",App.inp("niSku"))}
    ${App.can("cost")?App.fld("niCost","Закупка, ₽",App.inp("niCost","","number")):""}${App.can("price")||App.can("receive")?App.fld("niPrice","Цена продажи, ₽",App.inp("niPrice","","number")):""}
    ${App.fld("niQty","Количество",App.inp("niQty","1","number"))}${App.fld("niCond","Состояние",App.sel("niCond",App.CONDS,"Новый"))}
    <div class="fld full">${App.chk("niSer","Поштучный учёт (IMEI у телефонов, серийный номер у остальной техники)",false)}</div></div>
    <div class="acts"><button class="btn pri" data-act="rcvNewItemSave">Создать и добавить</button></div>`);
  if(!cats.length){const s=$("#niCat");if(s)s.value="__new"}
  setTimeout(()=>focus(name?"#niCost":"#niName"),0);
};
ACT.rcvNewItemSave=async(_,btn)=>{
  const V=App.val;if(!V("niName"))return App.toast("Укажите название");
  if(V("niBar")&&S.products.some(p=>p.barcode===V("niBar")))return App.toast("Такой штрихкод уже у другого товара");
  btn.disabled=true;const qty=Math.max(1,num(V("niQty"))),cost=num(V("niCost"))||"";
  try{
    let cat=V("niCat");
    if(cat==="__new"||!cat){if(!V("niCatNew")){btn.disabled=false;return App.toast("Название новой категории")}const c=await App.api.insert("categories",{name:V("niCatNew")});await App.reload(["categories"]);cat=c.id}
    const p=await App.api.insert("products",{name:V("niName"),category_id:cat,barcode:V("niBar")||null,sku:V("niSku")||null,condition:V("niCond"),
      price:App.can("price")||App.can("receive")?num(V("niPrice")):0,track_serial:App.checked("niSer"),on_site:false});
    await App.reload(["products"]);App.closeModal();
    const prod=P(p.id),i=ensureLine(prod);R.lines[i].cost=cost;if(!prod.trackSerial)R.lines[i].qty=qty;
    save();App.render();setTimeout(()=>focus(prod.trackSerial?`[data-rscan="${i}"]`:"#rcvQ"),0);App.toast("Товар создан");
  }catch(e){btn.disabled=false;App.toast(e.message)}
};

/* ---------- новое устройство Apple: модель → память → цвет → IMEI ---------- */
let DP=null;
ACT.rcvDevice=(code="")=>{
  if(typeof code!=="string")code="";
  if(!S.models.length)return App.toast("Каталог моделей пуст: «Настройки → Каталог Apple»");
  const prev=DP||{};
  DP={family:prev.family||"iPhone",modelId:prev.modelId||"",mem:prev.mem||"",color:prev.color||"",opts:prev.opts||{},cond:prev.cond||R.def.cond||"Новый",price:prev.price||"",cost:prev.cost||"",priceManual:!!prev.priceManual,battery:"",code,count:0,part:"",info:null,auto:false};
  if(!App.byId("models",DP.modelId))DP.modelId=(App.models(DP.family)[0]||{}).id||"";
  drawDP();
  if(code)dpIdentify(code);
};
App.rcvDevicePart=part=>{ACT.rcvDevice("");DP.part=App.normPart(part);drawDP();dpIdentify(DP.part)};
/* определить устройство по IMEI / артикулу и заполнить модель, память, цвет */
async function dpIdentify(code){
  const info=await App.deviceLookup(code);if(!DP||!document.getElementById("dpCode"))return;
  if(!info)return;
  const isPart=info.kind==="part",cur=isPart?DP.part:DP.code;if(App.normPart(cur)!==App.normPart(info.code)&&String(cur).trim().toUpperCase()!==info.code)return;
  DP.info=info;
  const mm=info.model&&App.byId("models",info.model.id);
  if(mm&&(!DP.count||isPart)){
    const changed=DP.modelId!==mm.id;
    DP.family=mm.family;DP.modelId=mm.id;if(changed){DP.mem="";DP.color="";DP.opts={}}
    const mem=App.devSure(info,"memory"),col=App.devSure(info,"color");
    if(mem&&mm.memories.includes(mem))DP.mem=mem;if(col&&(mm.colors.includes(col)||!mm.colors.length))DP.color=col;
    if(info.learned&&info.learned.stats&&info.learned.stats.opts)Object.entries(info.learned.stats.opts).forEach(([k,vals])=>{const e=Object.entries(vals).sort((a,b)=>b[1]-a[1]),tot=e.reduce((a,x)=>a+x[1],0),top=e[0];
      if(top&&(isPart||(top[1]>=3&&top[1]/tot>=.9))&&(mm.options||{})[k]&&mm.options[k].includes(top[0]))DP.opts[k]=top[0]});
    DP.auto=true}
  drawDP();
  /* модель распознана — сразу к закупке */
  const m2=dpModel();if(DP.auto&&m2&&(!m2.memories.length||DP.mem)&&(!m2.colors.length||DP.color)&&App.can("cost")&&!DP.cost)setTimeout(()=>{const e=$("#dpCost");if(e)e.focus()},0)}
function dpModel(){return App.byId("models",DP.modelId)}
function dpInfoHtml(){const i=DP&&DP.info;if(!i)return "";
  if(i.ref&&!/^apple$/i.test(i.ref.brand))return App.devHint(i)+`<p class="muted">Это не Apple. <button type="button" class="btn sm" data-act="dpOther">Создать товар «${esc(i.ref.brand+" "+i.ref.model)}»</button></p>`;
  const mm=i.model&&App.byId("models",i.model.id),cur=dpModel();
  return App.devHint(i)+(DP.count&&mm&&cur&&mm.id!==cur.id?`<p class="pill warn">Этот IMEI похож на ${esc(mm.name)}, а выбрана ${esc(cur.name)} — проверьте</p>`:"")}
ACT.dpOther=()=>{const i=DP&&DP.info;if(!i||!i.ref)return;const code=DP.code;App.closeModal();ACT.rcvNewItem("",i.ref.brand+" "+i.ref.model);App.toast(code?"Создайте товар, затем отсканируйте IMEI "+code+" ещё раз":"Создайте товар")};
function dpName(){const m=dpModel();return m?App.catalogName(m,DP.mem,DP.color,DP.opts):""}
function drawDP(){
  if(document.getElementById("dpu_body"))DP.ua=App.readUsed("dpu_").attrs;
  const m=dpModel(),name=dpName(),ex=S.products.find(p=>!p.archived&&p.name===name&&p.condition===DP.cond);
  const chips=(kind,vals,cur)=>vals.map(v=>`<button class="chip ${cur===v?"on":""}" data-act="dpSet" data-id="${esc(kind+"|"+v)}">${esc(v)}</button>`).join("");
  const html=App.head("Устройство Apple")+`
    <div class="chips">${App.FAMILIES.filter(f=>App.models(f).length).map(f=>`<button class="chip ${DP.family===f?"on":""}" data-act="dpFamily" data-id="${esc(f)}">${esc(f)}</button>`).join("")}</div>
    <div class="form">
      ${App.fld("dpModel","Модель",App.sel("dpModel",App.models(DP.family).map(x=>[x.id,x.name]),DP.modelId),"full")}
      ${m&&m.memories.length?`<div class="fld full"><label>Память</label><div class="chips">${chips("mem",m.memories,DP.mem)}</div></div>`:""}
      ${m&&m.colors.length?`<div class="fld full"><label>Цвет</label><div class="chips">${chips("color",m.colors,DP.color)}</div></div>`:m?App.fld("dpColorFree","Цвет",App.inp("dpColorFree",DP.color,"text","впишите цвет"),"full"):""}
      ${m?Object.entries(m.options||{}).map(([k,vals])=>`<div class="fld full"><label>${esc(k)}</label><div class="chips">${chips("opt:"+k,vals,DP.opts[k]||"")}</div></div>`).join(""):""}
      ${App.fld("dpCond","Состояние",App.sel("dpCond",App.CONDS,DP.cond))}
      ${App.fld("dpBatt","Ёмкость АКБ, %",App.inp("dpBatt",DP.battery,"number","для б/у",'min="0" max="100"'))}
      ${App.can("cost")?App.fld("dpCost","Закупка, ₽",App.inp("dpCost",DP.cost,"number")):""}
      ${App.can("price")||(!ex&&App.can("receive"))?App.fld("dpPrice",DP.cond==="Новый"?"Цена продажи, ₽":"Цена этого экземпляра, ₽",App.inp("dpPrice",DP.price,"number",ex?String(num(ex.price)):"")):""}
      ${DP.cond!=="Новый"?`<div class="fld full">${App.usedForm("dpu_",DP.ua||{})}</div>`:""}
      ${App.fld("dpCode",DP.family==="iPhone"?"IMEI":"Серийный номер",App.inp("dpCode",DP.code,"text","сканируйте или вставьте список",'autocomplete="off" class="mono"'))}
      ${App.fld("dpPart","Артикул с коробки",App.inp("dpPart",DP.part,"text","MTUV3ZD/A — необязательно",'autocomplete="off" class="mono"'))}
      <div class="full" id="dpInfo">${dpInfoHtml()}</div>
    </div>
    <div class="dpname">${name?`<b>${esc(name)}</b> · ${esc(DP.cond)} ${ex?'<span class="pill">товар уже есть</span>':'<span class="pill info">будет создан</span>'}`:'<span class="muted">Выберите модель, память и цвет</span>'}</div>
    ${DP.count?`<p class="muted">Добавлено в приёмку: ${DP.count}. Сканируйте следующий IMEI той же модели или меняйте параметры.</p>`:""}
    <div class="acts"><button class="btn" data-act="dpDone">Готово</button><button class="btn pri" data-act="dpAdd">Добавить</button></div>`;
  if($("#scrim").hidden)App.openModal(html,{wide:true});else{$("#modal").className="modal wide";$("#modal").innerHTML=html}
  const ms=$("#dpModel");if(ms)ms.onchange=()=>{DP.modelId=ms.value;DP.mem="";DP.color="";DP.opts={};drawDP()};
  const bind=(id,k,re)=>{const el=$("#"+id);if(el)el.oninput=()=>{DP[k]=el.value;if(re)drawDP()}};
  bind("dpBatt","battery");bind("dpCode","code");
  const dc=$("#dpCost"),dpr=$("#dpPrice");DP.ex=!!ex;
  if(dc){dc.oninput=()=>{DP.cost=dc.value;if(!DP.priceManual&&!DP.ex&&DP.cond==="Новый"&&dpr){const s=sugg(num(DP.cost));if(s){DP.price=String(s);dpr.value=DP.price}}};
    dc.onkeydown=e=>{if(e.key!=="Enter")return;e.preventDefault();if(String(DP.code||"").trim())ACT.dpAdd(null,$("[data-act=dpAdd]"));else{const c2=$("#dpCode");if(c2)c2.focus()}}}
  if(dpr)dpr.oninput=()=>{DP.price=dpr.value;DP.priceManual=!!dpr.value};
  const cs=$("#dpCond");if(cs)cs.onchange=()=>{DP.cond=cs.value;drawDP()};
  const cf=$("#dpColorFree");if(cf)cf.onchange=()=>{DP.color=cf.value.trim();drawDP()};
  const pt=$("#dpPart");if(pt){pt.oninput=()=>{DP.part=App.normPart(pt.value);if(App.isPartNo(DP.part))dpIdentify(DP.part)};pt.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();const c2=$("#dpCode");if(c2)c2.focus()}}}
  const c=$("#dpCode");if(c){let tm=0;c.addEventListener("input",()=>{DP.code=c.value;clearTimeout(tm);const v=c.value.trim();if(App.looksLikeDeviceCode(v))tm=setTimeout(()=>dpIdentify(v),250);else{DP.info=null;const b=$("#dpInfo");if(b)b.innerHTML=""}});
    c.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();DP.code=c.value;ACT.dpAdd(null,$("[data-act=dpAdd]"))}};
    /* вставка списка IMEI: все устройства этой модели, памяти и цвета добавляются разом */
    c.addEventListener("paste",async e=>{const t=(e.clipboardData||window.clipboardData).getData("text"),codes=splitCodes(t);if(codes.length<2)return;e.preventDefault();
      const m=dpModel();if(!m)return App.toast("Выберите модель");if(m.memories.length&&!DP.mem)return App.toast("Выберите память");if(!DP.color&&m.colors.length)return App.toast("Выберите цвет");
      const before=DP.count;for(const code of codes){DP.code=code;await ACT.dpAdd(null,null)}
      App.toast("Добавлено "+(DP.count-before)+" из "+codes.length+(DP.count-before<codes.length?" — остальные уже в приёмке или на складе":""))});
    setTimeout(()=>{const need=m&&((m.memories.length&&!DP.mem)||(m.colors.length&&!DP.color));if(!need)c.focus()},0)}
}
ACT.dpFamily=f=>{DP.family=f;DP.modelId=(App.models(f)[0]||{}).id||"";DP.mem="";DP.color="";DP.opts={};drawDP()};
ACT.dpSet=v=>{const [k,val]=v.split(/\|(.*)/s);if(k.startsWith("opt:")){const o=k.slice(4);DP.opts[o]=DP.opts[o]===val?"":val}else DP[k]=DP[k]===val?"":val;drawDP()};
ACT.dpDone=()=>{App.closeModal();App.render();setTimeout(()=>focus("#rcvQ"),0)};
ACT.dpAdd=async(_,btn)=>{
  const m=dpModel();if(!m)return App.toast("Выберите модель");
  if(m.memories.length&&!DP.mem)return App.toast("Выберите память");
  if(!DP.color&&m.colors.length)return App.toast("Выберите цвет");
  const code=String(DP.code||"").trim();if(!code)return App.toast("Отсканируйте IMEI или серийный номер");
  if(!App.battOk(DP.battery))return App.toast("Ёмкость АКБ — число от 0 до 100 %");
  if(btn&&btn.disabled)return;if(btn)btn.disabled=true;
  try{
    const name=dpName();let p=S.products.find(x=>!x.archived&&x.name===name&&x.condition===DP.cond);
    if(!p){
      const cat=DP.cond!=="Новый"?await App.usedCategory(m.family):await App.familyCategory(m.family);
      const row=await App.api.insert("products",{name,category_id:cat,brand:"Apple",model:m.name,memory:DP.mem||null,color:DP.color||null,condition:DP.cond,
        attrs:Object.fromEntries(Object.entries(DP.opts).filter(([k,v])=>v)),catalog_id:m.id,track_serial:true,price:DP.cond==="Новый"&&(App.can("price")||App.can("receive"))?num(DP.price):0});
      await App.reload(["products"]);p=P(row.id);
    }else if(!p.trackSerial){if(btn)btn.disabled=false;return App.toast("Товар «"+name+"» ведётся без IMEI — включите учёт по IMEI в карточке")}
    const extra={condition:DP.cond,battery_health:DP.battery||""};if(DP.part)extra.part_no=DP.part;
    if(DP.cond!=="Новый"&&document.getElementById("dpu_body")){const r=App.readUsed("dpu_");extra.attrs=r.attrs;if(r.kit)extra.kit=r.kit;const w=App.usedWarn(r.attrs);if(w)App.toast(w)}
    if(DP.cond!=="Новый"&&DP.price)extra.price=DP.price;
    if(!addUnit(p,code,extra)){if(btn)btn.disabled=false;return}
    const i=ensureLine(p);if(DP.cost)R.lines[i].cost=DP.cost;if(DP.cond==="Новый"&&DP.price)R.lines[i].price=DP.price;save();
    DP.count++;DP.code="";DP.info=null;DP.battery="";DP.ua={};if(DP.cond!=="Новый")DP.price="";
    drawDP();App.toast("Добавлено: "+code);
  }catch(e){if(btn)btn.disabled=false;App.toast(e.message)}
};
})();
