/* iCase CRM v3 · Ремонт: приём, диагностика, работы и запчасти, оплата, выдача, гарантия, квитанции */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.repairs="Ремонт";
Object.assign(App.ui,{repFilter:"active",repQ:"",repMaster:"",repView:window.innerWidth<700?"list":"board"});
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const RL=["repairs","cashops","products","movements","log"];
const masters=()=>S.staff.filter(s=>s.active!==false&&["master","owner","manager"].includes(s.role));
const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
App.repDue=r=>Math.max(0,App.repairTotal(r)-App.repairPaid(r));
App.repWarrantyEnd=r=>r.status==="done"&&r.closedAt?new Date(+new Date(r.closedAt)+num(r.warrantyDays)*864e5):null;
const inWarranty=r=>{const e=App.repWarrantyEnd(r);return e&&e>new Date()};

/* ---------- список ---------- */
const FILTERS=[["active","В работе"],["late","Просрочены"],["ready","Готовы"],["stored","Не забирают"],["parts","Ждут запчасть"],["approve","Согласование"],["done","Выданы"],["cancel","Отказы"],["all","Все"]];
const flt=(f,r)=>f==="active"?App.ACTIVE.includes(r.status):f==="late"?App.isLate(r):f==="stored"?App.isStored(r):f==="all"?true:r.status===f;
function card(r){
  const c=App.cust(r.customerId)||{},late=App.isLate(r),stored=App.isStored(r),due=App.repDue(r);
  return `<button class="rcard ${late?"late":""} ${r.status==="ready"?"ready":""}" data-act="openRepair" data-id="${esc(r.id)}">
    <div class="rc-h"><b>${esc(r.num)}</b>${r.warrantyOf?'<span class="pill info">гарантия</span>':""}${App.statusPill(r.status)}</div>
    <div class="rc-dev">${esc(r.device)}</div><div class="rc-m">${esc(r.problem)}</div>
    <div class="rc-m">${esc(c.name||"—")}${c.phone?" · "+esc(c.phone):""}</div>
    <div class="rc-f"><span>${r.masterId||r.master?esc(App.nameOf(r.masterId)||r.master):'<span class="badc">мастер не назначен</span>'}</span>
      <span>${late?`<span class="pill bad">срок ${App.dt(r.dueDate)}</span>`:stored?`<span class="pill warn">ждёт ${App.days(r.readyAt)} дн.</span>`:r.dueDate&&App.ACTIVE.includes(r.status)?"до "+App.dt(r.dueDate):App.dt(r.createdAt)}</span></div>
    <div class="rc-f"><span class="muted">${App.repairTotal(r)?money(App.repairTotal(r)):"цена не определена"}</span>${due&&App.ACTIVE.includes(r.status)?`<b>к оплате ${money(due)}</b>`:""}</div></button>`;
}
VIEWS.repairs={
  ownSearch:true,
  actions:()=>App.can("repair")?'<button class="btn pri" data-act="newRepair">+ Принять в ремонт</button>':"",
  render(){
    const u=App.ui,q=u.repQ.trim().toLowerCase(),pt=App.can("allPoints")?null:(App.point()||{}).id;
    const base=S.repairs.filter(r=>(!pt||r.pointId===pt)&&(!u.repMaster||(u.repMaster==="__none"?!r.masterId:r.masterId===u.repMaster))&&(!q||[r.num,r.device,r.imei,r.problem,(App.cust(r.customerId)||{}).name,(App.cust(r.customerId)||{}).phone].join(" ").toLowerCase().includes(q)));
    const list=App.sortDesc(base.filter(r=>flt(u.repFilter,r)));
    const board=u.repView==="board"&&u.repFilter==="active";
    const cols=App.RSTAT.filter(s=>App.ACTIVE.includes(s[0]));
    return `<div class="cfilt rep3"><input id="repQ" type="search" placeholder="№ квитанции, устройство, IMEI, клиент, телефон" value="${esc(u.repQ)}" data-filter="repQ" aria-label="Поиск ремонта">
        ${App.sel("repMaster",[["","Все мастера"],...masters().map(m=>[m.id,m.fullName])],u.repMaster,'data-filter-sel="repMaster" aria-label="Мастер"')}
        <div class="seg"><button class="${u.repView==="board"?"on":""}" data-act="repView" data-id="board">Доска</button><button class="${u.repView==="list"?"on":""}" data-act="repView" data-id="list">Список</button></div></div>
      <div class="chips rchips">${FILTERS.map(([k,l])=>{const n=base.filter(r=>flt(k,r)).length;return `<button class="chip ${u.repFilter===k?"on":""} ${k==="late"&&n?"bad":""}" data-act="repFilter" data-id="${k}">${l} <b>${n}</b></button>`}).join("")}</div>
      ${board?`<div class="rboard">${cols.map(([s,l])=>{const rs=list.filter(r=>r.status===s);return `<div class="rcol"><div class="rcol-h">${esc(l)} <b>${rs.length}</b></div>${rs.map(card).join("")||'<div class="rcol-e">—</div>'}</div>`}).join("")}</div>`
        :`<div class="rlist">${list.map(card).join("")||'<section class="card"><div class="empty">Ремонтов нет. Нажмите «Принять в ремонт», чтобы оформить квитанцию.</div></section>'}</div>`}`;
  }
};
ACT.repFilter=k=>{App.ui.repFilter=k;if(App.ui.view!=="repairs")location.hash="repairs";else App.render()};
ACT.repView=k=>{App.ui.repView=k;if(k==="board")App.ui.repFilter="active";App.render()};

