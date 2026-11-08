/* iCase CRM v3 · товары и складские документы (Supabase) */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;

/* ======================= ТОВАРЫ ======================= */
TITLES.stock="Товары";
Object.assign(App.ui,{stockQ:"",stockCat:"",stockWh:"",stockLow:false,stockArch:false,stockDead:false,stockZero:true});
function lastMove(p){let m="";S.movements.forEach(x=>{if(x.productId===p.id&&x.at>m)m=x.at});return m||p.createdAt}
App.isDead = p=>App.qtyTotal(p)>0&&App.days(lastMove(p))>App.settings().deadDays;
VIEWS.stock={
  actions:()=>(App.can("stock")?'<button class="btn" data-act="catalogNew">Из каталога Apple</button>':"")+`<button class="btn" data-act="tagsFromPick">${App.ui.tagPick.size?"Ценники ("+App.ui.tagPick.size+")":"Ценники"}</button>`+(App.can("io")?'<button class="btn" data-act="exportDlg" data-id="products">Экспорт</button><button class="btn" data-act="importDlg">Импорт</button>':"")+(App.can("stock")?'<button class="btn pri" data-act="newProduct">+ Товар</button>':""),
  render(){
    const u=App.ui,q=u.stockQ.trim().toLowerCase(),words=q?q.split(/\s+/):[];
    const whs=App.whs(),showCost=App.can("cost");
    const qty=p=>u.stockWh?App.qtyIn(p,u.stockWh):App.qtyTotal(p);
    let list=S.products.filter(p=>(u.stockArch?p.archived:!p.archived)&&App.inCat(p,u.stockCat)&&(!u.stockLow||App.isLow(p))&&(!u.stockDead||App.isDead(p))&&(u.stockZero||qty(p)>0)
      &&words.every(w=>[p.name,p.sku,p.barcode,p.serial,p.brand,App.catName(p)].join(" ").toLowerCase().includes(w)));
    list.sort((a,b)=>App.catName(a).localeCompare(App.catName(b))||String(a.name).localeCompare(b.name));
    const totCost=list.reduce((a,p)=>a+num(p.cost)*Math.max(0,qty(p)),0),totPrice=list.reduce((a,p)=>a+num(p.price)*Math.max(0,qty(p)),0),totQty=list.reduce((a,p)=>a+qty(p),0);
    const roots=App.catChildren("");
    const shown=list.slice(0,u.stockLimit||200);App.ui.stockShown=shown.map(p=>p.id);
    return `<div class="row-f">
      <input id="stockQ" type="search" placeholder="Название, артикул, штрихкод, IMEI" value="${esc(u.stockQ)}" data-filter="stockQ" aria-label="Поиск товара" style="flex:1 1 260px">
      ${App.sel("stockWh",[["","Все склады"],...App.whOpts()],u.stockWh,'data-filter-sel="stockWh" aria-label="Склад"')}
      ${App.sel("stockCat",[["","Все категории"],...App.catOpts(false)],u.stockCat,'data-filter-sel="stockCat" aria-label="Категория"')}
    </div>
    <div class="chips">
      ${App.chk("fLow","Ниже минимума",u.stockLow).replace('id="fLow"','id="fLow" data-filter-sel="stockLow"')}
      ${App.chk("fDead","Без движения "+App.settings().deadDays+" дн.",u.stockDead).replace('id="fDead"','id="fDead" data-filter-sel="stockDead"')}
      ${App.chk("fZero","Показывать нулевые",u.stockZero).replace('id="fZero"','id="fZero" data-filter-sel="stockZero"')}
      ${App.chk("fArch","Архив",u.stockArch).replace('id="fArch"','id="fArch" data-filter-sel="stockArch"')}
    </div>
    <div class="tiles"><div class="tile"><span>Позиций</span><b>${list.length}</b><small>${totQty} шт</small></div>${showCost?`<div class="tile"><span>В закупке</span><b>${money(totCost)}</b></div>`:""}<div class="tile"><span>В рознице</span><b>${money(totPrice)}</b></div>${showCost?`<div class="tile"><span>Потенциальная наценка</span><b>${money(totPrice-totCost)}</b></div>`:""}</div>
    <section class="card"><div class="tbl-wrap"><table><thead><tr><th class="tagsel"><input type="checkbox" data-act="tagPickAll" aria-label="Выбрать все для ценников" ${shown.length&&shown.every(p=>App.ui.tagPick.has(p.id))?"checked":""}></th><th>Товар</th>${u.stockWh?"<th class=\"n\">Остаток</th>":whs.map(w=>`<th class="n">${esc(w.name)}</th>`).join("")+'<th class="n">Всего</th>'}${showCost?'<th class="n">Закупка</th>':""}<th class="n">Цена</th>${showCost?'<th class="n">Наценка</th>':""}<th>Каналы</th></tr></thead><tbody>
    ${shown.map(p=>{const mk=num(p.price)-num(p.cost);return `<tr class="rowlink" data-act="openProduct" data-id="${esc(p.id)}">
      <td class="tagsel"><input type="checkbox" data-act="tagPick" data-id="${esc(p.id)}" aria-label="Ценник" ${App.ui.tagPick.has(p.id)?"checked":""}></td><td><b>${esc(p.name)}</b>${p.condition&&p.condition!=="Новый"?` <span class="pill">${esc(p.condition)}</span>`:""}<span class="sub">${esc(App.catName(p))}${p.sku?" · "+esc(p.sku):""}${p.serial?" · IMEI "+esc(p.serial):""}</span></td>
      ${u.stockWh?`<td class="n">${qtyCell(App.qtyIn(p,u.stockWh),p)}</td>`:whs.map(w=>`<td class="n">${App.qtyIn(p,w.id)||'<span class="muted">·</span>'}</td>`).join("")+`<td class="n">${qtyCell(App.qtyTotal(p),p)}</td>`}
      ${showCost?`<td class="n">${money(p.cost)}</td>`:""}<td class="n"><b>${money(p.price)}</b></td>
      ${showCost?`<td class="n">${mk<0?`<span class="pill bad">${money(mk)}</span>`:money(mk)}</td>`:""}
      <td><div class="chips">${p.onSite?'<span class="pill info">Сайт</span>':""}${p.onAvito?'<span class="pill info">Авито</span>':""}</div></td></tr>`}).join("")||`<tr><td colspan="10" class="empty">Ничего не найдено${roots.length?"":". Сначала создайте категории в настройках"}</td></tr>`}
    </tbody></table></div>${list.length>shown.length?`<div class="acts" style="justify-content:center;margin-top:10px"><button class="btn" data-act="moreStock">Показать ещё (${list.length-shown.length})</button></div>`:""}</section>`;
  }
};
function qtyCell(q,p){return App.isLow(p)?`<span class="pill bad">${q}</span>`:q<=0?'<span class="pill mute">0</span>':`<b>${q}</b>`}
ACT.moreStock=()=>{App.ui.stockLimit=(App.ui.stockLimit||200)+200;App.render()};

