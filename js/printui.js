/* iCase CRM v3 · раздел «Печать»: ценники, конфигуратор ценников, редактор товарного чека */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.print="Печать";
const LS=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||"null");localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};
Object.assign(App.ui,{tagSel:null,tagGuide:[],printTab:"tags",tagQ:"",tagTpl:LS("icase_tagtpl")||"dev70",tagQueue:LS("icase_tagq")||[],tagPick:new Set(),tagEdit:null,docEdit:null,docPrev:"a4"});
const saveQueue=()=>LS("icase_tagq",App.ui.tagQueue);
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const canTpl=()=>App.can("price")||App.can("settings");

const TABS=()=>[["tags","Ценники",true],["tagtpl","Шаблоны ценников",canTpl()],["receipt","Товарный чек",App.can("settings")]].filter(t=>t[2]);
VIEWS.print={
  ownSearch:true,
  render(){
    if(!TABS().some(t=>t[0]===App.ui.printTab))App.ui.printTab="tags";
    const t=App.ui.printTab;
    return `<div class="tabs">${TABS().map(([k,l])=>`<button class="tab ${t===k?"on":""}" data-act="printTab" data-id="${k}">${l}</button>`).join("")}</div>
    <div data-nodirty>${{tags,tagtpl,receipt}[t]()}</div>`;
  },
  after(){updatePreview()}
};
ACT.printTab=k=>{App.ui.printTab=k;if(App.ui.view!=="print")location.hash="print";else App.render()};

/* ---------- очередь ценников ---------- */
const queueItems=()=>App.ui.tagQueue.map(q=>({q,p:App.byId("products",q.id)})).filter(x=>x.p);
const qtyHere=p=>{const pt=App.point();return pt&&pt.cashWh?App.qtyIn(p,pt.cashWh):App.qtyTotal(p)};
App.tagsAdd=ids=>addToQueue(ids);
function addToQueue(ids){
  let n=0;ids.forEach(id=>{if(!App.ui.tagQueue.some(q=>q.id===id)){App.ui.tagQueue.push({id,copies:1});n++}});saveQueue();return n;
}
ACT.tagPick=id=>{const s=App.ui.tagPick;s.has(id)?s.delete(id):s.add(id);App.render()};
ACT.tagPickAll=()=>{const ids=App.ui.stockShown||[],s=App.ui.tagPick,all=ids.length&&ids.every(i=>s.has(i));ids.forEach(i=>all?s.delete(i):s.add(i));App.render()};
ACT.tagsFromPick=()=>{const n=addToQueue([...App.ui.tagPick]);App.ui.tagPick.clear();App.ui.printTab="tags";location.hash="print";if(n)App.toast("Добавлено в ценники: "+n)};
ACT.tagOne=id=>{addToQueue([id]);App.closeModal();App.ui.printTab="tags";location.hash="print";App.toast("Товар добавлен в ценники")};
ACT.tagAdd=id=>{addToQueue([id]);App.ui.tagQ="";App.render()};
ACT.tagAddFound=()=>{addToQueue(found().map(p=>p.id));App.ui.tagQ="";App.render()};
ACT.tagDel=i=>{App.ui.tagQueue.splice(+i,1);saveQueue();App.render()};
ACT.tagClear=()=>{App.ui.tagQueue=[];saveQueue();App.render()};
ACT.tagByStock=()=>{queueItems().forEach(({q,p})=>q.copies=Math.max(1,qtyHere(p)));saveQueue();App.render()};
ACT.tagOnes=()=>{App.ui.tagQueue.forEach(q=>q.copies=1);saveQueue();App.render()};
const unitsForTags=p=>{const pt=App.point(),here=pt&&pt.cashWh?App.unitsOf(p.id,{wh:pt.cashWh}):[];return here.length?here:App.unitsOf(p.id)};
const asUnit=(p,u)=>Object.assign({},p,{uattrs:u.attrs||{},serial:App.unitCode(u),batteryHealth:u.batteryHealth!=null&&u.batteryHealth!==""?u.batteryHealth:p.batteryHealth,condition:u.condition||p.condition,kit:u.kit||p.kit,price:App.unitPrice(u,p)});
function printList(){const out=[];queueItems().forEach(({q,p})=>{if(p.trackSerial&&q.perUnit!==false){unitsForTags(p).forEach(u=>out.push({p:asUnit(p,u),copies:Math.max(1,num(q.copies)||1)}))}else out.push({p,copies:q.copies})});return out}
ACT.tagUnitMode=i=>{const q=App.ui.tagQueue[+i];if(q){q.perUnit=q.perUnit===false;saveQueue();App.render()}};
ACT.tagPrint=()=>{const list=printList();if(!list.length)return App.toast("Добавьте товары");
  App.printHtml(App.tagsHtml(list,App.tagTemplate(App.ui.tagTpl)))};
