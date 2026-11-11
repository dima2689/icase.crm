/* iCase CRM v3 · настройки и справочники (Supabase) */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.settings="Настройки";
App.ui.setTab="shop";
const TABS=[["shop","Магазин"],["points","Точки и склады"],["categories","Категории"],["catalog","Каталог Apple"],["suppliers","Поставщики"],["services","Прайс работ"],["loyalty","Бонусы"],["evotor","Эвотор"],["site","Сайт"],["staff","Сотрудники"],["log","Журнал"],["data","Данные"]];
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
VIEWS.settings={
  render(){
    const t=App.ui.setTab;
    const body={shop,points,categories,catalog:()=>App.catalogTab(),site:()=>App.siteTab(),suppliers,services,staff,log,data,loyalty:()=>App.loyaltyTab?App.loyaltyTab():"",evotor:()=>App.evoTab?App.evoTab():""}[t]();
    return `<div class="tabs">${TABS.filter(([k])=>k!=="staff"||App.can("staff")).filter(([k])=>!["site","evotor","loyalty"].includes(k)||App.can("settings")).filter(([k])=>k!=="log"||App.can("log")).map(([k,l])=>`<button class="tab ${t===k?"on":""}" data-act="settingsTab" data-id="${k}">${l}</button>`).join("")}</div>${body}`;
  }
};
ACT.settingsTab=k=>{App.ui.setTab=k;if(App.ui.view!=="settings")location.hash="settings";else App.render()};

/* ---------- магазин ---------- */
function shop(){
  const s=App.settings(),ed=App.can("settings");
  return `<section class="card"><div class="card-h"><h2>Магазин и правила</h2></div><div class="form">
    ${App.fld("sName","Название",App.inp("sName",s.shopName))}${App.fld("sCity","Город",App.inp("sCity",s.city))}
    ${App.fld("sAddr","Адрес (по умолчанию для чеков)",App.inp("sAddr",s.address))}${App.fld("sPhone","Телефон",App.inp("sPhone",s.phone))}
    ${App.fld("sLegal","Продавец для документов",App.inp("sLegal",s.legalName,"text","ИП Фамилия Имя Отчество"))}${App.fld("sInn","ИНН",App.inp("sInn",s.inn))}${App.fld("sOgrn","ОГРНИП",App.inp("sOgrn",s.ogrnip))}
    ${App.fld("sSite","Сайт (QR в чеке)",App.inp("sSite",s.siteUrl,"url","https://…"))}${App.fld("sRev","Ссылка на отзывы (QR в чеке)",App.inp("sRev",s.reviewUrl,"url","Яндекс Карты, 2ГИС, Авито"))}
    ${App.fld("sWarr","Гарантия на устройства, мес.",App.inp("sWarr",s.deviceWarrantyMonths,"number"))}${App.fld("sRw","Гарантия на ремонт, дней",App.inp("sRw",s.repairWarrantyDays,"number"))}
    ${App.fld("sStore","Бесплатное хранение готовых ремонтов, дней",App.inp("sStore",s.storageDays,"number"))}${App.fld("sDead","Товар «залежался» через, дней",App.inp("sDead",s.deadDays,"number"))}
    ${App.fld("sAck","Отметка покупателя в товарном чеке",App.inp("sAck",s.receiptAck),"full")}${App.fld("sFoot","Подпись в чеке",App.inp("sFoot",s.receiptFooter),"full")}
    <div class="fld full">${App.chk("sShift","Продажи только при открытой кассовой смене",s.requireShift)}</div>
    <div class="fld full"><label>Подтверждение управляющим или владельцем</label>
      ${App.chk("sApC","Новые товары, заведённые кладовщиком, — только после подтверждения (до этого их можно принять на склад, но нельзя продать)",!!(s.approvals||{}).productCreate)}
      ${App.chk("sApD","Удаление и отправка товаров в архив кладовщиком — только по запросу с подтверждением",!!(s.approvals||{}).productDelete)}
      <small class="muted">Создание, удаление, архив и переименование товаров всегда записываются в журнал.</small></div>
  </div><div class="acts">${ed?'<button class="btn pri" data-act="saveSettings">Сохранить</button>':'<span class="muted">Изменять может управляющий или владелец</span>'}</div></section>`;
}
ACT.saveSettings=(_,btn)=>run(btn,async()=>{
  const V=App.val;
  await App.api.update("settings",1,{shop_name:V("sName")||"iCase",city:V("sCity"),address:V("sAddr")||null,phone:V("sPhone")||null,inn:V("sInn")||null,legal_name:V("sLegal")||null,ogrnip:V("sOgrn")||null,site_url:V("sSite")||null,review_url:V("sRev")||null,receipt_ack:V("sAck")||App.DEFAULTS.receiptAck,
    device_warranty_months:num(V("sWarr")),repair_warranty_days:num(V("sRw")),storage_days:num(V("sStore"))||30,dead_days:num(V("sDead"))||60,receipt_footer:V("sFoot")||null,require_shift:App.checked("sShift"),approvals:{productCreate:App.checked("sApC"),productDelete:App.checked("sApD")}});
  await App.api.audit("Настройки изменены","","");App.toast("Настройки сохранены");
});