/* ---------- карточка товара ---------- */
ACT.newProduct=()=>productForm(null);
ACT.openProduct=id=>productForm(id);
ACT.unitAll=()=>{App.ui.unitAll=!App.ui.unitAll;if(App.ui.prodOpen)productForm(App.ui.prodOpen)};
function productForm(id){
  const p=id?App.byId("products",id):{condition:"Новый",onSite:true,onAvito:false,minQty:0,categoryId:(App.catChildren("")[0]||{}).id||""};
  if(!p)return;App.ui.prodOpen=id||"";
  const edit=App.can("stock"),price=App.can("price"),cost=App.can("cost"),st=App.settings();
  const moves=id?App.sortDesc(S.movements.filter(m=>m.productId===id),"at").slice(0,15):[];
  const units=id&&p.trackSerial?App.sortDesc(S.units.filter(u=>u.productId===id&&(App.ui.unitAll||u.status==="in_stock")),"createdAt"):[];
  const attrs=Object.entries(p.attrs||{}).filter(([k,v])=>v);
  App.openModal(App.head(id?esc(p.name):"Новый товар",id&&p.archived?'<span class="pill mute">архив</span>':"")+`
  ${id?`<div class="tiles">${App.whs().map(w=>`<div class="tile"><span>${esc(w.name)}</span><b>${App.qtyIn(p,w.id)}</b></div>`).join("")}<div class="tile"><span>Всего</span><b>${App.qtyTotal(p)}</b></div></div>`:""}
  <div class="form">
    ${App.fld("pName","Название",App.inp("pName",p.name,"text","iPhone 15 Pro 256 ГБ, натуральный титан",edit?"":"disabled"),"full")}
    ${App.fld("pCat","Категория",App.sel("pCat",App.catOpts(),p.categoryId||"",edit?"":"disabled"))}
    ${App.fld("pCond","Состояние",App.sel("pCond",App.CONDS,p.condition,edit?"":"disabled"))}
    ${App.fld("pModel","Модель",App.inp("pModel",p.model,"text","iPhone 15 Pro",edit?"":"disabled"))}
    ${App.fld("pMem","Память",App.inp("pMem",p.memory,"text","256 ГБ",edit?"":"disabled"))}
    ${App.fld("pColor","Цвет",App.inp("pColor",p.color,"text","натуральный титан",edit?"":"disabled"))}
    ${App.fld("pBrand","Бренд",App.inp("pBrand",p.brand,"text","Apple",edit?"":"disabled"))}
    ${App.fld("pSku","Артикул",App.inp("pSku",p.sku,"text","",edit?"":"disabled"))}
    ${App.fld("pBar","Штрихкод",App.inp("pBar",p.barcode,"text","отсканируйте",edit?"":"disabled"))}
    <div class="fld full">${App.chk("pTrack","Учёт по IMEI / серийным номерам — каждый экземпляр отдельно",p.trackSerial).replace("<input",edit?"<input":"<input disabled")}</div>
    ${p.trackSerial?"":App.fld("pSerial","IMEI / серийный (если товар один)",App.inp("pSerial",p.serial,"text","",edit?"":"disabled"))}
    ${attrs.length?`<div class="fld full"><label>Параметры</label><div class="chips">${attrs.map(([k,v])=>`<span class="pill">${esc(k)}: ${esc(v)}</span>`).join("")}</div></div>`:""}
    ${cost?App.fld("pCost","Закупка, ₽",App.inp("pCost",p.cost||"","number","",price?"":"disabled")):""}
    ${App.fld("pPrice","Цена продажи, ₽",App.inp("pPrice",p.price||"","number","",price?"":"disabled"))}
    <div class="fld full"><span class="hint" id="pMk"></span></div>
    ${App.fld("pMin","Минимальный остаток (всего)",App.inp("pMin",p.minQty||0,"number","",edit?"":"disabled"))}
    ${App.fld("pWarr","Гарантия, мес. (0 = по умолчанию)",App.inp("pWarr",p.warrantyMonths||"","number","",edit?"":"disabled"))}
    ${App.fld("pBatt","Ёмкость АКБ, %",App.inp("pBatt",p.batteryHealth==null?"":p.batteryHealth,"number","для б/у устройств",edit?"":"disabled"))}
    ${App.fld("pAvito","Цена на Авито, ₽",App.inp("pAvito",p.avitoPrice,"number","как розничная",price?"":"disabled"))}
    ${App.fld("pDiag","Результат диагностики",App.inp("pDiag",p.diagnostics,"text","Всё исправно, замен не было",edit?"":"disabled"),"full")}
    ${App.fld("pKit","Комплектация",App.inp("pKit",p.kit,"text","Коробка, кабель",edit?"":"disabled"),"full")}
    ${!id&&edit&&!p.trackSerial?App.fld("pQty","Начальный остаток (для товара без IMEI)",App.inp("pQty","","number","0"))+App.fld("pWh","На склад",App.sel("pWh",App.whs().map(w=>[w.id,w.name]),App.cashWh())):""}
    <div class="fld full"><label>Где продаём</label><div class="chips">${App.chk("pSite","Сайт",p.onSite)}${App.chk("pOnAvito","Авито",p.onAvito)}</div></div>
    ${App.fld("pNote","Описание / заметка",App.area("pNote",p.note||""),"full")}
  </div>
  ${id&&p.trackSerial?`<section><div class="card-h"><h3 class="sub-h">Экземпляры (${App.unitsOf(id).length} в наличии)</h3><label class="chk"><input type="checkbox" data-act="unitAll" ${App.ui.unitAll?"checked":""}> показать проданные и списанные</label></div>
    <div class="tbl-wrap"><table><thead><tr><th>IMEI / SN</th><th>Состояние</th><th class="n">АКБ</th><th class="n">Цена</th>${cost?'<th class="n">Закупка</th>':""}<th>Где</th></tr></thead><tbody>
    ${units.map(u=>`<tr class="rowlink" data-act="openUnit" data-id="${esc(u.id)}"><td><b>${esc(App.unitCode(u))}</b>${u.imei2?'<span class="sub">IMEI 2 '+esc(u.imei2)+"</span>":""}${u.imei&&u.serialNo?'<span class="sub">SN '+esc(u.serialNo)+"</span>":""}</td><td>${esc(u.condition||"")}</td>
      <td class="n">${u.batteryHealth!=null&&u.batteryHealth!==""?u.batteryHealth+"%":"—"}</td><td class="n">${money(App.unitPrice(u,p))}</td>${cost?`<td class="n">${money(u.cost)}</td>`:""}<td>${App.unitSt(u)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Нет экземпляров. Оформите приход и отсканируйте IMEI</td></tr>`}
    </tbody></table></div></section>`:""}
  ${id?`<section><h3 class="sub-h">Движение</h3><div class="tbl-wrap"><table><tbody>${moves.map(m=>`<tr><td>${App.dtt(m.at)}</td><td>${esc(App.MOVE[m.type]||m.type)}</td><td>${esc(App.whName(m.whId))}</td><td class="n"><span class="pill ${num(m.qty)>0?"ok":"mute"}">${num(m.qty)>0?"+":""}${num(m.qty)}</span></td><td>${esc(m.ref)}${m.note?'<span class="sub">'+esc(m.note)+"</span>":""}</td></tr>`).join("")||'<tr><td class="empty">Движений нет</td></tr>'}</tbody></table></div></section>`:""}
  <div class="acts">
    ${id&&App.can("del")?`<button class="btn danger" data-act="delProduct" data-id="${esc(id)}">${moves.length?(p.archived?"Вернуть из архива":"В архив"):"Удалить"}</button>`:""}
    ${id?`<button class="btn" data-act="tagOne" data-id="${esc(id)}">Ценник</button>`:""}
    ${id&&App.can("stock")?`<button class="btn" data-act="quickDoc" data-id="in|${esc(id)}">Приход</button><button class="btn" data-act="quickDoc" data-id="transfer|${esc(id)}">Переместить</button><button class="btn" data-act="quickDoc" data-id="writeoff|${esc(id)}">Списать</button>`:""}
    ${edit||price?`<button class="btn pri" data-act="saveProduct" data-id="${esc(id||"")}">Сохранить</button>`:""}
  </div>`,{wide:true});
  const mk=()=>{const h=$("#pMk");if(!h||!cost)return;const c=num(App.val("pCost")),pr=num(App.val("pPrice"));if(!c||!pr){h.textContent="";return}
    const d=pr-c;
    h.textContent="Наценка "+money(d)+" ("+Math.round(d/c*100)+"%)"+(d<0?" · ниже закупки":"");h.className="hint "+(d<0?"bad":"ok")};
  ["pCost","pPrice","pCat"].forEach(i=>{const el=document.getElementById(i);if(el)el.addEventListener("input",mk)});mk();
}
ACT.saveProduct=async(id,btn)=>{
  const V=App.val;if(!V("pName"))return App.toast("Укажите название");
  const old=id?App.byId("products",id):null;
  const n=v=>v===""?null:num(v);
  const data={name:V("pName"),category_id:V("pCat")||null,condition:V("pCond"),brand:V("pBrand")||null,sku:V("pSku")||null,barcode:V("pBar")||null,serial:V("pSerial")||null,
    track_serial:App.checked("pTrack"),price:num(V("pPrice")),min_qty:num(V("pMin")),warranty_months:num(V("pWarr")),battery_health:n(V("pBatt")),diagnostics:V("pDiag")||null,kit:V("pKit")||null,model:V("pModel")||null,memory:V("pMem")||null,color:V("pColor")||null,
    avito_price:n(V("pAvito")),on_site:App.checked("pSite"),on_avito:App.checked("pOnAvito"),description:V("pNote")||null};
  if(data.battery_health!=null&&(data.battery_health<0||data.battery_health>100))return App.toast("Ёмкость АКБ — от 0 до 100%");
  if(App.can("cost")&&document.getElementById("pCost"))data.cost=num(V("pCost"));
  if(old&&old.trackSerial&&!data.track_serial&&S.units.some(u=>u.productId===id))return App.toast("У товара есть экземпляры с IMEI — учёт по серийным номерам отключить нельзя");
  if(old&&!old.trackSerial&&data.track_serial&&App.qtyTotal(old)>0)return App.toast("Сначала спишите или продайте остаток без IMEI, потом включите учёт по серийным номерам");
  if(!document.getElementById("pSerial"))delete data.serial;
  if(!App.can("price")){delete data.price;delete data.avito_price}
  if(btn.disabled)return;btn.disabled=true;
  try{
    if(id){await App.api.update("products",id,data);App.closeModal();App.toast("Сохранено")}
    else{
      const p=await App.api.insert("products",data);const q=num(V("pQty"));
      if(q>0)await App.api.doc({type:"in",wh_to:V("pWh"),note:"Начальный остаток"},[{product_id:p.id,qty:q,cost:num(data.cost)}],true);
      await App.api.audit("Новый товар",data.name,"");
      App.closeModal();App.toast("Товар добавлен");
    }
  }catch(e){btn.disabled=false;App.toast(e.message)}
};
ACT.delProduct=async(id,el)=>{
  const p=App.byId("products",id),hasMoves=S.movements.some(m=>m.productId===id)||App.qtyTotal(p)>0;
  try{
    if(!hasMoves){if(!App.confirm2(el,"Удалить навсегда? Нажмите ещё раз"))return;
      try{await App.api.remove("products",id)}catch(e){await App.api.update("products",id,{is_archived:true});App.closeModal();return App.toast("У товара есть история, он отправлен в архив")}
      await App.api.audit("Удаление товара",p.name,"");App.closeModal();return App.toast("Товар удалён")}
    if(!p.archived&&App.qtyTotal(p)>0)return App.toast("В архив можно отправить только товар с нулевым остатком. Сначала спишите или переместите");
    await App.api.update("products",id,{is_archived:!p.archived});await App.api.audit(p.archived?"Из архива":"В архив",p.name,"");App.closeModal();App.toast(p.archived?"Товар возвращён":"Товар в архиве");
  }catch(e){App.toast(e.message)}
};

/* ======================= СКЛАДСКИЕ ДОКУМЕНТЫ ======================= */
TITLES.docs="Склад";
App.ui.docType="";App.ui.docQ="";App.ui.docStatus="";
VIEWS.docs={
  actions:()=>App.can("stock")?Object.entries(App.DOCT).map(([k,d])=>`<button class="btn ${k==="in"?"pri":""}" data-act="newDoc" data-id="${k}">+ ${d.one}</button>`).join(""):"",
  render(){
    const u=App.ui,q=u.docQ.toLowerCase();
    const list=App.sortDesc(S.docs.filter(d=>(!u.docType||d.type===u.docType)&&(!u.docStatus||d.status===u.docStatus)&&(!q||[d.num,d.note,(App.byId("suppliers",d.supplierId)||{}).name,(d.lines||[]).map(l=>l.name).join(" ")].join(" ").toLowerCase().includes(q))));
    const moves=App.sortDesc(S.movements,"at").slice(0,40);
    return `<div class="chips"><button class="chip ${!u.docType?"on":""}" data-act="docType" data-id="">Все<b>${S.docs.length}</b></button>${Object.entries(App.DOCT).map(([k,d])=>`<button class="chip ${u.docType===k?"on":""}" data-act="docType" data-id="${k}">${d.label}<b>${S.docs.filter(x=>x.type===k).length}</b></button>`).join("")}</div>
    <div class="row-f"><input id="docQ" type="search" placeholder="№, поставщик, товар" value="${esc(u.docQ)}" data-filter="docQ" aria-label="Поиск документа" style="flex:1 1 260px">${App.sel("docStatus",[["","Любой статус"],["draft","Черновики"],["posted","Проведённые"],["cancelled","Отменённые"]],u.docStatus,'data-filter-sel="docStatus" aria-label="Статус"')}</div>
    <section class="card"><div class="tbl-wrap"><table><thead><tr><th>Документ</th><th>Дата</th><th>Склад</th><th>Основание</th><th class="n">Строк</th><th class="n">Кол-во</th>${App.can("cost")?'<th class="n">Сумма</th>':""}<th>Статус</th></tr></thead><tbody>
    ${list.map(d=>{const D=App.DOCT[d.type];const qty=(d.lines||[]).reduce((a,l)=>a+num(d.type==="inventory"?(num(l.counted)-num(l.expected)):l.qty),0);
      const sum=(d.lines||[]).reduce((a,l)=>a+num(l.cost)*num(d.type==="inventory"?(num(l.counted)-num(l.expected)):l.qty),0);
      return `<tr class="rowlink" data-act="openDoc" data-id="${esc(d.id)}"><td><span class="pill ${D.cls}">${D.one}</span> <b>${esc(d.num)}</b></td><td>${App.dtt(d.createdAt)}<span class="sub">${esc(App.nameOf(d.by))}</span></td>
      <td>${d.type==="transfer"?esc(App.whName(d.whFrom))+" → "+esc(App.whName(d.whTo)):esc(App.whName(d.whTo||d.whFrom))}</td><td>${esc((App.byId("suppliers",d.supplierId)||{}).name||d.reason||d.note||"")}</td>
      <td class="n">${(d.lines||[]).length}</td><td class="n">${d.type==="inventory"?(qty>0?"+":"")+qty:qty}</td>${App.can("cost")?`<td class="n">${money(sum)}</td>`:""}<td>${statusDoc(d)}</td></tr>`}).join("")||'<tr><td colspan="8" class="empty">Документов нет. Начните с прихода товара</td></tr>'}
    </tbody></table></div></section>
    <section class="card"><div class="card-h"><h2>Последние движения</h2></div><div class="tbl-wrap"><table><thead><tr><th>Когда</th><th>Товар</th><th>Операция</th><th>Склад</th><th class="n">Кол-во</th><th>Основание</th><th>Кто</th></tr></thead><tbody>
    ${moves.map(m=>`<tr><td>${App.dtt(m.at)}</td><td>${esc(m.productName)}</td><td>${esc(App.MOVE[m.type]||m.type)}</td><td>${esc(App.whName(m.whId))}</td><td class="n"><span class="pill ${num(m.qty)>0?"ok":"mute"}">${num(m.qty)>0?"+":""}${num(m.qty)}</span></td><td>${esc(m.ref)}${m.note?'<span class="sub">'+esc(m.note)+"</span>":""}</td><td>${esc(App.nameOf(m.by))}</td></tr>`).join("")||'<tr><td colspan="7" class="empty">Движений нет</td></tr>'}
    </tbody></table></div></section>`;
  }
};
const statusDoc=d=>d.status==="posted"?'<span class="pill ok">проведён</span>':d.status==="cancelled"?'<span class="pill bad">отменён</span>':'<span class="pill mute">черновик</span>';
ACT.docType=k=>{App.ui.docType=k;App.render()};

/* ---------- редактор документа ---------- */
let D=null; // текущий черновик в окне
ACT.newDoc=(type,prefill)=>{
  if(!App.can("stock"))return App.toast("Нет права работать со складом");
  const wh=App.cashWh(),whs=App.whs();
  if(!wh)return App.toast("Сначала создайте склад в «Настройки → Точки и склады»");
  D={id:null,type,num:"(новый)",status:"draft",whFrom:type==="transfer"?((whs.find(w=>w.id!==wh)||{}).id||wh):wh,whTo:type==="transfer"?wh:wh,
    supplierId:"",reason:type==="writeoff"?App.WRITEOFF_REASONS[0]:"",note:"",lines:[],catId:""};
  if(type==="inventory")D.whTo=wh;
  if(prefill&&prefill.productId)D.lines.push(prefill);
  docEditor();
};
ACT.quickDoc=arg=>{const [type,pid]=arg.split("|"),p=App.byId("products",pid);App.closeModal();
  ACT.newDoc(type,{productId:pid,name:p.name,qty:p.trackSerial?0:1,cost:num(p.cost),newUnits:[],unitIds:[],foundCodes:[]});
  if(type!=="in"){const w=App.whs().find(w=>App.qtyIn(p,w.id)>0);if(w){D.whFrom=w.id;D.whTo=type==="transfer"?(App.whs().find(x=>x.id!==w.id)||w).id:w.id}docEditor()}};
ACT.openDoc=id=>{const d=App.byId("docs",id);if(!d)return;D=App.clean(d);docEditor()};
function docWh(){return D.type==="transfer"||D.type==="writeoff"||D.type==="supret"?D.whFrom:D.whTo}
function docEditor(){
  const T=App.DOCT[D.type],ro=D.status!=="draft",cost=App.can("cost"),inv=D.type==="inventory";
  const whSel=(id,label,v)=>App.fld(id,label,App.sel(id,App.whOpts(),v,(ro?"disabled ":"")+'data-d="'+(id==="dFrom"?"whFrom":"whTo")+'"'));
  let headF="";
  if(D.type==="in")headF=whSel("dTo","На склад",D.whTo)+App.fld("dSup","Поставщик",App.sel("dSup",[["","—"],...S.suppliers.map(s=>[s.id,s.name])],D.supplierId,(ro?"disabled ":"")+'data-d="supplierId"'))+App.fld("dInvNo","Накладная поставщика",App.inp("dInvNo",D.invoice||"","text","№ и дата",(ro?"disabled ":"")+'data-d="invoice"'));
  if(D.type==="transfer")headF=whSel("dFrom","Откуда",D.whFrom)+whSel("dTo","Куда",D.whTo);
  if(D.type==="writeoff")headF=whSel("dFrom","Со склада",D.whFrom)+App.fld("dReason","Причина",App.sel("dReason",App.WRITEOFF_REASONS,D.reason,(ro?"disabled ":"")+'data-d="reason"'));
  if(D.type==="supret")headF=whSel("dFrom","Со склада",D.whFrom)+App.fld("dSup","Поставщик",App.sel("dSup",[["","—"],...S.suppliers.map(s=>[s.id,s.name])],D.supplierId,(ro?"disabled ":"")+'data-d="supplierId"'));
  if(inv)headF=whSel("dTo","Склад",D.whTo)+App.fld("dCat","Категория (необязательно)",App.sel("dCat",[["","Все товары"],...App.catOpts(false)],D.catId||"",(ro?"disabled ":"")+'data-d="catId"'));
  const wh=docWh();
  let sumQ=0,sumC=0,plusC=0,minusC=0;
  const rows=D.lines.map((l,k)=>{const p=App.byId("products",l.productId);const have=p?App.qtyIn(p,wh):0;
    if(p&&p.trackSerial){const R=serialRow(l,k,p,{ro,cost,inv,wh});sumQ+=R.q;sumC+=R.c;if(R.c>0)plusC+=R.c;else minusC+=R.c;return R.html}
    if(inv){const diff=num(l.counted)-num(l.expected);sumQ+=diff;const c=diff*num(l.cost);if(c>0)plusC+=c;else minusC+=c;
      return `<tr class="${l.counted===""||l.counted==null?"":diff?"diffrow":""}"><td>${esc(l.name)}${p&&p.serial?'<span class="sub">IMEI '+esc(p.serial)+"</span>":""}</td><td class="n">${num(l.expected)}</td>
      <td class="n"><input type="number" min="0" id="lc${k}" data-line="${k}" data-lf="counted" value="${l.counted==null?"":esc(l.counted)}" placeholder="?" ${ro?"disabled":""} aria-label="Фактически"></td>
      <td class="n">${l.counted===""||l.counted==null?'<span class="muted">не посчитан</span>':diff?`<span class="pill ${diff>0?"ok":"bad"}">${diff>0?"+":""}${diff}</span>`:'<span class="pill">0</span>'}</td>${cost?`<td class="n">${money(diff*num(l.cost))}</td>`:""}</tr>`}
    sumQ+=num(l.qty);sumC+=num(l.qty)*num(l.cost);
    const short=!ro&&D.type!=="in"&&num(l.qty)>have;
    return `<tr><td>${esc(l.name)}${short?`<span class="sub bad">на складе только ${have}</span>`:""}</td>${D.type!=="in"?`<td class="n">${have}</td>`:""}
      <td class="n"><input type="number" min="1" id="lq${k}" data-line="${k}" data-lf="qty" value="${num(l.qty)}" ${ro?"disabled":""} aria-label="Количество"></td>
      ${cost?`<td class="n">${D.type==="in"?`<input type="number" min="0" id="lk${k}" data-line="${k}" data-lf="cost" value="${num(l.cost)}" ${ro?"disabled":""} aria-label="Закупка">`:money(l.cost)}</td><td class="n">${money(num(l.qty)*num(l.cost))}</td>`:""}
      <td class="n">${ro?"":`<button class="btn sm ghost danger" data-act="docDelLine" data-id="${k}" aria-label="Убрать">✕</button>`}</td></tr>`}).join("");
  const thead=inv?`<th>Товар</th><th class="n">По учёту</th><th class="n">Факт</th><th class="n">Разница</th>${cost?'<th class="n">Сумма</th>':""}`
    :`<th>Товар</th>${D.type!=="in"?'<th class="n">Есть</th>':""}<th class="n">Кол-во</th>${cost?`<th class="n">${D.type==="in"?"Закупка":"Себест."}</th><th class="n">Сумма</th>`:""}<th></th>`;
  const html=App.head(T.one+" "+esc(D.num),statusDoc(D))+`
    <div class="form">${headF}${App.fld("dNote","Комментарий",App.inp("dNote",D.note||"","text","",(ro?"disabled ":"")+'data-d="note"'),"full")}</div>
    ${!ro?`<div class="row-f">${inv?`<button class="btn" data-act="invFill">Заполнить по учёту</button><button class="btn" data-act="invZero">Непосчитанные = 0</button>`:""}<div class="fld grow"><label for="dQ">${inv?"Скан или поиск: +1 к факту":"Добавить товар (поиск или сканер)"}</label><input id="dQ" type="search" autocomplete="off" data-live="1" placeholder="Название, артикул, штрихкод, IMEI"><div class="pick" id="dPick" hidden></div></div></div>`:""}
    <div class="tbl-wrap"><table class="cart"><thead><tr>${thead}</tr></thead><tbody>${rows||`<tr><td colspan="6" class="empty">${inv?"Нажмите «Заполнить по учёту» или сканируйте товары":"Добавьте строки"}</td></tr>`}</tbody></table></div>
    <div class="sumlines">${inv?`<span>Строк</span><span>${D.lines.length}</span><span>Излишки</span><span>${cost?money(plusC):""}</span><span>Недостача</span><span>${cost?money(minusC):""}</span><span>Итог в шт.</span><span>${sumQ>0?"+":""}${sumQ}</span>`:`<span>Всего, шт.</span><span>${sumQ}</span>${cost?`<span>Сумма</span><span>${money(sumC)}</span>`:""}`}</div>
    ${D.postedAt?`<p class="muted">Проведён ${App.dtt(D.postedAt)}${D.cancelledAt?" · отменён "+App.dtt(D.cancelledAt):""}</p>`:""}
    <div class="acts">
      ${D.id&&D.status==="draft"?`<button class="btn danger" data-act="docDelete">Удалить черновик</button>`:""}
      ${D.status==="posted"&&App.can("docCancel")?`<button class="btn danger" data-act="docCancel">Отменить проведение</button>`:""}
      ${!ro?`<button class="btn" data-act="docSave">Сохранить черновик</button>${App.can("docPost")?`<button class="btn pri" data-act="docPost">Провести</button>`:""}`:""}
    </div>`;
  if($("#scrim").hidden){App.openModal(html,{wide:true})}
  else{const m=$("#modal"),f=document.activeElement&&document.activeElement.id,sc=m.parentElement.scrollTop;m.className="modal wide";m.innerHTML=html;App.modalRefresh=null;
    if(f){const el=document.getElementById(f);if(el)el.focus()}m.parentElement.scrollTop=sc}
  bindDoc();
}
function bindDoc(){
  document.querySelectorAll("#modal [data-d]").forEach(el=>el.addEventListener("change",()=>{D[el.dataset.d]=el.value;if(["whFrom","whTo","catId"].includes(el.dataset.d)){if(D.type==="inventory"&&D.lines.length&&el.dataset.d!=="catId"){D.lines=[];App.toast("Склад изменён: строки очищены")}docEditor()}}));
  document.querySelectorAll("#modal [data-d]").forEach(el=>{if(el.tagName==="INPUT")el.addEventListener("input",()=>D[el.dataset.d]=el.value)});
  document.querySelectorAll("#modal [data-line]").forEach(el=>el.addEventListener("change",()=>{const l=D.lines[+el.dataset.line];l[el.dataset.lf]=el.dataset.lf==="counted"&&el.value===""?"":num(el.value);docEditor()}));
  document.querySelectorAll("#modal [data-uscan]").forEach(el=>el.addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();const v=el.value;el.value="";
    if(lineScan(+el.dataset.uscan,v)){docEditor();setTimeout(()=>{const x=document.querySelector(`#modal [data-uscan="${el.dataset.uscan}"]`);if(x)x.focus()},0)}}));
  document.querySelectorAll("#modal [data-unf]").forEach(el=>el.addEventListener("change",()=>{const [k,j,f]=el.dataset.unf.split("|");const u=D.lines[+k].newUnits[+j];if(u)u[f]=el.value}));
  document.querySelectorAll("#modal [data-upick]").forEach(el=>el.addEventListener("change",()=>{const [k,id]=el.dataset.upick.split("|");const l=D.lines[+k];
    l.unitIds=el.checked?[...new Set([...(l.unitIds||[]),id])]:(l.unitIds||[]).filter(x=>x!==id);docEditor()}));
  if(D.status==="draft")App.productPicker("dQ","dPick",{wh:docWh,inStock:false,showCost:App.can("cost"),onPick:(p,u)=>{
    if(p.trackSerial){pickSerial(p,u);return}
    const ex=D.lines.find(l=>l.productId===p.id);
    if(D.type==="inventory"){if(ex)ex.counted=num(ex.counted)+1;else D.lines.push({productId:p.id,name:p.name,expected:App.qtyIn(p,D.whTo),counted:1,cost:num(p.cost)})}
    else if(ex)ex.qty=num(ex.qty)+1;else D.lines.push({productId:p.id,name:p.name,qty:1,cost:num(p.cost)});
    docEditor();setTimeout(()=>{const q=document.getElementById("dQ");if(q)q.focus()},0)}});
}
ACT.docDelLine=k=>{D.lines.splice(+k,1);docEditor()};
ACT.docUnitDel=v=>{const [k,j]=v.split("|").map(Number),l=D.lines[k];if(!l)return;if(D.type==="in")l.newUnits.splice(j,1);else if(D.type==="inventory")l.foundCodes.splice(j,1);docEditor()};

