/* iCase CRM v3 · Связки данных:
   история экземпляра по IMEI и подготовка б/у · лист ожидания и упущенный спрос · задачи и автонапоминания ·
   аналитика: б/у и trade-in, поставщики и брак, реклама по каналам, сервис и запчасти, спрос, KPI продавцов и кассиров */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const DAY=864e5;
const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const ymd=d=>{const x=new Date(d);return new Date(x-x.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const pct=v=>(Math.round(v*1000)/10).toString().replace(".",",")+"%";
const inR=(t,[a,b])=>{if(!t)return false;const d=new Date(t);return d>=a&&d<b};
const docByNum=n=>S.docs.find(d=>d.num===n);
const saleByNum=n=>App.idx(S.sales,"num").get(n);

/* =================== ЭКЗЕМПЛЯР: ПОЛНАЯ ИСТОРИЯ ПО IMEI =================== */
App.unitSaleItem=u=>{for(const s of S.sales)for(const i of (s.items||[]))if((i.unitId&&i.unitId===u.id)||(u.saleItemId&&i.line===u.saleItemId))return {s,i};return null};
/* откуда пришёл: документ прихода с поставщиком или trade-in из продажи */
App.unitOrigin=function(u){const ref=u.originRef||u.lastRef||"";const d=docByNum(ref);
  if(d)return {kind:d.type==="in"?"supplier":"doc",ref,doc:d,supplierId:d.supplierId||"",at:d.postedAt||d.createdAt};
  const s=saleByNum(ref);if(s&&s.tradeIn)return {kind:"tradein",ref,sale:s,customerId:s.customerId,at:s.createdAt,amount:num(s.tradeIn.amount)};
  return {kind:"other",ref,at:u.createdAt}};
App.unitPrepSum=id=>S.unitcosts.filter(c=>c.unitId===id).reduce((a,c)=>a+num(c.amount),0);
/* поставщик товара: у экземпляра — из прихода, у обычного товара — из последнего прихода этого товара */
App.supplierOf=function(productId,unitId){if(unitId){const u=App.byId("units",unitId);if(u){const o=App.unitOrigin(u);if(o.supplierId)return o.supplierId}}
  const ds=S.docs.filter(d=>d.type==="in"&&d.status==="posted"&&d.supplierId&&d.lines.some(l=>l.productId===productId)).sort((a,b)=>String(b.postedAt||b.createdAt).localeCompare(a.postedAt||a.createdAt));
  return ds[0]?ds[0].supplierId:""};
ACT.unitHist=id=>{const u=App.byId("units",id);if(!u)return;const p=App.byId("products",u.productId)||{},code=App.unitCode(u),cost=App.can("cost");
  const o=App.unitOrigin(u),prep=S.unitcosts.filter(c=>c.unitId===id),prepSum=prep.reduce((a,c)=>a+num(c.amount),0),buy=num(u.cost)-prepSum;
  const sold=App.unitSaleItem(u),ev=[];
  if(o.kind==="supplier")ev.push([o.at,`Приход ${o.ref}`+(o.supplierId?` от «${(App.byId("suppliers",o.supplierId)||{}).name||""}»`:""),cost?money(buy):"",["openDoc",o.doc.id]]);
  else if(o.kind==="tradein")ev.push([o.at,`Принят в trade-in по продаже ${o.ref} от ${(App.cust(o.customerId)||{}).name||"клиента"}`,cost?money(o.amount):"",["openSale",o.sale.id]]);
  else ev.push([o.at,"Поступил на склад"+(o.ref?" · "+o.ref:""),cost?money(buy):"",null]);
  S.docs.filter(d=>d.status!=="draft"&&d.num!==o.ref&&d.lines.some(l=>(l.unitIds||[]).includes(id)||(l.newUnits||[]).some(x=>(x.imei||x.serial_no)===code)||(l.foundCodes||[]).includes(code)))
    .forEach(d=>ev.push([d.postedAt||d.createdAt,`${(App.DOCT[d.type]||{}).one||"Документ"} ${d.num}${d.type==="transfer"?": "+App.whName(d.whFrom)+" → "+App.whName(d.whTo):""}${d.status==="cancelled"?" (отменён)":""}`,"",["openDoc",d.id]]));
  prep.forEach(c=>ev.push([c.at,`Подготовка: ${c.name}${c.qty>1?" ×"+c.qty:""}${c.note?" · "+c.note:""}`,cost?"+"+money(c.amount):"",null]));
  if(sold){ev.push([sold.s.createdAt,`Продан ${sold.s.num}${sold.s.customerId?" · "+((App.cust(sold.s.customerId)||{}).name||""):""}`,money(num(sold.i.price)-num(sold.i.disc)),["openSale",sold.s.id]]);
    S.returns.filter(r=>r.saleId===sold.s.id&&(r.items||[]).some(i=>i.line===sold.i.line)).forEach(r=>ev.push([r.createdAt,`Возврат ${r.num}${r.defect?" · брак":""} · ${r.reason||""}`,money(-r.amount),["openSale",sold.s.id]]))}
  S.repairs.filter(r=>r.unitId===id||(code&&String(r.imei).trim()===code)).forEach(r=>ev.push([r.createdAt,`Ремонт ${r.num}: ${r.problem}${r.saleId?" · гарантийный по продаже":""}`,money(App.repairTotal(r)),["openRepair",r.id]]));
  ev.sort((a,b)=>String(a[0]).localeCompare(b[0]));
  const sale=sold?num(sold.i.price)-num(sold.i.disc):0,days=Math.round(((sold?new Date(sold.s.createdAt):new Date())-new Date(o.at||u.createdAt))/DAY);
  App.openModal(App.head("История "+esc(code),App.unitSt(u))+`<p class="muted" style="margin-top:-4px">${esc(p.name||"")}</p>
    <div class="tiles">${cost?`<div class="tile"><span>${o.kind==="tradein"?"Выкуплен за":"Закупка"}</span><b>${money(buy)}</b></div><div class="tile"><span>Подготовка</span><b>${money(prepSum)}</b><small>${prep.length} поз.</small></div><div class="tile"><span>Себестоимость</span><b>${money(u.cost)}</b></div>`:""}
      <div class="tile"><span>${sold?"Продан за":"Цена"}</span><b>${money(sold?sale:App.unitPrice(u,p))}</b>${cost&&sold?`<small class="${sale-num(sold.i.cost)<0?"badc":"okc"}">прибыль ${money(sale-num(sold.i.cost))}</small>`:""}</div>
      <div class="tile"><span>${sold?"Был на складе":"На складе"}</span><b>${days} дн.</b></div></div>
    <div class="rhst" style="max-height:none">${ev.map(([at,t,v,a])=>`<div class="rhr"><span class="rhr-d">${App.dtt(at)}</span><span>${a?`<a href="#" data-act="${a[0]}" data-id="${esc(a[1])}">${esc(t)}</a>`:esc(t)}</span><small>${esc(v)}</small></div>`).join("")}</div>
    <div class="acts"><button class="btn" data-act="openUnit" data-id="${esc(id)}">Карточка экземпляра</button>${u.status==="in_stock"&&(App.can("stock")||App.can("repairWork"))?`<button class="btn pri" data-act="unitPrep" data-id="${esc(id)}">Подготовка к продаже</button>`:""}</div>`,{wide:true})};

/* подготовка б/у к продаже: запчасти со склада + работа → в себестоимость экземпляра */
let PR=null;
ACT.unitPrep=id=>{const u=App.byId("units",id);if(!u)return;PR={id,parts:[],wh:App.serviceWh()||u.whId};drawPrep()};
function drawPrep(){const u=App.byId("units",PR.id),cost=App.can("cost");const ps=PR.parts.reduce((a,x)=>a+num((App.byId("products",x.productId)||{}).cost)*x.qty,0);
  const html=App.head("Подготовка к продаже · "+esc(App.unitCode(u)))+`
    <p class="muted">Запчасти спишутся со склада, их закупочная стоимость и стоимость работы добавятся к себестоимости этого экземпляра. Прибыль с продажи будет считаться честно.</p>
    <div class="form">${App.fld("ppWh","Склад запчастей",App.sel("ppWh",App.whOpts(),PR.wh))}</div>
    <div class="fld addrow"><input id="ppQ" type="search" placeholder="Запчасть: аккумулятор, дисплей, стекло…" autocomplete="off" aria-label="Запчасть"><div id="ppBox" class="pick" hidden></div></div>
    <div class="rpl">${PR.parts.map((x,i)=>{const p=App.byId("products",x.productId)||{};return `<div class="rpr"><span>${esc(p.name)}<small>${x.qty} шт${cost?" · "+money(num(p.cost)*x.qty):""}</small></span><b></b><button class="btn sm ghost" data-act="ppDel" data-id="${i}" aria-label="Убрать">✕</button></div>`}).join("")||'<div class="muted">Запчастей нет</div>'}</div>
    <div class="form">${App.fld("ppLabor","Стоимость работы (своя), ₽",App.inp("ppLabor","","number","0"))}${App.fld("ppNote","Что сделано",App.inp("ppNote","","text","Замена АКБ, полировка"))}</div>
    ${cost?`<div class="total"><span>Себестоимость станет</span><b id="ppTot">${money(num(u.cost)+ps)}</b></div>`:""}
    <div class="acts"><button class="btn" data-act="unitHist" data-id="${esc(PR.id)}">Назад</button><button class="btn pri" data-act="unitPrepOk">Списать и добавить к себестоимости</button></div>`;
  if($("#ppQ"))App.redrawModal(html);else App.openModal(html,{wide:true});
  App.productPicker("ppQ","ppBox",{wh:()=>App.val("ppWh"),inStock:true,showCost:cost,onPick:p=>{if(p.trackSerial)return App.toast("Товар с IMEI нельзя списать как запчасть");const ex=PR.parts.find(x=>x.productId===p.id);if(ex)ex.qty++;else PR.parts.push({productId:p.id,qty:1});drawPrep()}});
  const w=$("#ppWh");if(w)w.addEventListener("change",()=>{PR.wh=w.value});
  const l=$("#ppLabor");if(l&&cost)l.addEventListener("input",()=>{$("#ppTot").textContent=money(num(u.cost)+ps+num(l.value))})}
ACT.ppDel=i=>{PR.parts.splice(+i,1);drawPrep()};
ACT.unitPrepOk=(_,btn)=>run(btn,async()=>{const lab=num(App.val("ppLabor"));if(!PR.parts.length&&!lab)throw new Error("Добавьте запчасти или стоимость работы");
  const tot=await App.api.rpc("unit_prep",{p_unit:PR.id,p_parts:PR.parts.map(x=>({product_id:x.productId,warehouse_id:PR.wh,qty:x.qty})),p_labor:lab,p_note:App.val("ppNote")||null},["units","unit_costs","stock","stock_movements"]);
  await App.reload(["units","unitcosts","products","movements"]);App.toast("Добавлено к себестоимости: "+money(tot));ACT.unitHist(PR.id)});

/* =================== ЛИСТ ОЖИДАНИЯ И УПУЩЕННЫЙ СПРОС =================== */
const WST={open:["Ждёт товар","warn"],ready:["Пришло — позвонить","ok"],done:["Выполнено","mute"],cancelled:["Отменено","mute"]};
const wPill=s=>`<span class="pill ${(WST[s]||[])[1]||""}">${(WST[s]||[s])[0]}</span>`;
let WP=null;
ACT.waitNew=(arg)=>{const c=typeof arg==="string"&&arg?App.cust(arg):null;WP={productId:""};
  App.openModal(App.head("Лист ожидания: клиент ждёт товар")+`<div class="form">
    ${App.fld("wPhone","Телефон клиента",App.inp("wPhone",c?c.phone:"","tel","+7 900 000-00-00"))}${App.fld("wName","Имя",App.inp("wName",c?c.name:""))}
    <div class="fld full"><label for="wQ">Товар из базы (если есть) или опишите ниже</label><input id="wQ" type="search" placeholder="Найти товар" autocomplete="off"><div id="wBox" class="pick" hidden></div><small id="wPicked" class="muted"></small></div>
    ${App.fld("wReq","Что нужно",App.inp("wReq","","text","iPhone 16 Pro 256 ГБ, белый"),"full")}
    ${App.fld("wQty","Количество",App.inp("wQty",1,"number"))}${App.fld("wMax","Готов заплатить до, ₽",App.inp("wMax","","number","необязательно"))}
    ${App.fld("wNote","Комментарий",App.inp("wNote","","text","Звонить после 18:00"),"full")}</div>
    <p class="muted">Когда товар придёт на склад, заявка станет «Пришло — позвонить», и в «Задачах» появится напоминание.</p>
    <div class="acts"><button class="btn pri" data-act="waitSave">Записать</button></div>`);
  App.productPicker("wQ","wBox",{onPick:p=>{WP.productId=p.id;$("#wPicked").textContent="Выбран: "+p.name;if(!App.val("wReq"))$("#wReq").value=p.name}})};
ACT.waitSave=(_,btn)=>run(btn,async()=>{const V=App.val;if(App.phoneKey(V("wPhone")).length!==10)throw new Error("Укажите телефон клиента");if(!V("wReq"))throw new Error("Опишите, что нужно");
  const cid=await App.api.customer(V("wPhone"),V("wName"),"Магазин");
  await App.api.insert("waitlist",{customer_id:cid,product_id:WP.productId||null,request:V("wReq"),qty:Math.max(1,num(V("wQty"))),max_price:V("wMax")?num(V("wMax")):null,point_id:(App.point()||{}).id||null,note:V("wNote")||null});
  await App.reload(["waitlist","customers"]);App.closeModal();App.toast("Записано в лист ожидания")});
ACT.waitOpen=id=>{const w=S.waitlist.find(x=>x.id===id);if(!w)return;const c=App.cust(w.customerId)||{},p=w.productId?App.byId("products",w.productId):null,tel=App.phoneKey(c.phone);
  const txt=`Здравствуйте${c.name?", "+c.name:""}! ${App.settings().shopName||"iCase"}: пришёл товар, который вы ждали — ${w.request}${p?" · "+money(p.price):""}. Отложим для вас?`;
  App.openModal(App.head("Ожидание: "+esc(w.request),wPill(w.status))+`<div class="kv"><div><span>Клиент</span><b><a href="#" data-act="openClient" data-id="${esc(w.customerId)}">${esc(c.name||"—")}</a> · ${esc(c.phone||"")}</b></div>
    <div><span>Записан</span><b>${App.dtt(w.createdAt)} · ${esc(App.nameOf(w.by))}</b></div>${p?`<div><span>Товар</span><b>${esc(p.name)} · в наличии ${App.qtyTotal(p)} шт</b></div>`:""}
    <div><span>Количество</span><b>${w.qty}</b></div>${w.maxPrice?`<div><span>Бюджет</span><b>до ${money(w.maxPrice)}</b></div>`:""}${w.note?`<div><span>Комментарий</span><b>${esc(w.note)}</b></div>`:""}</div>
    <div class="acts">${tel?`<a class="btn" href="https://wa.me/7${tel}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="sms:+7${tel}?body=${encodeURIComponent(txt)}">SMS</a>`:""}
      ${["open","ready"].includes(w.status)?`<button class="btn danger" data-act="waitSt" data-id="${w.id}|cancelled">Отменить</button><button class="btn pri" data-act="waitSt" data-id="${w.id}|done">Клиент купил / вопрос закрыт</button>`:""}</div>`)};
ACT.waitSt=(arg,btn)=>run(btn,async()=>{const [id,st]=arg.split("|");await App.api.update("waitlist",id,{status:st,closed_at:new Date().toISOString()});
  const t=S.tasks.find(x=>x.autoKey==="wl-"+id&&x.status==="open");if(t)await App.api.update("tasks",t.id,{status:"done",done_at:new Date().toISOString(),done_by:App.me.id});
  await App.reload(["waitlist","tasks"]);App.closeModal();App.toast("Готово")});
let LP=null;
ACT.lostNew=()=>{LP={productId:""};App.openModal(App.head("Спрашивали, но не было")+`<div class="form">
    <div class="fld full"><label for="lQ">Товар из базы (если есть)</label><input id="lQ" type="search" placeholder="Найти товар" autocomplete="off"><div id="lBox" class="pick" hidden></div></div>
    ${App.fld("lReq","Что спрашивали",App.inp("lReq","","text","AirPods Pro 3 / чехол на Galaxy S25"),"full")}
    ${App.fld("lQty","Сколько",App.inp("lQty",1,"number"))}${App.fld("lWhy","Почему не купили",App.sel("lWhy",["нет в наличии","нет нужного цвета/памяти","дорого","нет такой модели в ассортименте","другое"]))}</div>
    <p class="muted">Это учитывается в «Аналитика → Спрос» и в списке «Что заказать». Если клиент готов ждать — лучше запишите его в лист ожидания.</p>
    <div class="acts"><button class="btn" data-act="waitNew">В лист ожидания</button><button class="btn pri" data-act="lostSave">Записать</button></div>`);
  App.productPicker("lQ","lBox",{onPick:p=>{LP.productId=p.id;$("#lReq").value=p.name}})};
ACT.lostSave=(_,btn)=>run(btn,async()=>{const V=App.val;if(!V("lReq"))throw new Error("Опишите, что спрашивали");
  await App.api.insert("lost_demand",{request:V("lReq"),product_id:LP.productId||null,qty:Math.max(1,num(V("lQty"))),reason:V("lWhy"),point_id:(App.point()||{}).id||null});
  await App.reload(["lostdemand"]);App.closeModal();App.toast("Записано")});

/* =================== ЗАДАЧИ И АВТОНАПОМИНАНИЯ =================== */
TITLES.tasks="Задачи";
Object.assign(App.ui,{tkTab:"tasks",tkWho:"all",wlSt:"active"});
App.NAV.splice(App.NAV.findIndex(n=>n[0]==="clients")+1,0,["tasks","Задачи",'<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',null]);
const myTasks=()=>S.tasks.filter(t=>t.status==="open"&&(!t.assignee||t.assignee===App.me.id||App.can("allPoints")));
App.tasksDue=()=>myTasks().filter(t=>!t.dueDate||t.dueDate<=today()).length;
/* автозадачи: формируются из данных, повторно не создаются (auto_key) */
let autoAt=0;
App.autoTasks=async function(force){if(!App.me.role||(!force&&Date.now()-autoAt<10*60e3))return;autoAt=Date.now();
  const rows=[],t0=today(),add=(key,title,o={})=>{if(!S.tasks.some(x=>x.autoKey===key))rows.push({auto_key:key,title,due_date:o.due||t0,note:o.note||null,customer_id:o.c||null,ref_type:o.rt||null,ref_id:o.ri||null,point_id:o.pt||null,assignee:o.who||null})};
  const st=App.settings();
  S.repairs.forEach(r=>{const c=App.cust(r.customerId)||{};
    if(r.status==="ready"&&r.readyAt&&App.days(r.readyAt)>=3)add("rep-wait-"+r.id,`Напомнить забрать ремонт ${r.num} (${r.device})`,{c:r.customerId,rt:"repair",ri:r.id,pt:r.pointId,note:"Готов с "+App.dt(r.readyAt)+(c.phone?" · "+c.phone:"")});
    if(App.isLate(r))add("rep-late-"+r.id,`Просрочен ремонт ${r.num}: предупредить клиента о сроке`,{c:r.customerId,rt:"repair",ri:r.id,pt:r.pointId,who:r.masterId||null});
    if(r.status==="approve"&&App.days(r.updatedAt||r.createdAt)>=1)add("rep-appr-"+r.id,`Согласовать цену ремонта ${r.num}`,{c:r.customerId,rt:"repair",ri:r.id,pt:r.pointId})});
  S.waitlist.filter(w=>w.status==="ready").forEach(w=>add("wl-"+w.id,`Пришло для клиента: ${w.request} — позвонить`,{c:w.customerId,rt:"waitlist",ri:w.id,pt:w.pointId}));
  if(App.can("finance")){S.debts.filter(d=>d.status==="open"&&d.dueDate&&d.dueDate<t0).forEach(d=>add("debt-"+d.id,d.direction==="in"?`Напомнить о долге: ${d.counterparty} (${money(App.debtLeft(d))})`:`Оплатить долг: ${d.counterparty} (${money(App.debtLeft(d))})`,{rt:"debt",ri:d.id,c:d.customerId||null}));
    if(App.finCfg)App.finCfg().psn.patents.forEach((p,i)=>{if(p.to&&new Date(p.to)-Date.now()<30*DAY&&new Date(p.to)>Date.now()-DAY)add(`psn-${i}-${p.to}`,`Продлить патент ПСН${p.pointId?" · "+((App.byId("points",p.pointId)||{}).name||""):""} (до ${App.dt(p.to)})`,{rt:"psn"})})}
  if(App.can("stock"))S.porders.filter(o=>["sent","partial"].includes(o.status)&&o.expectedDate&&o.expectedDate<t0).forEach(o=>add("po-"+o.id,`Поставка по заказу ${o.num} опаздывает — связаться с поставщиком`,{rt:"po",ri:o.id}));
  // повторные продажи: замена АКБ через ~18 мес после покупки телефона, новое стекло через год, день рождения
  const now=Date.now();S.sales.forEach(s=>{if(!s.customerId)return;const age=(now-new Date(s.createdAt))/DAY;
    if(age>=540&&age<570&&(s.items||[]).some(i=>i.serial&&App.isPhone(i.productId)))add("rs-bat-"+s.id,`Предложить замену АКБ или trade-in: телефон куплен ${App.dt(s.createdAt)}`,{c:s.customerId,rt:"sale",ri:s.id,pt:s.pointId});
    if(age>=365&&age<380&&(s.items||[]).some(i=>/стекл/i.test(i.name)))add("rs-glass-"+s.id,`Предложить новое защитное стекло (куплено ${App.dt(s.createdAt)})`,{c:s.customerId,rt:"sale",ri:s.id,pt:s.pointId})});
  const md=t0.slice(5),y=t0.slice(0,4);S.customers.filter(c=>c.birthday&&!c.mergedInto&&c.birthday.slice(5)===md).forEach(c=>add(`bd-${c.id}-${y}`,`День рождения: поздравить ${c.name}${num(c.discount)?"":", предложить скидку"}`,{c:c.id,rt:"customer",ri:c.id}));
  if(rows.length)try{await App.api.tasksAuto(rows);await App.reload(["tasks"])}catch(e){console.warn(e)}};
const tkRow=t=>{const c=t.customerId?App.cust(t.customerId):null,late=t.status==="open"&&t.dueDate&&t.dueDate<today();
  return `<div class="frow tkrow ${t.status!=="open"?"off":""}"><button class="tkchk" data-act="taskDone" data-id="${t.id}" aria-label="${t.status==="open"?"Выполнено":"Вернуть"}">${t.status==="done"?"✓":""}</button>
    <button class="cnm" data-act="taskOpen" data-id="${t.id}" style="text-align:left;background:none;border:0;font:inherit;color:inherit;cursor:pointer;padding:0"><b>${esc(t.title)}</b>
    <small>${t.dueDate?`<span class="${late?"badc":""}">${late?"просрочено · ":""}${App.dt(t.dueDate)}</span>`:"без срока"}${c?" · "+esc(c.name)+(c.phone?" "+esc(c.phone):""):""}${t.assignee?" · "+esc(App.nameOf(t.assignee)):""}${t.autoKey?' · <span class="muted">авто</span>':""}</small>
    ${t.note?`<small>${esc(t.note)}</small>`:""}</button></div>`};
VIEWS.tasks={
  ownSearch:true,
  actions:()=>'<button class="btn" data-act="lostNew">Спрашивали, не было</button><button class="btn" data-act="waitNew">+ Лист ожидания</button><button class="btn pri" data-act="taskNew">+ Задача</button>',
  render(){const u=App.ui,t=u.tkTab;
    const wlN=S.waitlist.filter(w=>w.status==="ready").length;
    return `<div class="tabs"><button class="tab ${t==="tasks"?"on":""}" data-act="tkTab" data-id="tasks">Задачи${App.tasksDue()?` <b>${App.tasksDue()}</b>`:""}</button><button class="tab ${t==="wait"?"on":""}" data-act="tkTab" data-id="wait">Лист ожидания${wlN?' <span class="dot ok"></span>':""}</button><button class="tab ${t==="lost"?"on":""}" data-act="tkTab" data-id="lost">Спрашивали</button></div>`
      +(t==="wait"?waitView():t==="lost"?lostView():taskView())},
  after(){App.autoTasks()}
};
ACT.tkTab=k=>{App.ui.tkTab=k;App.render()};
function taskView(){const u=App.ui,t0=today();
  let list=S.tasks.filter(t=>u.tkWho==="mine"?(!t.assignee||t.assignee===App.me.id):true);
  const open=list.filter(t=>t.status==="open").sort((a,b)=>String(a.dueDate||"9").localeCompare(b.dueDate||"9"));
  const grp=[["Просрочено",open.filter(t=>t.dueDate&&t.dueDate<t0)],["Сегодня",open.filter(t=>t.dueDate===t0)],["Позже",open.filter(t=>t.dueDate&&t.dueDate>t0)],["Без срока",open.filter(t=>!t.dueDate)]];
  const done=App.sortDesc(list.filter(t=>t.status==="done").map(t=>Object.assign({},t,{createdAt:t.doneAt||t.createdAt}))).slice(0,20);
  return `<div class="anbar"><div class="seg"><button class="${u.tkWho==="all"?"on":""}" data-act="tkWho" data-id="all">Все</button><button class="${u.tkWho==="mine"?"on":""}" data-act="tkWho" data-id="mine">Мои</button></div>
      <span class="muted">Напоминания о ремонтах, листе ожидания, долгах, поставках, патентах и поводах для повторных продаж создаются сами.</span></div>
    ${grp.filter(g=>g[1].length).map(([l,g])=>`<section class="card"><div class="card-h"><h2>${l} <span class="muted">${g.length}</span></h2></div><div class="flist">${g.map(tkRow).join("")}</div></section>`).join("")||'<section class="card"><div class="empty">Открытых задач нет 🎉</div></section>'}
    ${done.length?`<section class="card"><div class="card-h"><h2>Недавно выполнены</h2></div><div class="flist">${done.map(tkRow).join("")}</div></section>`:""}`}
ACT.tkWho=k=>{App.ui.tkWho=k;App.render()};
function waitView(){const u=App.ui;const list=App.sortDesc(S.waitlist.filter(w=>u.wlSt==="active"?["open","ready"].includes(w.status):u.wlSt==="all"||w.status===u.wlSt));
  return `<div class="chips rchips">${[["active","Активные"],["ready","Пришло"],["open","Ждут"],["done","Выполнены"],["all","Все"]].map(([k,l])=>`<button class="chip ${u.wlSt===k?"on":""}" data-act="wlSt" data-id="${k}">${l} <b>${S.waitlist.filter(w=>k==="active"?["open","ready"].includes(w.status):k==="all"||w.status===k).length}</b></button>`).join("")}</div>
    <section class="card">${list.length?`<div class="flist">${list.map(w=>{const c=App.cust(w.customerId)||{},p=w.productId?App.byId("products",w.productId):null;return `<button class="frow" data-act="waitOpen" data-id="${w.id}"><span class="fic">⏳</span>
      <span class="cnm"><b>${esc(w.request)}${w.qty>1?" ×"+w.qty:""} ${wPill(w.status)}</b><small>${esc(c.name||"")} ${esc(c.phone||"")} · с ${App.dt(w.createdAt)}${p?" · в наличии "+App.qtyTotal(p):" · не привязан к товару"}</small></span><span class="csum">${w.maxPrice?"до "+money(w.maxPrice):""}</span></button>`}).join("")}</div>`:'<div class="empty">Никто не ждёт. Если клиент спрашивает товар, которого нет, — запишите его, и CRM напомнит позвонить, когда товар придёт.</div>'}</section>`}
ACT.wlSt=k=>{App.ui.wlSt=k;App.render()};
function lostView(){const g={};S.lostdemand.forEach(x=>{const k=x.productId||x.request.toLowerCase().trim();(g[k]=g[k]||{name:x.productId?((App.byId("products",x.productId)||{}).name||x.request):x.request,n:0,q:0,last:"",why:{}});g[k].n++;g[k].q+=x.qty;g[k].why[x.reason]=(g[k].why[x.reason]||0)+1;if(x.createdAt>g[k].last)g[k].last=x.createdAt});
  const rows=Object.values(g).sort((a,b)=>b.q-a.q);
  return `<section class="card"><div class="card-h"><h2>Что спрашивали, а купить не смогли</h2><button class="btn sm" data-act="lostNew">+ Записать</button></div>${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Товар / запрос</th><th class="n">Раз</th><th class="n">Штук</th><th>Причины</th><th>Последний раз</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="n">${r.n}</td><td class="n">${r.q}</td><td>${esc(Object.entries(r.why).map(([k,v])=>k+(v>1?" ×"+v:"")).join(", "))}</td><td>${App.dt(r.last)}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty">Пока ничего. Записывайте каждый раз, когда клиент ушёл без покупки, — так видно, что докупить.</div>'}</section>`}
ACT.taskNew=(arg)=>{const pre=arg&&typeof arg==="object"&&!arg.nodeType?arg:{};
  App.openModal(App.head("Новая задача")+`<div class="form">${App.fld("tkT","Что сделать",App.inp("tkT",pre.title||"","text","Перезвонить клиенту по чехлу"),"full")}
    ${App.fld("tkD","Срок",App.inp("tkD",pre.due||today(),"date"))}${App.fld("tkW","Кому",App.sel("tkW",[["","Любому сотруднику"],...S.staff.filter(s=>s.active!==false).map(s=>[s.id,s.fullName])],pre.who||""))}
    ${App.fld("tkPh","Клиент (телефон, необязательно)",App.inp("tkPh",pre.phone||"","tel"))}${App.fld("tkN","Подробности",App.inp("tkN",""),"full")}</div>
    <div class="acts"><button class="btn pri" data-act="taskSave">Создать</button></div>`)};
ACT.taskSave=(_,btn)=>run(btn,async()=>{const V=App.val;if(!V("tkT"))throw new Error("Опишите задачу");let cid=null;
  if(V("tkPh")){const c=App.findCustomerByPhone(V("tkPh"));cid=c?c.id:await App.api.customer(V("tkPh"),"","Магазин")}
  await App.api.insert("tasks",{title:V("tkT"),due_date:V("tkD")||null,assignee:V("tkW")||null,customer_id:cid,note:V("tkN")||null,point_id:(App.point()||{}).id||null});
  await App.reload(["tasks"]);App.closeModal();App.toast("Задача создана")});
ACT.taskDone=(id,btn)=>run(btn,async()=>{const t=S.tasks.find(x=>x.id===id);const open=t.status==="open";
  await App.api.update("tasks",id,open?{status:"done",done_at:new Date().toISOString(),done_by:App.me.id}:{status:"open",done_at:null,done_by:null});await App.reload(["tasks"]);App.render()});
ACT.taskOpen=id=>{const t=S.tasks.find(x=>x.id===id);if(!t)return;const go={repair:"openRepair",waitlist:"waitOpen",debt:"debtOpen",po:"poOpen",sale:"openSale",customer:"openClient"}[t.refType];
  if(go&&ACT[go]&&t.refId)return ACT[go](t.refId);if(t.customerId)return ACT.openClient(t.customerId);App.toast(t.note||t.title)};

/* =================== АНАЛИТИКА: новые вкладки =================== */
const per=()=>{const u=App.ui;return App.anRange(u.anPer)};
const tbl=(title,cols,rows,note,foot)=>`<section class="card"><div class="card-h"><h2>${title}</h2></div>${rows.length?`<div class="tbl-wrap"><table><thead><tr>${cols.map(([h,c])=>`<th class="${c||""}">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<td class="${(cols[i]||[])[1]||""}">${v}</td>`).join("")}</tr>`).join("")}${foot?`<tr class="f">${foot.map((v,i)=>`<td class="${(cols[i]||[])[1]||""}"><b>${v}</b></td>`).join("")}</tr>`:""}</tbody></table></div>`:'<div class="empty">Нет данных за период</div>'}${note?`<p class="muted">${note}</p>`:""}</section>`;
const tiles=list=>`<div class="tiles">${list.map(([l,v,s])=>`<div class="tile"><span>${l}</span><b>${v}</b>${s?`<small>${s}</small>`:""}</div>`).join("")}</div>`;
const ptOk=(x,k="pointId")=>!App.ui.anPoint||x[k]===App.ui.anPoint;

/* --- б/у и trade-in --- */
function used(){const R=per(),cost=App.can("cost");
  const sold=[];S.sales.filter(s=>inR(s.createdAt,R)&&ptOk(s)).forEach(s=>(s.items||[]).forEach(i=>{if(!i.unitId)return;const u=App.byId("units",i.unitId);if(!u)return;const p=App.byId("products",u.productId);
    const o=App.unitOrigin(u);if(!(App.isUsedUnit(u,p)||o.kind==="tradein"))return;const prep=App.unitPrepSum(u.id),sale=num(i.price)-num(i.disc),cst=num(i.cost);
    sold.push({s,i,u,o,prep,sale,cst,profit:sale-cst,days:Math.max(0,Math.round((new Date(s.createdAt)-new Date(o.at||u.createdAt))/DAY))})}));
  const ti=S.sales.filter(s=>s.tradeIn&&inR(s.createdAt,R)&&ptOk(s)).map(s=>{const u=S.units.find(x=>x.originRef===s.num||(s.tradeIn.imei&&App.unitCode(x)===s.tradeIn.imei));const si=u?App.unitSaleItem(u):null;
    return {s,u,si,given:num(s.tradeIn.amount),prep:u?App.unitPrepSum(u.id):0,sale:si?num(si.i.price)-num(si.i.disc):0}});
  const sum=(a,k)=>a.reduce((x,y)=>x+y[k],0);
  const inStock=S.units.filter(u=>u.status==="in_stock"&&App.isUsedUnit(u,App.byId("products",u.productId)));
  return tiles([["Продано б/у",sold.length,money(sum(sold,"sale"))],...(cost?[["Прибыль с б/у",money(sum(sold,"profit")),sold.length?"в среднем "+money(sum(sold,"profit")/sold.length):""],["Потрачено на подготовку",money(sum(sold,"prep"))]]:[]),["Средний срок продажи",sold.length?Math.round(sum(sold,"days")/sold.length)+" дн.":"—"],["Б/у на складе",inStock.length,cost?money(inStock.reduce((a,u)=>a+num(u.cost),0))+" в закупке":""]])
    +tbl("Проданные б/у экземпляры",[["Экземпляр"],["Откуда"],...(cost?[["Закупка","n"],["Подготовка","n"]]:[]),["Продан за","n"],...(cost?[["Прибыль","n"]]:[]),["Дней","n"]],
      sold.sort((a,b)=>b.profit-a.profit).map(x=>[`<a href="#" data-act="unitHist" data-id="${x.u.id}">${esc((App.byId("products",x.u.productId)||{}).name||"")} · ${esc(App.unitCode(x.u))}</a>`,x.o.kind==="tradein"?"trade-in":x.o.kind==="supplier"?esc((App.byId("suppliers",x.o.supplierId)||{}).name||"поставщик"):"—",...(cost?[money(x.cst-x.prep),money(x.prep)]:[]),money(x.sale),...(cost?[`<span class="${x.profit<0?"badc":""}">${money(x.profit)}</span>`]:[]),x.days]),
      "Себестоимость б/у = закупка или выкуп + запчасти и работа на подготовку (кнопка «Подготовка к продаже» в истории экземпляра).")
    +tbl("Сделки trade-in",[["Продажа"],["Принято устройство"],["Зачтено клиенту","n"],["Подготовка","n"],["Перепродано за","n"],["Итог по устройству","n"]],
      ti.map(x=>[`<a href="#" data-act="openSale" data-id="${x.s.id}">${esc(x.s.num)}</a> · ${App.dt(x.s.createdAt)}`,x.u?`<a href="#" data-act="unitHist" data-id="${x.u.id}">${esc(x.s.tradeIn.device)}</a>`:esc(x.s.tradeIn.device),money(x.given),money(x.prep),x.si?money(x.sale):'<span class="muted">ещё на складе</span>',x.si?`<span class="${x.sale-x.given-x.prep<0?"badc":"okc"}">${money(x.sale-x.given-x.prep)}</span>`:"—"]),
      "Итог показывает, сколько заработали на перепродаже сданного устройства. Вместе с прибылью основной продажи — полная выгода сделки.")}

/* --- поставщики: качество --- */
function sup(){const R=per(),cost=App.can("cost");const m={};const g=id=>m[id]=m[id]||{rec:0,recSum:0,sold:0,defRet:0,warr:0,retSum:0};
  S.docs.filter(d=>d.type==="in"&&d.status==="posted"&&inR(d.postedAt||d.createdAt,R)).forEach(d=>{const x=g(d.supplierId||"");d.lines.forEach(l=>{x.rec+=num(l.qty);x.recSum+=num(l.qty)*num(l.cost)})});
  S.sales.filter(s=>inR(s.createdAt,R)).forEach(s=>(s.items||[]).forEach(i=>{if(!i.productId)return;g(App.supplierOf(i.productId,i.unitId)).sold+=num(i.qty)}));
  S.returns.filter(r=>r.defect&&inR(r.createdAt,R)).forEach(r=>{const s=App.byId("sales",r.saleId)||{};(r.items||[]).forEach(it=>{const si=(s.items||[]).find(i=>i.line===it.line)||{};if(!it.productId)return;const x=g(App.supplierOf(it.productId,si.unitId));x.defRet+=num(it.qty);x.retSum+=num(it.qty)*num(it.price)})});
  S.repairs.filter(r=>r.saleId&&inR(r.createdAt,R)).forEach(r=>{const u=r.unitId?App.byId("units",r.unitId):null;if(!u)return;g(App.supplierOf(u.productId,u.id)).warr++});
  const rows=Object.entries(m).filter(([,x])=>x.rec||x.sold||x.defRet||x.warr).sort((a,b)=>b[1].sold-a[1].sold);
  return tbl("Поставщики: закупки и брак",[["Поставщик"],["Принято, шт","n"],...(cost?[["На сумму","n"]]:[]),["Продано их товара","n"],["Возвраты с браком","n"],["Гарантийные ремонты","n"],["Доля брака","n"]],
    rows.map(([id,x])=>{const rate=x.sold?(x.defRet+x.warr)/x.sold:0;return [esc(id?(App.byId("suppliers",id)||{}).name||"—":"Неизвестно / без поставщика"),x.rec,...(cost?[money(x.recSum)]:[]),x.sold,x.defRet,x.warr,`<span class="${rate>=.05?"badc":rate>=.02?"warnc":""}">${x.sold?pct(rate):"—"}</span>`]}),
    "Брак = возвраты с отметкой «брак» + гарантийные ремонты устройств, проданных у нас (ремонт связывается с продажей по IMEI автоматически). Поставщик экземпляра — из его прихода, у обычного товара — из последнего прихода.")}

/* --- реклама: окупаемость каналов --- */
function ads(){const R=per();const spend={},cust={},rev={};
  S.finops.filter(o=>!o.cancelledAt&&o.kind==="out"&&o.channel&&new Date(o.date+"T12:00")>=R[0]&&new Date(o.date+"T12:00")<R[1]).forEach(o=>spend[o.channel]=(spend[o.channel]||0)+num(o.amount));
  const newC=S.customers.filter(c=>!c.mergedInto&&inR(c.createdAt,R));newC.forEach(c=>{const k=c.source||"Не указан";cust[k]=(cust[k]||0)+1});
  const ids=new Set(newC.map(c=>c.id));S.sales.filter(s=>s.customerId&&ids.has(s.customerId)&&inR(s.createdAt,R)).forEach(s=>{const k=(App.cust(s.customerId)||{}).source||"Не указан";rev[k]=(rev[k]||0)+num(s.total)});
  S.repairs.filter(r=>ids.has(r.customerId)&&r.status==="done"&&inR(r.closedAt,R)).forEach(r=>{const k=(App.cust(r.customerId)||{}).source||"Не указан";rev[k]=(rev[k]||0)+num(r.finalPrice)});
  const keys=[...new Set([...Object.keys(spend),...Object.keys(cust)])].sort((a,b)=>(rev[b]||0)-(rev[a]||0));
  const unt=Object.values(spend).length?"":"<br>Чтобы видеть окупаемость, при записи расхода по статье «Реклама» выберите канал (Авито, Соцсети…).";
  return tbl("Каналы привлечения: новые клиенты и окупаемость",[["Канал"],["Расход на рекламу","n"],["Новых клиентов","n"],["Цена клиента","n"],["Выручка с новых","n"],["Окупаемость","n"]],
    keys.map(k=>{const sp=spend[k]||0,n=cust[k]||0,r=rev[k]||0;return [esc(k),sp?money(sp):"—",n,sp&&n?money(sp/n):"—",money(r),sp?`<span class="${r<sp?"badc":"okc"}">${(r/sp).toFixed(1).replace(".",",")}×</span>`:"—"]}),
    "Источник клиента указывается при первой продаже или приёме в ремонт. Выручка — покупки и ремонты новых клиентов за этот же период."+unt)}

/* --- сервис: мастера, сроки, неисправности, запчасти --- */
const devKey=d=>String(d||"").replace(/[,(].*$/,"").replace(/\b(\d+\s?(гб|gb|тб|tb))\b.*$/i,"").trim().split(/\s+/).slice(0,3).join(" ")||"—";
function svc(){const R=per(),cost=App.can("cost");const done=S.repairs.filter(r=>r.status==="done"&&inR(r.closedAt,R)&&ptOk(r)),all=S.repairs.filter(r=>inR(r.createdAt,R)&&ptOk(r));
  const hrs=r=>(new Date(r.closedAt)-new Date(r.createdAt))/36e5;
  const works=done.reduce((a,r)=>a+App.repairWorksSum(r),0),parts=done.reduce((a,r)=>a+App.repairPartsSum(r),0),pc=done.reduce((a,r)=>a+App.repairPartsCost(r),0),fin=done.reduce((a,r)=>a+num(r.finalPrice),0);
  const late=done.filter(r=>r.dueDate&&ymd(r.closedAt)>r.dueDate).length,warr=all.filter(r=>r.warrantyOf).length;
  const ms={};done.forEach(r=>{const k=r.masterId||"";const x=ms[k]=ms[k]||{n:0,works:0,h:0,late:0,back:0};x.n++;x.works+=App.repairWorksSum(r);x.h+=hrs(r);if(r.dueDate&&ymd(r.closedAt)>r.dueDate)x.late++});
  S.repairs.filter(r=>r.warrantyOf&&inR(r.createdAt,R)).forEach(r=>{const o=App.byId("repairs",r.warrantyOf);if(o){const x=ms[o.masterId||""]=ms[o.masterId||""]||{n:0,works:0,h:0,late:0,back:0};x.back++}});
  const ft={};all.forEach(r=>{const k=devKey(r.device)+" · "+((r.services||[])[0]||{name:r.problem}).name;ft[k]=(ft[k]||0)+1});
  // запчасти: расход за 90 дней в ремонтах и подготовке → сколько держать на складе
  const R90=[new Date(Date.now()-90*DAY),new Date()],use={};
  S.repairs.forEach(r=>(r.parts||[]).forEach(p=>{if(!p.returned&&inR(r.createdAt,R90))use[p.productId]=(use[p.productId]||0)+num(p.qty)}));
  S.unitcosts.filter(c=>c.kind==="part"&&c.productId&&inR(c.at,R90)).forEach(c=>use[c.productId]=(use[c.productId]||0)+num(c.qty));
  const swh=new Set(S.points.map(p=>p.serviceWh).filter(Boolean));
  const need=Object.entries(use).map(([id,q])=>{const p=App.byId("products",id);if(!p)return null;const m=q/3,have=[...swh].reduce((a,w)=>a+Math.max(0,App.qtyIn(p,w)),0);return {p,q,m,have,need:Math.max(0,Math.ceil(m*1.25)-have)}}).filter(Boolean).sort((a,b)=>b.need-a.need||b.m-a.m);
  return tiles([["Выдано ремонтов",done.length,money(fin)],["Работы",money(works),cost?"запчасти "+money(parts)+" · закупка "+money(pc):"запчасти "+money(parts)],["Средний срок",done.length?(done.reduce((a,r)=>a+hrs(r),0)/done.length/24).toFixed(1).replace(".",",")+" дн.":"—"],["Сдано с опозданием",done.length?pct(late/done.length):"—"],["Гарантийные возвраты",all.length?pct(warr/all.length):"—",warr+" из "+all.length+" принятых"]])
    +tbl("Мастера",[["Мастер"],["Выдано","n"],["Работы","n"],["Средний срок","n"],["С опозданием","n"],["Вернулись по гарантии","n"]],
      Object.entries(ms).sort((a,b)=>b[1].works-a[1].works).map(([k,x])=>[esc(k?App.nameOf(k):"Не назначен"),x.n,money(x.works),x.n?(x.h/x.n/24).toFixed(1).replace(".",",")+" дн.":"—",x.n?pct(x.late/x.n):"—",x.back]))
    +tbl("Частые неисправности",[["Устройство · работа"],["Раз","n"]],Object.entries(ft).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,n])=>[esc(k),n]))
    +tbl("Запчасти: сколько держать на складе сервиса",[["Запчасть"],["Ушло за 90 дн.","n"],["В месяц","n"],["Есть","n"],["Докупить","n"]],
      need.slice(0,30).map(x=>[esc(x.p.name),x.q,x.m.toFixed(1).replace(".",","),x.have,x.need?`<b>${x.need}</b>`:"—"]),"Расход за 3 месяца по ремонтам и подготовке б/у; держим запас на месяц с небольшим (×1,25). Кнопка «Создать заказы» — в «Склад → Список к заказу».")}

/* --- спрос: лист ожидания + «спрашивали, не было» --- */
App.demandRows=function(days=30){const R=[new Date(Date.now()-days*DAY),new Date(Date.now()+DAY)],m={};
  S.waitlist.filter(w=>w.status==="open"&&w.productId).forEach(w=>{const x=m[w.productId]=m[w.productId]||{wait:0,lost:0};x.wait+=w.qty});
  S.lostdemand.filter(l=>l.productId&&inR(l.createdAt,R)).forEach(l=>{const x=m[l.productId]=m[l.productId]||{wait:0,lost:0};x.lost+=l.qty});
  return Object.entries(m).map(([id,x])=>({p:App.byId("products",id),...x})).filter(x=>x.p)};
function dem(){const R=per();const lost=S.lostdemand.filter(l=>inR(l.createdAt,R)&&ptOk(l)),wl=S.waitlist.filter(w=>inR(w.createdAt,R)&&ptOk(w));
  const conv=wl.filter(w=>w.status==="done").length;const why={};lost.forEach(l=>why[l.reason]=(why[l.reason]||0)+l.qty);
  const rows=App.demandRows(90).sort((a,b)=>(b.wait+b.lost)-(a.wait+a.lost));
  return tiles([["Ушли без покупки",lost.reduce((a,l)=>a+l.qty,0),"записей "+lost.length],["Записались в ожидание",wl.length,"купили "+conv+(wl.length?" · "+pct(conv/wl.length):"")],["Ждут сейчас",S.waitlist.filter(w=>w.status==="open").length],["Пришло — позвонить",S.waitlist.filter(w=>w.status==="ready").length]])
    +`<section class="card"><div class="card-h"><h2>Почему не купили</h2></div>${App.anHbars(Object.entries(why).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,""]),v=>v+" шт")||'<div class="empty">Нет записей</div>'}</section>`
    +tbl("Спрос на товары из базы (90 дней)",[["Товар"],["Ждут, шт","n"],["Не купили, шт","n"],["В наличии","n"]],rows.map(x=>[esc(x.p.name),x.wait,x.lost,App.qtyTotal(x.p)]),"Этот спрос добавляется в «Склад → Список к заказу».")
    +lostView()}

App.AN_TABS=[["used","Б/у и trade-in",used],["svc","Сервис",svc],["sup","Поставщики",sup],["ads","Реклама",ads],["dem","Спрос",dem]];

/* --- KPI продавцов и кассиров (вкладка «Сотрудники и точки») --- */
App.anTeamExtra=function(f,t,pt){const R=[f,t];const m={};
  S.sales.filter(s=>inR(s.createdAt,R)&&(!pt||s.pointId===pt)).forEach(s=>{const x=m[s.by||""]=m[s.by||""]||{dev:0,att:0,disc:0,below:0,diff:0,shifts:0};
    const its=s.items||[],dev=its.some(i=>i.serial&&App.isPhone(i.productId));if(dev){x.dev++;if(its.some(i=>!i.serial&&i.productId)||its.some(i=>i.kind==="service"))x.att++}
    its.forEach(i=>{if(num(i.cost)&&num(i.price)-num(i.disc)/Math.max(1,num(i.qty))<num(i.cost))x.below++})});
  S.shifts.filter(s=>s.status==="closed"&&inR(s.closedAt,R)&&(!pt||s.pointId===pt)).forEach(s=>{const x=m[s.closedBy||""]=m[s.closedBy||""]||{dev:0,att:0,disc:0,below:0,diff:0,shifts:0};x.shifts++;x.diff+=num(s.diff)});
  const rows=Object.entries(m).filter(([,x])=>x.dev||x.shifts||x.below);if(!rows.length)return "";
  return tbl("Допродажи и касса",[["Сотрудник"],["Продал устройств","n"],["С аксессуаром/услугой","n"],["Продажи ниже закупки","n"],["Закрыл смен","n"],["Расхождения в кассе","n"]],
    rows.map(([k,x])=>[esc(App.nameOf(k)||"—"),x.dev,x.dev?pct(x.att/x.dev):"—",x.below?`<span class="badc">${x.below}</span>`:"0",x.shifts,x.diff?`<span class="${Math.abs(x.diff)>=100?"badc":""}">${money(x.diff)}</span>`:"0 ₽"]),
    "«С аксессуаром/услугой» — доля чеков с телефоном, где продали ещё стекло, чехол или услугу. Продажи ниже закупки может провести только управляющий — здесь видно, кто и сколько раз.")};

/* --- «Что заказать»: добавляем лист ожидания и упущенный спрос --- */
if(ACT.anBuy){const orig=ACT.anBuy;ACT.anBuy=function(){orig.apply(this,arguments);const rows=App.demandRows(30).filter(x=>x.wait||x.lost);if(!rows.length)return;
  const acts=document.querySelector("#modal .acts");if(!acts)return;acts.insertAdjacentHTML("beforebegin",`<h3 class="sub-h">Спрос клиентов за 30 дней</h3><div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Ждут</th><th class="n">Ушли без покупки</th><th class="n">Есть</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.p.name)}</td><td class="n">${x.wait}</td><td class="n">${x.lost}</td><td class="n">${App.qtyTotal(x.p)}</td></tr>`).join("")}</tbody></table></div><p class="muted">При создании заказов поставщикам этот спрос добавляется к количеству.</p>`)}}
