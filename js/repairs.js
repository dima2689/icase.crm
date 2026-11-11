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
    <div class="rc-h"><b>${esc(r.num)}</b>${r.warrantyOf?'<span class="pill info">гарантия</span>':""}<span class="rc-st">${App.statusPill(r.status)}</span></div>
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

/* ---------- приём: по шагам — клиент, устройство, неисправность, осмотр, сроки и оплата ---------- */
const QK={
  rProblem:["Разбит экран","Не заряжается","Быстро садится батарея","Не включается","Попала вода","Не работает камера","Плохо слышно собеседника","Не работает Face ID","Нет сети"],
  rLook:["Без видимых повреждений","Царапины на корпусе","Сколы на рамке","Трещина задней крышки","Вмятины","Следы вскрытия"],
  rKit:["Только устройство","Без SIM","С SIM-картой","В чехле","Зарядка","Коробка"]};
const chips=id=>`<div class="qk">${QK[id].map(t=>`<button type="button" class="chip" data-act="repQk" data-id="${esc(id+"|"+t)}">${esc(t)}</button>`).join("")}</div>`;
ACT.repQk=v=>{const [id,t]=v.split(/\|(.*)/s),el=document.getElementById(id);if(!el)return;const cur=el.value.trim();
  if(cur.split(/,\s*/).includes(t))return;el.value=cur?cur.replace(/[.,\s]+$/,"")+", "+t:t;el.dispatchEvent(new Event("input",{bubbles:true}));el.focus()};
