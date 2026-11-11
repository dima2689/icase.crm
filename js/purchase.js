/* iCase CRM v3 · Заказы поставщикам: черновик → отправлен → частично принят → принят. Приёмка по заказу, заказ из аналитики */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS}=App;
Object.assign(App.ui,{supTab:"prices",poSt:"open"});
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const POST={draft:["Черновик","mute"],sent:["Отправлен","info"],partial:["Частично принят","warn"],done:["Принят","ok"],cancelled:["Отменён","mute"]};
const pill=s=>`<span class="pill ${(POST[s]||[])[1]||""}">${esc((POST[s]||[s])[0])}</span>`;
const supName=id=>(App.byId("suppliers",id)||{}).name||"Без поставщика";
App.poSum=o=>o.lines.reduce((a,l)=>a+num(l.qty)*num(l.cost),0);
App.poLeft=o=>o.lines.reduce((a,l)=>a+Math.max(0,num(l.qty)-num(l.received)),0);
const isOpen=o=>["draft","sent","partial"].includes(o.status);
const late=o=>o.expectedDate&&["sent","partial"].includes(o.status)&&new Date(o.expectedDate)<new Date(new Date().toDateString());

/* вкладки в разделе «Поставщики» */
const base=VIEWS.suppliers.render,baseActs=VIEWS.suppliers.actions;
VIEWS.suppliers.actions=()=>App.ui.supTab==="po"?(App.can("stock")?'<button class="btn pri" data-act="poNew">+ Заказ поставщику</button>':""):baseActs();
VIEWS.suppliers.render=function(){
  const n=S.porders.filter(isOpen).length,lt=S.porders.some(late);
  return `<div class="tabs"><button class="tab ${App.ui.supTab!=="po"?"on":""}" data-act="supTab" data-id="prices">Прайсы</button><button class="tab ${App.ui.supTab==="po"?"on":""}" data-act="supTab" data-id="po">Заказы${n?` <b>${n}</b>`:""}${lt?' <span class="dot bad"></span>':""}</button></div>`
    +(App.ui.supTab==="po"?poList():base.call(this));
};
ACT.supTab=k=>{App.ui.supTab=k;if(App.ui.view!=="suppliers")location.hash="suppliers";else App.render()};
function poList(){
  const u=App.ui,list=App.sortDesc(S.porders.filter(o=>u.poSt==="all"||(u.poSt==="open"?isOpen(o):o.status===u.poSt)));
  const sumOpen=S.porders.filter(o=>["sent","partial"].includes(o.status)).reduce((a,o)=>a+o.lines.reduce((b,l)=>b+Math.max(0,l.qty-l.received)*l.cost,0),0);
  return `<div class="chips rchips">${[["open","Активные"],["draft","Черновики"],["sent","Отправлены"],["partial","Частично"],["done","Приняты"],["all","Все"]].map(([k,l])=>`<button class="chip ${u.poSt===k?"on":""}" data-act="poSt" data-id="${k}">${l}</button>`).join("")}</div>
    ${sumOpen&&App.can("cost")?`<p class="muted">В пути от поставщиков: товара на ${money(sumOpen)}</p>`:""}
    <section class="card">${list.length?`<div class="flist">${list.map(o=>`<button class="frow" data-act="poOpen" data-id="${esc(o.id)}"><span class="fic">${o.status==="done"?"✓":"⇣"}</span>
      <span class="cnm"><b>${esc(o.num)} · ${esc(supName(o.supplierId))} ${pill(o.status)}${late(o)?' <span class="pill bad">просрочен</span>':""}</b>
      <small>${o.lines.length} поз. · ${o.lines.reduce((a,l)=>a+l.qty,0)} шт${isOpen(o)&&o.status!=="draft"?" · осталось принять "+App.poLeft(o):""} · ${esc(App.whName(o.whId))}${o.expectedDate?" · ждём "+App.dt(o.expectedDate):""}</small></span>
      <span class="csum">${App.can("cost")?money(App.poSum(o)):""}</span></button>`).join("")}</div>`
      :`<div class="empty">Заказов нет. Создайте заказ вручную или в «Аналитика → Склад → Список к заказу» — CRM посчитает, сколько нужно, по скорости продаж.</div>`}</section>`;
}
ACT.poSt=k=>{App.ui.poSt=k;App.render()};