function found(){
  const q=App.ui.tagQ.trim().toLowerCase();if(!q)return [];const w=q.split(/\s+/);
  return S.products.filter(p=>!p.archived&&w.every(x=>[p.name,p.sku,p.barcode,p.serial,p.model,App.catName(p)].join(" ").toLowerCase().includes(x)));
}
const plural=n=>{const a=n%10,b=n%100;return a===1&&b!==11?"ценник":a>=2&&a<=4&&(b<12||b>14)?"ценника":"ценников"};
function tags(){
  const items=queueItems(),total=printList().reduce((a,x)=>a+num(x.copies),0),res=found();
  return `<div class="pgrid pset">
  <section class="card"><div class="card-h"><h2>Что печатаем</h2>${items.length?`<span class="pill">${items.length} товаров · ${total} ценников</span>`:""}</div>
    <div class="tsec"><input type="search" id="tagQ" class="wide" placeholder="Найти товар: название, артикул, штрихкод, IMEI" value="${esc(App.ui.tagQ)}" data-filter="tagQ" aria-label="Поиск товара">
    ${res.length?`<div class="list-mini tgap">${res.slice(0,8).map(p=>`<button data-act="tagAdd" data-id="${esc(p.id)}"><span>${esc(p.name)}<small>${esc(App.catName(p))} · остаток ${App.qtyTotal(p)}</small></span><b>${money(p.price)}</b></button>`).join("")}</div>
      ${res.length>1?`<div class="tgap"><button class="btn sm" data-act="tagAddFound">Добавить все найденные (${res.length})</button></div>`:""}`:App.ui.tagQ?'<p class="muted">Ничего не найдено</p>':""}
    <p class="szhint">Можно отметить товары галочками в разделе «Товары» и нажать «Ценники».</p></div>
    ${items.length?`<div class="tsec"><div class="tbl-wrap"><table class="tagtbl"><thead><tr><th>Товар</th><th class="n">Цена</th><th class="n">Остаток</th><th class="n">Копий</th><th></th></tr></thead><tbody>
      ${items.map(({q,p},i)=>`<tr><td><b>${esc(p.name)}</b><span class="sub">${esc([p.memory,p.color,p.condition].filter(Boolean).join(" · "))}</span>${p.trackSerial?`<label class="unitmode"><input type="checkbox" data-act="tagUnitMode" data-id="${i}" ${q.perUnit!==false?"checked":""}> по экземплярам: ${unitsForTags(p).length} шт.<small>свои IMEI, АКБ и цена</small></label>`:""}</td><td class="n">${money(p.price)}</td><td class="n">${qtyHere(p)}</td>
        <td class="n"><input type="number" min="0" max="200" value="${num(q.copies)}" data-tagcopy="${i}" aria-label="Копий" style="width:70px"></td><td class="n"><button class="btn sm ghost" data-act="tagDel" data-id="${i}" aria-label="Убрать">✕</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="chips tgap"><button class="btn sm" data-act="tagByStock">Копий по остатку на точке</button><button class="btn sm" data-act="tagOnes">По одному</button><button class="btn sm danger" data-act="tagClear">Очистить</button></div></div>`
      :'<div class="tsec"><div class="empty">Список пуст</div></div>'}
  </section>
  <section class="card"><div class="card-h"><h2>Шаблон</h2>${canTpl()?'<button class="btn sm" data-act="printTab" data-id="tagtpl">Настроить</button>':""}</div>
    <div class="tsec">${App.sel("tagTplSel",App.tagTemplates().map(t=>[t.id,t.name+(t.builtin?"":" · свой")]),App.ui.tagTpl,'data-filter-sel="tagTpl" aria-label="Шаблон ценника"')}
    <div class="prevbox tgap"><iframe id="tagPrev" title="Предпросмотр ценников"></iframe></div>
    <div class="printbar"><span class="muted">${total?`${total} ${plural(total)} · ${esc(App.tagTemplate(App.ui.tagTpl).name)}`:"Добавьте товары слева"}</span>
      <button class="btn pri" data-act="tagPrint" id="tagPrintBtn" ${total?"":"disabled"}>🖨 Печать${total?" · "+total+" шт.":""}</button></div></div>
  </section></div>
  ${total?`<div class="printfab"><button class="btn pri" data-act="tagPrint">🖨 Печать · ${total} шт.</button></div>`:""}`;
}

/* ---------- конструктор ценников: холст с блоками ---------- */
const SIZES={tags:[[58,40],[70,50],[100,70],[105,74],[148,105]],labels:[[30,20],[40,25],[43,25],[40,30],[58,30],[58,40],[58,60]]};
const LIM={min:10,max:297},SHEET={w:194,h:281}; // A4 минус поля 8 мм
const sizeTxt=v=>String(+num(v).toFixed(1)).replace(".",",");
const MM=3.7795;
const SW=["#000000","#ffffff","#d70015","#ff9500","#ffcc00","#1f9d55","#0a6cff","#8e8e93"];
function tagDraft(){if(!App.ui.tagEdit)App.ui.tagEdit=App.tagNorm(App.tagTemplate(App.ui.tagTpl));return App.ui.tagEdit}
const sampleProduct=()=>{const q=queueItems()[0];let p=q?q.p:
  S.products.find(p=>!p.archived&&p.serial&&num(p.price))||S.products.find(p=>!p.archived&&num(p.price))||
    {id:"demo",name:"iPhone 14 128 ГБ",model:"iPhone 14",memory:"128 ГБ",color:"синий",condition:"Б/у",batteryHealth:89,kit:"Коробка, кабель",serial:"350000000000001",sku:"IP14-128",barcode:"4600000000017",price:47500,warrantyMonths:App.settings().deviceWarrantyMonths||0};
  // старая цена для примера, если у товара её нет
  if(!(num(p.oldPrice)>num(p.price)))p=Object.assign({},p,{oldPrice:Math.round(num(p.price)*1.12/100)*100,_demoOld:true});
  return p};
const swatches=(attr,cur,none)=>`<div class="sw">${none?`<button class="swb none ${!cur?"on":""}" data-act="${attr}" data-id="" title="Без фона"></button>`:""}${SW.map(c=>`<button class="swb ${String(cur).toLowerCase()===c?"on":""}" style="background:${c}" data-act="${attr}" data-id="${c}" title="${c}"></button>`).join("")}<input type="color" value="${cur||"#000000"}" data-tbcolor="${attr}" aria-label="Свой цвет"></div>`;
const sizeChips=(list,t)=>list.map(([w,h])=>`<button class="btn sm ${num(t.w)===w&&num(t.h)===h?"pri":""}" data-act="tagSize" data-id="${w}x${h}">${sizeTxt(w)}×${sizeTxt(h)}</button>`).join("");
const mySizes=()=>{const all=[...SIZES.tags,...SIZES.labels].map(s=>s.join("x")),out=[];
  for(const x of (App.settings().tagTemplates||[])){const k=num(x.w)+"x"+num(x.h);if(num(x.w)&&num(x.h)&&!all.includes(k)&&!out.some(o=>o.join("x")===k))out.push([num(x.w),num(x.h)])}return out};
function sizeWarn(t){const w=num(t.w),h=num(t.h);
  if(w<LIM.min||h<LIM.min)return `Минимум ${LIM.min} мм по каждой стороне`;
  if(w>LIM.max||h>LIM.max)return `Максимум ${LIM.max} мм по каждой стороне`;
  if(t.media==="sheet"){if(w>SHEET.w||h>SHEET.h)return `Не помещается на лист A4 (до ${SHEET.w}×${SHEET.h} мм). Уменьшите размер или выберите печать на термопринтере`;
    const g=t.gap==null?1:num(t.gap),n=Math.max(1,Math.floor((SHEET.w+g)/(w+g)))*Math.max(1,Math.floor((SHEET.h+g)/(h+g)));return `<span class="ok">На листе A4: ${n} шт.</span>`}
  return `<span class="ok">В настройках термопринтера задайте этикетку ${sizeTxt(w)}×${sizeTxt(h)} мм</span>`}
function tagtpl(){
  const t=tagDraft(),f=t.fields||{},st=App.settings();
  const inp=(k,lab,type="text",extra="",cls="")=>App.fld("tc_"+k,lab,`<input id="tc_${k}" type="${type}" value="${esc(t[k]==null?"":t[k])}" data-tcfg="${k}" ${extra}>`,cls);
  const opt=(k,lab,list,cls="")=>App.fld("tc_"+k,lab,`<select id="tc_${k}" data-tcfg="${k}">${list.map(([v,l])=>`<option value="${v}"${String(t[k])===String(v)?" selected":""}>${l}</option>`).join("")}</select>`,cls);
  const ck=(k,lab,on,attr)=>`<label class="chk"><input type="checkbox" ${attr} ${on?"checked":""}> ${lab}</label>`;
  const site=String(st.siteUrl||"").replace(/\/+$/,"");
  return `<div class="pgrid tedit">
  <section class="card"><div class="card-h"><h2>Шаблон</h2></div>
    <div class="tsec"><div class="form">
      ${App.fld("tcBase","Взять за основу",`<select id="tcBase">${App.tagTemplates().map(x=>`<option value="${esc(x.id)}"${x.id===t.id?" selected":""}>${esc(x.name)}</option>`).join("")}</select>`,"full")}
      ${inp("name","Название шаблона","text","","full")}
      ${opt("media","Как печатаем",[["sheet","Лист A4 — раскладка, вырезать"],["label","Термопринтер этикеток — по одной"]],"full")}
    </div></div>
    <div class="tsec"><h3 class="sub">Размер</h3>
      <div class="sizebox"><label class="szf"><span>Ширина</span><input id="tc_w" type="number" step="0.5" min="${LIM.min}" max="${LIM.max}" value="${num(t.w)}" data-tcfg="w"></label>
        <button class="btn sm ghost szswap" data-act="tagSwap" title="Повернуть: поменять ширину и высоту" aria-label="Поменять ширину и высоту">⇄</button>
        <label class="szf"><span>Высота</span><input id="tc_h" type="number" step="0.5" min="${LIM.min}" max="${LIM.max}" value="${num(t.h)}" data-tcfg="h"></label>
        <span class="szmm">мм</span>
        ${t.media==="sheet"?`<label class="szf szgap"><span>Промежуток</span><input id="tc_gap" type="number" min="0" max="10" step="0.5" value="${t.gap==null?1:num(t.gap)}" data-tcfg="gap"></label><span class="szmm">мм</span>`:""}</div>
      <p class="szhint">От ${LIM.min} до ${LIM.max} мм, можно с половиной миллиметра.</p>
      <p class="sizewarn" id="tcSizeWarn">${sizeWarn(t)}</p>
      <div class="szgroups">
        <div><span class="szlab">Ценники</span><div class="chips">${sizeChips(SIZES.tags,t)}</div></div>
        <div><span class="szlab">Этикетки термопринтера</span><div class="chips">${sizeChips(SIZES.labels,t)}</div></div>
        ${mySizes().length?`<div><span class="szlab">Мои размеры</span><div class="chips">${sizeChips(mySizes(),t)}</div></div>`:""}
      </div></div>
    <div class="tsec"><h3 class="sub">Оформление</h3><div class="form">
      ${opt("font","Шрифт",App.TAG_FONTS.map(([k,l])=>[k,l]),"full")}
      <div class="fld full"><label>Рамка</label><div class="chips">${ck("border","Рамка",t.border,'data-tcfg="border"')}${ck("round","Скруглённые углы",t.round,'data-tcfg="round"')}</div></div>
      <div class="fld full"><label>Фон ценника</label>${swatches("tagBg",t.bg)}</div>
    </div></div>
    <div class="tsec"><h3 class="sub">Что показывать</h3>
    <div class="chips">${App.TAG_FIELDS.map(([k,l])=>ck(k,l,f[k],`data-tfield="${k}"`)).join("")}</div>
    <div class="form tsec-extra${f.note||f.credit||f.qr||f.logo||f.oldprice||f.discount?"":" none"}">
      ${f.note?inp("note","Своя надпись","text",'placeholder="Например: Trade-in, рассрочка, скидка"',"full"):""}
      ${f.credit?inp("creditMonths","Рассрочка, месяцев","number",'min="1" max="60"')+inp("creditRate","Переплата, %","number",'min="0" max="100" step="0.5"'):""}
      ${f.qr?App.fld("tc_qrUrl","Ссылка в QR",`<input id="tc_qrUrl" type="text" value="${esc(t.qrUrl||"")}" data-tcfg="qrUrl" placeholder="${esc(site?site+"/product/{slug}":"https://ваш-сайт/product/{slug}")}">`,"full")
        +`<p class="muted full">По умолчанию — страница товара на сайте, как её отдаёт API. Можно вставить {slug}, {sku} или {id}.${site?"":" Адрес сайта не задан: укажите его в «Настройки → Магазин» или впишите ссылку здесь."}</p>`:""}
      ${f.logo?`<div class="fld full"><label>Логотип</label><div class="logobox">${t.logo?`<img src="${t.logo}" alt="Логотип">`:'<span class="muted">Не загружен — печатается название магазина</span>'}
        <label class="btn sm">Загрузить<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" id="tcLogo" hidden></label>${t.logo?`<button class="btn sm" data-act="tagLogoDel">Убрать</button>`:""}</div>
        ${ck("logoBw","Печатать логотип чёрно-белым",t.logoBw,'data-tcfg="logoBw"')}</div>`:""}
      ${f.oldprice||f.discount?`<p class="muted full">Старая цена берётся из карточки товара (поле «Старая цена»). Если её нет или она не выше текущей, блоки «Старая цена» и «Скидка» не печатаются.</p>`:""}
    </div>
    </div>
    <div class="acts">${t.builtin?"":`<button class="btn danger" data-act="tagTplDel">Удалить</button>`}
      ${t.builtin?"":`<button class="btn" data-act="tagTplSave">Сохранить</button>`}<button class="btn ${t.builtin?"pri":""}" data-act="tagTplSaveNew">Сохранить как новый</button>
      ${t.builtin?"":`<button class="btn pri" data-act="tagTplUse">Использовать</button>`}</div>
    ${t.builtin?'<p class="muted">Это готовый шаблон: чтобы сохранить изменения, нажмите «Сохранить как новый».</p>':""}
  </section>
  <section class="card tcard"><div class="card-h"><h2>Ценник</h2><button class="btn sm" data-act="tagAuto" title="Разложить блоки заново под размер">Расставить автоматически</button></div>
    <div id="tbPanel"></div>
    <div class="tcwrap" id="tcwrap"><div id="tcanvas"></div></div>
    <p class="muted">Перетаскивайте блоки мышью или пальцем, размер — за уголок. Стрелки сдвигают выбранный блок на 0,5 мм (с Shift — на 2 мм), Delete скрывает. Пример: ${esc(sampleProduct().name)}${sampleProduct()._demoOld?" (старая цена показана для примера)":""}.</p>
  </section></div>`;
}
/* панель выбранного блока */
function panelHtml(){
  const t=tagDraft(),k=App.ui.tagSel,b=k&&t.blocks[k];
  if(!b||!App.tagBlockOn(t,k))return `<div class="tbar empty">Нажмите на блок на ценнике, чтобы изменить шрифт, цвет и положение</div>`;
  const media=["logo","qr","barcode"].includes(k)&&!(k==="logo"&&!t.logo);
  const n=(p,l,step=.5)=>`<label class="tbn">${l}<input type="number" step="${step}" value="${+(+b[p]).toFixed(2)}" data-tbn="${p}"></label>`;
  const tg=(p,l,title)=>`<button class="tbb ${b[p]?"on":""}" data-act="tbToggle" data-id="${p}" title="${title}">${l}</button>`;
  return `<div class="tbar">
    <div class="tbrow"><b class="tbname">${esc(App.TAG_BLOCKS[k])}</b>
      <span class="tbsp"></span><button class="tbb" data-act="tbZ" data-id="up" title="Поверх других">▲</button><button class="tbb" data-act="tbZ" data-id="down" title="Под другими">▼</button>
      <button class="tbb" data-act="tbHide" title="Скрыть блок">Скрыть</button></div>
    ${media?"":`<div class="tbrow">
      <span class="tbgrp"><button class="tbb" data-act="tbFs" data-id="-1" title="Меньше">A−</button><label class="tbn">Шрифт<input type="number" step="0.1" min="0.8" value="${+(+b.fs).toFixed(2)}" data-tbn="fs"></label><button class="tbb" data-act="tbFs" data-id="1" title="Больше">A+</button></span>
      <span class="tbgrp">${tg("b","<b>Ж</b>","Жирный")}${tg("i","<i>К</i>","Курсив")}${tg("up","АА","Заглавными")}</span>
      <span class="tbgrp">${[["l","⯇","Влево"],["c","≡","По центру"],["r","⯈","Вправо"]].map(([v,l,ti])=>`<button class="tbb ${(b.al||"l")===v?"on":""}" data-act="tbAl" data-id="${v}" title="${ti}">${l}</button>`).join("")}</span></div>
    <div class="tbrow"><span class="tblab">Текст</span>${swatches("tbC",b.c)}</div>
    <div class="tbrow"><span class="tblab">Плашка</span>${swatches("tbBg",b.bg,true)}</div>`}
    ${media&&k!=="qr"?`<div class="tbrow"><span class="tbgrp">${[["l","⯇","Влево"],["c","≡","По центру"],["r","⯈","Вправо"]].map(([v,l,ti])=>`<button class="tbb ${(b.al||"l")===v?"on":""}" data-act="tbAl" data-id="${v}" title="${ti}">${l}</button>`).join("")}</span></div>`:""}
    <div class="tbrow">${n("x","X")}${n("y","Y")}${n("w","Ширина")}${n("h","Высота")}<span class="muted">мм</span></div>
  </div>`;
}
let k0=1;
function drawCanvas(){
  const el=document.getElementById("tcanvas"),wrap=document.getElementById("tcwrap");if(!el||!wrap)return;
  const t=tagDraft(),w=num(t.w)||60,h=num(t.h)||40;
  const cw=Math.max(240,wrap.clientWidth-24);k0=Math.max(.8,Math.min(cw/(w*MM),440/(h*MM),5));
  el.style.cssText=`width:${(w*MM*k0).toFixed(1)}px;height:${(h*MM*k0).toFixed(1)}px;--k:${k0}`;
  const g=App.ui.tagGuide||[];
  el.innerHTML=`<div class="tcz" style="transform:scale(${k0});width:${w}mm;height:${h}mm">${App.tagHtml(sampleProduct(),t,{edit:true,sel:App.ui.tagSel})}
    ${g.map(([ax,v])=>`<i class="tguide ${ax}" style="${ax==="v"?"left":"top"}:${v}mm"></i>`).join("")}</div>`;
}
function drawPanel(){const p=document.getElementById("tbPanel");if(p)p.innerHTML=panelHtml()}
function drawEd(){drawCanvas();drawPanel()}
const R2=v=>Math.round(v*2)/2;
const clampB=(b,t)=>{const w=num(t.w),h=num(t.h);b.w=Math.max(2,Math.min(w,b.w));b.h=Math.max(1.5,Math.min(h,b.h));b.x=Math.max(0,Math.min(w-b.w,b.x));b.y=Math.max(0,Math.min(h-b.h,b.y))};
const selB=()=>{const t=tagDraft(),k=App.ui.tagSel;return k&&t.blocks[k]?t.blocks[k]:null};
const blkEdit=(fn,pos)=>{const b=selB();if(!b)return;fn(b,tagDraft());if(pos)b.m=1;clampB(b,tagDraft());drawEd()};
ACT.tbFs=d=>blkEdit(b=>{b.fs=Math.max(.8,+(b.fs*(+d>0?1.1:1/1.1)).toFixed(2))});
ACT.tbToggle=p=>blkEdit(b=>{b[p]=b[p]?0:1});
ACT.tbAl=v=>blkEdit(b=>{b.al=v});
ACT.tbC=c=>blkEdit(b=>{b.c=c});
ACT.tbBg=c=>blkEdit(b=>{b.bg=c});
ACT.tbZ=d=>{const t=tagDraft(),k=App.ui.tagSel,o=t.order,i=o.indexOf(k);if(i<0)return;o.splice(i,1);o.splice(d==="up"?Math.min(o.length,i+1):Math.max(0,i-1),0,k);drawEd()};
ACT.tbHide=()=>{const t=tagDraft(),k=App.ui.tagSel;if(!k)return;
  const keys=k==="pills"?["chips","cond","battery","warranty"]:[k];t.fields=Object.assign({},t.fields);keys.forEach(x=>t.fields[x]=false);App.ui.tagSel=null;App.render()};
ACT.tagBg=c=>{tagDraft().bg=c;App.render()};
ACT.tagAuto=()=>{const t=tagDraft();t.blocks=App.tagAutoBlocks(t);t.order=Object.keys(App.TAG_BLOCKS);App.toast("Блоки расставлены заново");drawEd()};
ACT.tagLogoDel=()=>{delete tagDraft().logo;App.render()};
/* перетаскивание */
let drag=null,raf=0;
const snapTo=(t,k,b,mode)=>{
  const W=num(t.w),H=num(t.h),th=.7,g=[];const xs=[0,W/2,W],ys=[0,H/2,H];
  for(const [kk,o] of Object.entries(t.blocks))if(kk!==k&&App.tagBlockOn(t,kk)){xs.push(o.x,o.x+o.w,o.x+o.w/2);ys.push(o.y,o.y+o.h,o.y+o.h/2)}
  const fit=(cands,edges)=>{let best=null;for(const [e,off] of edges)for(const c of cands){const d=c-e;if(Math.abs(d)<th&&(!best||Math.abs(d)<Math.abs(best[0])))best=[d,c,off]}return best};
  if(mode==="mv"){const sx=fit(xs,[[b.x,0],[b.x+b.w/2,0],[b.x+b.w,0]]);if(sx){b.x+=sx[0];g.push(["v",sx[1]])}
    const sy=fit(ys,[[b.y,0],[b.y+b.h/2,0],[b.y+b.h,0]]);if(sy){b.y+=sy[0];g.push(["h",sy[1]])}}
  else{const sx=fit(xs,[[b.x+b.w,0]]);if(sx){b.w+=sx[0];g.push(["v",sx[1]])}const sy=fit(ys,[[b.y+b.h,0]]);if(sy){b.h+=sy[0];g.push(["h",sy[1]])}}
  return g};
document.addEventListener("pointerdown",e=>{
  const c=e.target.closest&&e.target.closest("#tcanvas [data-blk]");
  if(!c){if(e.target.closest&&e.target.closest("#tcanvas")&&App.ui.tagSel){App.ui.tagSel=null;drawEd()}return}
  e.preventDefault();const t=tagDraft(),k=c.dataset.blk,b=t.blocks[k];
  App.ui.tagSel=k;drag={k,mode:e.target.classList.contains("rh")?"rs":"mv",sx:e.clientX,sy:e.clientY,b0:Object.assign({},b),moved:false};drawEd();
});
window.addEventListener("pointermove",e=>{if(!drag)return;
  const t=tagDraft(),b=t.blocks[drag.k],dx=(e.clientX-drag.sx)/(MM*k0),dy=(e.clientY-drag.sy)/(MM*k0);
  if(!drag.moved&&Math.abs(dx)+Math.abs(dy)<.3)return;drag.moved=true;
  b.m=1;if(drag.mode==="mv"){b.x=R2(drag.b0.x+dx);b.y=R2(drag.b0.y+dy)}else{b.w=R2(drag.b0.w+dx);b.h=R2(drag.b0.h+dy)}
  App.ui.tagGuide=e.altKey?[]:snapTo(t,drag.k,b,drag.mode);b.x=+b.x.toFixed(2);b.y=+b.y.toFixed(2);b.w=+b.w.toFixed(2);b.h=+b.h.toFixed(2);clampB(b,t);
  cancelAnimationFrame(raf);raf=requestAnimationFrame(drawCanvas)});
window.addEventListener("pointerup",()=>{if(!drag)return;drag=null;App.ui.tagGuide=[];drawEd()});
document.addEventListener("keydown",e=>{
  if(App.ui.view!=="print"||App.ui.printTab!=="tagtpl"||!selB())return;
  if(e.target.closest&&e.target.closest("input,textarea,select"))return;
  const st=e.shiftKey?2:.5,mv={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key];
  if(mv){e.preventDefault();blkEdit(b=>{b.x=R2(b.x+mv[0]);b.y=R2(b.y+mv[1])},1)}
  else if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();ACT.tbHide()}
  else if(e.key==="Escape"){App.ui.tagSel=null;drawEd()}
});
window.addEventListener("resize",()=>{if(App.ui.view==="print"&&App.ui.printTab==="tagtpl")drawCanvas()});
/* логотип: уменьшаем до 600 px, чтобы шаблон оставался лёгким */
document.addEventListener("change",e=>{const t=e.target;if(t.id!=="tcLogo"||!t.files||!t.files[0])return;
  const file=t.files[0];if(file.size>5e6){App.toast("Файл больше 5 МБ");return}
  const rd=new FileReader();rd.onload=()=>{const img=new Image();img.onload=()=>{
    const s=Math.min(1,600/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*s));c.height=Math.max(1,Math.round(img.height*s));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);const url=c.toDataURL("image/png");
    if(url.length>400000){App.toast("Логотип слишком детальный — попробуйте файл попроще");return}
    tagDraft().logo=url;App.render();App.toast("Логотип загружен")};img.onerror=()=>App.toast("Не удалось открыть картинку");img.src=rd.result};
  rd.readAsDataURL(file)});
document.addEventListener("change",e=>{const t=e.target;if(t.id==="tagTplSel"){LS("icase_tagtpl",t.value);App.ui.tagEdit=null}
  if(t.id==="tcBase"){App.ui.tagEdit=App.tagNorm(App.tagTemplate(t.value));App.ui.tagSel=null;App.render()}});
ACT.tagSwap=()=>{const t=tagDraft(),w=num(t.w),h=num(t.h);ACT.tagSize(h+"x"+w)};
ACT.tagSize=v=>{const [w,h]=v.split("x").map(Number);const t=tagDraft(),rx=w/(num(t.w)||w),ry=h/(num(t.h)||h),rf=Math.min(rx,ry);
  for(const b of Object.values(t.blocks||{})){b.x=+(b.x*rx).toFixed(2);b.w=+(b.w*rx).toFixed(2);b.y=+(b.y*ry).toFixed(2);b.h=+(b.h*ry).toFixed(2);b.fs=+(b.fs*rf).toFixed(2)}
  t.w=w;t.h=h;t._w=w;t._h=h;relayoutIfUntouched(t);App.render()};
// пока блоки не двигали руками — под новый размер раскладываем заново, иначе масштабируем то, что есть
function relayoutIfUntouched(t){if(!Object.values(t.blocks||{}).some(b=>b.m))t.blocks=App.tagAutoBlocks(t)}
async function saveTagTemplates(list){await App.api.update("settings",1,{tag_templates:list});await App.reload(["settings"])}
const custom=()=>(App.settings().tagTemplates||[]).slice();
const clean=t=>{const c=JSON.parse(JSON.stringify(t));delete c.builtin;delete c._w;delete c._h;c.w=Math.min(LIM.max,Math.max(LIM.min,num(c.w)));c.h=Math.min(LIM.max,Math.max(LIM.min,num(c.h)));return c};
ACT.tagTplSaveNew=(_,btn)=>run(btn,async()=>{const t=clean(tagDraft());t.id="t"+Date.now().toString(36);
  if(!t.name||App.TAG_PRESETS.some(p=>p.name===t.name))t.name=(t.name||"Шаблон")+" (свой)";
  await saveTagTemplates([...custom(),t]);App.ui.tagEdit=App.tagNorm(t);App.ui.tagTpl=t.id;LS("icase_tagtpl",t.id);App.render();App.toast("Шаблон сохранён")});
ACT.tagTplSave=(_,btn)=>run(btn,async()=>{const t=clean(tagDraft());await saveTagTemplates(custom().map(x=>x.id===t.id?t:x));App.render();App.toast("Шаблон сохранён")});
ACT.tagTplDel=(_,btn)=>run(btn,async()=>{const id=tagDraft().id;if(!confirm("Удалить шаблон «"+tagDraft().name+"»?"))return;
  await saveTagTemplates(custom().filter(x=>x.id!==id));App.ui.tagEdit=null;if(App.ui.tagTpl===id){App.ui.tagTpl="dev70";LS("icase_tagtpl","dev70")}App.render();App.toast("Шаблон удалён")});
ACT.tagTplUse=()=>{App.ui.tagTpl=tagDraft().id;LS("icase_tagtpl",App.ui.tagTpl);App.ui.printTab="tags";App.render()};

/* ---------- редактор товарного чека ---------- */
function docDraft(){if(!App.ui.docEdit)App.ui.docEdit=App.docCfg();return App.ui.docEdit}
function receipt(){
  const d=docDraft();
  const ck=(k,l)=>`<label class="chk"><input type="checkbox" data-dcfg="${k}" ${d[k]?"checked":""}> ${l}</label>`;
  const tx=(k,l,ph="")=>App.fld("dc_"+k,l,`<input id="dc_${k}" type="text" value="${esc(d[k]||"")}" data-dcfg="${k}" placeholder="${esc(ph)}">`,"full");
  return `<div class="pgrid pset">
  <section class="card"><div class="card-h"><h2>Товарный чек</h2></div>
    <div class="tsec"><h3 class="sub">Шаблон</h3><div class="tplpick">${App.DOC_TEMPLATES.map(([k,l])=>`<button class="tplbtn ${d.template===k?"on":""}" data-act="docTpl" data-id="${k}"><span class="tpl-${k}"></span>${l}</button>`).join("")}</div></div>
    <div class="tsec"><h3 class="sub">Тексты</h3><div class="form">
      ${tx("title","Заголовок","Товарный чек")}
      ${App.fld("dc_ackText","Отметка покупателя",`<textarea id="dc_ackText" rows="3" data-dcfg="ackText">${esc(d.ackText||"")}</textarea>`,"full")}
      ${tx("thanks","Надпись внизу","Спасибо за покупку!")}
      ${tx("legal1","Юридическая строка 1")}${tx("legal2","Юридическая строка 2")}
    </div></div>
    <div class="tsec"><h3 class="sub">Вид</h3><div class="form">
      ${App.fld("dc_scale","Размер текста: <b id=\"dcScaleV\">"+num(d.scale)+"%</b>",`<input id="dc_scale" type="range" min="85" max="115" step="5" value="${num(d.scale)||100}" data-dcfg="scale">`,"full")}
      <div class="fld full"><label>Что печатать</label><div class="chips">
        ${ck("showPoint","Название точки")}${ck("showStaff","Имя продавца")}${ck("chips","Память, цвет, гарантия")}${ck("tradein","Блок trade-in")}
        ${ck("words","Сумма прописью")}${ck("ack","Отметка покупателя")}${ck("legal","Юридические строки")}${ck("qrSite","QR на сайт")}${ck("qrReview","QR на отзывы")}</div></div>
    </div>
    <p class="szhint">Реквизиты ИП, адрес и ссылки для QR-кодов — в «Настройки → Магазин». QR без ссылки не печатается.</p></div>
    <div class="acts"><button class="btn" data-act="docReset">Стандартные настройки</button><button class="btn pri" data-act="docSave">Сохранить</button></div>
  </section>
  <section class="card"><div class="card-h"><h2>Предпросмотр</h2><div class="seg"><button class="${App.ui.docPrev==="a4"?"on":""}" data-act="docPrev" data-id="a4">A4</button><button class="${App.ui.docPrev==="80"?"on":""}" data-act="docPrev" data-id="80">80 мм</button></div></div>
    <div class="tsec"><div class="prevbox doc ${App.ui.docPrev==="80"?"tape":""}"><iframe id="docPrev" title="Предпросмотр товарного чека"></iframe></div>
    <p class="szhint">${S.sales.length?"Показана последняя продажа":"Продаж ещё нет — показан пример"}.</p></div></section></div>`;
}
ACT.docTpl=k=>{docDraft().template=k;App.render()};
ACT.docPrev=k=>{App.ui.docPrev=k;App.render()};
ACT.docReset=()=>{App.ui.docEdit=Object.assign({},App.DOC_DEFAULT,{ackText:App.DEFAULTS.receiptAck,thanks:App.DEFAULTS.receiptFooter});App.render()};
ACT.docSave=(_,btn)=>run(btn,async()=>{const d=Object.assign({},docDraft());const ack=d.ackText,thanks=d.thanks;delete d.ackText;delete d.thanks;
  await App.api.update("settings",1,{doc_config:d,receipt_ack:ack||App.DEFAULTS.receiptAck,receipt_footer:thanks||null});
  await App.api.audit("Шаблон товарного чека изменён","","");await App.reload(["settings"]);App.ui.docEdit=null;App.render();App.toast("Шаблон чека сохранён")});

/* ---------- живые изменения без перерисовки ---------- */
document.addEventListener("input",e=>{const t=e.target;
  if(t.dataset.tagcopy!=null){const q=App.ui.tagQueue[+t.dataset.tagcopy];if(q){q.copies=Math.max(0,Math.min(200,num(t.value)));saveQueue();
    const total=printList().reduce((a,x)=>a+num(x.copies),0);document.querySelectorAll('[data-act="tagPrint"]').forEach(b=>{b.textContent="🖨 Печать"+(total?" · "+total+" шт.":"");b.disabled=!total})}return}
  if(t.dataset.tcfg){const d=tagDraft(),k=t.dataset.tcfg,v=t.type==="checkbox"?t.checked:(t.type==="number"?num(t.value):t.value);
    const okSize=x=>num(x)>=LIM.min&&num(x)<=LIM.max;
    if((k==="w"||k==="h")&&okSize(v)){const last=okSize(d["_"+k])?num(d["_"+k]):okSize(d[k])?num(d[k]):num(v),r=num(v)/last;d["_"+k]=num(v);
      for(const b of Object.values(d.blocks||{})){if(k==="w"){b.x=+(b.x*r).toFixed(2);b.w=+(b.w*r).toFixed(2)}else{b.y=+(b.y*r).toFixed(2);b.h=+(b.h*r).toFixed(2)}if(r<1)b.fs=+(b.fs*r).toFixed(2)}d[k]=v;relayoutIfUntouched(d)}
    d[k]=v;if(k==="w"||k==="h"||k==="gap"){const wn=$("#tcSizeWarn");if(wn)wn.innerHTML=sizeWarn(d);if(!okSize(d.w)||!okSize(d.h))return}previewSoon();return}
  if(t.dataset.tfield){const d=tagDraft(),k=t.dataset.tfield;d.fields=Object.assign({},d.fields,{[k]:t.checked});
    // блоки, которые пользователь не двигал, раскладываем заново под новый набор полей
    const auto=App.tagAutoBlocks(d);for(const [bk,b] of Object.entries(auto))if(!d.blocks[bk]||!d.blocks[bk].m)d.blocks[bk]=b;
    if(t.checked)App.ui.tagSel=App.tagBlockOf(k);
    else if(App.ui.tagSel&&!App.tagBlockOn(d,App.ui.tagSel))App.ui.tagSel=null;
    App.render();return}
  if(t.dataset.tbn){const b=selB();if(!b)return;const v=num(t.value);if(!(v>0)&&t.dataset.tbn!=="x"&&t.dataset.tbn!=="y")return;b[t.dataset.tbn]=v;if(t.dataset.tbn!=="fs")b.m=1;clampB(b,tagDraft());drawCanvas();return}
  if(t.dataset.tbcolor){const a=t.dataset.tbcolor;if(a==="tagBg")tagDraft().bg=t.value;else{const b=selB();if(!b)return;b[a==="tbC"?"c":"bg"]=t.value}drawCanvas();return}
  if(t.dataset.dcfg){const d=docDraft(),k=t.dataset.dcfg;d[k]=t.type==="checkbox"?t.checked:(k==="scale"?num(t.value):t.value);if(k==="scale"){const v=$("#dcScaleV");if(v)v.textContent=d.scale+"%"}previewSoon()}
});
document.addEventListener("change",e=>{const t=e.target;if(t.dataset&&t.dataset.tbcolor){if(t.dataset.tbcolor==="tagBg")App.render();else drawEd();return}
  if(t.dataset&&t.dataset.tbn){drawEd();return}
  if(t.type==="checkbox"&&(t.dataset.tcfg||t.dataset.tfield||t.dataset.dcfg))t.dispatchEvent(new Event("input",{bubbles:true}));
  if(t.tagName==="SELECT"&&t.dataset.tcfg){t.dispatchEvent(new Event("input",{bubbles:true}));if(t.dataset.tcfg==="media")App.render()}});
let pv=0;const previewSoon=()=>{clearTimeout(pv);pv=setTimeout(updatePreview,150)};
function setFrame(id,html){const f=document.getElementById(id);if(f&&f.dataset.html!==html){f.srcdoc=html;f.dataset.html=html}}
function updatePreview(){
  if(App.ui.view!=="print")return;
  if(App.ui.printTab==="receipt"){const s=App.demoSale(),d=docDraft();setFrame("docPrev",App.ui.docPrev==="80"?App.receipt80(s,d):App.receiptA4(s,d))}
  else if(App.ui.printTab==="tagtpl")drawEd();
  else if(App.ui.printTab==="tags"){const list=printList().slice(0,8).map(x=>({p:x.p,copies:1}));
    setFrame("tagPrev",list.length?App.tagsHtml(list,Object.assign({},App.tagTemplate(App.ui.tagTpl),{media:"sheet"})):'<p style="font:14px Arial;color:#888;padding:20px">Добавьте товары — здесь появятся ценники</p>')}
}
})();