/* ---------- строки с серийным учётом ---------- */
function serialRow(l,k,p,{ro,cost,inv,wh}){
  l.newUnits=l.newUnits||[];l.unitIds=l.unitIds||[];l.foundCodes=l.foundCodes||[];
  const scan=ro?"":`<input class="uscan" data-uscan="${k}" placeholder="Сканируйте IMEI / SN и нажмите Enter" autocomplete="off" aria-label="IMEI или серийный номер">`;
  const tag='<span class="pill info">IMEI</span> ';
  if(inv){
    const inWh=App.unitsOf(p.id,{wh:D.whTo}),found=l.foundCodes,exp=ro?num(l.expected):inWh.length,cnt=found.length,diff=cnt-exp,c=diff*num(l.cost);
    const missing=ro?[]:inWh.filter(u=>!found.some(x=>[u.imei,u.imei2,u.serialNo].some(y=>y&&y.toLowerCase()===String(x).toLowerCase())));
    return {q:diff,c,html:`<tr class="${diff?"diffrow":""}"><td>${tag}${esc(l.name)}</td><td class="n">${exp}</td><td class="n"><b>${cnt}</b></td>
      <td class="n">${diff?`<span class="pill ${diff>0?"ok":"bad"}">${diff>0?"+":""}${diff}</span>`:'<span class="pill">0</span>'}</td>${cost?`<td class="n">${money(c)}</td>`:""}</tr>
      <tr class="subrow"><td colspan="${cost?5:4}">${scan}<div class="chips">${found.map((x,j)=>`<span class="pill ok">${esc(x)}${ro?"":` <button class="x" data-act="docUnitDel" data-id="${k}|${j}" aria-label="Убрать">✕</button>`}</span>`).join("")}</div>
      ${missing.length?`<div class="sub bad" style="margin-top:4px">Не найдены (будут списаны как недостача): ${missing.map(u=>esc(App.unitCode(u))).join(", ")}</div>`:""}</td></tr>`};
  }
  if(D.type==="in"){
    const n=l.newUnits.length,c=n*num(l.cost);
    return {q:n,c,html:`<tr><td>${tag}${esc(l.name)}</td><td class="n"><b>${n}</b></td>
      ${cost?`<td class="n"><input type="number" min="0" id="lk${k}" data-line="${k}" data-lf="cost" value="${num(l.cost)}" ${ro?"disabled":""} aria-label="Закупка"></td><td class="n">${money(c)}</td>`:""}
      <td class="n">${ro?"":`<button class="btn sm ghost danger" data-act="docDelLine" data-id="${k}" aria-label="Убрать">✕</button>`}</td></tr>
      <tr class="subrow"><td colspan="${cost?5:3}">${scan}
      ${n?`<table class="units"><thead><tr><th>IMEI / SN</th><th>Состояние</th><th>АКБ, %</th>${App.can("price")?"<th>Цена экз., ₽</th>":""}<th></th></tr></thead><tbody>
      ${l.newUnits.map((u,j)=>`<tr><td><b>${esc(u.imei||u.serial_no)}</b>${u.warn?`<span class="sub warn">${esc(u.warn)}</span>`:""}</td>
        <td>${ro?esc(u.condition||""):`<select data-unf="${k}|${j}|condition" aria-label="Состояние">${App.CONDS.map(x=>`<option${(u.condition||p.condition)===x?" selected":""}>${x}</option>`).join("")}</select>`}</td>
        <td><input type="number" min="0" max="100" value="${esc(u.battery_health||"")}" data-unf="${k}|${j}|battery_health" ${ro?"disabled":""} aria-label="АКБ" style="width:70px"></td>
        ${App.can("price")?`<td><input type="number" min="0" value="${esc(u.price||"")}" data-unf="${k}|${j}|price" ${ro?"disabled":""} placeholder="${num(p.price)}" aria-label="Цена экземпляра" style="width:100px"></td>`:""}
        <td class="n">${ro?"":`<button class="btn sm ghost" data-act="docUnitDel" data-id="${k}|${j}" aria-label="Убрать">✕</button>`}</td></tr>`).join("")}</tbody></table>`:'<div class="muted">Отсканируйте каждый экземпляр — количество посчитается само</div>'}</td></tr>`};
  }
  // перемещение, списание, возврат поставщику
  const avail=ro?[]:App.unitsOf(p.id,{wh:D.whFrom}),sel=l.unitIds,n=sel.length,c=n*num(l.cost);
  const shown=ro?sel.map(id=>App.byId("units",id)).filter(Boolean):avail.concat(sel.map(id=>App.byId("units",id)).filter(u=>u&&!avail.includes(u)));
  return {q:n,c,html:`<tr><td>${tag}${esc(l.name)}</td><td class="n">${ro?"":avail.length}</td><td class="n"><b>${n}</b></td>
    ${cost?`<td class="n">${money(l.cost)}</td><td class="n">${money(c)}</td>`:""}<td class="n">${ro?"":`<button class="btn sm ghost danger" data-act="docDelLine" data-id="${k}" aria-label="Убрать">✕</button>`}</td></tr>
    <tr class="subrow"><td colspan="${cost?6:4}">${scan}<div class="chips">${shown.map(u=>{const bad=!ro&&!avail.includes(u);
      return `<label class="chk ${bad?"bad":""}"><input type="checkbox" data-upick="${k}|${esc(u.id)}" ${sel.includes(u.id)?"checked":""} ${ro?"disabled":""}> ${esc(App.unitLabel(u))}${bad?" — нет на складе":""}</label>`}).join("")||'<span class="muted">Нет экземпляров на складе «'+esc(App.whName(D.whFrom))+'»</span>'}</div></td></tr>`};
}
function lineScan(k,raw){
  const l=D.lines[k],p=l&&App.byId("products",l.productId);if(!p)return false;
  const pc=App.parseCode(raw);if(!pc)return false;const code=pc.imei||pc.serial_no;
  const u=App.findUnit(code);
  if(D.type==="in"){
    if(D.lines.some(x=>(x.newUnits||[]).some(n=>(n.imei||n.serial_no)===code))){App.toast("Этот код уже есть в документе");return false}
    if(u&&["in_stock","reserved","in_repair"].includes(u.status)){App.toast("IMEI/SN "+code+" уже числится на складе: «"+(App.byId("products",u.productId)||{}).name+"»");return false}
    if(u)App.toast("Этот экземпляр уже был в базе ("+(App.UNIT_ST[u.status]||[u.status])[0].toLowerCase()+") — вернётся на склад");
    else if(pc.warn)App.toast(pc.warn);
    l.newUnits.push({imei:pc.imei||"",serial_no:pc.serial_no||"",condition:p.condition,battery_health:"",price:"",warn:pc.warn||""});return true;
  }
  if(D.type==="inventory"){
    if(l.foundCodes.some(x=>x.toLowerCase()===code.toLowerCase())){App.toast("Уже отсканирован");return false}
    if(!u){App.toast("IMEI/SN "+code+" не числится в базе — оформите приход");return false}
    if(u.productId!==p.id){App.toast("Это «"+(App.byId("products",u.productId)||{}).name+"»");return false}
    if(u.status!=="in_stock"){App.toast("Числится как «"+(App.UNIT_ST[u.status]||[u.status])[0]+"»");return false}
    l.foundCodes.push(App.unitCode(u));return true;
  }
  if(!u){App.toast("IMEI/SN "+code+" не найден");return false}
  if(u.productId!==p.id){App.toast("Это «"+(App.byId("products",u.productId)||{}).name+"»");return false}
  if(u.status!=="in_stock"||u.whId!==D.whFrom){App.toast("Этого экземпляра нет на складе «"+App.whName(D.whFrom)+"»");return false}
  if(!l.unitIds.includes(u.id))l.unitIds.push(u.id);return true;
}
function pickSerial(p,u){
  let k=D.lines.findIndex(l=>l.productId===p.id);
  if(k<0){D.lines.push({productId:p.id,name:p.name,qty:0,cost:num(p.cost),expected:D.type==="inventory"?App.unitsOf(p.id,{wh:D.whTo}).length:0,counted:"",newUnits:[],unitIds:[],foundCodes:[]});k=D.lines.length-1}
  if(u)lineScan(k,App.unitCode(u));
  docEditor();setTimeout(()=>{const x=document.querySelector(`#modal [data-uscan="${k}"]`);if(x&&!u)x.focus();else{const q=document.getElementById("dQ");if(q)q.focus()}},0);
}
ACT.invFill=()=>{
  const ex=new Set(D.lines.map(l=>l.productId));
  S.products.filter(p=>!p.archived&&App.inCat(p,D.catId)&&(App.qtyIn(p,D.whTo)!==0)&&!ex.has(p.id)).sort((a,b)=>String(a.name).localeCompare(b.name))
    .forEach(p=>D.lines.push({productId:p.id,name:p.name,expected:App.qtyIn(p,D.whTo),counted:"",cost:num(p.cost),foundCodes:[],newUnits:[],unitIds:[]}));
  D.lines.forEach(l=>{const p=App.byId("products",l.productId);if(p)l.expected=p.trackSerial?App.unitsOf(p.id,{wh:D.whTo}).length:App.qtyIn(p,D.whTo)});
  docEditor();
};
ACT.invZero=()=>{D.lines.forEach(l=>{const p=App.byId("products",l.productId);if(!(p&&p.trackSerial)&&(l.counted===""||l.counted==null))l.counted=0});docEditor()};
function docHead(){return{type:D.type,wh_from:D.whFrom||null,wh_to:D.whTo||null,supplier_id:D.supplierId||null,invoice:D.invoice||null,reason:D.reason||null,category_id:D.catId||null,note:D.note||null}}
function docLines(){return D.lines.map(l=>{const p=App.byId("products",l.productId),ser=!!(p&&p.trackSerial);
  const extra={new_units:ser&&D.type==="in"?(l.newUnits||[]).map(cleanUnit):[],unit_ids:ser?(l.unitIds||[]):[],found_codes:ser&&D.type==="inventory"?(l.foundCodes||[]):[]};
  if(D.type==="inventory")return Object.assign({product_id:l.productId,expected:num(l.expected),counted:ser?(l.foundCodes||[]).length:(l.counted===""||l.counted==null?null:num(l.counted)),cost:num(l.cost)},extra);
  return Object.assign({product_id:l.productId,qty:ser?(D.type==="in"?(l.newUnits||[]).length:(l.unitIds||[]).length):num(l.qty),cost:num(l.cost)},extra)})}