/* ---------- форма заказа ---------- */
let F=null;
ACT.poNew=(_,__,pre)=>{F=Object.assign({id:null,supplierId:"",whId:App.cashWh()||"",expectedDate:"",note:"",lines:[]},pre||{});draw()};
ACT.poOpen=id=>{const o=App.byId("porders",id);if(!o)return;if(o.status==="draft"&&App.can("stock")){F={id:o.id,num:o.num,supplierId:o.supplierId,whId:o.whId,expectedDate:o.expectedDate,note:o.note,lines:o.lines.map(l=>({productId:l.productId,qty:l.qty,cost:l.cost}))};return draw()}
  view(o)};
function draw(){
  const cost=App.can("cost"),tot=F.lines.reduce((a,l)=>a+num(l.qty)*num(l.cost),0);
  const html=App.head(F.id?"Заказ "+esc(F.num):"Новый заказ поставщику")+`<div class="form">
      ${App.fld("poSup","Поставщик",App.sel("poSup",[["","— выберите —"],...S.suppliers.map(s=>[s.id,s.name])],F.supplierId))}
      ${App.fld("poWh","Склад приёмки",App.sel("poWh",App.whOpts(),F.whId))}
      ${App.fld("poDate","Ожидаем поставку",App.inp("poDate",F.expectedDate||"","date"))}
      ${App.fld("poNote","Комментарий",App.inp("poNote",F.note||"","text","Условия, оплата, контакт"))}</div>
    <div class="fld addrow"><input id="poQ" type="search" placeholder="Добавить товар: название, артикул, штрихкод" autocomplete="off" aria-label="Товар"><div id="poBox" class="pick" hidden></div></div>
    <div class="tbl-wrap"><table class="potbl"><thead><tr><th>Товар</th><th class="n">У нас</th><th class="n">Кол-во</th>${cost?'<th class="n">Цена закупки</th><th class="n">Сумма</th>':""}<th></th></tr></thead><tbody>
      ${F.lines.map((l,i)=>{const p=App.byId("products",l.productId)||{};const o=(App.offersFor?App.offersFor(p):[]).filter(x=>x.price>0&&(!F.supplierId||x.supplierId===F.supplierId))[0];
        return `<tr><td>${esc(p.name||"—")}${o&&cost&&Math.abs(o.price-num(l.cost))>=1?`<small class="muted"> · в прайсе ${money(o.price)}</small>`:""}</td><td class="n">${App.qtyTotal(p)}</td>
        <td class="n"><input class="poq" data-i="${i}" data-k="qty" type="number" inputmode="numeric" min="1" value="${l.qty}" aria-label="Количество"></td>
        ${cost?`<td class="n"><input class="poq" data-i="${i}" data-k="cost" type="number" inputmode="decimal" value="${l.cost}" aria-label="Цена"></td><td class="n">${money(num(l.qty)*num(l.cost))}</td>`:""}
        <td><button class="btn sm ghost" data-act="poDel" data-id="${i}" aria-label="Убрать">✕</button></td></tr>`}).join("")||`<tr><td colspan="6" class="muted">Добавьте товары поиском выше</td></tr>`}
    </tbody></table></div>
    ${cost&&F.lines.length?`<div class="total"><span>Итого</span><b>${money(tot)}</b></div>`:""}
    <div class="acts">${F.id?`<button class="btn danger" data-act="poDelete">Удалить</button>`:""}<button class="btn" data-act="poSave" data-id="draft">Сохранить черновик</button><button class="btn pri" data-act="poSave" data-id="sent">Отправлен поставщику</button></div>`;
  if($("#modal").innerHTML&&$("#poQ"))App.redrawModal(html);else App.openModal(html,{wide:true});
  App.productPicker("poQ","poBox",{showCost:cost,onPick:p=>{const ex=F.lines.find(l=>l.productId===p.id);if(ex)ex.qty=num(ex.qty)+1;else{const o=(App.offersFor?App.offersFor(p):[]).filter(x=>x.price>0&&(!F.supplierId||x.supplierId===F.supplierId))[0];F.lines.push({productId:p.id,qty:1,cost:o?o.price:num(p.cost)})}keep();draw();setTimeout(()=>{const q=$("#poQ");if(q)q.focus()},0)}});
  document.querySelectorAll(".poq").forEach(el=>el.addEventListener("change",()=>{F.lines[+el.dataset.i][el.dataset.k]=num(el.value);keep();draw()}));
  const sp=$("#poSup");if(sp)sp.addEventListener("change",()=>{keep();draw()});
}
const keep=()=>{const V=App.val;if(!$("#poSup"))return;F.supplierId=V("poSup");F.whId=V("poWh");F.expectedDate=V("poDate");F.note=V("poNote")};
ACT.poDel=i=>{keep();F.lines.splice(+i,1);draw()};
ACT.poSave=(st,btn)=>run(btn,async()=>{keep();
  if(!F.supplierId)throw new Error("Выберите поставщика");if(!F.lines.length)throw new Error("Добавьте товары");if(F.lines.some(l=>!(num(l.qty)>=1)))throw new Error("Количество должно быть не меньше 1");
  const row={supplier_id:F.supplierId,wh_id:F.whId||null,expected_date:F.expectedDate||null,note:F.note||null,status:st};
  let id=F.id;
  if(id){await App.api.update("purchase_orders",id,row);const old=(App.byId("porders",id)||{lines:[]}).lines;for(const l of old)await App.api.remove("purchase_order_lines",l.id)}
  else id=(await App.api.insert("purchase_orders",row)).id;
  await App.api.insertMany("purchase_order_lines",F.lines.map(l=>({po_id:id,product_id:l.productId,qty:Math.round(num(l.qty)),cost:num(l.cost)})));
  await App.reload(["porders"]);App.toast(st==="sent"?"Заказ отправлен — распечатайте или скопируйте его для поставщика":"Черновик сохранён");
  App.ui.supTab="po";App.closeModal();if(App.ui.view!=="suppliers")location.hash="suppliers";else App.render();
  if(st==="sent")view(App.byId("porders",id));
});
ACT.poDelete=(_,btn)=>{if(!App.confirm2(btn,"Удалить черновик? Ещё раз"))return;run(btn,async()=>{await App.api.remove("purchase_orders",F.id);await App.reload(["porders"]);App.closeModal();App.toast("Удалено")})};