const dayIso=n=>{const d=new Date(Date.now()+n*864e5);return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
ACT.repDueQ=n=>{const e=$("#rDue");if(e){e.value=dayIso(+n);e.dispatchEvent(new Event("input",{bubbles:true}))}};
ACT.repScanImei=()=>{if(!App.scan)return App.toast("Сканер недоступен");App.scan({title:"Наведите на IMEI или серийный номер",onCode:c=>{const i=$("#rImei");if(i){i.value=c;i.dispatchEvent(new Event("input",{bubbles:true}))}return false}})};
const sec=(n,t,body,note="")=>`<section class="rsec"><h3><i>${n}</i>${t}${note?`<small>${note}</small>`:""}</h3><div class="form">${body}</div></section>`;
ACT.newRepair=(arg)=>{
  if(!App.can("repair"))return App.toast("Нет права принимать ремонт");
  const pre=arg&&typeof arg==="object"&&!arg.nodeType?arg:{};const c=pre.customerId?App.cust(pre.customerId):null;
  const st=App.settings(),ms=masters(),meM=ms.find(m=>m.id===App.me.id&&App.me.role==="master");
  App.openModal(App.head(pre.warrantyOf?"Гарантийный ремонт по "+esc(pre.warrantyNum):"Приём в ремонт")+`<div class="rin">
    ${sec(1,"Клиент",`${App.fld("rPhone","Телефон",App.inp("rPhone",c?c.phone:"","tel","+7 900 000-00-00",'autocomplete="off"'))}
      ${App.fld("rName","Имя",App.inp("rName",c?c.name:"","text","Как обращаться"))}
      <div class="full" id="rCust"></div>`)}
    ${sec(2,"Устройство",`<div class="fld"><label for="rImei">IMEI / серийный номер</label><div class="row-f">${App.inp("rImei",pre.imei||"","text","Сканируйте или введите",'autocomplete="off"')}<button type="button" class="btn" data-act="repScanImei" aria-label="Сканировать IMEI камерой">Скан</button></div></div>
      ${App.fld("rDevice","Устройство",App.inp("rDevice",pre.device||"","text","iPhone 13, синий, 128 ГБ",'list="rDevList" autocomplete="off"'))}
      <div class="full" id="rInModel"></div>
      <div class="fld full"><label for="rPass">Пароль / графический ключ</label><div class="row-f">${App.inp("rPass","","text","Если клиент оставляет")}<button type="button" class="btn" data-act="patOpen">Ключ</button></div><div id="patBox" class="patbox" hidden></div></div>`,"IMEI подскажет модель")}
    ${sec(3,"Неисправность",`<div class="fld full"><label for="rProblem">Со слов клиента</label>${App.area("rProblem",pre.problem||"","Что случилось и когда")}${chips("rProblem")}</div>`)}
    ${sec(4,"Осмотр и комплектация",`<div class="fld full"><label>Проверка при клиенте <small class="muted">нажатие: ✓ в порядке → ✕ дефект → ? не проверить</small></label>${App.repIntakeCheck()}</div>
      <div class="fld full"><label for="rLook">Внешний вид</label>${App.inp("rLook","","text","Что видно на корпусе и экране")}${chips("rLook")}</div>
      <div class="fld full"><label for="rKit">Что оставили вместе с устройством</label>${App.inp("rKit","","text","Только устройство")}${chips("rKit")}</div>
      <div class="fld full"><label>Фото <small class="muted">экран, корпус со всех сторон — защита от споров при выдаче</small></label>${App.repIntakePhotos()}</div>`)}
    ${sec(5,"Сроки и оплата",`${App.fld("rEst","Стоимость, ₽",App.inp("rEst",pre.warrantyOf?0:"","number","Оценка или по прайсу"))}
      <div class="fld"><label for="rDue">Срок готовности</label>${App.inp("rDue",dayIso(pre.warrantyOf?3:3),"date")}<div class="qk"><button type="button" class="chip" data-act="repDueQ" data-id="0">Сегодня</button><button type="button" class="chip" data-act="repDueQ" data-id="1">Завтра</button><button type="button" class="chip" data-act="repDueQ" data-id="3">3 дня</button><button type="button" class="chip" data-act="repDueQ" data-id="7">Неделя</button></div></div>
      ${App.fld("rMaster","Мастер",App.sel("rMaster",[["","— назначить позже —"],...ms.map(m=>[m.id,m.fullName])],meM?meM.id:ms.filter(m=>m.role==="master").length===1?ms.find(m=>m.role==="master").id:""))}
      <div class="fld"><label for="rPre">Предоплата, ₽</label><div class="row-f">${App.inp("rPre","","number","0")}${App.sel("rPreM",Object.entries(App.PAY),"",'aria-label="Способ предоплаты"')}</div></div>
      <details class="full rmore"><summary>Гарантия и откуда узнал</summary><div class="form">${App.fld("rWar","Гарантия на работы, дней",App.inp("rWar",st.repairWarrantyDays||90,"number"))}${App.fld("rSrc","Как узнал о нас",App.sel("rSrc",App.SOURCES))}</div></details>`)}
    </div><datalist id="rDevList">${[...new Set(S.repairs.map(r=>r.device))].slice(0,200).map(d=>`<option value="${esc(d)}">`).join("")}</datalist>
    <div class="acts rin-acts"><span class="rin-sum" id="rSum"></span><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="saveRepair" data-id="${esc(pre.warrantyOf||"")}">Принять и распечатать квитанцию</button></div>`,{wide:true});
  const ph=$("#rPhone");
  const who=()=>{const c2=App.findCustomerByPhone(ph.value),box=$("#rCust");if(!box)return;
    if(c2){if(!App.val("rName"))$("#rName").value=c2.name;const n=S.repairs.filter(r=>r.customerId===c2.id).length,ds=App.clientDevices?App.clientDevices(c2.id):[];
      box.innerHTML=`<div class="rcust ${c2.blacklisted?"bad":""}"><span>Клиент найден: <b>${esc(c2.name)}</b>${n?` · ремонтов: ${n}`:""}${c2.blacklisted?' · <b class="badc">в чёрном списке</b>'+(c2.blackReason?" — "+esc(c2.blackReason):""):""}</span>
        ${ds.length?`<div class="qk"><small class="muted">Его устройства:</small>${ds.slice(0,6).map((d,i)=>`<button type="button" class="chip" data-act="inDev" data-id="${i}">${esc(d.name)}${d.code?` <small>…${esc(String(d.code).slice(-4))}</small>`:""}</button>`).join("")}</div>`:""}</div>`;box._ds=ds}
    else{box.innerHTML=App.phoneKey(ph.value).length===10?'<span class="muted">Новый клиент — карточка создастся при приёме</span>':"";box._ds=[]}};
  if(ph){ph.addEventListener("input",who);who()}
  const sum=()=>{const e=num(App.val("rEst")),p=num(App.val("rPre")),b=$("#rSum");if(b)b.innerHTML=e||p?`${e?"Стоимость <b>"+money(e)+"</b>":""}${p?" · предоплата <b>"+money(p)+"</b>":""}`:""};
  ["rEst","rPre"].forEach(k=>{const e=document.getElementById(k);if(e)e.addEventListener("input",sum)});
  if(App.repIntakeBind)App.repIntakeBind();
  if(!c&&ph)ph.focus();
};
ACT.saveRepair=(warrantyOf,btn)=>run(btn,async()=>{
  const V=App.val,bad=(id,m)=>{const e=document.getElementById(id);if(e){e.focus();e.classList.add("err");setTimeout(()=>e.classList.remove("err"),2500)}throw new Error(m)};
  if(App.phoneKey(V("rPhone")).length!==10)bad("rPhone","Укажите телефон клиента — по нему он узнает статус и получит уведомление");
  if(!V("rDevice").trim())bad("rDevice","Укажите устройство");if(!V("rProblem").trim())bad("rProblem","Опишите неисправность");
  const pt=App.point();if(!pt)throw new Error("Выберите точку");
  const cid=await App.api.customer(V("rPhone"),V("rName"),V("rSrc")||"Магазин");
  const id=await App.api.rpc("repair_create",{p:{customer_id:cid,point_id:pt.id,device:V("rDevice"),imei:V("rImei"),problem:V("rProblem"),kit:V("rKit"),appearance:V("rLook"),
    device_pass:V("rPass"),master_id:V("rMaster"),estimate:V("rEst"),due_date:V("rDue"),warranty_days:V("rWar"),source:V("rSrc"),warranty_of:warrantyOf||null,prepay:V("rPre"),prepay_method:V("rPreM")}});
  if(App.repAfterCreate)try{await App.repAfterCreate(id)}catch(e){App.toast(e.message)}
  await App.reload(["repairs","cashops","customers"]);App.closeModal();App.toast("Принят в ремонт");
  const r=App.byId("repairs",id);if(r){ACT.openRepair(id);ACT.repReceipt(id)}
});

/* ---------- карточка ремонта ---------- */
const FLOW=[["new","Принят"],["diag","Диагностика"],["approve","Согласование"],["work","Ремонт"],["ready","Готов"],["done","Выдан"]];
function flowHtml(r){
  if(r.status==="cancel")return `<div class="rflow-x"><span class="pill bad">Отказ от ремонта</span></div>`;
  const cur=r.status==="parts"?"work":r.status,idx=FLOW.findIndex(f=>f[0]===cur);
  return `<ol class="rflow">${FLOW.map(([k,l],i)=>`<li class="${i<idx?"done":i===idx?"cur":""}${k==="work"&&r.status==="parts"?" wait":""}">${k==="work"&&r.status==="parts"?"Ждёт запчасть":l}</li>`).join("")}</ol>`}
const nb=(id,act,l,cls="")=>`<button class="btn ${cls}" data-act="${act}" data-id="${esc(id)}">${l}</button>`;
function nextHtml(r){
  const id=r.id,tot=App.repairTotal(r),due=App.repDue(r),canW=App.can("repairWork"),dec=r.clientDecision;
  const box=(txt,btns,cls="")=>`<div class="rnext ${cls}"><p>${txt}</p>${btns?`<div class="rnext-b">${btns}</div>`:""}</div>`;
  const decLine=dec?` Клиент ${dec.decision==="yes"?"<b class=\"okc\">согласился</b>":"<b class=\"badc\">отказался</b>"} по ссылке ${App.dtt(dec.at)}${dec.comment?" — «"+esc(dec.comment)+"»":""}.`:"";
  switch(r.status){
    case "new":return box(`Устройство принято${r.masterId?", мастер — "+esc(App.nameOf(r.masterId)):", мастер не назначен"}. Следующий шаг — диагностика${canW?"":": её начнёт мастер"}.`,canW?nb(id,"repNext","Начать диагностику","pri"):"");
    case "diag":return box(`Найдите причину, впишите диагноз и добавьте работы и запчасти — сумма для клиента посчитается сама${tot?": сейчас <b>"+money(tot)+"</b>":""}.`,nb(id,"repToApprove","Отправить на согласование","pri")+nb(id,"repAgree","Клиент уже согласен — в работу"));
    case "approve":return box(`Ждём ответ клиента на <b>${money(tot)}</b>.${decLine}`,nb(id,"repAgree","Клиент согласен","pri")+nb(id,"repLink","Отправить ссылку")+nb(id,"repCancel","Клиент отказался","ghost danger"),dec&&dec.decision==="no"?"bad":"");
    case "work":return box(`Идёт ремонт${r.approvedSum?", согласовано <b>"+money(r.approvedSum)+"</b>":""}.${decLine} Если нужной запчасти нет на складе — закажите её, ремонт подождёт.`,nb(id,"repReady","Ремонт готов","pri")+nb(id,"rqNew","Заказать запчасть"));
    case "parts":{const w=(r.partReqs||[]).filter(q=>q.status==="ordered").map(q=>esc(q.name)).join(", ");
      return box(`Ждём запчасть${w?": <b>"+w+"</b>":""}. Когда она придёт на склад, ремонт сам вернётся в работу, а мастер получит задачу.`,nb(id,"repResume","Запчасть есть — продолжить","pri"),"warn")}
    case "ready":return box(`Готов ${App.dtt(r.readyAt)}.${App.isStored(r)?` · <b class="badc">не забирают ${App.days(r.readyAt)} дн.</b>`:""} ${due?"К оплате <b>"+money(due)+"</b>.":"Оплачено полностью."}`,nb(id,"repIssue","Выдать клиенту","pri")+nb(id,"repMsg","Напомнить клиенту"),"ok");
    case "done":{const we=App.repWarrantyEnd(r);return box(`Выдан ${App.dtt(r.closedAt)} за <b>${money(r.finalPrice)}</b>.${we?` Гарантия до ${App.dt(we.toISOString())}${inWarranty(r)?"":" — истекла"}.`:""}`,nb(id,"repAct","Акт выдачи")+(inWarranty(r)?nb(id,"repWarranty","Гарантийный ремонт"):""))}
    case "cancel":return box(`Отказ ${App.dtt(r.closedAt)}: ${esc(r.cancelReason||"без причины")}${num(r.diagFee)?" · диагностика "+money(r.diagFee):""}.`,"","bad");
  }return ""}
function lineRows(r,open,cost){
  const w=(r.services||[]).map(s=>`<div class="rln"><span class="rln-k">работа</span><span class="rln-n">${esc(s.name)}${num(s.qty)>1?" × "+s.qty:""}</span><b>${num(s.price)?money(num(s.price)*num(s.qty||1)):'<span class="muted">бесплатно</span>'}</b>${open?`<button class="btn sm ghost" data-act="repSvcDel" data-id="${r.id}|${s.id}" aria-label="Убрать работу">✕</button>`:"<i></i>"}</div>`);
  const p=(r.parts||[]).map(x=>`<div class="rln ${x.returned?"off":""}"><span class="rln-k">запчасть</span><span class="rln-n">${esc(x.name)}${num(x.qty)>1?" × "+x.qty:""}<small>${x.returned?"возвращена на склад":"со склада "+esc(App.whName(x.whId))}${cost?" · закупка "+money(x.cost):""}</small></span><b>${num(x.price)?money(num(x.price)*num(x.qty)):"в цене работы"}</b>${open&&!x.returned?`<button class="btn sm ghost" data-act="repPartBack" data-id="${r.id}|${x.id}" title="Вернуть на склад" aria-label="Вернуть запчасть на склад">↩</button>`:"<i></i>"}</div>`);
  const RQ={ordered:["заказана","warn"],arrived:["пришла","ok"],cancelled:["заказ отменён","mute"]};
  const q=(r.partReqs||[]).filter(x=>x.status!=="arrived"||!(r.parts||[]).some(p=>p.productId&&p.productId===x.productId)).map(x=>`<div class="rln ${x.status==="cancelled"?"off":""}"><span class="rln-k">под заказ</span><span class="rln-n">${esc(x.name)}${x.qty>1?" × "+x.qty:""}<small>заказана ${App.dt(x.at)}${x.arrivedAt?" · пришла "+App.dt(x.arrivedAt):""}${x.note?" · "+esc(x.note):""}</small></span><span class="pill ${RQ[x.status][1]}">${RQ[x.status][0]}</span>${x.status==="ordered"&&open?`<span class="rln-a"><button class="btn sm ghost" data-act="rqSet" data-id="${esc(x.id)}|arrived" title="Пришла">✓</button><button class="btn sm ghost" data-act="rqSet" data-id="${esc(x.id)}|cancelled" title="Отменить заказ">✕</button></span>`:"<i></i>"}</div>`);
  return [...w,...p,...q].join("")}
ACT.openRepair=id=>{
  const draw=()=>{const r=App.byId("repairs",id);if(!r)return App.closeModal();
    const c=App.cust(r.customerId)||{},open=App.ACTIVE.includes(r.status),paid=App.repairPaid(r),tot=App.repairTotal(r),due=App.repDue(r);
    const canEdit=open||App.can("del"),cost=App.can("cost"),canW=App.can("repairWork"),m=App.repModel?App.repModel(r):null,ck=r.checklist||{};
    const hasLines=(r.services||[]).length||(r.parts||[]).length;
    const RS=(f,html)=>canEdit?html:"";
    App.redrawModal(App.head(`${esc(r.num)} · ${esc(r.device)}`,App.statusPill(r.status)+(r.warrantyOf?' <span class="pill info">гарантийный</span>':""))+`
      ${flowHtml(r)}${nextHtml(r)}
      <div class="rgrid">
        <div class="rmain">
          <section class="rblk"><h3>Диагноз и что сделано</h3>${canEdit?`<textarea id="reDiag" rows="2" data-rsave="diagnosis" placeholder="Причина неисправности, что заменили">${esc(r.diagnosis||"")}</textarea>`:`<p>${esc(r.diagnosis||"—")}</p>`}</section>
          <section class="rblk"><h3>Работы и запчасти</h3>
            <div class="rlns">${lineRows(r,open,cost)||'<div class="muted">Пока пусто. Добавьте работы из прайса — сумма для клиента посчитается сама.</div>'}</div>
            <div class="rtot"><span>${hasLines?"Сумма для клиента":num(r.approvedSum)?"Согласовано":"Предварительная оценка"}</span><b>${money(tot)}</b></div>
            ${open&&!hasLines?`<div class="fld"><label for="reEst">Оценка до диагностики, ₽</label>${App.inp("reEst",num(r.estimate)||"","number","0",'data-rsave="estimate"')}</div>`:""}
            ${open?`<div class="radd">
              ${App.repModelChips?App.repModelChips(r):""}
              <div class="row-f addrow">${App.sel("rsSvc",[["","Работа из прайса…"],...S.services.filter(s=>s.active!==false).map(s=>[s.id,s.name+" · "+money(s.price)])],"",'aria-label="Работа из прайса"')}
                <input id="rsName" placeholder="или своя работа" aria-label="Название работы"><input id="rsPrice" type="number" inputmode="decimal" placeholder="Цена" aria-label="Цена" style="width:100px">
                <button class="btn sm" data-act="repSvcAdd" data-id="${r.id}">Добавить</button></div>
              ${canW?`<div class="fld addrow"><input id="rpQ" type="search" placeholder="Запчасть со склада сервиса: название, артикул, штрихкод" autocomplete="off" aria-label="Запчасть со склада"><div id="rpBox" class="pick" hidden></div></div>`:""}
              <button class="btn sm ghost" data-act="rqNew" data-id="${r.id}">Нет на складе — заказать запчасть</button>
            </div>`:""}
          </section>
        </div>
        <aside class="rside">
          <section class="rblk"><h3>Клиент</h3>
            <p><a href="#" data-act="openClient" data-id="${esc(r.customerId)}"><b>${esc(c.name||"—")}</b></a>${c.blacklisted?' <span class="pill bad">чёрный список</span>':""}</p>
            ${c.phone?`<p><a href="tel:+7${App.phoneKey(c.phone)}">${esc(c.phone)}</a></p>`:""}
            <div class="row-f wrap">${nb(r.id,"repMsg","Написать клиенту","sm")}${["new","diag","approve"].includes(r.status)?nb(r.id,"repLink","Ссылка на согласование","sm"):""}</div>
          </section>
          <section class="rblk"><h3>Устройство</h3>
            <dl class="rdl"><dt>Модель</dt><dd>${open&&App.repModelSel?App.repModelSel(r,m):esc(m?m.name:"—")}</dd>
              <dt>IMEI / S/N</dt><dd>${esc(r.imei||"—")}</dd>
              ${r.devicePass?`<dt>Пароль</dt><dd class="rpass">${App.patSvg&&App.patSvg(r.devicePass)||esc(r.devicePass)}</dd>`:""}</dl>
          </section>
          <section class="rblk"><h3>Приём · ${App.dtt(r.createdAt)}</h3>
            <dl class="rdl"><dt>Неисправность</dt><dd>${esc(r.problem)}</dd><dt>Внешний вид</dt><dd>${esc(r.appearance||"—")}</dd><dt>Оставили</dt><dd>${esc(r.kit||"—")}</dd>
              <dt>Осмотр</dt><dd>${ck.intake&&App.checkSummary?esc(App.checkSummary(ck.intake)):"не заполнен"}${ck.issue&&App.checkSummary?`<br><small>при выдаче: ${esc(App.checkSummary(ck.issue))}</small>`:""} <button class="btn sm ghost" data-act="repCheck" data-id="${r.id}">${ck.intake?"Открыть":"Заполнить"}</button></dd>
              <dt>Точка, принял</dt><dd>${esc((App.byId("points",r.pointId)||{}).name||"")}${r.createdBy?" · "+esc(App.nameOf(r.createdBy)):""}</dd></dl>
            ${App.repPhotosHtml?App.repPhotosHtml(r):""}
          </section>
          <section class="rblk"><h3>Мастер и срок</h3>
            ${canEdit?`<div class="fld"><label for="reMaster">Мастер</label><div class="row-f">${App.sel("reMaster",[["","— не назначен —"],...masters().map(x=>[x.id,x.fullName])],r.masterId||"",'data-rsave="master_id"')}${open&&canW&&r.masterId!==App.me.id?nb(r.id,"repTake","Взять себе","sm"):""}</div></div>
              <div class="fld"><label for="reDue">Срок готовности</label>${App.inp("reDue",r.dueDate||"","date",'','data-rsave="due_date"')}${App.isLate(r)?'<small class="badc">срок прошёл</small>':""}</div>
              <div class="fld"><label for="reWar">Гарантия, дней</label>${App.inp("reWar",r.warrantyDays,"number","",'data-rsave="warranty_days"')}</div>`
            :`<dl class="rdl"><dt>Мастер</dt><dd>${esc(App.nameOf(r.masterId)||r.master||"—")}</dd><dt>Гарантия</dt><dd>${num(r.warrantyDays)} дн.</dd></dl>`}
          </section>
          <section class="rblk"><h3>Оплата</h3>
            <div class="rpay"><div><span>Сумма</span><b>${money(tot)}</b></div><div><span>Оплачено</span><b>${money(paid)}</b></div><div><span>${open?"К оплате":"Остаток"}</span><b class="${due>0&&open?"badc":""}">${money(open?due:0)}</b></div></div>
            ${open?nb(r.id,"repPay","Принять предоплату","sm"):""}
          </section>
        </aside>
      </div>
      <details class="rhist"><summary>История и оплаты</summary>
        ${canEdit?`<div class="row-f addrow"><input id="reNote" placeholder="Заметка: позвонили клиенту, согласовал замену…" aria-label="Заметка в историю"><button class="btn sm" data-act="repNote" data-id="${r.id}">Добавить</button></div>`:""}
        <div class="rhst">${histRows(r)}</div></details>
      <div class="acts racts">
        ${nb(r.id,"repReceipt","Квитанция")}${nb(r.id,"repLabel","Наклейка")}${r.status==="done"?nb(r.id,"repAct","Акт выдачи"):""}
        ${open&&r.status!=="approve"?nb(r.id,"repCancel","Отказ от ремонта","ghost danger"):""}
        ${open&&App.can("allPoints")?`<label class="rst-man">Статус вручную ${App.sel("reStatus",App.RSTAT.filter(s=>App.ACTIVE.includes(s[0])).map(s=>[s[0],s[1]]),r.status,'data-rid="'+r.id+'" aria-label="Статус вручную"')}</label>`:""}
      </div>`);
    if(document.getElementById("rpQ"))App.productPicker("rpQ","rpBox",{wh:()=>App.serviceWhOf(r),inStock:true,showCost:cost,onPick:p=>partAdd(r,p)});
    if(App.fillPhotos)App.fillPhotos();
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
App.serviceWhOf=r=>{const p=App.byId("points",r.pointId);return p&&p.serviceWh?p.serviceWh:p&&p.cashWh?p.cashWh:App.serviceWh()};
/* поля карточки сохраняются сразу */
document.addEventListener("change",async e=>{const t=e.target;if(!t.dataset)return;
  if(t.id==="reStatus"&&t.dataset.rid){try{await App.api.rpc("repair_update",{p_id:t.dataset.rid,p:{status:t.value,note:"Статус изменён вручную"}});await App.reload(["repairs"]);App.toast("Статус: "+App.RS[t.value].label)}catch(err){App.toast(err.message)}return}
  if(!t.dataset.rsave)return;const btn=document.querySelector('#modal [data-act="repReceipt"]');const id=btn&&btn.dataset.id;if(!id)return;
  try{await App.api.rpc("repair_update",{p_id:id,p:{[t.dataset.rsave]:t.value}});await App.reload(["repairs"]);App.toast("Сохранено")}catch(err){App.toast(err.message)}});
function histRows(r){
  const pays=S.cashops.filter(o=>o.ref===r.num&&["prepay","repair","refund"].includes(o.type)).map(o=>({at:o.at,t:`${o.amount<0?"Возврат":App.CASHOP[o.type]||"Оплата"}: ${money(Math.abs(o.amount))} · ${App.payLabel(o.method)}`,cls:o.amount<0?"bad":"ok",by:o.by||o.staffId}));
  const hs=(r.history||[]).map(h=>({at:h.at,t:h.note?`${esc(h.note)}`:`Статус: ${esc((App.RS[h.status]||{}).label||h.status)}`,by:h.by,cls:h.note?"":"mute"}));
  return [...pays,...hs].sort((a,b)=>String(b.at).localeCompare(a.at)).map(x=>`<div class="rhr"><span class="rhr-d">${App.dtt(x.at)}</span><span class="${x.cls==="bad"?"badc":x.cls==="ok"?"okc":""}">${x.t}</span>${x.by?`<small>${esc(App.nameOf(x.by))}</small>`:""}</div>`).join("")||'<div class="muted">Пусто</div>';
}
const ref=s=>s.split("|");
const setSt=async(id,p,msg)=>{await App.api.rpc("repair_update",{p_id:id,p});await App.reload(["repairs"]);if(msg)App.toast(msg)};
const needPrice=r=>!r.warrantyOf&&!App.repairTotal(r);
ACT.repNext=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id),p={status:"diag"};if(!r.masterId&&App.can("repairWork"))p.master_id=App.me.id;await setSt(id,p,"Диагностика начата")});
ACT.repToApprove=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id);if(needPrice(r))throw new Error("Добавьте работы или укажите оценку — клиенту нужно назвать сумму");
  await setSt(id,{status:"approve"});const fresh=App.byId("repairs",id);(App.repApproveLink&&App.repApproveLink(fresh)?ACT.repLink:ACT.repMsg)(id)});