/* ---------- приём ---------- */
ACT.newRepair=(arg)=>{
  if(!App.can("repair"))return App.toast("Нет права принимать ремонт");
  const pre=arg&&typeof arg==="object"&&!arg.nodeType?arg:{};const c=pre.customerId?App.cust(pre.customerId):null;
  const st=App.settings(),due=new Date(Date.now()+3*864e5);const ms=masters();
  App.openModal(App.head(pre.warrantyOf?"Гарантийный ремонт по "+esc(pre.warrantyNum):"Приём в ремонт")+`
    <div class="form">
      ${App.fld("rPhone","Телефон клиента",App.inp("rPhone",c?c.phone:"","tel","+7 900 000-00-00",'autocomplete="off"'))}
      ${App.fld("rName","Имя",App.inp("rName",c?c.name:"","text","Как обращаться"))}
      <p class="muted full" id="rCust"></p>
      ${App.fld("rDevice","Устройство",App.inp("rDevice",pre.device||"","text","iPhone 13, синий, 128 ГБ",'list="rDevList"'),"")}
      ${App.fld("rImei","IMEI / серийный номер",App.inp("rImei",pre.imei||""))}
      ${App.repIntakeTop?App.repIntakeTop():""}
      ${App.fld("rProblem","Неисправность со слов клиента",App.area("rProblem",pre.problem||"","Не заряжается, разбит дисплей"),"full")}
      ${App.fld("rKit","Комплектация",App.inp("rKit","","text","Без SIM, без чехла"))}
      ${App.fld("rLook","Внешний вид",App.inp("rLook","","text","Царапины на корпусе, скол в углу"))}
      ${App.fld("rPass","Пароль / графический ключ",App.inp("rPass","","text","по желанию клиента"))}
      ${App.fld("rMaster","Мастер",App.sel("rMaster",[["","— назначить позже —"],...ms.map(m=>[m.id,m.fullName])],ms.length===1?ms[0].id:""))}
      ${App.fld("rEst","Предварительная стоимость, ₽",App.inp("rEst",pre.warrantyOf?0:"","number","после диагностики"))}
      ${App.fld("rDue","Срок готовности",App.inp("rDue",new Date(due-due.getTimezoneOffset()*6e4).toISOString().slice(0,10),"date"))}
      ${App.fld("rPre","Предоплата, ₽",App.inp("rPre","","number","0"))}
      ${App.fld("rPreM","Способ предоплаты",App.sel("rPreM",Object.entries(App.PAY)))}
      ${App.fld("rWar","Гарантия на работы, дней",App.inp("rWar",st.repairWarrantyDays||90,"number"))}
      ${App.fld("rSrc","Как узнал о нас",App.sel("rSrc",App.SOURCES))}
      ${App.repIntakeExtra?App.repIntakeExtra(pre):""}
    </div><datalist id="rDevList">${[...new Set(S.repairs.map(r=>r.device))].slice(0,200).map(d=>`<option value="${esc(d)}">`).join("")}</datalist>
    <div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="saveRepair" data-id="${esc(pre.warrantyOf||"")}">Принять и распечатать квитанцию</button></div>`,{wide:true});
  const ph=$("#rPhone");if(ph)ph.addEventListener("input",()=>{const c2=App.findCustomerByPhone(ph.value),box=$("#rCust");
    if(c2){if(!App.val("rName"))$("#rName").value=c2.name;const n=S.repairs.filter(r=>r.customerId===c2.id).length;box.innerHTML=`Клиент найден: <b>${esc(c2.name)}</b>${n?` · ремонтов: ${n}`:""}${c2.blacklisted?' · <span class="badc">в чёрном списке</span>':""}`}else box.textContent=""});
  if(App.repIntakeBind)App.repIntakeBind();
};
ACT.saveRepair=(warrantyOf,btn)=>run(btn,async()=>{
  const V=App.val;if(App.phoneKey(V("rPhone")).length!==10)throw new Error("Укажите телефон клиента — по нему он узнает статус и получит уведомление");
  if(!V("rDevice").trim())throw new Error("Укажите устройство");if(!V("rProblem").trim())throw new Error("Опишите неисправность");
  const pt=App.point();if(!pt)throw new Error("Выберите точку");
  const cid=await App.api.customer(V("rPhone"),V("rName"),V("rSrc")||"Магазин");
  const id=await App.api.rpc("repair_create",{p:{customer_id:cid,point_id:pt.id,device:V("rDevice"),imei:V("rImei"),problem:V("rProblem"),kit:V("rKit"),appearance:V("rLook"),
    device_pass:V("rPass"),master_id:V("rMaster"),estimate:V("rEst"),due_date:V("rDue"),warranty_days:V("rWar"),source:V("rSrc"),warranty_of:warrantyOf||null,prepay:V("rPre"),prepay_method:V("rPreM")}});
  if(App.repAfterCreate)try{await App.repAfterCreate(id)}catch(e){App.toast(e.message)}
  await App.reload(["repairs","cashops","customers"]);App.closeModal();App.toast("Принят в ремонт");
  const r=App.byId("repairs",id);if(r){ACT.repReceipt(id);ACT.openRepair(id)}
});