/* ---------- просмотр заказа ---------- */
function view(o){if(!o)return;const cost=App.can("cost"),s=App.byId("suppliers",o.supplierId)||{};
  const docs=S.docs.filter(d=>d.poId===o.id);
  App.openModal(App.head(esc(o.num)+" · "+esc(supName(o.supplierId)),pill(o.status))+`
    <div class="kv"><div><span>Склад</span><b>${esc(App.whName(o.whId))}</b></div><div><span>Ожидаем</span><b>${o.expectedDate?App.dt(o.expectedDate):"—"}</b></div>
      ${s.phone||s.contact?`<div><span>Контакт</span><b>${esc([s.contact,s.phone].filter(Boolean).join(" · "))}</b></div>`:""}${o.note?`<div><span>Комментарий</span><b>${esc(o.note)}</b></div>`:""}</div>
    <div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Заказано</th><th class="n">Принято</th>${cost?'<th class="n">Цена</th><th class="n">Сумма</th>':""}</tr></thead><tbody>
      ${o.lines.map(l=>`<tr><td>${esc((App.byId("products",l.productId)||{}).name||"—")}</td><td class="n">${l.qty}</td><td class="n ${l.received>=l.qty?"okc":l.received?"":"muted"}">${l.received}</td>${cost?`<td class="n">${money(l.cost)}</td><td class="n">${money(l.qty*l.cost)}</td>`:""}</tr>`).join("")}</tbody></table></div>
    ${cost?`<div class="total"><span>Итого</span><b>${money(App.poSum(o))}</b></div>`:""}
    ${docs.length?`<p class="muted">Приёмки по заказу: ${docs.map(d=>`<a href="#" data-act="openDoc" data-id="${esc(d.id)}">${esc(d.num)}</a>`).join(", ")}</p>`:""}
    <div class="acts">
      <button class="btn" data-act="poPrint" data-id="${o.id}">Печать</button><button class="btn" data-act="poCopy" data-id="${o.id}">Скопировать текст</button>
      ${App.can("stock")&&isOpen(o)?`<button class="btn danger" data-act="poCancel" data-id="${o.id}">Отменить</button>`:""}
      ${App.can("stock")&&o.status==="partial"?`<button class="btn" data-act="poClose" data-id="${o.id}">Закрыть без остатка</button>`:""}
      ${App.can("stock")&&["sent","partial"].includes(o.status)?`<button class="btn pri" data-act="poReceive" data-id="${o.id}">Принять товар по заказу</button>`:""}
    </div>`,{wide:true})}