/* ---------- точки и склады ---------- */
function points(){
  const ed=App.can("settings");
  const pts=App.points(true);
  return `<section class="card"><div class="card-h"><h2>Торговые точки</h2>${ed?'<button class="btn pri sm" data-act="pointForm">+ Точка</button>':""}</div>
  <p class="muted">У каждой точки своя касса и смены. Склад кассы — откуда продаём на этой точке, склад сервиса — откуда берём запчасти.</p>
  <div class="tbl-wrap"><table><thead><tr><th>Точка</th><th>Адрес</th><th>Склад кассы</th><th>Склад сервиса</th><th>Смена</th><th>Сотрудников</th></tr></thead><tbody>
  ${pts.map(p=>{const sh=App.openShift(p.id);return `<tr class="rowlink" data-act="pointForm" data-id="${esc(p.id)}"><td><b>${esc(p.name)}</b>${p.active===false?' <span class="pill mute">закрыта</span>':""}${p.patentNo?`<span class="sub">патент ${esc(p.patentNo)}</span>`:""}</td><td>${esc(p.address)}</td><td>${esc(App.whName(p.cashWh))}</td><td>${esc(App.whName(p.serviceWh))}</td><td>${sh?'<span class="pill ok">'+esc(sh.num)+'</span>':'<span class="pill mute">закрыта</span>'}</td><td class="n">${S.staff.filter(s=>s.pointId===p.id).length}</td></tr>`}).join("")||'<tr><td colspan="6" class="empty">Точек нет. Добавьте первую</td></tr>'}
  </tbody></table></div></section>
  <section class="card"><div class="card-h"><h2>Склады</h2>${ed?'<button class="btn pri sm" data-act="whForm">+ Склад</button>':""}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Склад</th><th>Точка</th><th>Тип</th><th class="n">Позиций</th><th class="n">Штук</th><th>Статус</th></tr></thead><tbody>
  ${App.whs(true).map(w=>{const ps=S.products.filter(p=>App.qtyIn(p,w.id)>0);return `<tr class="rowlink" data-act="whForm" data-id="${esc(w.id)}"><td><b>${esc(w.name)}</b></td><td>${w.pointId?esc(App.pointName(w.pointId)):'<span class="muted">общий</span>'}</td><td>${esc(w.kind)}</td><td class="n">${ps.length}</td><td class="n">${ps.reduce((a,p)=>a+App.qtyIn(p,w.id),0)}</td><td>${w.active===false?'<span class="pill mute">отключён</span>':'<span class="pill ok">работает</span>'}</td></tr>`}).join("")||'<tr><td colspan="6" class="empty">Складов нет</td></tr>'}
  </tbody></table></div></section>`;
}
ACT.pointForm=id=>{
  if(!App.can("settings"))return;
  const p=id?App.byId("points",id):{active:true};
  const whs=[["","— не выбран —"],...App.whs().map(w=>[w.id,w.name+(w.pointId&&w.pointId!==id?" ("+App.pointName(w.pointId)+")":"")])];
  App.openModal(App.head(id?"Точка "+esc(p.name):"Новая точка")+`<div class="form">
    ${App.fld("ptName","Название",App.inp("ptName",p.name,"text","iCase ТЦ «Октябрь»"))}${App.fld("ptPhone","Телефон",App.inp("ptPhone",p.phone,"tel"))}
    ${App.fld("ptAddr","Адрес",App.inp("ptAddr",p.address),"full")}
    ${App.fld("ptPatent","Номер патента (ПСН)",App.inp("ptPatent",p.patentNo))}${App.fld("ptEvo","Магазин в Эвоторе (ID)",App.inp("ptEvo",p.evotorStoreId,"text","понадобится для чеков"))}
    ${id?App.fld("ptCash","Склад кассы",App.sel("ptCash",whs,p.cashWh||""))+App.fld("ptSrv","Склад сервиса",App.sel("ptSrv",whs,p.serviceWh||"")):`<div class="fld full">${App.chk("ptMkWh","Создать склады «Зал» и «Сервис» для этой точки",true)}</div>`}
    <div class="fld">${App.chk("ptAct","Работает",p.active!==false)}</div>
  </div><div class="acts"><button class="btn pri" data-act="pointSave" data-id="${esc(id||"")}">Сохранить</button></div>`);
};
ACT.pointSave=(id,btn)=>run(btn,async()=>{
  const V=App.val;if(!V("ptName"))return App.toast("Укажите название");
  const data={name:V("ptName"),phone:V("ptPhone")||null,address:V("ptAddr")||null,patent_no:V("ptPatent")||null,evotor_store_id:V("ptEvo")||null,is_active:App.checked("ptAct")};
  if(id){data.cash_wh=V("ptCash")||null;data.service_wh=V("ptSrv")||null;
    if(!data.is_active&&App.openShift(id))return App.toast("На точке открыта смена. Закройте её перед закрытием точки");
    await App.api.update("points",id,data)}
  else{
    const p=await App.api.insert("points",data);
    if(App.checked("ptMkWh")){
      const hall=await App.api.insert("warehouses",{name:data.name+" · зал",kind:"Торговый зал",point_id:p.id});
      const srv=await App.api.insert("warehouses",{name:data.name+" · сервис",kind:"Сервис",point_id:p.id});
      await App.api.update("points",p.id,{cash_wh:hall.id,service_wh:srv.id});
    }
  }
  await App.api.audit(id?"Точка изменена":"Новая точка",data.name,"");App.closeModal();App.toast("Сохранено");
});
ACT.whForm=id=>{
  if(!App.can("settings"))return;
  const w=id?App.byId("warehouses",id):{kind:"Склад",active:true,pointId:(App.point()||{}).id||""};
  App.openModal(App.head(id?"Склад":"Новый склад")+`<div class="form">${App.fld("wName","Название",App.inp("wName",w.name,"text","Основной склад"))}${App.fld("wKind","Тип",App.sel("wKind",["Торговый зал","Склад","Сервис","Другое"],w.kind))}
  ${App.fld("wPoint","Точка",App.sel("wPoint",[["","Общий (без точки)"],...App.points(true).map(p=>[p.id,p.name])],w.pointId||""))}${App.fld("wOrder","Порядок",App.inp("wOrder",w.order||0,"number"))}
  ${App.fld("wAddr","Адрес",App.inp("wAddr",w.address),"full")}<div class="fld">${App.chk("wAct","Работает",w.active!==false)}</div></div>
  ${id?"":`<p class="muted" style="margin:10px 0 0">Склад можно привязать к точке или оставить общим (например, основной склад или склад в офисе). Товар на новый склад попадает через приёмку или перемещение.</p>`}
  <div class="acts">${id?`<button class="btn" data-act="whStock" data-id="${esc(id)}">Товары на складе</button>`:""}<button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="whSave" data-id="${esc(id||"")}">${id?"Сохранить":"Создать склад"}</button></div>`);
};
ACT.whSave=(id,btn)=>run(btn,async()=>{
  if(!App.val("wName"))return App.toast("Укажите название");
  if(id&&!App.checked("wAct")&&S.products.some(p=>App.qtyIn(p,id)>0))return App.toast("На складе есть товар. Переместите его перед отключением");
  const data={name:App.val("wName"),kind:App.val("wKind"),address:App.val("wAddr")||null,point_id:App.val("wPoint")||null,sort:num(App.val("wOrder")),is_active:App.checked("wAct")};
  if(id)await App.api.update("warehouses",id,data);else await App.api.insert("warehouses",data);
  await App.api.audit(id?"Склад изменён":"Новый склад",data.name,"");App.closeModal();App.toast("Сохранено");
});