/* ---------- карточка ремонта ---------- */
ACT.openRepair=id=>{
  const draw=()=>{const r=App.byId("repairs",id);if(!r)return App.closeModal();
    const c=App.cust(r.customerId)||{},open=App.ACTIVE.includes(r.status),works=App.repairWorksSum(r),parts=App.repairPartsSum(r),paid=App.repairPaid(r),tot=App.repairTotal(r);
    const canEdit=open||App.can("del"),cost=App.can("cost"),we=App.repWarrantyEnd(r);
    const steps=App.RSTAT.filter(s=>App.ACTIVE.includes(s[0]));
    App.redrawModal(App.head(`${esc(r.num)} · ${esc(r.device)}`,App.statusPill(r.status)+(r.warrantyOf?' <span class="pill info">гарантийный</span>':""))+`
      ${open?`<div class="rsteps">${steps.map(([s,l])=>`<button class="${r.status===s?"on":""}" data-act="repStatus" data-id="${r.id}|${s}">${esc(l)}</button>`).join("")}</div>`:""}
      <div class="tiles"><div class="tile"><span>Работы</span><b>${money(works)}</b></div><div class="tile"><span>Запчасти</span><b>${money(parts)}</b>${cost&&parts?`<small>себестоимость ${money(App.repairPartsCost(r))}</small>`:""}</div>
        <div class="tile"><span>Итого</span><b>${money(tot)}</b>${!works&&!parts&&r.estimate?"<small>предварительно</small>":""}</div><div class="tile"><span>${open?"Оплачено / к оплате":"Оплачено"}</span><b>${money(paid)}</b>${open?`<small class="${tot-paid>0?"badc":""}">к оплате ${money(Math.max(0,tot-paid))}</small>`:""}</div></div>
      <div class="kv">
        <div><span>Клиент</span><b><a href="#" data-act="openClient" data-id="${esc(r.customerId)}">${esc(c.name||"—")}</a> · ${esc(c.phone||"")}</b></div>
        <div><span>Принят</span><b>${App.dtt(r.createdAt)} · ${esc((App.byId("points",r.pointId)||{}).name||"")}</b></div>
        <div><span>Неисправность</span><b>${esc(r.problem)}</b></div><div><span>IMEI / S/N</span><b>${esc(r.imei||"—")}</b></div>
        <div><span>Комплектация</span><b>${esc(r.kit||"—")}</b></div><div><span>Внешний вид</span><b>${esc(r.appearance||"—")}</b></div>
        ${r.devicePass?`<div><span>Пароль</span><b>${esc(r.devicePass)}</b></div>`:""}
        ${r.status==="done"?`<div><span>Выдан</span><b>${App.dtt(r.closedAt)}${we?` · гарантия до ${App.dt(we.toISOString())}${inWarranty(r)?"":" (истекла)"}`:""}</b></div>`:""}
        ${r.status==="cancel"?`<div><span>Отказ</span><b>${esc(r.cancelReason||"—")}${num(r.diagFee)?" · диагностика "+money(r.diagFee):""}</b></div>`:""}
      </div>
      ${canEdit?`<div class="form">
        ${App.fld("reMaster","Мастер",App.sel("reMaster",[["","— не назначен —"],...masters().map(m=>[m.id,m.fullName])],r.masterId||""))}
        ${App.fld("reDue","Срок готовности",App.inp("reDue",r.dueDate||"","date"))}
        ${App.fld("reDiag","Диагноз / что сделано",App.area("reDiag",r.diagnosis||"","Результат диагностики"),"full")}
        ${App.fld("reEst","Согласованная цена, ₽",App.inp("reEst",r.approvedSum||r.estimate||"","number"))}
        ${App.fld("reWar","Гарантия, дней",App.inp("reWar",r.warrantyDays,"number"))}
        ${App.fld("reNote","Комментарий в историю",App.inp("reNote","","text","Позвонили клиенту, согласовал замену"),"full")}
      </div>`:""}
      ${App.repCardExtra?App.repCardExtra(r):""}
      <h3 class="sub-h">Работы</h3>
      <div class="rpl">${(r.services||[]).map(s=>`<div class="rpr"><span>${esc(s.name)}${num(s.qty)>1?" × "+s.qty:""}</span><b>${money(num(s.price)*num(s.qty||1))}</b>${open?`<button class="btn sm ghost" data-act="repSvcDel" data-id="${r.id}|${s.id}" aria-label="Убрать">✕</button>`:""}</div>`).join("")||'<div class="muted">Работ пока нет</div>'}</div>
      ${open?`<div class="row-f addrow">${App.sel("rsSvc",[["","Из прайса…"],...S.services.filter(s=>s.active!==false).map(s=>[s.id,s.name+" · "+money(s.price)])],"",'aria-label="Работа из прайса"')}
        <input id="rsName" placeholder="или своя работа" aria-label="Название работы"><input id="rsPrice" type="number" inputmode="decimal" placeholder="Цена" aria-label="Цена" style="width:110px">
        <button class="btn sm" data-act="repSvcAdd" data-id="${r.id}">Добавить</button></div>`:""}
      ${App.repWorksExtra?App.repWorksExtra(r):""}
      <h3 class="sub-h">Запчасти</h3>
      <div class="rpl">${(r.parts||[]).map(p=>`<div class="rpr ${p.returned?"off":""}"><span>${esc(p.name)}${num(p.qty)>1?" × "+p.qty:""}<small>${esc(App.whName(p.whId))}${cost?" · закупка "+money(p.cost):""}${p.returned?" · возвращена на склад":""}</small></span><b>${money(num(p.price)*num(p.qty))}</b>${open&&!p.returned?`<button class="btn sm ghost" data-act="repPartBack" data-id="${r.id}|${p.id}" title="Вернуть на склад">↩</button>`:""}</div>`).join("")||'<div class="muted">Запчастей нет</div>'}</div>
      ${open&&App.can("repairWork")?`<div class="fld addrow"><input id="rpQ" type="search" placeholder="Найти запчасть на складе сервиса: название, артикул, штрихкод" autocomplete="off" aria-label="Запчасть"><div id="rpBox" class="pick" hidden></div></div>`:""}
      <h3 class="sub-h">Оплаты и история</h3>
      <div class="rhst">${histRows(r)}</div>
      <div class="acts">
        <button class="btn" data-act="repReceipt" data-id="${r.id}">Квитанция</button>
        <button class="btn" data-act="repLabel" data-id="${r.id}">Наклейка</button>
        ${open&&["new","diag","approve"].includes(r.status)?`<button class="btn" data-act="repLink" data-id="${r.id}">Ссылка на согласование</button>`:""}
        ${open&&r.masterId!==App.me.id&&App.can("repairWork")?`<button class="btn" data-act="repTake" data-id="${r.id}">Взять себе</button>`:""}
        ${r.status==="done"?`<button class="btn" data-act="repAct" data-id="${r.id}">Акт выдачи</button>`:""}
        <button class="btn" data-act="repMsg" data-id="${r.id}">Сообщение клиенту</button>
        ${r.status==="done"&&inWarranty(r)?`<button class="btn" data-act="repWarranty" data-id="${r.id}">Гарантийный ремонт</button>`:""}
        ${open?`<button class="btn" data-act="repPay" data-id="${r.id}">Предоплата</button><button class="btn danger" data-act="repCancel" data-id="${r.id}">Отказ</button>`:""}
        ${canEdit?`<button class="btn" data-act="repSave" data-id="${r.id}">Сохранить</button>`:""}
        ${open?`<button class="btn pri" data-act="repIssue" data-id="${r.id}">Выдать клиенту</button>`:""}
      </div>`);
    if(document.getElementById("rpQ"))App.productPicker("rpQ","rpBox",{wh:()=>App.serviceWhOf(r),inStock:true,showCost:cost,onPick:p=>partAdd(r,p)});
    if(App.fillPhotos)App.fillPhotos();
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
App.serviceWhOf=r=>{const p=App.byId("points",r.pointId);return p&&p.serviceWh?p.serviceWh:p&&p.cashWh?p.cashWh:App.serviceWh()};
function histRows(r){
  const pays=S.cashops.filter(o=>o.ref===r.num&&["prepay","repair","refund"].includes(o.type)).map(o=>({at:o.at,t:`${o.amount<0?"Возврат":App.CASHOP[o.type]||"Оплата"}: ${money(Math.abs(o.amount))} · ${App.payLabel(o.method)}`,cls:o.amount<0?"bad":"ok"}));
  const hs=(r.history||[]).map(h=>({at:h.at,t:h.note?`${esc(h.note)}`:`Статус: ${esc((App.RS[h.status]||{}).label||h.status)}`,by:h.by,cls:h.note?"":"mute"}));
  return [...pays,...hs].sort((a,b)=>String(b.at).localeCompare(a.at)).map(x=>`<div class="rhr"><span class="rhr-d">${App.dtt(x.at)}</span><span class="${x.cls==="bad"?"badc":x.cls==="ok"?"okc":""}">${x.t}</span>${x.by?`<small>${esc(App.nameOf(x.by))}</small>`:""}</div>`).join("")||'<div class="muted">Пусто</div>';
}
const ref=s=>s.split("|");
ACT.repStatus=(arg,btn)=>run(btn,async()=>{const [id,s]=ref(arg);const r=App.byId("repairs",id);
  if(s==="ready"&&!App.repairWorksSum(r)&&!App.repairPartsSum(r)&&!num(r.estimate)&&!num(r.approvedSum))App.toast("Цена ещё не указана — добавьте работы или согласованную цену");
  await App.api.rpc("repair_update",{p_id:id,p:{status:s}});await App.reload(["repairs"]);
  if(s==="ready")App.toast("Готов к выдаче — отправьте клиенту сообщение");});
ACT.repSave=(id,btn)=>run(btn,async()=>{const V=App.val,p={master_id:V("reMaster"),due_date:V("reDue"),diagnosis:V("reDiag"),warranty_days:V("reWar"),note:V("reNote")};
  const est=V("reEst");if(est!=="")p.approved_sum=est;
  await App.api.rpc("repair_update",{p_id:id,p});const n=document.getElementById("reNote");if(n)n.value="";await App.reload(["repairs"]);App.toast("Сохранено")});
ACT.repSvcAdd=(id,btn)=>run(btn,async()=>{const sid=App.val("rsSvc"),s=sid?App.byId("services",sid):null,name=(App.val("rsName")||"").trim()||(s&&s.name),price=App.val("rsPrice")!==""?num(App.val("rsPrice")):s?num(s.price):0;
  if(!name)throw new Error("Выберите работу из прайса или впишите свою");
  await App.api.insert("repair_services",{repair_id:id,service_id:s?s.id:null,name,price,qty:1});["rsName","rsPrice","rsSvc"].forEach(k=>{const e=document.getElementById(k);if(e)e.value=""});await App.reload(["repairs"])});
ACT.repSvcDel=(arg,btn)=>run(btn,async()=>{const [id,sid]=ref(arg);await App.api.remove("repair_services",sid);await App.reload(["repairs"])});
async function partAdd(r,p){try{
  if(p.trackSerial)throw new Error("Товар с IMEI нельзя списать как запчасть");
  await App.api.insert("repair_parts",{repair_id:r.id,product_id:p.id,warehouse_id:App.serviceWhOf(r),name:p.name,qty:1,price:num(p.price),cost:num(p.cost)});
  await App.reload(["repairs","products","movements"]);App.toast("Запчасть списана со склада: "+p.name)}catch(e){App.toast(e.message)}}
ACT.repPartBack=(arg,btn)=>run(btn,async()=>{const [,pid]=ref(arg);await App.api.update("repair_parts",pid,{returned:true});await App.reload(["repairs","products","movements"]);App.toast("Запчасть вернулась на склад")});

/* ---------- оплата, выдача, отказ ---------- */
ACT.repPay=id=>{const r=App.byId("repairs",id);
  App.openModal(App.head("Предоплата · "+esc(r.num))+`<div class="form">${App.fld("rpAmt","Сумма, ₽",App.inp("rpAmt","","number","0",'autofocus'))}${App.fld("rpM","Способ",App.sel("rpM",Object.entries(App.PAY)))}</div>
    <div class="acts"><button class="btn" data-act="openRepair" data-id="${id}">Назад</button><button class="btn pri" data-act="repPayOk" data-id="${id}">Принять оплату</button></div>`)};
ACT.repPayOk=(id,btn)=>run(btn,async()=>{await App.api.rpc("repair_pay",{p_id:id,p_amount:num(App.val("rpAmt")),p_method:App.val("rpM")});await App.reload(RL);App.toast("Оплата принята");ACT.openRepair(id)});
ACT.repIssue=id=>{const r=App.byId("repairs",id),tot=App.repairTotal(r),paid=App.repairPaid(r);
  if(!App.repairWorksSum(r)&&!App.repairPartsSum(r)&&!num(r.approvedSum)&&!num(r.estimate)&&!r.warrantyOf)App.toast("Не указана стоимость — добавьте работы или согласованную цену");
  App.openModal(App.head("Выдача · "+esc(r.num))+`
    <div class="form">${App.fld("riFinal","Итого за ремонт, ₽",App.inp("riFinal",r.warrantyOf?0:tot,"number"))}<div class="fld"><label>Уже оплачено</label><b class="big-n">${money(paid)}</b></div></div>
    <div class="total"><span>К оплате</span><b id="riDue">${money(Math.max(0,tot-paid))}</b></div>
    <div class="paygrid">${Object.entries(App.PAY).map(([m,l])=>`<div class="fld"><label for="ri_${m}">${l}</label><div class="row-f">${App.inp("ri_"+m,"","number","0")}<button class="btn sm" data-act="riAll" data-id="${m}">Всё</button></div></div>`).join("")}</div>
    <p class="muted">После выдачи начнётся гарантия ${num(r.warrantyDays)} дн. Распечатайте акт выдачи — клиент подписывает, что устройство получил и претензий нет.</p>
    <div class="acts"><button class="btn" data-act="openRepair" data-id="${id}">Назад</button><button class="btn pri" data-act="repIssueOk" data-id="${id}">Выдать и распечатать акт</button></div>`);
  const upd=()=>{const due=num(App.val("riFinal"))-paid,got=Object.keys(App.PAY).reduce((a,m)=>a+num(App.val("ri_"+m)),0);const el=$("#riDue");const rest=due-got;el.textContent=due<0?"вернуть клиенту "+money(-due):Math.abs(rest)<0.5?(due?"всё внесено":"доплаты нет"):rest>0?"не хватает "+money(rest):"внесено больше на "+money(-rest);el.className=Math.abs(due-got)<0.5||due<0?"ok":"bad"};
  document.querySelectorAll("#modal input").forEach(e=>e.addEventListener("input",upd));
  ACT.riAll=m=>{const due=Math.max(0,num(App.val("riFinal"))-paid);Object.keys(App.PAY).forEach(k=>{document.getElementById("ri_"+k).value=k===m?due:""});upd()};
  if(tot-paid>0)ACT.riAll("cash");upd();
};
ACT.repIssueOk=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id),fin=num(App.val("riFinal")),paid=App.repairPaid(r);
  let pays=Object.keys(App.PAY).map(m=>({method:m,amount:num(App.val("ri_"+m))})).filter(p=>p.amount);
  if(fin<paid)pays=[{method:"cash",amount:-(paid-fin)}]; // переплата — вернуть наличными
  await App.api.rpc("repair_issue",{p_id:id,p_final:fin,p_payments:pays});await App.reload(RL);App.closeModal();App.toast("Выдан клиенту");ACT.repAct(id)});