const txt=o=>`Заказ ${o.num} от ${App.settings().shopName||"iCase"}\n`+o.lines.map((l,i)=>{const p=App.byId("products",l.productId)||{};return `${i+1}. ${p.name}${p.sku?" (арт. "+p.sku+")":""} — ${l.qty} шт`}).join("\n")+(o.expectedDate?`\nНужно к ${App.dt(o.expectedDate)}`:"")+(o.note?`\n${o.note}`:"");
ACT.poCopy=id=>ACT.copyTxt(txt(App.byId("porders",id)));
ACT.poPrint=id=>{const o=App.byId("porders",id),st=App.settings(),cost=App.can("cost");
  App.printHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.num)}</title><style>@page{size:A4;margin:14mm}body{font:11pt Arial,sans-serif}h1{font-size:16pt;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}.n{text-align:right}</style></head><body>
  <h1>Заказ поставщику ${esc(o.num)}</h1><div>${esc(st.shopName||"iCase")}${st.inn?" · ИНН "+esc(st.inn):""} → <b>${esc(supName(o.supplierId))}</b> · ${App.dt(o.createdAt)}${o.expectedDate?" · поставка к "+App.dt(o.expectedDate):""}</div>
  <table><tr><th>№</th><th>Товар</th><th>Артикул</th><th class="n">Кол-во</th>${cost?'<th class="n">Цена</th><th class="n">Сумма</th>':""}</tr>${o.lines.map((l,i)=>{const p=App.byId("products",l.productId)||{};return `<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${esc(p.sku||p.barcode||"")}</td><td class="n">${l.qty}</td>${cost?`<td class="n">${money(l.cost)}</td><td class="n">${money(l.qty*l.cost)}</td>`:""}</tr>`}).join("")}
  ${cost?`<tr><td colspan="5"><b>Итого</b></td><td class="n"><b>${money(App.poSum(o))}</b></td></tr>`:""}</table>${o.note?`<p>${esc(o.note)}</p>`:""}</body></html>`)};
ACT.poCancel=(id,btn)=>{if(!App.confirm2(btn,"Отменить заказ? Ещё раз"))return;run(btn,async()=>{await App.api.update("purchase_orders",id,{status:"cancelled"});await App.reload(["porders"]);App.closeModal();App.toast("Заказ отменён")})};
ACT.poClose=(id,btn)=>run(btn,async()=>{await App.api.update("purchase_orders",id,{status:"done"});await App.reload(["porders"]);App.closeModal();App.toast("Заказ закрыт")});
ACT.poReceive=id=>{const o=App.byId("porders",id);
  const lines=o.lines.filter(l=>l.qty>l.received).map(l=>({productId:l.productId,qty:l.qty-l.received,cost:l.cost}));
  if(!App.rcvLoad)return App.toast("Раздел приёмки недоступен");
  App.rcvLoad({wh:o.whId,supplierId:o.supplierId,poId:o.id,invoice:"",note:"По заказу "+o.num,lines});App.closeModal();location.hash="receive";App.toast("Остаток заказа в приёмке — проверьте количество и проведите")};

/* ---------- заказ из аналитики ---------- */
App.poFromNeeds=async function(rows){ // rows: [{p, need}]
  const by={};rows.filter(r=>r.need>0).forEach(r=>{const o=(App.offersFor?App.offersFor(r.p):[]).filter(x=>x.price>0)[0];const sid=o?o.supplierId:"";(by[sid]=by[sid]||[]).push({productId:r.p.id,qty:Math.ceil(r.need),cost:o?o.price:num(r.p.cost)})});
  const groups=Object.entries(by);if(!groups.length)throw new Error("Заказывать нечего");
  if(groups.length===1&&!groups[0][0]){App.closeModal();ACT.poNew(null,null,{lines:groups[0][1]});return}
  let n=0;for(const [sid,lines] of groups){if(!sid)continue;const po=await App.api.insert("purchase_orders",{supplier_id:sid,wh_id:App.cashWh()||null,status:"draft"});
    await App.api.insertMany("purchase_order_lines",lines.map(l=>({po_id:po.id,product_id:l.productId,qty:l.qty,cost:l.cost})));n++}
  await App.reload(["porders"]);App.closeModal();App.ui.supTab="po";App.ui.poSt="draft";location.hash="suppliers";if(App.ui.view==="suppliers")App.render();
  const rest=by[""];App.toast(`Создано черновиков: ${n}`+(rest?` · ${rest.length} поз. без поставщика — добавьте вручную`:""));
};
})();