/* ---------- категории ---------- */
function categories(){
  const cnt=id=>S.products.filter(p=>!p.archived&&App.inCat(p,id)).length;
  const row=(c,lvl)=>`<tr class="rowlink" data-act="catForm" data-id="${esc(c.id)}"><td style="padding-left:${10+lvl*22}px">${lvl?"— ":""}<b>${esc(c.name)}</b></td><td>${c.isDevice?'<span class="pill dark">устройство</span>':""}</td><td class="n">${cnt(c.id)}</td></tr>`;
  return `<section class="card"><div class="card-h"><h2>Категории</h2>${App.can("settings")?'<button class="btn pri sm" data-act="catForm">+ Категория</button>':""}</div>
  <p class="muted">Флажок «устройство» включает гарантию на устройства из настроек магазина. Подкатегории наследуют его.</p>
  <div class="tbl-wrap"><table><thead><tr><th>Название</th><th>Тип</th><th class="n">Товаров</th></tr></thead><tbody>
  ${App.catChildren("").map(c=>row(c,0)+App.catChildren(c.id).map(s=>row(s,1)).join("")).join("")||'<tr><td colspan="3" class="empty">Категорий нет</td></tr>'}
  </tbody></table></div></section>`;
}
ACT.catForm=id=>{
  if(!App.can("settings"))return;
  const c=id?App.cat(id):{parentId:"",isDevice:false};
  App.openModal(App.head(id?"Категория":"Новая категория",id&&App.can("del")?`<button class="btn sm danger" data-act="catDel" data-id="${esc(id)}">Удалить</button>`:"")+`<div class="form">
  ${App.fld("kName","Название",App.inp("kName",c.name))}${App.fld("kParent","Родительская",App.sel("kParent",[["","— верхний уровень —"],...App.catChildren("").filter(x=>x.id!==id).map(x=>[x.id,x.name])],c.parentId||""))}
  <div class="fld full">${App.chk("kDev","Устройство (гарантия на устройства)",c.isDevice)}</div>
  <div class="fld full">${App.chk("kUsed","Б/у техника — у каждого экземпляра параметры б/у (АКБ, ремонт, комплект…)",c.isUsed)}</div></div>
  <div class="acts"><button class="btn pri" data-act="catSave" data-id="${esc(id||"")}">Сохранить</button></div>`);
};
ACT.catSave=(id,btn)=>run(btn,async()=>{
  const name=App.val("kName");if(!name)return App.toast("Укажите название");
  const parentId=App.val("kParent");
  if(S.categories.some(c=>c.id!==id&&(c.parentId||"")===parentId&&String(c.name).toLowerCase()===name.toLowerCase()))return App.toast("Такая категория уже есть");
  if(id&&parentId&&App.catChildren(id).length)return App.toast("У категории есть подкатегории, её нельзя вложить");
  const data={name,parent_id:parentId||null,is_device:App.checked("kDev"),is_used:App.checked("kUsed")};
  if(id)await App.api.update("categories",id,data);else await App.api.insert("categories",data);
  App.closeModal();App.toast("Сохранено");
});
ACT.catDel=(id,el)=>run(null,async()=>{
  if(S.products.some(p=>p.categoryId===id)||App.catChildren(id).length)return App.toast("В категории есть товары или подкатегории. Перенесите их сначала");
  if(!App.confirm2(el,"Удалить? Нажмите ещё раз"))return;await App.api.remove("categories",id);App.closeModal();App.toast("Категория удалена");
});

