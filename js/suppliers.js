/* iCase CRM v3 · поставщики: прайсы, поиск по всем прайсам, сравнение цен, привязка к товарам */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.suppliers="Поставщики";
Object.assign(App.ui,{spQ:"",spSup:"",spSort:"price"});
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const norm=s=>String(s||"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/g," ").trim();
const supName=id=>(App.byId("suppliers",id)||{}).name||"—";
/* ключ для сравнения одинаковых позиций у разных поставщиков: привязанный товар CRM, иначе артикул, иначе название */
const offerKey=o=>o.productId?"p:"+o.productId:o.sku?"s:"+norm(o.sku):"n:"+norm(o.name);
App.offersFor=p=>{if(!p)return[];const sk=[p.sku,p.barcode].filter(Boolean).map(norm),nm=norm(p.name);
  return S.sprices.filter(o=>o.productId===p.id||(o.sku&&sk.includes(norm(o.sku)))||(!o.productId&&norm(o.name)===nm)).sort((a,b)=>a.price-b.price)};

VIEWS.suppliers={
  ownSearch:true,
  actions:()=>App.can("stock")?'<button class="btn" data-act="supForm">+ Поставщик</button><button class="btn pri" data-act="spImport">Загрузить прайс</button>':"",
  render(){
    const u=App.ui,words=norm(u.spQ).split(" ").filter(Boolean);
    const sups=S.suppliers.slice().sort((a,b)=>String(a.name).localeCompare(b.name));
    const cnt=id=>S.sprices.filter(o=>o.supplierId===id).length;
    let list=S.sprices.filter(o=>(!u.spSup||o.supplierId===u.spSup)&&(!words.length||words.every(w=>o._s.includes(w))));
    const best={};list.forEach(o=>{const k=offerKey(o);if(o.price>0&&(!best[k]||o.price<best[k]))best[k]=o.price});
    const multi={};list.forEach(o=>{const k=offerKey(o);multi[k]=(multi[k]||0)+1});
    list.sort(u.spSort==="name"?(a,b)=>String(a.name).localeCompare(b.name):u.spSort==="supplier"?(a,b)=>supName(a.supplierId).localeCompare(supName(b.supplierId))||a.price-b.price:(a,b)=>(a.price||1e12)-(b.price||1e12));
    const shown=list.slice(0,300),cur=u.spSup?App.byId("suppliers",u.spSup):null;
    return `<div class="cfilt"><input id="spQ" type="search" placeholder="Поиск по всем прайсам: модель, память, цвет, артикул" value="${esc(u.spQ)}" data-filter="spQ" aria-label="Поиск по прайсам">
      ${App.sel("spSup",[["","Все поставщики ("+S.sprices.length+")"],...sups.map(s=>[s.id,s.name+" ("+cnt(s.id)+")"])],u.spSup,'data-filter-sel="spSup" aria-label="Поставщик"')}
      ${App.sel("spSort",[["price","Сначала дешевле"],["name","По названию"],["supplier","По поставщику"]],u.spSort,'data-filter-sel="spSort" aria-label="Сортировка"')}</div>
    ${cur?`<div class="supbar"><span><b>${esc(cur.name)}</b>${[cur.contact,cur.phone].filter(Boolean).length?" · "+esc([cur.contact,cur.phone].filter(Boolean).join(" · ")):""} · ${cnt(cur.id)} позиций${cur.priceUpdatedAt?" · прайс от "+App.dt(cur.priceUpdatedAt):" · прайса нет"}${cur.note?" · "+esc(cur.note):""}</span>
      ${App.can("stock")?`<span class="row-f"><button class="btn sm" data-act="spImport" data-id="${esc(cur.id)}">Загрузить прайс</button><button class="btn sm ghost" data-act="supForm" data-id="${esc(cur.id)}">Изменить</button></span>`:""}</div>`:""}
    <section class="card crow-list">${shown.length?`<div class="sphead"><span>Товар · поставщик</span><span>Закупка</span></div>`:""}${shown.map(o=>{const k=offerKey(o),p=o.productId?App.byId("products",o.productId):null,isBest=multi[k]>1&&o.price>0&&o.price===best[k];
        return `<button type="button" class="crow sprow" data-act="spOpen" data-id="${o.id}">
          <span class="cnm"><b>${esc(o.name)}${isBest?' <span class="pill ok">лучшая цена</span>':""}${multi[k]>1&&!isBest?` <span class="pill mute">есть дешевле на ${money(o.price-best[k])}</span>`:""}</b>
          <small><span class="spsup">${esc(supName(o.supplierId))}</span>${o.sku?" · арт. "+esc(o.sku):""}${o.brand?" · "+esc(o.brand):""}${o.stock?" · "+esc(o.stock):""}</small>
          ${p?`<small class="ok">в CRM: розница ${money(p.price)}${num(p.price)&&o.price?" · наценка "+money(num(p.price)-o.price):""} · у нас ${App.qtyTotal(p)} шт</small>`:""}</span>
          <span class="csum">${o.price?money(o.price):"—"}</span></button>`}).join("")||`<div class="empty">${S.sprices.length?"Ничего не найдено. Попробуйте короче: «15 pro 256» или артикул.":S.suppliers.length?"Прайсов пока нет — нажмите «Загрузить прайс».":"Поставщиков пока нет — добавьте первого и загрузите его прайс."}</div>`}
      ${list.length>shown.length?`<div class="empty">Показаны первые ${shown.length} из ${list.length}. Уточните поиск или выберите поставщика.</div>`:""}</section>`;
  }
};

/* карточка предложения: сравнение у всех поставщиков, привязка к товару, приход */
ACT.spOpen=id=>{
  const draw=()=>{
    const o=S.sprices.find(x=>String(x.id)===String(id));if(!o)return App.closeModal();
    const p=o.productId?App.byId("products",o.productId):null,k=offerKey(o);
    const same=(p?App.offersFor(p):S.sprices.filter(x=>offerKey(x)===k)).slice().sort((a,b)=>(a.price||1e12)-(b.price||1e12));
    App.redrawModal(App.head(esc(o.name),`<span class="pill info">${esc(supName(o.supplierId))}</span>`)+`
      <div class="tiles"><div class="tile"><span>Цена поставщика</span><b>${money(o.price)}</b><small>${esc(o.stock||"наличие не указано")}</small></div>
        ${p?`<div class="tile"><span>В CRM сейчас</span><b class="mid">закупка ${money(p.cost)}</b><small>розница ${money(p.price)}${num(p.price)&&o.price?" · наценка "+money(num(p.price)-o.price):""}</small></div>`:""}
        <div class="tile"><span>Остаток у нас</span><b>${p?App.qtyTotal(p):"—"}</b><small>${p?"шт":"товар не привязан"}</small></div></div>
      ${o.sku||o.brand||o.note?`<p class="muted">${[o.sku?"Артикул: "+esc(o.sku):"",o.brand?"Бренд: "+esc(o.brand):"",o.note?esc(o.note):""].filter(Boolean).join(" · ")}</p>`:""}
      <h3 class="sub-h">${same.length>1?"Цены у поставщиков":"Других предложений не найдено"}</h3>
      ${same.length>1?`<div class="whlist">${same.map((x,i)=>`<div class="whr"><span class="whr-main" style="cursor:default"><b>${esc(supName(x.supplierId))}${i===0&&x.price?' <span class="pill ok">дешевле всех</span>':""}</b><small>${esc(x.name)}${x.stock?" · "+esc(x.stock):""}</small></span><span class="whr-q">${x.price?money(x.price):"—"}</span><span class="whr-p">${i&&same[0].price&&x.price?"+"+money(x.price-same[0].price):""}</span></div>`).join("")}</div>`:""}
      ${App.can("stock")?`<div class="fld" style="margin-top:12px"><label for="spPQ">${p?"Привязан к товару CRM — сменить":"Привязать к товару CRM"}</label><input id="spPQ" type="search" autocomplete="off" placeholder="Название, артикул, штрихкод"><div class="pick" id="spPick" hidden></div></div>`:""}
      <div class="acts">${p?`<button class="btn" data-act="openProduct" data-id="${esc(p.id)}">Карточка товара</button>`:""}${p&&App.can("stock")?`<button class="btn ghost" data-act="spUnlink" data-id="${o.id}">Отвязать</button><button class="btn pri" data-act="spIn" data-id="${o.id}">Оформить приход по этой цене</button>`:""}<button class="btn" data-act="close">Закрыть</button></div>`);
    if(document.getElementById("spPQ"))App.productPicker("spPQ","spPick",{inStock:false,showCost:true,onPick:async pr=>{try{await App.api.update("supplier_prices",o.id,{productId:pr.id});App.toast("Привязано к «"+pr.name+"»")}catch(e){App.toast(e.message)}}});
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
ACT.spUnlink=(id,btn)=>run(btn,async()=>{await App.api.update("supplier_prices",+id,{productId:null});App.toast("Отвязано")});
ACT.spIn=id=>{const o=S.sprices.find(x=>String(x.id)===String(id));const p=o&&App.byId("products",o.productId);if(!p)return;
  App.closeModal();ACT.newDoc("in",{productId:p.id,name:p.name,qty:p.trackSerial?0:1,cost:o.price,newUnits:[],unitIds:[],foundCodes:[]});
  App.docSet&&App.docSet(d=>{d.supplierId=o.supplierId})};

/* ======================= загрузка прайса ======================= */
const SPF=[["name","Название",["наименование","название","товар","модель","name","title","номенклатура"]],["sku","Артикул / код",["артикул","код","sku","штрихкод","part","арт"]],
  ["brand","Бренд",["бренд","производитель","brand","марка"]],["price","Цена",["цена","опт","price","стоимость","руб"]],["stock","Наличие",["наличие","остаток","кол-во","количество","stock","склад"]],
  ["note","Примечание",["примечание","комментарий","описание","цвет","note"]]];
let IMP=null;
function loadXLSX(){return new Promise((ok,bad)=>{if(window.XLSX)return ok(window.XLSX);const s=document.createElement("script");s.src="js/vendor/xlsx.full.min.js";s.onload=()=>ok(window.XLSX);s.onerror=()=>bad(new Error("Не удалось загрузить модуль Excel"));document.head.appendChild(s)})}
ACT.spImport=sid=>{
  if(!App.can("stock"))return App.toast("Загружать прайсы может кладовщик, управляющий или владелец");
  if(!S.suppliers.length){App.toast("Сначала добавьте поставщика");return ACT.supForm()}
  IMP={sid:sid||App.ui.spSup||S.suppliers[0].id,rows:null};
  App.openModal(App.head("Загрузить прайс поставщика")+`
    <div class="form">${App.fld("spS","Поставщик",App.sel("spS",S.suppliers.map(s=>[s.id,s.name]),IMP.sid),"full")}</div>
    <p class="muted">Файл Excel (.xlsx, .xls) или CSV — первая строка с названиями колонок. Или скопируйте строки прямо из таблицы и вставьте ниже.</p>
    <input type="file" id="spFile" accept=".xlsx,.xls,.csv,.txt">
    <textarea id="spPaste" rows="4" placeholder="…или вставьте сюда строки из Excel / Google Таблиц (Ctrl+V)" style="width:100%;margin-top:8px"></textarea>
    <div id="spMap"></div>`,{wide:true});
  $("#spFile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;
    try{let rows;
      if(/\.(xlsx|xls)$/i.test(f.name)){const X=await loadXLSX();const wb=X.read(await f.arrayBuffer(),{type:"array"});
        rows=X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:""}).map(r=>r.map(c=>String(c)));}
      else{let text=await f.text();if(text.includes("�")){try{text=new TextDecoder("windows-1251").decode(await f.arrayBuffer())}catch(_){}}rows=App.parseCSV(text)}
      spMap(rows)}catch(err){App.toast(err.message)}});
  $("#spPaste").addEventListener("input",e=>{const t=e.target.value;if(t.trim())spMap(App.parseCSV(t))});
};
function spMap(rows){
  rows=(rows||[]).filter(r=>r.some(c=>String(c).trim()));
  // строка заголовков — первая, где есть хотя бы 2 непустые ячейки и нет «чистых» цен
  let hi=rows.findIndex(r=>r.filter(c=>String(c).trim()).length>=2&&r.some(c=>SPF.some(f=>f[2].some(a=>String(c).toLowerCase().includes(a)))));
  if(hi<0)hi=0;
  const head=rows[hi]||[],H=head.map(h=>String(h).toLowerCase().trim());
  const guess=f=>{for(const a of f[2]){const i=H.indexOf(a);if(i>=0)return i}for(const a of f[2]){const i=H.findIndex(h=>h.includes(a)&&!(f[0]==="name"&&/код|артикул/.test(h)));if(i>=0)return i}return -1};
  IMP.rows=rows.slice(hi+1);IMP.head=head;
  if(!IMP.rows.length){$("#spMap").innerHTML='<p class="bad">В файле нет строк с данными</p>';return}
  $("#spMap").innerHTML=`<h3 class="sub-h">Колонки · строк: ${IMP.rows.length}</h3><div class="form">${SPF.map(f=>App.fld("sp_"+f[0],f[1],App.sel("sp_"+f[0],[["-1","— нет —"],...head.map((h,i)=>[String(i),String(h||"Колонка "+(i+1))])],String(guess(f))))).join("")}
    ${App.fld("spMode","Как загрузить",App.sel("spMode",[["replace","Заменить весь прайс этого поставщика"],["append","Добавить к текущему прайсу"]],"replace"))}</div>
    <div class="tbl-wrap"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${IMP.rows.slice(0,5).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="acts"><button class="btn pri" data-act="spLoad">Загрузить ${IMP.rows.length} строк</button></div>`;
}
ACT.spLoad=async(_,btn)=>{
  if(!IMP||!IMP.rows||btn.disabled)return;
  const col={};SPF.forEach(f=>col[f[0]]=+App.val("sp_"+f[0]));
  if(col.name<0||col.price<0)return App.toast("Укажите колонки «Название» и «Цена»");
  const sid=App.val("spS"),mode=App.val("spMode");
  const g=(r,k)=>col[k]>=0?String(r[col[k]]??"").trim():"";
  const rows=IMP.rows.map(r=>({name:g(r,"name"),sku:g(r,"sku"),brand:g(r,"brand"),price:g(r,"price"),stock:g(r,"stock"),note:g(r,"note")})).filter(r=>r.name&&/\d/.test(r.price));
  if(!rows.length)return App.toast("Не нашлось строк с названием и ценой");
  btn.disabled=true;btn.textContent="Загружаем…";
  try{let n=0;for(let i=0;i<rows.length;i+=2000){n+=await App.api.rpc("supplier_price_load",{p_supplier:sid,p_rows:rows.slice(i,i+2000),p_mode:i===0?mode:"append"})}
    await App.reload(["sprices","suppliers"]);App.closeModal();App.ui.spSup=sid;App.ui.spQ="";App.render();
    App.toast("Загружено позиций: "+n+(rows.length<IMP.rows.length?" · пропущено строк без цены: "+(IMP.rows.length-rows.length):""));
    await App.api.audit("Прайс поставщика",supName(sid),String(n));
  }catch(e){App.toast(e.message);btn.disabled=false;btn.textContent="Загрузить"}
};
})();
