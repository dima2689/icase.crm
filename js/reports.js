/* iCase CRM v3 · отчёты, импорт, экспорт (Supabase) */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.reports="Отчёты";
Object.assign(App.ui,{repPeriod:"month",repFrom:"",repTo:"",repPoint:""});
function bars(rows,fmt=money){const max=Math.max(1,...rows.map(r=>Math.abs(r[1])));
  return `<div class="hbars">${rows.map(([l,v,sub])=>`<div class="hb"><span class="hb-l">${esc(l)}${sub?`<small>${esc(sub)}</small>`:""}</span><span class="hb-t"><i style="width:${Math.max(1,Math.abs(v)/max*100)}%"></i></span><b>${fmt(v)}</b></div>`).join("")||'<div class="empty sm">Нет данных</div>'}</div>`}
VIEWS.reports={
  actions:()=>App.can("io")?'<button class="btn" data-act="exportDlg">Экспорт данных</button>':"",
  render(){
    const u=App.ui,[from,to]=App.periodRange(u.repPeriod,u.repFrom,u.repTo),st=App.periodStats(from,to,u.repPoint||null),cost=App.can("cost");
    const byPoint=App.points(true).map(p=>[p.name,App.periodStats(from,to,p.id).rev]);
    // по категориям и товарам
    const byCat={},byProd={},bySeller={},byPay={};
    st.sales.forEach(s=>{(s.items||[]).forEach(i=>{const p=App.byId("products",i.productId)||{};const k=App.catName(p).split(" / ")[0];const v=i.qty*i.price-num(i.disc);
      byCat[k]=(byCat[k]||0)+v;const pk=i.name;byProd[pk]=byProd[pk]||{v:0,q:0,pr:0};byProd[pk].v+=v;byProd[pk].q+=i.qty;byProd[pk].pr+=v-num(i.cost)*i.qty});
      bySeller[s.by||""]=(bySeller[s.by||""]||0)+num(s.total);(s.payments||[]).forEach(p=>byPay[p.method]=(byPay[p.method]||0)+num(p.amount))});
    const top=Object.entries(byProd).sort((a,b)=>b[1].v-a[1].v).slice(0,10);
    const repByMaster={};st.reps.forEach(r=>{const k=r.master||"Без мастера";repByMaster[k]=repByMaster[k]||{v:0,n:0,d:0};repByMaster[k].v+=num(r.finalPrice);repByMaster[k].n++;repByMaster[k].d+=App.days(r.createdAt,r.closedAt)});
    const inP=d=>{const t=new Date(d);return t>=from&&t<to};
    const accepted=S.repairs.filter(r=>inP(r.createdAt)).length;
    const whVal=App.whs().map(w=>{let c=0,p=0;S.products.forEach(x=>{const q=App.qtyIn(x,w.id);if(q>0){c+=q*num(x.cost);p+=q*num(x.price)}});return[w.name,c,p]});
    const shifts=S.shifts.filter(s=>s.status==="closed"&&inP(s.closedAt));
    const shortage=shifts.reduce((a,s)=>a+num(s.diff),0);
    const wo=S.movements.filter(m=>m.type==="writeoff"&&inP(m.at));
    const woSum=wo.reduce((a,m)=>{const p=App.byId("products",m.productId);return a+(p?-num(m.qty)*num(p.cost):0)},0);
    const inv=S.docs.filter(d=>d.type==="inventory"&&d.status==="posted"&&inP(d.postedAt));
    return `<div class="row-f">${App.sel("repPoint",[["","Все точки"],...App.points(true).map(p=>[p.id,p.name])],u.repPoint,'data-filter-sel="repPoint" aria-label="Точка"')}${App.sel("repPeriod",[...App.PERIODS,["custom","Свой период"]],u.repPeriod,'data-filter-sel="repPeriod" aria-label="Период"')}
      ${u.repPeriod==="custom"?App.inp("repFrom",u.repFrom,"date","",'data-filter-sel="repFrom" aria-label="С"')+App.inp("repTo",u.repTo,"date","",'data-filter-sel="repTo" aria-label="По"'):""}
      <span class="muted">${from.getFullYear()>2000?from.toLocaleDateString("ru-RU"):"начало"} — ${new Date(+to-1).toLocaleDateString("ru-RU")}</span></div>
    <div class="tiles">
      <div class="tile"><span>Выручка</span><b>${money(st.rev)}</b><small>продажи ${money(st.saleRev)} · ремонт ${money(st.repRev)}</small></div>
      ${cost?`<div class="tile"><span>Валовая прибыль</span><b>${money(st.profit)}</b><small>маржа ${st.rev?Math.round(st.profit/st.rev*100):0}%</small></div>`:""}
      <div class="tile"><span>Чеков</span><b>${st.count}</b><small>средний ${money(st.avg)}</small></div>
      <div class="tile ${st.retSum?"alert":""}"><span>Возвраты</span><b>${money(st.retSum)}</b><small>${st.rets.length} шт</small></div>
      <div class="tile"><span>Ремонт</span><b>${st.reps.length}</b><small>закрыто · принято ${accepted}</small></div>
      ${cost?`<div class="tile ${woSum?"alert":""}"><span>Списано</span><b>${money(woSum)}</b><small>по закупке</small></div>`:""}
    </div>
    ${!u.repPoint&&byPoint.length>1?`<section class="card"><div class="card-h"><h2>Выручка по точкам</h2></div>${bars(byPoint.sort((a,b)=>b[1]-a[1]))}</section>`:""}
    <div class="grid g2">
      <section class="card"><div class="card-h"><h2>Продажи по категориям</h2></div>${bars(Object.entries(byCat).sort((a,b)=>b[1]-a[1]))}</section>
      <section class="card"><div class="card-h"><h2>По способам оплаты</h2><span class="pill">продажи</span></div>${bars(Object.entries(byPay).map(([m,v])=>[App.payLabel(m),v]).sort((a,b)=>b[1]-a[1]))}</section>
    </div>
    <div class="grid g2">
      <section class="card"><div class="card-h"><h2>Топ товаров</h2></div><div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Шт</th><th class="n">Выручка</th>${cost?'<th class="n">Прибыль</th>':""}</tr></thead><tbody>
      ${top.map(([n,x])=>`<tr><td>${esc(n)}</td><td class="n">${x.q}</td><td class="n">${money(x.v)}</td>${cost?`<td class="n">${money(x.pr)}</td>`:""}</tr>`).join("")||'<tr><td colspan="4" class="empty">Нет продаж</td></tr>'}</tbody></table></div></section>
      <section class="card"><div class="card-h"><h2>Продавцы</h2></div>${bars(Object.entries(bySeller).map(([id,v])=>[App.nameOf(id),v]).sort((a,b)=>b[1]-a[1]))}</section>
    </div>
    <div class="grid g2">
      <section class="card"><div class="card-h"><h2>Ремонт по мастерам</h2></div><div class="tbl-wrap"><table><thead><tr><th>Мастер</th><th class="n">Закрыто</th><th class="n">Выручка</th><th class="n">Средний срок</th></tr></thead><tbody>
      ${Object.entries(repByMaster).map(([m,x])=>`<tr><td>${esc(m)}</td><td class="n">${x.n}</td><td class="n">${money(x.v)}</td><td class="n">${Math.round(x.d/x.n*10)/10} дн.</td></tr>`).join("")||'<tr><td colspan="4" class="empty">Нет закрытых ремонтов</td></tr>'}</tbody></table></div></section>
      <section class="card"><div class="card-h"><h2>Склады сейчас</h2></div><div class="tbl-wrap"><table><thead><tr><th>Склад</th>${cost?'<th class="n">В закупке</th>':""}<th class="n">В рознице</th></tr></thead><tbody>
      ${whVal.map(([n,c,p])=>`<tr><td>${esc(n)}</td>${cost?`<td class="n">${money(c)}</td>`:""}<td class="n">${money(p)}</td></tr>`).join("")}</tbody></table></div></section>
    </div>
    <div class="grid g2">
      <section class="card"><div class="card-h"><h2>Кассовые смены</h2><span class="pill ${Math.abs(shortage)>=1?"bad":"ok"}">расхождения ${money(shortage)}</span></div><div class="list-mini">
      ${App.sortDesc(shifts,"closedAt").slice(0,8).map(s=>`<button data-act="openShift" data-id="${esc(s.id)}"><span>${esc(s.num)} · ${App.dt(s.openedAt)}<small>${esc(App.nameOf(s.openedBy))} · продажи ${money(App.shiftTotals(s).sales)}</small></span><span class="pill ${Math.abs(num(s.diff))<1?"ok":"bad"}">${money(s.diff)}</span></button>`).join("")||'<div class="empty sm">Закрытых смен нет</div>'}</div></section>
      <section class="card"><div class="card-h"><h2>Инвентаризации</h2></div><div class="list-mini">
      ${inv.map(d=>{const diff=(d.lines||[]).reduce((a,l)=>a+(num(l.counted)-num(l.expected))*num(l.cost),0);return `<button data-act="openDoc" data-id="${esc(d.id)}"><span>${esc(d.num)} · ${esc(App.whName(d.whTo))}<small>${App.dt(d.postedAt)} · ${(d.lines||[]).length} позиций</small></span>${cost?`<span class="pill ${diff<0?"bad":"ok"}">${money(diff)}</span>`:""}</button>`}).join("")||'<div class="empty sm">Не проводились</div>'}</div></section>
    </div>`;
  }
};