/* ---------- поставщики ---------- */
function suppliers(){
  return `<section class="card"><div class="card-h"><h2>Поставщики</h2>${App.can("stock")?'<button class="btn pri sm" data-act="supForm">+ Поставщик</button>':""}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Название</th><th>Контакт</th><th>Телефон</th><th class="n">Приходов</th><th class="n">На сумму</th></tr></thead><tbody>
  ${S.suppliers.slice().sort((a,b)=>String(a.name).localeCompare(b.name)).map(s=>{const ds=S.docs.filter(d=>d.supplierId===s.id&&d.type==="in"&&d.status==="posted");return `<tr class="rowlink" data-act="supForm" data-id="${esc(s.id)}"><td><b>${esc(s.name)}</b><span class="sub">${esc(s.inn||"")}</span></td><td>${esc(s.contact||"")}</td><td>${esc(s.phone||"")}</td><td class="n">${ds.length}</td><td class="n">${App.can("cost")?money(ds.reduce((a,d)=>a+(d.lines||[]).reduce((b,l)=>b+num(l.qty)*num(l.cost),0),0)):"—"}</td></tr>`}).join("")||'<tr><td colspan="5" class="empty">Поставщиков нет</td></tr>'}
  </tbody></table></div></section>`;
}
ACT.supForm=id=>{
  if(!App.can("stock"))return;
  const s=id?App.byId("suppliers",id):{};
  App.openModal(App.head(id?"Поставщик":"Новый поставщик")+`<div class="form">${App.fld("uName","Название",App.inp("uName",s.name))}${App.fld("uInn","ИНН",App.inp("uInn",s.inn))}
  ${App.fld("uContact","Контактное лицо",App.inp("uContact",s.contact))}${App.fld("uPhone","Телефон",App.inp("uPhone",s.phone,"tel"))}${App.fld("uNote","Условия, заметки",App.area("uNote",s.note),"full")}</div>
  <div class="acts"><button class="btn pri" data-act="supSave" data-id="${esc(id||"")}">Сохранить</button></div>`);
};
ACT.supSave=(id,btn)=>run(btn,async()=>{if(!App.val("uName"))return App.toast("Укажите название");
  const d={name:App.val("uName"),inn:App.val("uInn")||null,contact:App.val("uContact")||null,phone:App.val("uPhone")||null,note:App.val("uNote")||null};
  if(id)await App.api.update("suppliers",id,d);else await App.api.insert("suppliers",d);App.closeModal();App.toast("Сохранено")});