const cleanUnit=u=>{const o={};["imei","imei2","serial_no","condition","battery_health","price","kit","diagnostics"].forEach(k=>{if(u[k]!==""&&u[k]!=null)o[k]=String(u[k]).trim()});return o};
async function persistDraft(){
  if(!D.id){const d=await App.api.doc(docHead(),docLines(),false);D.id=d.id;D.num=d.num;return}
  await App.api.update("stock_docs",D.id,docHead());
  await App.api.remove("stock_doc_lines",D.id,"doc_id");
  await App.api.insertMany("stock_doc_lines",docLines().map(l=>Object.assign({doc_id:D.id},l)));
}
function docCheck(){
  if(!D.lines.length)return "Добавьте хотя бы одну строку";
  if(D.type==="transfer"&&D.whFrom===D.whTo)return "Склады отправления и назначения совпадают";
  for(const l of D.lines){const p=App.byId("products",l.productId);if(!p||!p.trackSerial)continue;
    if(D.type==="in"&&!(l.newUnits||[]).length)return "Отсканируйте IMEI / SN для «"+p.name+"»";
    if(["transfer","writeoff","supret"].includes(D.type)&&!(l.unitIds||[]).length)return "Отметьте экземпляры (IMEI / SN) для «"+p.name+"»"}
  if(D.type!=="inventory"&&D.lines.some(l=>{const p=App.byId("products",l.productId);return !(p&&p.trackSerial)&&num(l.qty)<=0}))return "Количество должно быть больше нуля";
  return "";
}
ACT.docSave=async(_,btn)=>{
  const e=docCheck();if(e)return App.toast(e);if(btn.disabled)return;btn.disabled=true;
  try{await persistDraft();App.toast("Черновик "+D.num+" сохранён");App.closeModal()}catch(x){btn.disabled=false;App.toast(x.message)}
};
ACT.docPost=async(_,btn)=>{
  const e=docCheck();if(e)return App.toast(e);
  if(D.type==="inventory"&&D.lines.some(l=>{const p=App.byId("products",l.productId);return !(p&&p.trackSerial)&&(l.counted===""||l.counted==null)}))return App.toast("Не все строки посчитаны. Введите факт или нажмите «Непосчитанные = 0»");
  if(btn.disabled)return;btn.disabled=true;
  try{
    await persistDraft();
    await App.api.rpc("post_doc",{p_doc:D.id},["stock_docs","stock","stock_movements","products","audit_log","units"]);
    App.toast("Документ "+D.num+" проведён");App.closeModal();
  }catch(x){btn.disabled=false;App.toast(x.message+(D.id?". Документ сохранён как черновик":""))}
};
ACT.docCancel=async(_,el)=>{
  if(!App.confirm2(el,"Откатить все движения? Нажмите ещё раз"))return;
  try{await App.api.rpc("cancel_doc",{p_doc:D.id},["stock_docs","stock","stock_movements","products","audit_log","units"]);App.toast("Проведение отменено");App.closeModal()}
  catch(x){App.toast("Нельзя отменить: "+x.message+". Часть товара уже продана или перемещена")}
};
ACT.docDelete=async(_,el)=>{if(!App.confirm2(el,"Удалить черновик? Нажмите ещё раз"))return;try{await App.api.remove("stock_docs",D.id);App.closeModal();App.toast("Черновик удалён")}catch(x){App.toast(x.message)}};
})();