ACT.repCancel=id=>{const r=App.byId("repairs",id),paid=App.repairPaid(r);
  App.openModal(App.head("Отказ от ремонта · "+esc(r.num))+`<div class="form">
    ${App.fld("rcWhy","Причина",App.inp("rcWhy","","text","Клиент отказался от цены, ремонт невозможен…"),"full")}
    ${App.fld("rcFee","Плата за диагностику, ₽",App.inp("rcFee",0,"number"))}
    ${App.fld("rcM","Как вернуть / получить деньги",App.sel("rcM",Object.entries(App.PAY)))}</div>
    <p class="muted">Предоплата ${money(paid)}. Клиенту вернётся предоплата минус плата за диагностику. Запчасти вернутся на склад.</p>
    <div class="acts"><button class="btn" data-act="openRepair" data-id="${id}">Назад</button><button class="btn danger" data-act="repCancelOk" data-id="${id}">Оформить отказ</button></div>`)};
ACT.repCancelOk=(id,btn)=>run(btn,async()=>{await App.api.rpc("repair_cancel",{p_id:id,p_reason:App.val("rcWhy"),p_fee:num(App.val("rcFee")),p_method:App.val("rcM")});await App.reload(RL);App.closeModal();App.toast("Отказ оформлен")});
ACT.repCopy=()=>ACT.copyTxt(App.val("rmT"));
ACT.repWarranty=id=>{const r=App.byId("repairs",id);App.closeModal();ACT.newRepair({warrantyOf:r.id,warrantyNum:r.num,customerId:r.customerId,device:r.device,imei:r.imei,problem:"Гарантия по "+r.num+": "})};
ACT.repairFor=cid=>ACT.newRepair({customerId:cid});