/* ---------- прайс работ ---------- */
function services(){
  return `<section class="card"><div class="card-h"><h2>Прайс работ сервиса</h2><button class="btn sm" data-act="printServices">Печать</button>${App.can("settings")?'<button class="btn pri sm" data-act="svcForm">+ Работа</button>':""}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Работа</th><th>Группа</th><th class="n">Цена</th></tr></thead><tbody>
  ${S.services.slice().sort((a,b)=>String(a.group||"").localeCompare(b.group||"")||String(a.name).localeCompare(b.name)).map(s=>`<tr class="rowlink" data-act="svcForm" data-id="${esc(s.id)}"><td>${esc(s.name)}</td><td>${esc(s.group||"")}</td><td class="n"><b>${money(s.price)}</b></td></tr>`).join("")||'<tr><td colspan="3" class="empty">Прайс пуст</td></tr>'}
  </tbody></table></div></section>`;
}
ACT.svcForm=id=>{
  if(!App.can("settings"))return;
  const s=id?App.byId("services",id):{};
  App.openModal(App.head(id?"Работа":"Новая работа",id?`<button class="btn sm danger" data-act="svcDel" data-id="${esc(id)}">Удалить</button>`:"")+`<div class="form">${App.fld("vName","Название",App.inp("vName",s.name,"text","Замена дисплея iPhone 11"),"full")}${App.fld("vGroup","Группа",App.inp("vGroup",s.group,"text","iPhone"))}${App.fld("vPrice","Цена, ₽",App.inp("vPrice",s.price,"number"))}</div>
  <div class="acts"><button class="btn pri" data-act="svcSave" data-id="${esc(id||"")}">Сохранить</button></div>`);
};
ACT.svcSave=(id,btn)=>run(btn,async()=>{if(!App.val("vName"))return App.toast("Укажите название");const d={name:App.val("vName"),grp:App.val("vGroup")||null,price:num(App.val("vPrice"))};
  if(id)await App.api.update("services",id,d);else await App.api.insert("services",d);App.closeModal();App.toast("Сохранено")});
ACT.svcDel=(id,el)=>run(null,async()=>{if(!App.confirm2(el))return;await App.api.remove("services",id);App.closeModal()});

