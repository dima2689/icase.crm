/* iCase CRM v3 · раздел «Печать»: ценники, конфигуратор ценников, редактор товарного чека */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.print="Печать";
const LS=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||"null");localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};
Object.assign(App.ui,{printTab:"tags",tagQ:"",tagTpl:LS("icase_tagtpl")||"dev70",tagQueue:LS("icase_tagq")||[],tagPick:new Set(),tagEdit:null,docEdit:null,docPrev:"a4"});
const saveQueue=()=>LS("icase_tagq",App.ui.tagQueue);
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const canTpl=()=>App.can("price")||App.can("settings");

const TABS=()=>[["tags","Ценники",true],["tagtpl","Шаблоны ценников",canTpl()],["receipt","Товарный чек",App.can("settings")]].filter(t=>t[2]);
VIEWS.print={
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
ACT.tagPrint=()=>{const list=queueItems().map(({q,p})=>({p,copies:q.copies}));if(!list.length)return App.toast("Добавьте товары");
  App.printHtml(App.tagsHtml(list,App.tagTemplate(App.ui.tagTpl)))};
function found(){
  const q=App.ui.tagQ.trim().toLowerCase();if(!q)return [];const w=q.split(/\s+/);
  return S.products.filter(p=>!p.archived&&w.every(x=>[p.name,p.sku,p.barcode,p.serial,p.model,App.catName(p)].join(" ").toLowerCase().includes(x)));
}
function tags(){
  const items=queueItems(),total=items.reduce((a,x)=>a+num(x.q.copies),0),res=found();
  return `<div class="pgrid">
  <section class="card"><div class="card-h"><h2>Что печатаем</h2>${items.length?`<span class="pill">${items.length} товаров · ${total} ценников</span>`:""}</div>
    <input type="search" id="tagQ" placeholder="Найти товар: название, артикул, штрихкод, IMEI" value="${esc(App.ui.tagQ)}" data-filter="tagQ" aria-label="Поиск товара">
    ${res.length?`<div class="list-mini" style="margin-top:8px">${res.slice(0,8).map(p=>`<button data-act="tagAdd" data-id="${esc(p.id)}"><span>${esc(p.name)}<small>${esc(App.catName(p))} · остаток ${App.qtyTotal(p)}</small></span><b>${money(p.price)}</b></button>`).join("")}</div>
      ${res.length>1?`<div class="acts" style="justify-content:flex-start;margin-top:6px"><button class="btn sm" data-act="tagAddFound">Добавить все найденные (${res.length})</button></div>`:""}`:App.ui.tagQ?'<p class="muted">Ничего не найдено</p>':""}
    <p class="muted" style="margin:10px 0 0">Можно отметить товары галочками в разделе «Товары» и нажать «Ценники».</p>
    ${items.length?`<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Товар</th><th class="n">Цена</th><th class="n">Остаток</th><th class="n">Копий</th><th></th></tr></thead><tbody>
      ${items.map(({q,p},i)=>`<tr><td><b>${esc(p.name)}</b><span class="sub">${esc([p.memory,p.color,p.condition].filter(Boolean).join(" · "))}</span></td><td class="n">${money(p.price)}</td><td class="n">${qtyHere(p)}</td>
        <td class="n"><input type="number" min="0" max="200" value="${num(q.copies)}" data-tagcopy="${i}" aria-label="Копий" style="width:70px"></td><td class="n"><button class="btn sm ghost" data-act="tagDel" data-id="${i}" aria-label="Убрать">✕</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="acts" style="justify-content:flex-start"><button class="btn sm" data-act="tagByStock">Копий по остатку на точке</button><button class="btn sm" data-act="tagOnes">По одному</button><button class="btn sm danger" data-act="tagClear">Очистить</button></div>`
      :'<div class="empty">Список пуст</div>'}
  </section>
  <section class="card"><div class="card-h"><h2>Шаблон</h2>${canTpl()?'<button class="btn sm" data-act="printTab" data-id="tagtpl">Настроить</button>':""}</div>
    ${App.sel("tagTplSel",App.tagTemplates().map(t=>[t.id,t.name+(t.builtin?"":" · свой")]),App.ui.tagTpl,'data-filter-sel="tagTpl" aria-label="Шаблон ценника"')}
    <div class="prevbox"><iframe id="tagPrev" title="Предпросмотр ценников"></iframe></div>
    <div class="acts"><button class="btn pri" data-act="tagPrint" id="tagPrintBtn">Печать${total?" · "+total+" шт.":""}</button></div>
  </section></div>`;
}

/* ---------- конфигуратор ценников ---------- */
const SIZES=[[58,40],[70,50],[100,70],[40,30],[58,30],[105,74]];
function tagDraft(){if(!App.ui.tagEdit)App.ui.tagEdit=JSON.parse(JSON.stringify(App.tagTemplate(App.ui.tagTpl)));return App.ui.tagEdit}
const sampleProduct=()=>{const q=queueItems()[0];if(q)return q.p;
  return S.products.find(p=>!p.archived&&p.serial&&num(p.price))||S.products.find(p=>!p.archived&&num(p.price))||
    {name:"iPhone 14 128 ГБ",model:"iPhone 14",memory:"128 ГБ",color:"синий",condition:"Б/у",batteryHealth:89,kit:"Коробка, кабель",serial:"350000000000001",sku:"IP14-128",barcode:"4600000000017",price:47500,warrantyMonths:App.settings().deviceWarrantyMonths||0}};
function tagtpl(){
  const t=tagDraft(),f=t.fields||{};
  const inp=(k,lab,type="text",extra="")=>App.fld("tc_"+k,lab,`<input id="tc_${k}" type="${type}" value="${esc(t[k]==null?"":t[k])}" data-tcfg="${k}" ${extra}>`);
  const opt=(k,lab,list)=>App.fld("tc_"+k,lab,`<select id="tc_${k}" data-tcfg="${k}">${list.map(([v,l])=>`<option value="${v}"${String(t[k])===String(v)?" selected":""}>${l}</option>`).join("")}</select>`);
  const ck=(k,lab,on,attr)=>`<label class="chk"><input type="checkbox" ${attr} ${on?"checked":""}> ${lab}</label>`;
  return `<div class="pgrid">
  <section class="card"><div class="card-h"><h2>Конфигуратор</h2></div>
    <div class="form">
      ${App.fld("tcBase","Взять за основу",`<select id="tcBase">${App.tagTemplates().map(x=>`<option value="${esc(x.id)}"${x.id===t.id?" selected":""}>${esc(x.name)}</option>`).join("")}</select>`,"full")}
      ${inp("name","Название шаблона")}
      ${opt("media","Как печатаем",[["sheet","Лист A4 — раскладка, вырезать"],["label","Термопринтер этикеток — по одной"]])}
      ${inp("w","Ширина, мм","number",'min="25" max="200"')}${inp("h","Высота, мм","number",'min="15" max="150"')}
      <div class="fld full"><label>Готовые размеры</label><div class="chips">${SIZES.map(([w,h])=>`<button class="btn sm" data-act="tagSize" data-id="${w}x${h}">${w}×${h}</button>`).join("")}</div></div>
      ${opt("priceSize","Размер цены",[["S","Небольшая"],["M","Средняя"],["L","Крупная"]])}
      ${inp("note","Своя надпись","text",'placeholder="Например: Trade-in, рассрочка, скидка"')}
      <div class="fld full"><label>Оформление</label><div class="chips">${ck("border","Рамка",t.border,'data-tcfg="border"')}${ck("round","Скруглённые углы",t.round,'data-tcfg="round"')}${ck("invert","Надпись на чёрной плашке",t.invert,'data-tcfg="invert"')}</div></div>
      <div class="fld full"><label>Что показывать</label><div class="chips">${App.TAG_FIELDS.map(([k,l])=>ck(k,l,f[k],`data-tfield="${k}"`)).join("")}</div></div>
    </div>
    <div class="acts">${t.builtin?"":`<button class="btn danger" data-act="tagTplDel">Удалить</button>`}
      ${t.builtin?"":`<button class="btn" data-act="tagTplSave">Сохранить</button>`}<button class="btn ${t.builtin?"pri":""}" data-act="tagTplSaveNew">Сохранить как новый</button>
      ${t.builtin?"":`<button class="btn pri" data-act="tagTplUse">Использовать</button>`}</div>
    ${t.builtin?'<p class="muted">Это готовый шаблон: чтобы сохранить изменения, нажмите «Сохранить как новый».</p>':""}
  </section>
  <section class="card"><div class="card-h"><h2>Предпросмотр</h2><span class="muted">${esc(sampleProduct().name)}</span></div>
    <div class="prevbox"><iframe id="tagPrev" title="Предпросмотр ценника"></iframe></div>
    <p class="muted">На экране ценник в натуральную величину. Штрихкод берётся из поля «Штрихкод», если его нет — артикул или IMEI.</p></section></div>`;
}
document.addEventListener("change",e=>{const t=e.target;if(t.id==="tagTplSel"){LS("icase_tagtpl",t.value);App.ui.tagEdit=null}if(t.id==="tcBase"){App.ui.tagEdit=JSON.parse(JSON.stringify(App.tagTemplate(t.value)));App.render()}});
ACT.tagSize=v=>{const [w,h]=v.split("x").map(Number);const t=tagDraft();t.w=w;t.h=h;App.render()};
async function saveTagTemplates(list){await App.api.update("settings",1,{tag_templates:list});await App.reload(["settings"])}
const custom=()=>(App.settings().tagTemplates||[]).slice();
const clean=t=>{const c=JSON.parse(JSON.stringify(t));delete c.builtin;c.w=Math.max(15,num(c.w));c.h=Math.max(15,num(c.h));return c};
ACT.tagTplSaveNew=(_,btn)=>run(btn,async()=>{const t=clean(tagDraft());t.id="t"+Date.now().toString(36);
  if(!t.name||App.TAG_PRESETS.some(p=>p.name===t.name))t.name=(t.name||"Шаблон")+" (свой)";
  await saveTagTemplates([...custom(),t]);App.ui.tagEdit=JSON.parse(JSON.stringify(t));App.ui.tagTpl=t.id;LS("icase_tagtpl",t.id);App.render();App.toast("Шаблон сохранён")});
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
  return `<div class="pgrid">
  <section class="card"><div class="card-h"><h2>Товарный чек</h2></div>
    <div class="fld full"><label>Шаблон</label><div class="tplpick">${App.DOC_TEMPLATES.map(([k,l])=>`<button class="tplbtn ${d.template===k?"on":""}" data-act="docTpl" data-id="${k}"><span class="tpl-${k}"></span>${l}</button>`).join("")}</div></div>
    <div class="form">
      ${tx("title","Заголовок","Товарный чек")}
      ${App.fld("dc_ackText","Отметка покупателя",`<textarea id="dc_ackText" rows="2" data-dcfg="ackText">${esc(d.ackText||"")}</textarea>`,"full")}
      ${tx("thanks","Надпись внизу","Спасибо за покупку!")}
      ${tx("legal1","Юридическая строка 1")}${tx("legal2","Юридическая строка 2")}
      ${App.fld("dc_scale","Размер текста: <b id=\"dcScaleV\">"+num(d.scale)+"%</b>",`<input id="dc_scale" type="range" min="85" max="115" step="5" value="${num(d.scale)||100}" data-dcfg="scale">`,"full")}
      <div class="fld full"><label>Блоки</label><div class="chips">
        ${ck("showPoint","Название точки")}${ck("showStaff","Имя продавца")}${ck("chips","Память, цвет, гарантия")}${ck("tradein","Блок trade-in")}
        ${ck("words","Сумма прописью")}${ck("ack","Отметка покупателя")}${ck("legal","Юридические строки")}${ck("qrSite","QR на сайт")}${ck("qrReview","QR на отзывы")}</div></div>
    </div>
    <p class="muted">Реквизиты ИП, адрес и ссылки для QR-кодов — в «Настройки → Магазин». QR без ссылки не печатается.</p>
    <div class="acts"><button class="btn" data-act="docReset">Стандартные настройки</button><button class="btn pri" data-act="docSave">Сохранить</button></div>
  </section>
  <section class="card"><div class="card-h"><h2>Предпросмотр</h2><div class="seg"><button class="${App.ui.docPrev==="a4"?"on":""}" data-act="docPrev" data-id="a4">A4</button><button class="${App.ui.docPrev==="80"?"on":""}" data-act="docPrev" data-id="80">80 мм</button></div></div>
    <div class="prevbox doc ${App.ui.docPrev==="80"?"tape":""}"><iframe id="docPrev" title="Предпросмотр товарного чека"></iframe></div>
    <p class="muted">${S.sales.length?"Показана последняя продажа":"Продаж ещё нет — показан пример"}.</p></section></div>`;
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
    const total=App.ui.tagQueue.reduce((a,x)=>a+num(x.copies),0);const b=$("#tagPrintBtn");if(b)b.textContent="Печать"+(total?" · "+total+" шт.":"")}return}
  if(t.dataset.tcfg){const d=tagDraft(),k=t.dataset.tcfg;d[k]=t.type==="checkbox"?t.checked:(t.type==="number"?num(t.value):t.value);previewSoon();return}
  if(t.dataset.tfield){const d=tagDraft();d.fields=Object.assign({},d.fields,{[t.dataset.tfield]:t.checked});previewSoon();return}
  if(t.dataset.dcfg){const d=docDraft(),k=t.dataset.dcfg;d[k]=t.type==="checkbox"?t.checked:(k==="scale"?num(t.value):t.value);if(k==="scale"){const v=$("#dcScaleV");if(v)v.textContent=d.scale+"%"}previewSoon()}
});
document.addEventListener("change",e=>{const t=e.target;if(t.type==="checkbox"&&(t.dataset.tcfg||t.dataset.tfield||t.dataset.dcfg))t.dispatchEvent(new Event("input",{bubbles:true}));
  if(t.tagName==="SELECT"&&t.dataset.tcfg)t.dispatchEvent(new Event("input",{bubbles:true}))});
let pv=0;const previewSoon=()=>{clearTimeout(pv);pv=setTimeout(updatePreview,150)};
function setFrame(id,html){const f=document.getElementById(id);if(f&&f.dataset.html!==html){f.srcdoc=html;f.dataset.html=html}}
function updatePreview(){
  if(App.ui.view!=="print")return;
  if(App.ui.printTab==="receipt"){const s=App.demoSale(),d=docDraft();setFrame("docPrev",App.ui.docPrev==="80"?App.receipt80(s,d):App.receiptA4(s,d))}
  else if(App.ui.printTab==="tagtpl"){const t=tagDraft();setFrame("tagPrev",App.tagsHtml([{p:sampleProduct(),copies:1}],Object.assign({},t,{media:"sheet"})))}
  else if(App.ui.printTab==="tags"){const list=queueItems().slice(0,8).map(({p})=>({p,copies:1}));
    setFrame("tagPrev",list.length?App.tagsHtml(list,Object.assign({},App.tagTemplate(App.ui.tagTpl),{media:"sheet"})):'<p style="font:14px Arial;color:#888;padding:20px">Добавьте товары — здесь появятся ценники</p>')}
}
})();
