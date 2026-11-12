/* iCase CRM v3 · Приёмка товара: сканер, быстрое создание товаров и устройств, IMEI, цены, ценники */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.receive="Приёмка";
const LS=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||"null");localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};
/* склады для приёмки: продавец — только склады своей точки */
function rcvWhOpts(){const all=App.whOpts();if(App.can("stock"))return all;const pt=(App.point()||{}).id;const mine=new Set(S.warehouses.filter(w=>w.pointId===pt).map(w=>w.id));return all.filter(o=>mine.has(o[0]))}
const blank=()=>({wh:"",supplierId:"",invoice:"",note:"",payAcc:"",poId:"",lines:[]});
let R=LS("icase_recv")||blank();
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
        ${App.can("finance")&&R.supplierId?App.fld("rcvPay","Оплата поставщику",App.sel("rcvPay",[["","В долг — оплачу позже"],...S.finaccounts.filter(a=>a.active).map(a=>[a.id,"Оплачено сразу: "+a.name])],R.payAcc||"",'data-rh="payAcc"')):""}
        ${App.fld("rcvNote","Комментарий",App.inp("rcvNote",R.note,"text","",'data-rh="note"'))}
      </div>
      ${!App.can("stock")?'<p class="muted">Закупочные цены подставятся из карточек товаров — управляющий проверит их по задаче. Новые товары могут потребовать подтверждения.</p>':""}
      <div class="scanbar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>
        <input id="rcvQ" type="search" autocomplete="off" placeholder="Штрихкод или IMEI" aria-label="Сканер или поиск товара"><div class="pick" id="rcvPick" hidden></div></div>
      <p class="muted hintline">Новый IMEI → выберите модель, и устройство создастся само. Новый штрихкод → откроется карточка нового товара.</p>
      <div class="rlines">${R.lines.map((l,i)=>lineHtml(l,i,{cost,price})).join("")||`<div class="empty big">Пока пусто. Отсканируйте первый товар или нажмите «+ Устройство Apple»</div>`}</div>
    </section>
    <aside class="card rsum">
      <h2>Итого</h2>
      <div class="sumlines"><span>Позиций</span><span>${R.lines.length}</span><span>Штук</span><span id="rcvTq">${tq}</span>${cost?`<span>Закупка</span><span id="rcvTc">${money(tc)}</span>`:""}</div>
      <button class="btn pri big" data-act="rcvPost" ${R.lines.length?"":"disabled"}>Провести приёмку</button>
      <button class="btn" data-act="rcvClear" ${R.lines.length?"":"disabled"}>Очистить</button>
      <p class="muted">Черновик хранится в этом браузере, пока вы не проведёте приёмку.</p>
      ${last?`<div class="donebox"><b>Приёмка ${esc(last.num)} проведена</b><span>${last.qty} шт · ${esc(App.whName(last.wh))}</span>
        <button class="btn" data-act="rcvTags">Ценники на принятое</button><button class="btn ghost" data-act="openDoc" data-id="${esc(last.id)}">Открыть документ</button></div>`:""}
    </aside></div>`;
  },
  after(){bind()}
};

function lineHtml(l,i,{cost,price}){
  const p=P(l.productId),ser=p.trackSerial,q=lineQty(l);
  const prices=`${cost?`<label class="mini">Закупка, ₽<input type="number" min="0" value="${num(l.cost)||""}" data-rl="${i}|cost" placeholder="0"></label>`:""}
    ${price?`<label class="mini">Цена продажи, ₽<input type="number" min="0" value="${num(l.price)||""}" data-rl="${i}|price" placeholder="${num(p.price)||0}"></label>`:""}`;
  return `<div class="rline">
    <div class="rhead"><div><b>${esc(p.name)}</b><span class="sub">${esc([App.catName(p),p.condition,p.barcode?"ШК "+p.barcode:"",p.sku?"арт. "+p.sku:""].filter(Boolean).join(" · "))}</span></div>
      <div class="rq">${ser?`<span class="pill info">${App.codeLbl(p)}</span> <b>${q}</b> шт`:`<button class="btn sm" data-act="rcvQty" data-id="${i}|-1" aria-label="Меньше">−</button><input type="number" min="1" value="${q}" data-rl="${i}|qty" aria-label="Количество"><button class="btn sm" data-act="rcvQty" data-id="${i}|1" aria-label="Больше">+</button>`}</div>
      <div class="rprices">${prices}</div>
      <button class="btn sm ghost danger" data-act="rcvDel" data-id="${i}" aria-label="Убрать">✕</button></div>
    ${ser?`<div class="runits"><input class="uscan" data-rscan="${i}" placeholder="Сканируйте ${App.codeName(p)} и Enter" autocomplete="off" aria-label="${App.codeName(p)}">
      ${(l.units||[]).length?`<table class="units"><thead><tr><th>${App.codeLbl(p)}</th><th>Состояние</th><th>АКБ, %</th>${price?"<th>Цена экз., ₽</th>":""}<th></th></tr></thead><tbody>
      ${l.units.map((u,j)=>`<tr><td><b>${esc(codeOf(u))}</b>${u.warn?`<span class="sub warn">${esc(u.warn)}</span>`:""}${u.condition&&u.condition!=="Новый"||u.attrs?`<div class="chips usum">${App.usedChips(u.attrs)}<button class="btn sm" data-act="rcvUsed" data-id="${i}|${j}">Параметры б/у</button></div>`:""}</td>
        <td><select data-ru="${i}|${j}|condition" aria-label="Состояние">${App.CONDS.map(c=>`<option${(u.condition||p.condition)===c?" selected":""}>${c}</option>`).join("")}</select></td>
        <td><input type="number" min="0" max="100" value="${esc(u.battery_health||"")}" data-ru="${i}|${j}|battery_health" aria-label="АКБ" style="width:70px"></td>
        ${price?`<td><input type="number" min="0" value="${esc(u.price||"")}" data-ru="${i}|${j}|price" placeholder="${num(l.price)||num(p.price)||""}" aria-label="Цена экземпляра" style="width:100px"></td>`:""}
        <td><button class="btn sm ghost" data-act="rcvUnitDel" data-id="${i}|${j}" aria-label="Убрать">✕</button></td></tr>`).join("")}</tbody></table>`:'<span class="muted">Отсканируйте каждое устройство</span>'}</div>`:""}
  </div>`;
}

/* ---------- добавление ---------- */
function ensureLine(p){let i=R.lines.findIndex(l=>l.productId===p.id);
  if(i<0){R.lines.unshift({productId:p.id,qty:0,cost:num(p.cost)||"",price:"",units:[]});i=0}return i}
function addProduct(p,{focusScan=true}={}){
  const i=ensureLine(p);if(!p.trackSerial)R.lines[i].qty=num(R.lines[i].qty)+1;
  save();App.render();setTimeout(()=>focus(p.trackSerial&&focusScan?`[data-rscan="${i}"]`:"#rcvQ"),0);
}
function addUnit(p,code,extra={}){
  const pc=App.parseCode(code,App.isPhone(p));if(!pc)return false;const c=pc.imei||pc.serial_no;
  if(allCodes().some(x=>x.toLowerCase()===c.toLowerCase())){App.toast(App.codeLbl(p)+" "+c+" уже есть в приёмке");return false}
  const u=App.findUnit(c);
  if(u&&["in_stock","reserved","in_repair"].includes(u.status)){App.toast(App.codeLbl(p)+" "+c+" уже на складе «"+App.whName(u.whId)+"»");return false}
  if(u)App.toast("Это устройство уже было в базе — вернётся на склад");else if(pc.warn)App.toast(pc.warn);
  const i=ensureLine(p);R.lines[i].units.push(Object.assign({imei:pc.imei||"",serial_no:pc.serial_no||"",condition:p.condition,battery_health:"",price:"",warn:pc.warn||""},extra));
  save();return true;
}
function focus(sel){const el=document.querySelector(sel);if(el)el.focus()}
function handleCode(raw){
  const v=String(raw||"").trim();if(!v)return;
  const u=App.findUnit(v);
  if(u){const p=P(u.productId);if(p&&addUnit(p,v)){App.render();setTimeout(()=>focus("#rcvQ"),0)}return}
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
  document.querySelectorAll("[data-rscan]").forEach(el=>el.addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();
    const i=+el.dataset.rscan,p=P(R.lines[i].productId),v=el.value;el.value="";if(addUnit(p,v)){App.render();setTimeout(()=>focus(`[data-rscan="${ensureLine(p)}"]`),0)}}));
  if(!document.activeElement||document.activeElement===document.body)q.focus();
}
document.addEventListener("input",e=>{const t=e.target;
  if(t.dataset.rh){R[t.dataset.rh]=t.value;save();return}
  if(t.dataset.rl){const [i,f]=t.dataset.rl.split("|");const l=R.lines[+i];if(!l)return;l[f]=f==="qty"?Math.max(1,num(t.value)):t.value;save();totals();return}
  if(t.dataset.ru){const [i,j,f]=t.dataset.ru.split("|");const u=(R.lines[+i]||{}).units&&R.lines[+i].units[+j];if(u){u[f]=t.value;save()}}
});
document.addEventListener("change",e=>{const t=e.target;if(t.dataset.rh||t.dataset.ru)t.dispatchEvent(new Event("input",{bubbles:true}));if(t.dataset.rh==="supplierId"&&App.can("finance"))App.render()});
function totals(){const a=$("#rcvTq"),b=$("#rcvTc");if(a)a.textContent=R.lines.reduce((x,l)=>x+lineQty(l),0);if(b)b.textContent=money(R.lines.reduce((x,l)=>x+lineQty(l)*num(l.cost),0))}
ACT.rcvQty=v=>{const [i,d]=v.split("|").map(Number),l=R.lines[i];if(!l)return;l.qty=Math.max(1,num(l.qty)+d);save();App.render()};
ACT.rcvDel=i=>{R.lines.splice(+i,1);save();App.render()};
ACT.rcvUsed=v=>{const [i,j]=v.split("|").map(Number),u=R.lines[i]&&R.lines[i].units[j];if(!u)return;
  App.usedModal({title:"Параметры б/у · "+codeOf(u),attrs:u.attrs||{},battery:u.battery_health,onSave:r=>{u.attrs=r.attrs;if(r.kit)u.kit=r.kit;if(r.battery!=null)u.battery_health=r.battery;save();App.render()}})};
ACT.rcvUnitDel=v=>{const [i,j]=v.split("|").map(Number);R.lines[i].units.splice(j,1);save();App.render()};
ACT.rcvClear=(_,el)=>{if(!App.confirm2(el,"Очистить список? Ещё раз"))return;R=Object.assign(blank(),{wh:R.wh,supplierId:R.supplierId});save();App.render()};
ACT.rcvTags=()=>{if(!last)return;App.tagsAdd(last.productIds);App.ui.printTab="tags";location.hash="print"};

ACT.rcvPost=async(_,btn)=>{
  if(!App.can("receive"))return App.toast("Нет права принимать товар");
  if(!R.wh)return App.toast("Выберите склад");
  for(const l of R.lines){const p=P(l.productId);if(p.trackSerial&&!(l.units||[]).length)return App.toast("Отсканируйте "+App.codeName(p)+" для «"+p.name+"»");if(!p.trackSerial&&num(l.qty)<1)return App.toast("Количество для «"+p.name+"»")}
  if(btn.disabled)return;btn.disabled=true;btn.textContent="Проводим…";
  let doc=null;
  try{
    if(App.can("price"))for(const l of R.lines){const p=P(l.productId);if(l.price!==""&&l.price!=null&&num(l.price)!==num(p.price))await App.api.update("products",p.id,{price:num(l.price)})}
    const clean=u=>{const o={};["imei","serial_no","condition","battery_health","price","kit","part_no"].forEach(k=>{if(u[k]!==""&&u[k]!=null)o[k]=String(u[k]).trim()});if(u.attrs&&Object.keys(u.attrs).length)o.attrs=u.attrs;return o};
    const lines=R.lines.map(l=>{const p=P(l.productId);return {product_id:p.id,qty:lineQty(l),cost:num(l.cost),new_units:p.trackSerial?l.units.map(clean):[]}});
    doc=await App.api.insert("stock_docs",{type:"in",wh_to:R.wh,supplier_id:R.supplierId||null,invoice:R.invoice||null,note:R.note||"Приёмка",pay_account:R.supplierId&&R.payAcc?R.payAcc:null,po_id:R.poId||null});
    await App.api.insertMany("stock_doc_lines",lines.map(l=>Object.assign({doc_id:doc.id},l)));
    await App.api.rpc("post_doc",{p_doc:doc.id},["stock_docs","stock","stock_movements","products","audit_log","units"]);
    last={id:doc.id,num:doc.num,wh:R.wh,qty:lines.reduce((a,l)=>a+l.qty,0),productIds:R.lines.map(l=>l.productId)};
    R=Object.assign(blank(),{wh:R.wh});save();
    await App.reload(["products","units","docs","porders"]);App.toast("Приёмка "+doc.num+" проведена");App.render();
  }catch(e){
    if(doc)try{await App.api.remove("stock_docs",doc.id)}catch(x){}
    btn.disabled=false;btn.textContent="Провести приёмку";App.toast(e.message||"Ошибка приёмки");
  }
};

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
  DP={family:prev.family||"iPhone",modelId:prev.modelId||"",mem:prev.mem||"",color:prev.color||"",opts:prev.opts||{},cond:prev.cond||"Новый",price:prev.price||"",cost:prev.cost||"",battery:"",code,count:0,part:"",info:null,auto:false};
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
  drawDP()}
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
      ${App.fld("dpBatt","Ёмкость АКБ, %",App.inp("dpBatt",DP.battery,"number","для б/у"))}
      ${App.can("cost")?App.fld("dpCost","Закупка, ₽",App.inp("dpCost",DP.cost,"number")):""}
      ${App.can("price")||(!ex&&App.can("receive"))?App.fld("dpPrice",DP.cond==="Новый"?"Цена продажи, ₽":"Цена этого экземпляра, ₽",App.inp("dpPrice",DP.price,"number",ex?String(num(ex.price)):"")):""}
      ${DP.cond!=="Новый"?`<div class="fld full">${App.usedForm("dpu_",DP.ua||{})}</div>`:""}
      ${App.fld("dpCode",DP.family==="iPhone"?"IMEI":"Серийный номер",App.inp("dpCode",DP.code,"text","сканируйте",'autocomplete="off" class="mono"'))}
      ${App.fld("dpPart","Артикул с коробки",App.inp("dpPart",DP.part,"text","MTUV3ZD/A — необязательно",'autocomplete="off" class="mono"'))}
      <div class="full" id="dpInfo">${dpInfoHtml()}</div>
    </div>
    <div class="dpname">${name?`<b>${esc(name)}</b> · ${esc(DP.cond)} ${ex?'<span class="pill">товар уже есть</span>':'<span class="pill info">будет создан</span>'}`:'<span class="muted">Выберите модель, память и цвет</span>'}</div>
    ${DP.count?`<p class="muted">Добавлено в приёмку: ${DP.count}. Сканируйте следующий IMEI той же модели или меняйте параметры.</p>`:""}
    <div class="acts"><button class="btn" data-act="dpDone">Готово</button><button class="btn pri" data-act="dpAdd">Добавить</button></div>`;
  if($("#scrim").hidden)App.openModal(html,{wide:true});else{$("#modal").className="modal wide";$("#modal").innerHTML=html}
  const ms=$("#dpModel");if(ms)ms.onchange=()=>{DP.modelId=ms.value;DP.mem="";DP.color="";DP.opts={};drawDP()};
  const bind=(id,k,re)=>{const el=$("#"+id);if(el)el.oninput=()=>{DP[k]=el.value;if(re)drawDP()}};
  bind("dpBatt","battery");bind("dpCost","cost");bind("dpPrice","price");bind("dpCode","code");
  const cs=$("#dpCond");if(cs)cs.onchange=()=>{DP.cond=cs.value;drawDP()};
  const cf=$("#dpColorFree");if(cf)cf.onchange=()=>{DP.color=cf.value.trim();drawDP()};
  const pt=$("#dpPart");if(pt){pt.oninput=()=>{DP.part=App.normPart(pt.value);if(App.isPartNo(DP.part))dpIdentify(DP.part)};pt.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();const c2=$("#dpCode");if(c2)c2.focus()}}}
  const c=$("#dpCode");if(c){let tm=0;c.addEventListener("input",()=>{DP.code=c.value;clearTimeout(tm);const v=c.value.trim();if(App.looksLikeDeviceCode(v))tm=setTimeout(()=>dpIdentify(v),250);else{DP.info=null;const b=$("#dpInfo");if(b)b.innerHTML=""}});
    c.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();DP.code=c.value;ACT.dpAdd(null,$("[data-act=dpAdd]"))}};
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