if(App.poFromNeeds){const orig=App.poFromNeeds;App.poFromNeeds=function(rows){const by=new Map(rows.map(r=>[r.p.id,r]));
  App.demandRows(30).forEach(x=>{const extra=Math.max(0,x.wait+Math.ceil(x.lost/2)-App.qtyTotal(x.p));if(!extra)return;const r=by.get(x.p.id);if(r)r.need=Math.max(num(r.need),0)+extra;else by.set(x.p.id,{p:x.p,need:extra})});
  return orig([...by.values()])}}

/* --- точки входа: глобальный поиск по IMEI, карточка экземпляра, клиент, сводка --- */
const baseUnit=ACT.openUnit;ACT.openUnit=function(id){baseUnit(id);const a=document.querySelector("#modal .acts");if(a)a.insertAdjacentHTML("afterbegin",`<button class="btn" data-act="unitHist" data-id="${esc(id)}">История и себестоимость</button>`)};
App.clientExtra=function(id){const w=S.waitlist.filter(x=>x.customerId===id&&["open","ready"].includes(x.status)),t=S.tasks.filter(x=>x.customerId===id&&x.status==="open");
  return w.length||t.length?`<section><h3 class="sub-h">Ждёт и напоминания</h3><div class="list-mini">${w.map(x=>`<button data-act="waitOpen" data-id="${x.id}"><span>${esc(x.request)}<small>с ${App.dt(x.createdAt)}</small></span>${wPill(x.status)}</button>`).join("")}${t.map(x=>`<button data-act="taskOpen" data-id="${x.id}"><span>${esc(x.title)}<small>${x.dueDate?App.dt(x.dueDate):""}</small></span><span class="pill">задача</span></button>`).join("")}</div></section>`:""};
ACT.taskNewFor=id=>{const c=App.cust(id)||{};ACT.taskNew({phone:c.phone,title:"Позвонить "+(c.name||"клиенту")})};
/* автонапоминания: через 5 секунд после входа и потом раз в 10 минут */
setTimeout(()=>App.autoTasks(),5000);setInterval(()=>App.autoTasks(),60e3);
})();