/* ---------- сообщение клиенту ---------- */
ACT.repMsg=id=>{const r=App.byId("repairs",id),c=App.cust(r.customerId)||{},st=App.settings(),due=App.repDue(r);
  const site=String(st.siteUrl||"").replace(/\/+$/,"");
  const T={new:`Здравствуйте${c.name?", "+c.name:""}! ${st.shopName||"iCase"}: ваше устройство ${r.device} принято в ремонт, квитанция ${r.num}.${r.dueDate?" Ориентировочный срок — "+App.dt(r.dueDate)+".":""}`,
    approve:`Здравствуйте! ${st.shopName||"iCase"}: по ремонту ${r.num} (${r.device}) диагностика готова${r.diagnosis?": "+r.diagnosis:""}. Стоимость ${money(App.repairTotal(r)||r.estimate)}. Подтвердите, пожалуйста, ремонт.`,
    ready:`Здравствуйте! ${st.shopName||"iCase"}: ваш ${r.device} готов, квитанция ${r.num}.${due?" К оплате "+money(due)+".":""} Ждём вас${st.address?" по адресу "+st.address:""}.`,
    parts:`Здравствуйте! ${st.shopName||"iCase"}: для ремонта ${r.num} заказали запчасть, сообщим, как только придёт.`};
  const txt=T[r.status]||T.ready;
  const tel=App.phoneKey(c.phone);
  App.openModal(App.head("Сообщение клиенту")+`${App.fld("rmT","Текст",`<textarea id="rmT" rows="5">${esc(txt+(site?` Статус ремонта: ${site}/repair?n=${encodeURIComponent(r.num)}`:""))}</textarea>`,"full")}
    <div class="acts"><button class="btn" data-act="repCopy">Скопировать</button>
      ${tel?`<a class="btn" href="https://wa.me/7${tel}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="https://t.me/+7${tel}" target="_blank" rel="noopener">Telegram</a><a class="btn pri" href="sms:+7${tel}?body=${encodeURIComponent(txt)}">SMS</a>`:""}</div>
    <p class="muted">Автоматическая отправка (SMS или Telegram-бот) подключается в настройках — пока сообщение отправляется вручную с телефона.</p>`)};

/* ---------- квитанция и акт ---------- */
function doc(r,kind){
  const st=App.settings(),c=App.cust(r.customerId)||{},pt=App.byId("points",r.pointId)||{},paid=App.repairPaid(r),we=App.repWarrantyEnd(r);
  const rows=[...(r.services||[]).map(s=>[s.name,num(s.qty||1),num(s.price)]),...(r.parts||[]).filter(p=>!p.returned).map(p=>[p.name,num(p.qty),num(p.price)])];
  const head=`<div class="h"><div><b class="logo">${esc(st.shopName||"iCase")}</b><div class="s">${esc([st.legalName,st.inn?"ИНН "+st.inn:"",pt.address||st.address,pt.phone||st.phone].filter(Boolean).join(" · "))}</div></div>
    <div class="r"><b>${kind==="act"?"Акт выдачи":"Квитанция о приёме в ремонт"}</b><div>№ ${esc(r.num)} от ${App.dt(kind==="act"?r.closedAt:r.createdAt)}</div></div></div>`;
  const kv=(l,v)=>v?`<tr><td>${l}</td><td>${esc(v)}</td></tr>`:"";
  const body=`${head}<table class="kv">${kv("Клиент",[c.name,c.phone].filter(Boolean).join(", "))}${kv("Устройство",r.device)}${kv("IMEI / S/N",r.imei)}${kv("Неисправность",r.problem)}${kv("Комплектация",r.kit||"—")}${kv("Внешний вид",r.appearance||"—")}
    ${kind==="act"?kv("Выполнено",r.diagnosis):kv("Предварительная стоимость",num(r.estimate)?money(r.estimate):"после диагностики")+kv("Срок",r.dueDate?App.dt(r.dueDate):"")+kv("Предоплата",paid?money(paid):"")}</table>
    ${kind==="act"&&rows.length?`<table class="it"><tr><th>Работа / запчасть</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr>${rows.map(([n,q,p])=>`<tr><td>${esc(n)}</td><td>${q}</td><td>${money(p)}</td><td>${money(q*p)}</td></tr>`).join("")}<tr class="t"><td colspan="3">Итого</td><td>${money(r.finalPrice)}</td></tr></table>`:""}
    ${kind==="act"?`<p>Гарантия на выполненные работы — ${num(r.warrantyDays)} дн.${we?", до "+App.dt(we.toISOString()):""}. Гарантия не распространяется на повреждения после выдачи (удары, влага, вскрытие третьими лицами).</p>
      <p>Устройство получил, работоспособность проверена, претензий к внешнему виду, комплектации и качеству ремонта не имею.</p>`
      :`<p>Клиент согласен: стоимость окончательно определяется после диагностики и согласовывается по телефону. Устройство, не востребованное более ${num(st.storageDays)||30} дней после уведомления о готовности, может быть передано на платное хранение. Данные на устройстве сохраняются по возможности — сервис не несёт ответственности за утрату информации. Устройство выдаётся по квитанции или по документу, удостоверяющему личность.</p>
      ${st.siteUrl?`<p>Статус ремонта: ${esc(String(st.siteUrl).replace(/\/+$/,""))}/repair — номер квитанции и последние 4 цифры телефона.</p>`:""}`}
    <div class="sg"><div>Клиент ____________ / ${esc(c.name||"")}</div><div>${kind==="act"?"Выдал":"Принял"} ____________ / ${esc(App.nameOf(App.me.id))}</div></div>`;
  const css=`@page{size:A4;margin:12mm}body{font:11pt/1.4 Arial,sans-serif;color:#111}.h{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}.logo{font-size:20pt}.s{font-size:8.5pt;color:#555}.r{text-align:right}
    table{width:100%;border-collapse:collapse;margin:8px 0}.kv td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}.kv td:first-child{width:32%;color:#555}.it th,.it td{border:1px solid #bbb;padding:4px 6px;text-align:left}.it .t td{font-weight:700}
    p{font-size:9.5pt;margin:6px 0}.sg{display:flex;justify-content:space-between;margin-top:26px}.cut{border-top:1px dashed #999;margin:18px 0;position:relative}`;
  // квитанция: два экземпляра на листе — клиенту и сервису
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(r.num)}</title><style>${css}</style></head><body>${body}${kind==="act"?"":`<div class="cut"></div>${body}`}</body></html>`;
}
ACT.repReceipt=id=>{const r=App.byId("repairs",id);if(r)App.printHtml(doc(r,"receipt"))};
ACT.repAct=id=>{const r=App.byId("repairs",id);if(r)App.printHtml(doc(r,"act"))};
})();