ACT.repAgree=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id),t=App.repairTotal(r);if(needPrice(r))throw new Error("Сначала добавьте работы или оценку — что согласовал клиент?");
  await setSt(id,{status:"work",approved:true,approved_sum:t,note:"Клиент согласовал: "+money(t)},"В работе — согласовано "+money(t))});
ACT.repReady=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id);if(needPrice(r))throw new Error("Цена не указана — добавьте выполненные работы");
  if((r.partReqs||[]).some(q=>q.status==="ordered"))throw new Error("Есть заказанная запчасть, которая ещё не пришла — отметьте её или отмените заказ");
  await setSt(id,{status:"ready"},"Готов к выдаче");ACT.repMsg(id)});
ACT.repResume=(id,btn)=>run(btn,async()=>{await setSt(id,{status:"work"},"Ремонт продолжен")});
ACT.repNote=(id,btn)=>run(btn,async()=>{const v=App.val("reNote").trim();if(!v)throw new Error("Напишите заметку");await setSt(id,{note:v},"Заметка добавлена")});
ACT.repStatus=(arg,btn)=>run(btn,async()=>{const [id,s]=ref(arg);await setSt(id,{status:s})});
ACT.repSave=(id,btn)=>run(btn,async()=>{App.toast("Изменения сохраняются сразу")});
ACT.repSvcAdd=(id,btn)=>run(btn,async()=>{const sid=App.val("rsSvc"),s=sid?App.byId("services",sid):null,name=(App.val("rsName")||"").trim()||(s&&s.name),price=App.val("rsPrice")!==""?num(App.val("rsPrice")):s?num(s.price):0;
  if(!name)throw new Error("Выберите работу из прайса или впишите свою");
  await App.api.insert("repair_services",{repair_id:id,service_id:s?s.id:null,name,price,qty:1});await App.reload(["repairs"]);App.toast("Работа добавлена: "+name)});
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
ACT.repIssue=id=>{const r=App.byId("repairs",id),tot=App.repairTotal(r),paid=App.repairPaid(r),ck=r.checklist||{};
  if(needPrice(r))return App.toast("Не указана стоимость — добавьте выполненные работы"),ACT.openRepair(id);
  const rows=[...(r.services||[]).map(s=>[s.name,num(s.price)*num(s.qty||1)]),...(r.parts||[]).filter(p=>!p.returned&&num(p.price)).map(p=>[p.name,num(p.price)*num(p.qty)])];
  if(App.repIssueCheckInit)App.repIssueCheckInit(r);
  App.openModal(App.head("Выдача · "+esc(r.num)+" · "+esc(r.device))+`
    <section class="rblk"><h3>За что платит клиент</h3><div class="rlns">${rows.map(([n,v])=>`<div class="rln"><span class="rln-n">${esc(n)}</span><b>${money(v)}</b><i></i></div>`).join("")||'<div class="muted">Гарантийный ремонт — без оплаты</div>'}</div>
      <div class="rtot"><span>Сумма</span><b>${money(tot)}</b></div>${r.diagnosis?`<p class="muted">Сделано: ${esc(r.diagnosis)}</p>`:""}</section>
    <section class="rblk"><h3>Проверьте устройство вместе с клиентом</h3>${ck.intake&&App.checkSummary?`<p class="muted">При приёме: ${esc(App.checkSummary(ck.intake))}</p>`:""}
      ${App.repIssueCheckHtml?App.repIssueCheckHtml():""}</section>
    <section class="rblk"><h3>Оплата</h3>
      <div class="form">${App.fld("riFinal","Итого за ремонт, ₽",App.inp("riFinal",r.warrantyOf?0:tot,"number"))}<div class="fld"><label>Уже оплачено</label><b class="big-n">${money(paid)}</b></div></div>
      <div class="total"><span>К оплате</span><b id="riDue">${money(Math.max(0,tot-paid))}</b></div>
      <div class="paygrid">${Object.entries(App.PAY).map(([m,l])=>`<div class="fld"><label for="ri_${m}">${l}</label><div class="row-f">${App.inp("ri_"+m,"","number","0")}<button class="btn sm" data-act="riAll" data-id="${m}">Всё</button></div></div>`).join("")}</div></section>
    <p class="muted">После выдачи начнётся гарантия ${num(r.warrantyDays)} дн. Откроется акт выдачи — клиент подписывает, что устройство получил и претензий нет.</p>
    <div class="acts"><button class="btn" data-act="openRepair" data-id="${id}">Назад</button><button class="btn pri" data-act="repIssueOk" data-id="${id}">Выдать и открыть акт</button></div>`,{wide:true});
  const upd=()=>{const due=num(App.val("riFinal"))-paid,got=Object.keys(App.PAY).reduce((a,m)=>a+num(App.val("ri_"+m)),0);const el=$("#riDue");const rest=due-got;el.textContent=due<0?"вернуть клиенту "+money(-due):Math.abs(rest)<0.5?(due?"всё внесено":"доплаты нет"):rest>0?"не хватает "+money(rest):"внесено больше на "+money(-rest);el.className=Math.abs(due-got)<0.5||due<0?"ok":"bad"};
  document.querySelectorAll("#modal input").forEach(e=>e.addEventListener("input",upd));
  ACT.riAll=m=>{const due=Math.max(0,num(App.val("riFinal"))-paid);Object.keys(App.PAY).forEach(k=>{document.getElementById("ri_"+k).value=k===m?due:""});upd()};
  if(tot-paid>0)ACT.riAll("cash");upd();
};
ACT.repIssueOk=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id),fin=num(App.val("riFinal")),paid=App.repairPaid(r);
  let pays=Object.keys(App.PAY).map(m=>({method:m,amount:num(App.val("ri_"+m))})).filter(p=>p.amount);
  if(fin<paid)pays=[{method:"cash",amount:-(paid-fin)}]; // переплата — вернуть наличными
  const got=pays.reduce((a,p)=>a+p.amount,0);if(fin>=paid&&Math.abs(fin-paid-got)>=.5)throw new Error("Сумма оплаты не сходится с остатком "+money(fin-paid));
  if(App.repIssueCheckSave)await App.repIssueCheckSave(id);
  await App.api.rpc("repair_issue",{p_id:id,p_final:fin,p_payments:pays});await App.reload(RL);App.toast("Выдан клиенту");ACT.openRepair(id);ACT.repAct(id)});
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
  const st=App.settings(),c=App.cust(r.customerId)||{},pt=App.byId("points",r.pointId)||{},paid=App.repairPaid(r),we=App.repWarrantyEnd(r);const ck=r.checklist||{};
  const rows=[...(r.services||[]).map(s=>[s.name,num(s.qty||1),num(s.price)]),...(r.parts||[]).filter(p=>!p.returned).map(p=>[p.name,num(p.qty),num(p.price)])];
  const head=`<div class="h"><div><b class="logo">${esc(st.shopName||"iCase")}</b><div class="s">${esc([st.legalName,st.inn?"ИНН "+st.inn:"",pt.address||st.address,pt.phone||st.phone].filter(Boolean).join(" · "))}</div></div>
    <div class="r"><b>${kind==="act"?"Акт выдачи":"Квитанция о приёме в ремонт"}</b><div>№ ${esc(r.num)} от ${App.dt(kind==="act"?r.closedAt:r.createdAt)}</div></div></div>`;
  const kv=(l,v)=>v?`<tr><td>${l}</td><td>${esc(v)}</td></tr>`:"";
  const body=`${head}<table class="kv">${kv("Клиент",[c.name,c.phone].filter(Boolean).join(", "))}${kv("Устройство",r.device)}${kv("IMEI / S/N",r.imei)}${kv("Неисправность",r.problem)}${kv("Комплектация",r.kit||"—")}${kv("Внешний вид",r.appearance||"—")}${kv("Осмотр при приёме",ck.intake&&App.checkSummary?App.checkSummary(ck.intake):"")}${kv("Фото при приёме",(r.photos||[]).filter(p=>p.kind==="intake").length?(r.photos||[]).filter(p=>p.kind==="intake").length+" шт., хранятся в сервисе":"")}${kind==="act"?kv("Проверено при выдаче",ck.issue&&App.checkSummary?App.checkSummary(ck.issue):""):""}
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