/* ======================= ЭКСПОРТ ======================= */
const EXPORTS={
  products:["Товары и остатки",()=>{const whs=App.whs();return[["Название","Категория","Бренд","Состояние","Артикул","Штрихкод","IMEI",...(App.can("cost")?["Закупка"]:[]),"Цена",...whs.map(w=>"Остаток: "+w.name),"Всего","Мин. остаток","Сайт","Авито","Архив"],
    ...S.products.map(p=>[p.name,App.catName(p),p.brand,p.condition,p.sku,p.barcode,p.serial,...(App.can("cost")?[num(p.cost)]:[]),num(p.price),...whs.map(w=>App.qtyIn(p,w.id)),App.qtyTotal(p),num(p.minQty),p.onSite?"да":"",p.onAvito?"да":"",p.archived?"да":""])]}],
  customers:["Клиенты",()=>[["Имя","Телефон","Доп. телефон","Email","День рождения","Откуда","Скидка %","Метки","Чёрный список","Заметка","Создан"],
    ...S.customers.filter(c=>!c.mergedInto).map(c=>[c.name,c.phone,c.phone2,c.email,c.birthday,c.source,num(c.discount),(c.tags||[]).join(", "),c.blacklisted?"да":"",c.note,App.dt(c.createdAt)])]],
  sales:["Продажи (построчно)",()=>[["Чек","Дата","Клиент","Телефон","Товар","IMEI","Кол-во","Цена","Скидка строки","Сумма строки",...(App.can("cost")?["Себестоимость"]:[]),"Итог чека","Оплата","Продавец","Статус"],
    ...App.sortDesc(S.sales).flatMap(s=>{const c=App.cust(s.customerId)||{};return(s.items||[]).map(i=>[s.num,App.dtt(s.createdAt),c.name,c.phone,i.name,i.serial,i.qty,i.price,num(i.disc),i.qty*i.price-num(i.disc),...(App.can("cost")?[num(i.cost)*i.qty]:[]),s.total,App.paysText(s.payments),App.nameOf(s.by),s.status==="returned"?"возврат":s.status==="partial"?"частичный возврат":""])})]],
  repairs:["Ремонты",()=>[["№","Принят","Клиент","Телефон","Устройство","IMEI","Неисправность","Статус","Мастер","Работы","Запчасти","Итог","Закрыт"],
    ...App.sortDesc(S.repairs).map(r=>{const c=App.cust(r.customerId)||{};return[r.num,App.dtt(r.createdAt),c.name,c.phone,r.device,r.imei,r.problem,(App.RS[r.status]||{}).label,r.master,App.repairWorksSum(r),App.repairPartsSum(r),App.repairTotal(r),App.dtt(r.closedAt)]})]],
  movements:["Движение товара",()=>[["Когда","Товар","Операция","Склад","Кол-во","Основание","Комментарий","Сотрудник"],
    ...App.sortDesc(S.movements,"at").map(m=>[App.dtt(m.at),m.productName,App.MOVE[m.type]||m.type,App.whName(m.whId),m.qty,m.ref,m.note,App.nameOf(m.by)])]],
  cashops:["Кассовые операции",()=>[["Когда","Смена","Операция","Способ","Сумма","Основание","Комментарий","Сотрудник"],
    ...App.sortDesc(S.cashops,"at").map(o=>[App.dtt(o.at),(App.byId("shifts",o.shiftId)||{}).num,App.CASHOP[o.type]||o.type,App.payLabel(o.method),o.amount,o.ref,o.note,App.nameOf(o.by)])]]
};
ACT.exportDlg=pre=>{
  if(!App.can("io"))return App.toast("Экспорт доступен управляющему и владельцу");
  App.openModal(App.head("Экспорт в CSV")+`<p class="muted">Файл откроется в Excel и Google Таблицах (разделитель «;», кодировка UTF-8).</p>
  <div class="list-mini">${Object.entries(EXPORTS).map(([k,[l]])=>`<button data-act="exportGo" data-id="${k}"><span>${l}<small>${k==="products"?S.products.length:k==="customers"?S.customers.length:k==="sales"?S.sales.length:k==="repairs"?S.repairs.length:k==="movements"?S.movements.length:S.cashops.length} записей</small></span><span class="pill ${pre===k?"dark":""}">Скачать</span></button>`).join("")}</div>`);
};
ACT.exportGo=async k=>{const [l,fn]=EXPORTS[k];const d=new Date().toISOString().slice(0,10);App.download(`icase-${k}-${d}.csv`,App.toCSV(fn()));await App.api.audit("Экспорт",l,"")};