/* ---------- сотрудники ---------- */
function staff(){
  const reqs=S.staffreq.filter(r=>!App.byId("staff",r.id));
  const ptOpts=[["","— все / не привязан —"],...App.points().map(p=>[p.id,p.name])];
  const roles=Object.entries(App.ROLES).filter(([k])=>k!=="owner");
  const au=App.ui.authUsers||{};
  if(!App.ui.authUsers&&!App.ui.authLoading&&App.can("staff")){App.ui.authLoading=true;App.api.invoke("staff-admin",{action:"list"}).then(r=>{App.ui.authUsers=Object.fromEntries((r.users||[]).map(u=>[u.id,u]));App.ui.authLoading=false;App.render()}).catch(()=>{App.ui.authUsers={};App.ui.authLoading=false})}
  const stat=s=>{const u=au[s.id]||{};return s.active===false||u.banned?'<span class="pill bad">заблокирован</span>':u.invited?'<span class="pill warn">приглашён</span>':s.mustChange?'<span class="pill warn">временный пароль</span>':'<span class="pill ok">активен</span>'};
  const seen=s=>{const u=au[s.id]||{},t=u.last_sign_in_at||s.lastSeen;return t?App.dtt(t):'<span class="muted">не входил</span>'};
  return `<section class="card"><div class="card-h"><h2>Сотрудники и доступ</h2>${App.can("staff")?'<button class="btn pri sm" data-act="staffNew">+ Сотрудник</button>':""}</div>
  <p class="muted">Пригласите сотрудника по email или создайте вход с временным паролем — при первом входе он задаст свой. Нажмите на сотрудника, чтобы сменить роль, точку, прислать ссылку для входа, сбросить пароль или заблокировать.</p>
  ${reqs.length?`<h3 class="sub-h">Заявки на доступ</h3><div class="list-mini">${reqs.map(r=>`<div class="lrow"><span><b>${esc(r.fullName||r.email)}</b><small>${esc(r.email)} · ${App.dtt(r.at)}</small></span><span class="row-f">${App.sel("rq_"+r.id,roles,"seller")}${App.sel("rqp_"+r.id,ptOpts,"")}<button class="btn sm pri" data-act="staffAdd" data-id="${esc(r.id)}">Принять</button><button class="btn sm ghost danger" data-act="staffReject" data-id="${esc(r.id)}">Отклонить</button></span></div>`).join("")}</div>`:""}
  <div class="list-mini stafflist">${S.staff.slice().sort((a,b)=>(a.role==="owner"?-1:b.role==="owner"?1:String(a.fullName).localeCompare(b.fullName))).map(s=>`<button type="button" class="lrow" data-act="staffOpen" data-id="${esc(s.id)}">
    <span><b>${esc(s.fullName)}</b><small>${esc(s.email||(au[s.id]||{}).email||"")}${s.phone?" · "+esc(s.phone):""}</small></span>
    <span class="row-f"><span class="pill ${s.role==="owner"?"dark":""}">${esc(App.ROLES[s.role])}</span><span class="muted small">${s.pointId?esc(App.pointName(s.pointId)):"все точки"}</span>${stat(s)}<span class="muted small">вход: ${seen(s)}</span></span></button>`).join("")}</div>
  <h3 class="sub-h">Что может каждая роль</h3>
  <div class="tbl-wrap"><table><tbody>
    <tr><td><b>Владелец</b></td><td>всё, включая сотрудников, доступы и подключения; один на CRM, права можно передать</td></tr>
    <tr><td><b>Управляющий</b></td><td>всё на всех точках, кроме сотрудников и ключей подключения</td></tr><tr><td><b>Продавец</b></td><td>касса и смена своей точки, продажи, возвраты, клиенты, заказы с сайта</td></tr>
    <tr><td><b>Мастер</b></td><td>ремонт на своей точке</td></tr><tr><td><b>Кладовщик</b></td><td>товары, приход, перемещение, списание, инвентаризация, поставщики; видит закупочные цены</td></tr>
  </tbody></table></div></section>`;
}
const REDIR=()=>location.origin+location.pathname;
const genPass=()=>{const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";let p="";const r=new Uint32Array(10);crypto.getRandomValues(r);r.forEach(x=>p+=a[x%a.length]);return p.slice(0,4)+"-"+p.slice(4)};
const sa=async(body)=>{const r=await App.api.invoke("staff-admin",{redirect:REDIR(),...body});App.ui.authUsers=null;await App.reload(["staff","staffreq","log"]);return r};
ACT.staffNew=()=>{
  if(!App.can("staff"))return;
  const roles=Object.entries(App.ROLES).filter(([k])=>k!=="owner"),pts=[["","— все / не привязан —"],...App.points().map(p=>[p.id,p.name])];
  App.openModal(App.head("Новый сотрудник")+`<div class="form">
    ${App.fld("snName","Имя и фамилия",App.inp("snName",""))}${App.fld("snEmail","Email для входа",App.inp("snEmail","","email"))}
    ${App.fld("snRole","Роль",App.sel("snRole",roles,"seller"))}${App.fld("snPoint","Точка",App.sel("snPoint",pts,(App.point()||{}).id||""))}
    ${App.fld("snPhone","Телефон",App.inp("snPhone","","tel","+7"))}
    ${App.fld("snHow","Как выдать доступ",App.sel("snHow",[["invite","Приглашение на email — сотрудник сам задаст пароль"],["create","Создать сейчас с временным паролем"]],"invite"),"full")}
    <div class="fld full" id="snPassBox" hidden><label for="snPass">Временный пароль</label><div class="row-f">${App.inp("snPass",genPass(),"text","",'autocomplete="off"')}<button class="btn sm" type="button" data-act="snGen">Другой</button></div><small class="muted">Передайте его сотруднику лично. При первом входе CRM попросит сменить.</small></div>
  </div><div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="staffCreate">Добавить</button></div>`);
  const how=document.getElementById("snHow");how.onchange=()=>{document.getElementById("snPassBox").hidden=how.value!=="create"};
};
ACT.snGen=()=>{const i=document.getElementById("snPass");if(i)i.value=genPass()};
ACT.staffCreate=(_,btn)=>run(btn,async()=>{
  const how=App.val("snHow"),email=App.val("snEmail"),pass=App.val("snPass");
  await sa({action:how,email,full_name:App.val("snName"),role:App.val("snRole"),point_id:App.val("snPoint")||null,phone:App.val("snPhone"),password:how==="create"?pass:undefined});
  if(how==="create")App.openModal(App.head("Сотрудник добавлен")+`<p>Передайте сотруднику данные для входа:</p><div class="kvcopy"><span>Адрес CRM</span><code>${esc(REDIR())}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(REDIR())}">Копировать</button></div><div class="kvcopy"><span>Email</span><code>${esc(email)}</code></div><div class="kvcopy"><span>Временный пароль</span><code>${esc(pass)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(pass)}">Копировать</button></div><p class="muted small">При первом входе CRM попросит придумать свой пароль.</p><div class="acts"><button class="btn pri" data-act="close">Готово</button></div>`);
  else{App.closeModal();App.toast("Приглашение отправлено на "+email)}
});
ACT.staffOpen=id=>{
  curStaff=id;App.ui.staffOut=null;
  const draw=()=>{
    const s=App.byId("staff",id);if(!s)return App.closeModal();
    const own=App.can("staff"),me=id===App.me.id,isOwner=s.role==="owner",u=(App.ui.authUsers||{})[id]||{},blocked=s.active===false||u.banned;
    const roles=Object.entries(App.ROLES).filter(([k])=>k!=="owner"),pts=[["","— все / не привязан —"],...App.points().map(p=>[p.id,p.name])];
    App.redrawModal(App.head(esc(s.fullName),`<span class="pill ${isOwner?"dark":""}">${esc(App.ROLES[s.role])}</span>${blocked?' <span class="pill bad">заблокирован</span>':""}`)+`
      <div class="tiles"><div class="tile"><span>Email</span><b class="mid">${esc(s.email||u.email||"—")}</b><small>${u.confirmed===false?"не подтверждён":u.invited?"приглашение не принято":""}</small></div>
        <div class="tile"><span>Последний вход</span><b class="mid">${u.last_sign_in_at||s.lastSeen?App.dtt(u.last_sign_in_at||s.lastSeen):"не входил"}</b></div>
        <div class="tile"><span>Продаж</span><b>${S.sales.filter(x=>x.by===id).length}</b></div></div>
      ${isOwner?`<p class="muted">Владелец видит и меняет всё. Сменить роль или заблокировать владельца нельзя — можно только передать права другому сотруднику.</p>`
      :own?`<div class="form">${App.fld("soRole","Роль",App.sel("soRole",roles,s.role))}${App.fld("soPoint","Точка",App.sel("soPoint",pts,s.pointId||""))}</div>
        <div class="acts"><button class="btn pri" data-act="staffSave" data-id="${esc(id)}">Сохранить роль и точку</button></div>`:""}
      ${own&&!me?`<h3 class="sub-h">Доступ</h3>
      <div class="acts" style="justify-content:flex-start;flex-wrap:wrap">
        <button class="btn" data-act="staffResetMail" data-id="${esc(id)}">Отправить ссылку смены пароля на email</button>
        <button class="btn" data-act="staffResetLink" data-id="${esc(id)}">Ссылка для входа (в мессенджер)</button>
        ${isOwner?"":`<button class="btn" data-act="staffTmpPass" data-id="${esc(id)}">Задать временный пароль</button>`}
        <button class="btn" data-act="staffEmail" data-id="${esc(id)}">Сменить email</button>
      </div>
      <div id="staffOut">${App.ui.staffOut&&App.ui.staffOut.id===id?App.ui.staffOut.html:""}</div>
      ${isOwner?"":`<h3 class="sub-h">Опасные действия</h3><div class="acts" style="justify-content:flex-start;flex-wrap:wrap">
        ${blocked?`<button class="btn" data-act="staffUnblock" data-id="${esc(id)}">Разблокировать</button>`:`<button class="btn danger" data-act="staffBlock" data-id="${esc(id)}">Заблокировать доступ</button>`}
        ${blocked?"":`<button class="btn ghost" data-act="staffOwner" data-id="${esc(id)}">Передать права владельца</button>`}</div>
        <p class="muted small">Блокировка сразу закрывает вход и все сеансы сотрудника; его продажи и действия в журнале сохраняются.</p>`}`:me?`<p class="muted">Свои данные, пароль и email меняйте в профиле.</p><div class="acts"><button class="btn" data-act="profile">Мой профиль</button></div>`:""}`);
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
let curStaff=null;
const out=html=>{App.ui.staffOut={id:curStaff,html};const o=document.getElementById("staffOut");if(o)o.innerHTML=html};
ACT.staffSave=(id,btn)=>run(btn,async()=>{
  const role=App.val("soRole"),pt=App.val("soPoint")||null;
  if(["seller","master","storekeeper"].includes(role)&&!pt)return App.toast("Для этой роли выберите точку");
  await App.api.update("staff",id,{role,point_id:pt});await App.api.audit("Изменён сотрудник",App.nameOf(id),App.ROLES[role]+" · "+(pt?App.pointName(pt):"все точки"));App.toast("Сохранено");
});
ACT.staffResetMail=(id,btn)=>run(btn,async()=>{const r=await sa({action:"reset_email",id});out(`<div class="banner ok">Ссылка для смены пароля отправлена на ${esc(r.email)}.</div>`)});
ACT.staffResetLink=(id,btn)=>run(btn,async()=>{const r=await sa({action:"reset_link",id});
  out(`<div class="banner info">Одноразовая ссылка для входа — перешлите сотруднику лично (WhatsApp, Telegram). По ней он войдёт и задаст новый пароль. Ссылка действует ограниченное время.</div><div class="kvcopy"><span>Ссылка</span><code>${esc(r.link)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(r.link)}">Копировать</button></div>`)});
ACT.staffTmpPass=(id)=>{const p=genPass();out(`<div class="form">${App.fld("tpPass","Временный пароль",App.inp("tpPass",p,"text","",'autocomplete="off"'),"full")}</div><div class="acts"><button class="btn pri" data-act="staffTmpOk" data-id="${esc(id)}">Установить</button></div><p class="muted small">Текущий пароль сотрудника перестанет работать. При входе CRM попросит придумать свой.</p>`)};
ACT.staffTmpOk=(id,btn)=>run(btn,async()=>{const p=App.val("tpPass");await sa({action:"set_password",id,password:p});out(`<div class="banner ok">Пароль установлен. Передайте сотруднику лично:</div><div class="kvcopy"><span>Временный пароль</span><code>${esc(p)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(p)}">Копировать</button></div>`)});
ACT.staffEmail=(id)=>{const s=App.byId("staff",id);out(`<div class="form">${App.fld("seEmail","Новый email",App.inp("seEmail",s.email||"","email"),"full")}</div><div class="acts"><button class="btn pri" data-act="staffEmailOk" data-id="${esc(id)}">Сменить</button></div>`)};
ACT.staffEmailOk=(id,btn)=>run(btn,async()=>{await sa({action:"change_email",id,email:App.val("seEmail")});out('<div class="banner ok">Email изменён — входить теперь по новому адресу.</div>')});
ACT.staffBlock=(id,btn)=>{if(!App.confirm2(btn,"Нажмите ещё раз — сотрудник сразу потеряет доступ"))return;run(btn,async()=>{await sa({action:"block",id});App.toast("Доступ заблокирован")})};
ACT.staffUnblock=(id,btn)=>run(btn,async()=>{await sa({action:"unblock",id});App.toast("Доступ восстановлен")});
ACT.staffOwner=(id,btn)=>{if(!App.confirm2(btn,"Нажмите ещё раз: сотрудник станет владельцем, а вы — управляющим"))return;
  run(btn,async()=>{await App.api.rpc("transfer_owner",{p_to:id},["staff","log"]);App.toast("Права владельца переданы");setTimeout(()=>location.reload(),900)})};
ACT.staffAdd=(id,btn)=>run(btn,async()=>{
  const r=App.byId("staffreq",id),role=App.val("rq_"+id),pt=App.val("rqp_"+id)||null;
  if(["seller","master","storekeeper"].includes(role)&&!pt)return App.toast("Для этой роли выберите точку");
  await App.api.insert("staff",{id,full_name:r.fullName||r.email,role,point_id:pt,email:r.email||null});
  await App.api.remove("staff_requests",id);
  await App.api.audit("Принят сотрудник",r.fullName||r.email,App.ROLES[role]);App.toast("Сотрудник добавлен");
});
ACT.staffReject=(id,el)=>run(null,async()=>{if(!App.confirm2(el,"Отклонить заявку?"))return;await App.api.remove("staff_requests",id);App.toast("Заявка отклонена")});

/* ---------- журнал ---------- */
App.ui.logQ="";
function log(){
  const q=App.ui.logQ.toLowerCase();
  const list=App.sortDesc(S.log,"at").filter(l=>!q||[l.action,l.ref,l.details,App.nameOf(l.by)].join(" ").toLowerCase().includes(q)).slice(0,300);
  return `<section class="card"><div class="card-h"><h2>Журнал действий</h2><input id="logQ" type="search" placeholder="Поиск" value="${esc(App.ui.logQ)}" data-filter="logQ" aria-label="Поиск в журнале"></div>
  <div class="tbl-wrap"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Подробности</th></tr></thead><tbody>
  ${list.map(l=>`<tr><td>${App.dtt(l.at)}</td><td>${esc(App.nameOf(l.by))}</td><td>${esc(l.action)}</td><td>${l.entity==="product"&&App.byId("products",l.entityId)?`<button class="linkbtn" data-act="openProduct" data-id="${esc(l.entityId)}">${esc(l.ref)}</button>`:esc(l.ref)}</td><td>${esc(l.details)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Записей нет</td></tr>'}
  </tbody></table></div><p class="muted">Показаны последние 500 записей.</p></section>`;
}

/* ---------- данные ---------- */
function data(){
  return `<section class="card"><div class="card-h"><h2>Данные</h2><span class="pill">база Supabase</span></div>
  <div class="tiles">${[["points","Точки"],["customers","Клиенты"],["products","Товары"],["sales","Продажи"],["docs","Документы"],["shifts","Смены"],["staff","Сотрудники"]].map(([c,l])=>`<div class="tile"><span>${l}</span><b>${S[c].length}</b></div>`).join("")}</div>
  ${App.can("io")?'<div class="acts" style="justify-content:flex-start;margin-top:14px"><button class="btn" data-act="exportDlg">Экспорт</button><button class="btn" data-act="importDlg">Импорт товаров</button><button class="btn" data-act="importDlg" data-id="customers">Импорт клиентов</button><button class="btn" data-act="reloadAll">Перечитать всё из базы</button></div>':""}</section>`;
}
ACT.reloadAll=async()=>{await App.reload(App.COLS);App.toast("Данные обновлены")};
})();