/* ======================= ИМПОРТ ======================= */
const PFIELDS=[["name","Название",["наименование","название","товар","name","title"]],["category","Категория",["группы","группа","категория","category","раздел"]],["brand","Бренд",["бренд","производитель","brand"]],
  ["condition","Состояние",["состояние","condition"]],["model","Модель",["модель","model"]],["memory","Память",["память","объём памяти","объем памяти","memory"]],["color","Цвет",["цвет","color"]],["sku","Артикул",["артикул","sku"]],["barcode","Штрихкод",["штрихкод ean13","штрихкод","штрих-код","barcode","ean"]],["serial","IMEI",["imei","серийный номер","серийный","serial","s/n"]],
  ["cost","Закупка",["закупочная цена","закупка","себестоимость","cost"]],["price","Цена",["цена: цена продажи","цена продажи","розничная цена","розница","price","цена"]],["qty","Количество",["остаток","количество","кол-во","qty","stock"]],["minQty","Мин. остаток",["неснижаемый остаток","минимальный остаток","мин. остаток"]]];
const CFIELDS=[["name","Имя",["имя","фио","клиент","name"]],["phone","Телефон",["телефон","phone","тел","мобильный"]],["email","Email",["email","почта","e-mail"]],["birthday","День рождения",["день рождения","дата рождения","birthday"]],["note","Заметка",["заметка","комментарий","note","примечание"]],["discount","Скидка %",["скидка","discount"]]];
ACT.importDlg=kind=>{
  if(!App.can("io"))return App.toast("Импорт доступен управляющему и владельцу");
  kind=kind==="customers"?"customers":"products";
  App.openModal(App.head("Импорт "+(kind==="products"?"товаров":"клиентов"))+`
  <p class="muted">Сохраните таблицу Excel как CSV (UTF-8) и выберите файл. Первая строка — названия колонок. ${kind==="products"?"Товары с тем же артикулом, штрихкодом или IMEI обновятся, новые будут созданы. Остатки придут документом прихода.":"Клиенты с уже существующим телефоном пропускаются."}</p>
  <div class="tabs"><button class="tab ${kind==="products"?"on":""}" data-act="importDlg" data-id="products">Товары</button><button class="tab ${kind==="customers"?"on":""}" data-act="importDlg" data-id="customers">Клиенты</button></div>
  <input type="file" id="impFile" accept=".csv,.txt,text/csv">
  <div id="impMap"></div>`,{wide:true});
  $("#impFile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;
    let text=await f.text();if(text.includes("�")){try{text=new TextDecoder("windows-1251").decode(await f.arrayBuffer())}catch(_){}}
    const rows=App.parseCSV(text);if(rows.length<2)return App.toast("В файле нет данных");
    mapStep(kind,rows)});
};
function mapStep(kind,rows){
  const head=rows[0].map(h=>h.trim()),F=kind==="products"?PFIELDS:CFIELDS;
  const H=head.map(h=>h.toLowerCase());
  const guess=f=>{for(const a of f[2]){const i=H.indexOf(a);if(i>=0)return i}
    for(const a of f[2]){const i=H.findIndex(h=>h.includes(a)&&!(f[0]==="price"&&/закуп|себест/.test(h))&&!(f[0]==="qty"&&/неснижаем|мин/.test(h)));if(i>=0)return i}return -1};
  $("#impMap").innerHTML=`<h3 class="sub-h">Сопоставление колонок · строк: ${rows.length-1}</h3><div class="form">${F.map(f=>App.fld("im_"+f[0],f[1],App.sel("im_"+f[0],[["-1","— не загружать —"],...head.map((h,i)=>[String(i),h||"Колонка "+(i+1)])],String(guess(f))))).join("")}
  ${kind==="products"?App.fld("impWh","Остатки на склад",App.sel("impWh",App.whs().map(w=>[w.id,w.name]),App.cashWh()))+App.fld("impCat","Категория по умолчанию",App.sel("impCat",App.catOpts(),"")):""}</div>
  <div class="tbl-wrap"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1,6).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
  <div class="acts"><button class="btn pri" data-act="importGo" data-id="${kind}">Загрузить ${rows.length-1} строк</button></div>`;
  App.impRows=rows;
}
ACT.importGo=async(kind,btn)=>{
  if(btn.disabled)return;btn.disabled=true;btn.textContent="Загружаем…";
  const rows=App.impRows.slice(1),F=kind==="products"?PFIELDS:CFIELDS;
  const col={};F.forEach(f=>col[f[0]]=+App.val("im_"+f[0]));
  const g=(r,k)=>col[k]>=0?String(r[col[k]]||"").trim():"";
  let created=0,updated=0,skipped=0,errors=0;
  const chunks=(a,n)=>{const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o};
  try{
  if(kind==="customers"){
    if(col.phone<0){btn.disabled=false;return App.toast("Укажите колонку с телефоном")}
    const seen=new Set(S.customers.map(c=>App.phoneKey(c.phone))),batch=[];
    for(const r of rows){const k=App.phoneKey(g(r,"phone"));if(k.length!==10){errors++;continue}
      if(seen.has(k)){skipped++;continue}seen.add(k);
      const bd=g(r,"birthday"),iso=/^\d{4}-\d\d-\d\d$/.test(bd)?bd:(/^(\d\d)\.(\d\d)\.(\d{4})$/.test(bd)?bd.replace(/^(\d\d)\.(\d\d)\.(\d{4})$/,"$3-$2-$1"):null);
      batch.push({name:g(r,"name")||"Без имени",phone:k,email:g(r,"email")||null,birthday:iso,note:g(r,"note")||null,discount:Math.min(100,num(g(r,"discount"))),source:"Импорт"})}
    for(const c of chunks(batch,500)){await App.api.insertMany("customers",c);created+=c.length;btn.textContent="Загружено "+created+"…"}
  }else{
    if(col.name<0){btn.disabled=false;return App.toast("Укажите колонку с названием")}
    const wh=App.val("impWh"),defCat=App.val("impCat")||null,lines=[],fresh=[];
    const cats=new Map(S.categories.map(c=>[String(c.name).toLowerCase(),c.id]));
    const catId=async raw=>{const n=String(raw||"").split("/").pop().trim();if(!n)return defCat;const k=n.toLowerCase();
      if(!cats.has(k)){const c=await App.api.insert("categories",{name:n});cats.set(k,c.id)}return cats.get(k)};
    const usedKeys=new Set();
    for(const r of rows){const name=g(r,"name");if(!name){errors++;continue}
      const keys={sku:g(r,"sku"),barcode:g(r,"barcode"),serial:g(r,"serial")};
      const dupKey=Object.values(keys).find(v=>v&&usedKeys.has(v.toLowerCase()));if(dupKey){skipped++;continue}
      Object.values(keys).forEach(v=>v&&usedKeys.add(v.toLowerCase()));
      const ex=S.products.find(p=>!p.archived&&Object.entries(keys).some(([k,v])=>v&&String(p[k]||"").toLowerCase()===v.toLowerCase()));
      const cond=App.CONDS.find(c=>c.toLowerCase()===g(r,"condition").toLowerCase());
      const data={name,category_id:await catId(g(r,"category")),brand:g(r,"brand")||null,model:g(r,"model")||null,memory:g(r,"memory")||null,color:g(r,"color")||null,sku:keys.sku||null,barcode:keys.barcode||null,serial:keys.serial||null};
      if(cond)data.condition=cond;
      if(col.price>=0)data.price=num(g(r,"price"));if(col.cost>=0&&App.can("cost"))data.cost=num(g(r,"cost"));if(col.minQty>=0)data.min_qty=num(g(r,"minQty"));
      const q=num(g(r,"qty"));
      if(ex){Object.keys(data).forEach(k=>{if(data[k]==null&&k!=="category_id")delete data[k]});if(!data.category_id)delete data.category_id;
        await App.api.update("products",ex.id,data);updated++;if(q>0)lines.push({product_id:ex.id,qty:q,cost:num(data.cost)})}
      else fresh.push({data,q});
    }
    for(const part of chunks(fresh,300)){const ins=await App.api.insertMany("products",part.map(x=>x.data));
      ins.forEach((p,i)=>{created++;if(part[i].q>0)lines.push({product_id:p.id,qty:part[i].q,cost:num(part[i].data.cost)})});btn.textContent="Загружено "+created+"…"}
    if(lines.length)await App.api.doc({type:"in",wh_to:wh,note:"Импорт из CSV"},lines,true);
  }
  await App.api.audit("Импорт",kind==="products"?"Товары":"Клиенты",`создано ${created}, обновлено ${updated}, пропущено ${skipped}, ошибок ${errors}`);
  App.closeModal();App.toast(`Готово: создано ${created}, обновлено ${updated}${skipped?", пропущено "+skipped:""}${errors?", пропущено с ошибками "+errors:""}`);
  App.reload(["products","customers","categories","docs","movements"]);
  }catch(e){btn.disabled=false;btn.textContent="Повторить";App.toast("Импорт прерван: "+e.message+". Загружено: "+(created+updated))}
};
})();
