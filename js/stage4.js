/* iCase CRM v3 · Бонусная программа · Выкуп и комиссия у частных лиц (договоры) · Импорт банковской выписки */
"use strict";
(function(){
const {S,$,esc,num,money,ACT}=App;
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};

/* =========================== БОНУСЫ =========================== */
const LDEF={on:false,earn_pct:3,max_pay_pct:30,welcome:0};
App.loyalty=()=>({...LDEF,...(App.settings().loyalty||{})});
App.bonusOn=()=>!!App.loyalty().on;
App.bonusBal=cid=>Math.round(App.grpOf(S.bonusops,"customerId",cid).reduce((a,o)=>a+num(o.amount),0));
const BK={earn:"Начислено",spend:"Оплата бонусами",return:"Возврат покупки",manual:"Корректировка",welcome:"Приветственные"};
App.loyaltyTab=function(){const l=App.loyalty(),ed=App.can("settings"),dis=ed?"":"disabled";
  const total=S.customers.reduce((a,c)=>a+Math.max(0,App.bonusBal(c.id)),0),m0=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  const mo=S.bonusops.filter(o=>new Date(o.at)>=m0),earn=mo.filter(o=>o.amount>0).reduce((a,o)=>a+o.amount,0),spent=-mo.filter(o=>o.kind==="spend").reduce((a,o)=>a+o.amount,0);
  return `<section class="card" data-nodirty><div class="card-h"><h2>Бонусная программа</h2></div>
    <div class="form"><div class="fld full">${App.chk("lyOn","Включить: покупатели с телефоном копят бонусы и оплачивают ими часть покупки",l.on)}</div>
      ${App.fld("lyEarn","Начислять с покупки, %",App.inp("lyEarn",l.earn_pct,"number","3",dis))}${App.fld("lyMax","Бонусами можно оплатить до, % чека",App.inp("lyMax",l.max_pay_pct,"number","30",dis))}
      ${App.fld("lyWel","Приветственные бонусы новому клиенту",App.inp("lyWel",l.welcome,"number","0",dis))}</div>
    <p class="muted">1 бонус = 1 ₽. Бонусы начисляются от суммы, которую клиент заплатил. При возврате начисленные за эту покупку бонусы списываются. Оплата бонусами уменьшает чек как скидка — в прибыли это видно сразу.</p>
    ${ed?'<div class="acts"><button class="btn pri" data-act="lySave">Сохранить</button></div>':""}</section>
    <div class="tiles"><div class="tile"><span>Бонусов на счетах клиентов</span><b>${money(total)}</b><small>это будущая скидка — обязательство магазина</small></div><div class="tile"><span>Начислено в этом месяце</span><b>${money(earn)}</b></div><div class="tile"><span>Оплачено бонусами в этом месяце</span><b>${money(spent)}</b></div></div>`};
ACT.lySave=(_,btn)=>run(btn,async()=>{const V=App.val,l={on:App.checked("lyOn"),earn_pct:num(V("lyEarn")),max_pay_pct:num(V("lyMax")),welcome:Math.round(num(V("lyWel")))};
  if(l.earn_pct<0||l.earn_pct>50||l.max_pay_pct<0||l.max_pay_pct>100)throw new Error("Проверьте проценты");
  await App.api.update("settings",1,{loyalty:l});await App.reload(["settings"]);App.render();App.toast("Сохранено")});
ACT.bonusHist=cid=>{const c=App.cust(cid)||{},ops=S.bonusops.filter(o=>o.customerId===cid).sort((a,b)=>String(b.at).localeCompare(a.at));
  App.openModal(App.head("Бонусы · "+esc(c.name||""))+`<div class="tiles"><div class="tile"><span>На счёте</span><b>${App.bonusBal(cid)}</b></div></div>
    <div class="rhst" style="max-height:none">${ops.map(o=>`<div class="rhr"><span class="rhr-d">${App.dtt(o.at)}</span><span>${esc(BK[o.kind]||o.kind)}${o.note?" · "+esc(o.note):""}</span><small class="${o.amount<0?"badc":"okc"}">${o.amount>0?"+":""}${o.amount}</small></div>`).join("")||'<div class="muted">Операций нет</div>'}</div>
    ${App.can("del")?`<div class="form">${App.fld("baAmt","Начислить (+) или списать (−)",App.inp("baAmt","","number","500"))}${App.fld("baNote","Причина",App.inp("baNote","","text","Компенсация за ожидание"))}</div>
    <div class="acts"><button class="btn" data-act="openClient" data-id="${esc(cid)}">Назад</button><button class="btn pri" data-act="bonusAdj" data-id="${esc(cid)}">Провести</button></div>`:""}`)};
ACT.bonusAdj=(cid,btn)=>run(btn,async()=>{await App.api.rpc("bonus_adjust",{p_customer:cid,p_amount:num(App.val("baAmt")),p_note:App.val("baNote")},["bonus_ops"]);await App.reload(["bonusops"]);App.toast("Готово");ACT.bonusHist(cid)});

/* =========================== ВЫКУП И КОМИССИЯ =========================== */
const DST={open:["На складе","info"],sold:["Продан — выплатить клиенту","warn"],paid:["Выплачено","ok"],done:["Продан","ok"],returned:["Возвращён клиенту","mute"],cancelled:["Отменён","mute"]};
const dPill=d=>{const s=DST[d.status]||[d.status,""];return `<span class="pill ${s[1]}">${d.kind==="buyout"&&d.status==="open"?"Выкуплен, на складе":s[0]}</span>`};
let DL=null;
ACT.dealNew=(arg)=>{const c=typeof arg==="string"&&arg?App.cust(arg):null;DL={kind:"buyout",productId:""};const pt=App.point()||{};
  App.openModal(App.head("Устройство от частного лица")+`
    <div class="seg wide3" id="dlKind"><button class="on" data-act="dlKind" data-id="buyout"><b>Выкуп</b><small>платим сразу</small></button><button data-act="dlKind" data-id="commission"><b>Комиссия</b><small>платим после продажи</small></button></div>
    <h3 class="sub-h">Продавец (клиент)</h3>
    <div class="form">${App.fld("dlPhone","Телефон",App.inp("dlPhone",c?c.phone:"","tel","+7 900 000-00-00"))}${App.fld("dlName","ФИО полностью",App.inp("dlName",c?c.name:"","text","Иванов Иван Иванович"))}
      ${App.fld("dlDoc","Паспорт: серия и номер",App.inp("dlDoc","","text","4510 123456"))}${App.fld("dlIss","Кем выдан",App.inp("dlIss",""))}
      ${App.fld("dlIssD","Дата выдачи",App.inp("dlIssD","","date"))}${App.fld("dlBirth","Дата рождения",App.inp("dlBirth","","date"))}
      ${App.fld("dlAddr","Адрес регистрации",App.inp("dlAddr",""),"full")}</div>
    <h3 class="sub-h">Устройство</h3>
    <div class="form"><div class="fld full"><label for="dlQ">Товар в каталоге (если есть такая модель)</label><input id="dlQ" type="search" placeholder="iPhone 13 128 ГБ…" autocomplete="off"><div id="dlBox" class="pick" hidden></div><small id="dlPicked" class="muted">Если не выбрать — CRM создаст карточку б/у товара с названием ниже</small></div>
      ${App.fld("dlDev","Устройство",App.inp("dlDev","","text","iPhone 13 128 ГБ, синий"),"full")}
      ${App.fld("dlCode","IMEI или серийный номер",App.inp("dlCode",""))}${App.fld("dlCond","Состояние",App.sel("dlCond",App.CONDS.filter(x=>x!=="Новый"),"Б/у хорошее"))}
      ${App.fld("dlBatt","Ёмкость АКБ, %",App.inp("dlBatt","","number"))}${App.fld("dlKit","Комплектация",App.inp("dlKit","","text","Коробка, кабель"))}
      ${App.fld("dlWh","Склад",App.sel("dlWh",App.whOpts(),pt.cashWh||App.cashWh()||""))}</div>
    <h3 class="sub-h">Деньги</h3>
    <div class="form">${App.fld("dlAmt",'<span id="dlAmtL">Выкупаем за, ₽</span>',App.inp("dlAmt","","number"))}${App.fld("dlPrice","Цена продажи в магазине, ₽",App.inp("dlPrice","","number"))}
      <div class="fld" id="dlPayW"><label for="dlPay">Как платим</label>${App.sel("dlPay",[["cash","Наличными из кассы"],["transfer","Переводом"]])}</div>
      <div class="fld" id="dlTermW" hidden><label for="dlTerm">Срок продажи, дней</label>${App.inp("dlTerm",30,"number")}</div>
      ${App.fld("dlNote","Комментарий",App.inp("dlNote",""),"full")}</div>
    <p class="muted" id="dlHint">Выкуп: деньги выдаются из кассы сейчас, устройство становится товаром магазина. Распечатайте договор купли-продажи — клиент подписывает.</p>
    <p class="muted small">Паспортные данные — персональные данные: храните их только на сервере в РФ и только для договора.</p>
    <div class="acts"><button class="btn pri" data-act="dealSave">Оформить и распечатать договор</button></div>`,{wide:true});
  App.productPicker("dlQ","dlBox",{onPick:p=>{if(!p.trackSerial)return App.toast("Выберите товар с IMEI/серийным номером");DL.productId=p.id;$("#dlPicked").textContent="Выбран: "+p.name;if(!App.val("dlDev"))$("#dlDev").value=p.name;if(!App.val("dlPrice"))$("#dlPrice").value=num(p.price)||""}});
  const ph=$("#dlPhone");ph.addEventListener("input",()=>{const c2=App.findCustomerByPhone(ph.value);if(c2&&!App.val("dlName"))$("#dlName").value=c2.name;
    const last=c2&&S.deals.filter(d=>d.customerId===c2.id).sort((a,b)=>String(b.createdAt).localeCompare(a.createdAt))[0];if(last&&last.person){const p=last.person;[["dlDoc","doc"],["dlIss","issued"],["dlIssD","issued_date"],["dlBirth","birth"],["dlAddr","address"]].forEach(([i,k])=>{if(!App.val(i)&&p[k])$("#"+i).value=p[k]})}})};
ACT.dlKind=k=>{DL.kind=k;document.querySelectorAll("#dlKind button").forEach(b=>b.classList.toggle("on",b.dataset.id===k));
  $("#dlAmtL").textContent=k==="buyout"?"Выкупаем за, ₽":"Выплатить клиенту после продажи, ₽";$("#dlPayW").hidden=k!=="buyout";$("#dlTermW").hidden=k==="buyout";
  $("#dlHint").textContent=k==="buyout"?"Выкуп: деньги выдаются из кассы сейчас, устройство становится товаром магазина. Распечатайте договор купли-продажи — клиент подписывает.":"Комиссия: устройство остаётся собственностью клиента, магазин продаёт его за свою цену. После продажи CRM запишет долг клиенту — выплатите его в «Финансы → Долги». Вознаграждение магазина = цена продажи − выплата."};
ACT.dealSave=(_,btn)=>run(btn,async()=>{const V=App.val;
  if(App.phoneKey(V("dlPhone")).length!==10)throw new Error("Укажите телефон клиента");if(V("dlName").split(/\s+/).length<2)throw new Error("Укажите ФИО полностью — оно нужно в договоре");
  if(!V("dlDoc"))throw new Error("Укажите серию и номер паспорта");if(!V("dlDev"))throw new Error("Укажите устройство");if(!V("dlCode"))throw new Error("Укажите IMEI или серийный номер");
  const code=V("dlCode").replace(/\s+/g,"");if(/^\d+$/.test(code)&&!/^\d{15}$/.test(code))throw new Error("IMEI — это 15 цифр");
  const cid=await App.api.customer(V("dlPhone"),V("dlName"),"Магазин");
  const p={kind:DL.kind,customer_id:cid,wh_id:V("dlWh"),product_id:DL.productId||null,device:V("dlDev"),[/^\d{15}$/.test(code)?"imei":"serial_no"]:code.toUpperCase(),condition:V("dlCond"),battery_health:V("dlBatt")||null,kit:V("dlKit")||null,
    amount:num(V("dlAmt")),price:V("dlPrice")?num(V("dlPrice")):null,term_days:DL.kind==="commission"?num(V("dlTerm"))||30:null,pay_method:DL.kind==="buyout"?V("dlPay"):null,note:V("dlNote")||null,
    person:{name:V("dlName"),doc:V("dlDoc"),issued:V("dlIss"),issued_date:V("dlIssD"),birth:V("dlBirth"),address:V("dlAddr")}};
  const id=await App.api.rpc("buy_deal_create",{p},["buy_deals","units","products","stock","cash_ops","customers"]);
  await App.reload(["deals","units","products","cashops","customers","movements"]);App.closeModal();App.toast(DL.kind==="buyout"?"Выкуп оформлен":"Принято на комиссию");ACT.dealPrint(id);ACT.dealOpen(id)});
ACT.dealsList=()=>{const list=S.deals.slice().sort((a,b)=>String(b.createdAt).localeCompare(a.createdAt));
  const pay=S.deals.filter(d=>d.status==="sold"),onc=S.deals.filter(d=>d.kind==="commission"&&d.status==="open");
  App.openModal(App.head("Выкуп и комиссия")+`<div class="tiles"><div class="tile"><span>На комиссии сейчас</span><b>${onc.length}</b><small>выплатим при продаже ${money(onc.reduce((a,d)=>a+d.amount,0))}</small></div><div class="tile"><span>Продано — надо выплатить</span><b class="${pay.length?"badc":""}">${money(pay.reduce((a,d)=>a+d.amount,0))}</b><small>${pay.length} клиентам</small></div></div>
    <div class="flist">${list.map(d=>{const c=App.cust(d.customerId)||{};return `<button class="frow" data-act="dealOpen" data-id="${d.id}"><span class="fic">${d.kind==="buyout"?"💵":"🤝"}</span>
      <span class="cnm"><b>${esc(d.num)} · ${esc(d.device)} ${dPill(d)}</b><small>${d.kind==="buyout"?"выкуп":"комиссия"} · ${esc(c.name||"")} · ${App.dt(d.createdAt)}${d.imei?" · "+esc(d.imei):""}</small></span><span class="csum">${money(d.amount)}</span></button>`}).join("")||'<div class="empty">Сделок пока нет</div>'}</div>
    <div class="acts"><button class="btn pri" data-act="dealNew">+ Выкуп или комиссия</button></div>`,{wide:true})};
ACT.dealOpen=id=>{const d=S.deals.find(x=>x.id===id);if(!d)return;const c=App.cust(d.customerId)||{},u=d.unitId?App.byId("units",d.unitId):null,sale=d.saleId?App.byId("sales",d.saleId):null,debt=d.debtId?S.debts.find(x=>x.id===d.debtId):null;
  const sp=sale&&u?(sale.items||[]).find(i=>i.unitId===u.id):null,sold=sp?num(sp.price)-num(sp.disc):0;
  App.openModal(App.head(`${esc(d.num)} · ${d.kind==="buyout"?"выкуп":"комиссия"}`,dPill(d))+`
    <div class="kv"><div><span>Клиент</span><b><a href="#" data-act="openClient" data-id="${esc(d.customerId)}">${esc(c.name||"")}</a> · ${esc(c.phone||"")}</b></div><div><span>Устройство</span><b>${esc(d.device)}${d.imei?" · "+esc(d.imei):""}</b></div>
      <div><span>${d.kind==="buyout"?"Заплатили клиенту":"Выплатить клиенту"}</span><b>${money(d.amount)}${d.kind==="buyout"?" · "+App.payLabel(d.payMethod):""}</b></div>${d.price?`<div><span>Цена в магазине</span><b>${money(d.price)}</b></div>`:""}
      ${d.kind==="commission"?`<div><span>Срок продажи</span><b>${d.termDays||30} дн. · до ${App.dt(new Date(+new Date(d.createdAt)+(d.termDays||30)*864e5).toISOString())}</b></div>`:""}
      ${sale?`<div><span>Продан</span><b><a href="#" data-act="openSale" data-id="${sale.id}">${esc(sale.num)}</a> за ${money(sold)}${App.can("cost")?" · магазину "+money(sold-d.amount):""}</b></div>`:""}
      ${debt?`<div><span>Выплата клиенту</span><b><a href="#" data-act="debtOpen" data-id="${debt.id}">${esc(debt.num)}</a> · ${debt.status==="closed"?"выплачено":"осталось "+money(App.debtLeft?App.debtLeft(debt):debt.amount)}</b></div>`:""}
      ${d.note?`<div><span>Комментарий</span><b>${esc(d.note)}</b></div>`:""}<div><span>Оформил</span><b>${esc(App.nameOf(d.by))} · ${App.dtt(d.createdAt)}</b></div></div>
    <div class="acts"><button class="btn" data-act="dealPrint" data-id="${d.id}">Договор</button>${d.status==="sold"||d.status==="paid"?`<button class="btn" data-act="dealReport" data-id="${d.id}">Отчёт комиссионера</button>`:""}
      ${u?`<button class="btn" data-act="unitHist" data-id="${u.id}">История экземпляра</button>`:""}
      ${d.kind==="commission"&&d.status==="open"?`<button class="btn danger" data-act="dealReturn" data-id="${d.id}">Клиент забрал устройство</button>`:""}
      ${debt&&debt.status==="open"&&App.can("finance")?`<button class="btn pri" data-act="debtPay" data-id="${debt.id}">Выплатить клиенту</button>`:""}</div>`,{wide:true})};
ACT.dealReturn=(id,btn)=>{if(!App.confirm2(btn,"Списать устройство и вернуть клиенту? Ещё раз"))return;run(btn,async()=>{await App.api.rpc("buy_deal_return",{p_id:id,p_note:""},["buy_deals","units","stock"]);await App.reload(["deals","units","products"]);App.toast("Устройство возвращено клиенту");ACT.dealOpen(id)})};

/* --- договоры --- */
const st=()=>App.settings();
const shopLine=()=>{const s=st();return [s.legalName||("ИП "+(s.shopName||"")),s.inn?"ИНН "+s.inn:"",s.ogrnip?"ОГРНИП "+s.ogrnip:"",[s.city,s.address].filter(Boolean).join(", ")].filter(Boolean).join(", ")};
const personLine=p=>[p.name,p.birth?"дата рождения "+App.dt(p.birth):"","паспорт "+(p.doc||"________"),p.issued?"выдан "+p.issued:"",p.issued_date?App.dt(p.issued_date):"",p.address?"зарегистрирован(а) по адресу: "+p.address:""].filter(Boolean).join(", ");
const devLine=(d,u)=>`${d.device}${d.imei?", IMEI/серийный номер "+d.imei:""}${u&&u.condition?", состояние: "+u.condition:""}${u&&u.batteryHealth?", ёмкость АКБ "+u.batteryHealth+"%":""}${u&&u.kit?", комплектация: "+u.kit:""}`;
const words=v=>App.rubWords?" ("+App.rubWords(v)+")":"";
ACT.dealPrint=id=>{const d=S.deals.find(x=>x.id===id);if(!d)return;const u=d.unitId?App.byId("units",d.unitId):null,p=d.person||{},date=App.dt(d.createdAt),city=st().city||"";
  const H=App.docHead,sg=(a,b)=>`<div class="sg"><div>${a}</div><div>${b}</div></div>`;
  let body;
  if(d.kind==="buyout")body=H("Договор купли-продажи бывшего в употреблении товара",d.num,date)
    +`<p class="note">${esc(city?"г. "+city+", ":"")}${esc(date)}</p>
    <p class="note"><b>Продавец:</b> ${esc(personLine(p))}.</p><p class="note"><b>Покупатель:</b> ${esc(shopLine())}.</p>
    <p class="note">1. Продавец передаёт в собственность Покупателя, а Покупатель принимает и оплачивает бывший в употреблении товар: <b>${esc(devLine(d,u))}</b>.</p>
    <p class="note">2. Цена товара — <b>${esc(money(d.amount))}</b>${esc(words(d.amount))}. Оплата ${d.payMethod==="cash"?"наличными денежными средствами":"переводом на счёт Продавца"} в момент подписания договора.</p>
    <p class="note">3. Продавец гарантирует, что товар принадлежит ему на праве собственности, не заложен, не находится под арестом, не является предметом спора, не числится в розыске и не получен преступным путём; учётная запись (iCloud / Google) отвязана.</p>
    <p class="note">4. Покупатель осмотрел товар, проверил работоспособность и комплектность. Продавец уведомлён, что товар будет перепродан.</p>
    <p class="note">5. Право собственности переходит к Покупателю с момента подписания договора и передачи товара. Договор является одновременно актом приёма-передачи и распиской в получении денег.</p>
    <p class="note">6. Продавец даёт согласие на обработку персональных данных, указанных в договоре, для исполнения договора и учёта (152-ФЗ).</p>`
    +sg("Продавец: деньги в сумме "+esc(money(d.amount))+" получил, товар передал<br><br>____________ / "+esc(p.name||""),"Покупатель: товар получил<br><br>____________ / "+esc(App.nameOf(d.by))+" · М.П.");
  else body=H("Договор комиссии",d.num,date)
    +`<p class="note">${esc(city?"г. "+city+", ":"")}${esc(date)}</p>
    <p class="note"><b>Комитент:</b> ${esc(personLine(p))}.</p><p class="note"><b>Комиссионер:</b> ${esc(shopLine())}.</p>
    <p class="note">1. Комиссионер обязуется от своего имени и за счёт Комитента продать товар Комитента: <b>${esc(devLine(d,u))}</b>.</p>
    <p class="note">2. Цена продажи — <b>${esc(money(d.price))}</b>. Сумма к выплате Комитенту после продажи — <b>${esc(money(d.amount))}</b>${esc(words(d.amount))}. Комиссионное вознаграждение — разница между ценой продажи и суммой к выплате, удерживается Комиссионером. Продажа по более высокой цене — выгода Комиссионера, по более низкой — только с согласия Комитента.</p>
    <p class="note">3. Срок продажи — ${esc(String(d.termDays||30))} дней. Если товар не продан в срок, Комитент вправе забрать его или продлить срок; Комиссионер вправе потребовать забрать товар.</p>
    <p class="note">4. Выплата Комитенту — в течение 3 рабочих дней после продажи, наличными или переводом. Комиссионер представляет отчёт о продаже.</p>
    <p class="note">5. Товар остаётся собственностью Комитента до продажи. Комитент гарантирует, что товар принадлежит ему, не заложен, не в розыске, учётная запись отвязана.</p>
    <p class="note">6. Комитент даёт согласие на обработку персональных данных, указанных в договоре, для исполнения договора и учёта (152-ФЗ).</p>
    <h3>Акт приёма-передачи</h3><p class="note">Комитент передал, Комиссионер принял товар: ${esc(devLine(d,u))}. Внешний вид и работоспособность проверены.</p>`
    +sg("Комитент<br><br>____________ / "+esc(p.name||""),"Комиссионер<br><br>____________ / "+esc(App.nameOf(d.by))+" · М.П.");
  App.printHtml(App.docPage(d.num,body))};
ACT.dealReport=id=>{const d=S.deals.find(x=>x.id===id);if(!d)return;const sale=App.byId("sales",d.saleId)||{},u=App.byId("units",d.unitId),it=(sale.items||[]).find(i=>u&&i.unitId===u.id)||{},sold=num(it.price)-num(it.disc),p=d.person||{};
  App.printHtml(App.docPage("Отчёт "+d.num,App.docHead("Отчёт комиссионера",d.num,App.dt(new Date().toISOString()))
    +App.docMeta([["Комитент",p.name||""],["Договор",d.num+" от "+App.dt(d.createdAt)],["Товар",devLine(d,u)],["Продан",(sale.num||"")+" от "+App.dt(sale.createdAt)]])
    +App.docTable([["Показатель"],["Сумма","n"]],[["Цена продажи",money(sold)],["Вознаграждение комиссионера",money(sold-d.amount)],["К выплате комитенту",money(d.amount)]])
    +`<p class="note">Деньги в сумме ${esc(money(d.amount))}${esc(words(d.amount))} получил, претензий не имею.</p><div class="sg"><div>Комитент ____________ / ${esc(p.name||"")}</div><div>Комиссионер ____________ · М.П.</div></div>`))};

/* =========================== БАНКОВСКАЯ ВЫПИСКА =========================== */
/* формат 1С «1CClientBankExchange» — его выгружают все банки (Сбер, Т-Банк, Альфа, Точка, ВТБ…) */
App.parse1C=function(text){const head={},docs=[];let cur=null;
  text.split(/\r?\n/).forEach(line=>{const i=line.indexOf("=");const k=(i<0?line:line.slice(0,i)).trim(),v=i<0?"":line.slice(i+1).trim();
    if(k==="СекцияДокумент"){cur={type:v};return}if(k==="КонецДокумента"){if(cur)docs.push(cur);cur=null;return}
    if(cur)cur[k]=v;else if(k)head[k]=head[k]?head[k]+","+v:v});
  const accs=String(head["РасчСчет"]||"").split(",").filter(Boolean);
  const dt=s=>{const m=String(s||"").match(/(\d{2})\.(\d{2})\.(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:""};
  return {account:accs[0]||"",rows:docs.map(d=>{const out=accs.includes(d["ПлательщикСчет"])||(!accs.length&&d["ДатаСписано"]);
    return {out:!!out,date:dt(out?(d["ДатаСписано"]||d["Дата"]):(d["ДатаПоступило"]||d["Дата"])),num:d["Номер"]||"",amount:num(String(d["Сумма"]||"0").replace(",",".")),
      party:(out?(d["Получатель1"]||d["Получатель"]):(d["Плательщик1"]||d["Плательщик"]))||"",inn:(out?d["ПолучательИНН"]:d["ПлательщикИНН"])||"",purpose:d["НазначениеПлатежа"]||"",type:d.type}}).filter(r=>r.amount>0)}};
const RULES=[[/эквайр|возмещ|по операциям с (банковскими )?картами|торгов(ой|ая) точк|СБП|QR/i,"in","skip","Безнал с касс — уже учтён в CRM"],[/комисси/i,"out","Банк и эквайринг"],[/аренд/i,"out","Аренда"],
  [/налог|ПСН|патент|ФНС|УФК|страхов.{0,20}взнос/i,"out","Налоги и взносы"],[/заработн|зарплат|аванс сотрудн/i,"out","Зарплата"],[/связь|интернет|телеком|МТС|Билайн|Мегафон|Ростелеком|Теле2/i,"out","Связь и интернет"],
  [/реклам|Авито|Avito|Яндекс|VK|ВКонтакте|таргет/i,"out","Реклама"],[/электроэн|коммунал|водоснаб|отоплен|вывоз ТКО/i,"out","Коммунальные услуги"],[/доставк|СДЭК|CDEK|Boxberry|Почта России/i,"out","Доставка"]];
function classify(r){const s=App.settings(),norm=x=>String(x||"").toLowerCase().replace(/[«»"']/g,"").replace(/\s+/g," ").trim();
  if(s.inn&&r.inn===s.inn)return {skip:true,why:"Перевод между своими счетами"};
  for(const [re,dir,cat,why] of RULES){if((dir===(r.out?"out":"in"))&&re.test(r.purpose+" "+r.party)){if(cat==="skip")return {skip:true,why};const c=S.fincats.find(x=>x.kind==="out"&&x.name===cat);return {catId:c?c.id:"",why:cat}}}
  if(r.out){const sup=S.suppliers.find(x=>(x.inn&&x.inn===r.inn)||norm(r.party).includes(norm(x.name).replace(/ \(демо\)/,"")));
    if(sup){const d=S.debts.filter(x=>x.direction==="out"&&x.status==="open"&&x.supplierId===sup.id&&App.debtLeft(x)>=r.amount-0.5).sort((a,b)=>String(a.createdAt).localeCompare(b.createdAt))[0];
      const c=S.fincats.find(x=>x.name==="Закупка товара");return {catId:c?c.id:"",debtId:d?d.id:"",why:d?"Оплата долга "+d.num+" · "+sup.name:"Поставщик "+sup.name}}}
  else{const d=S.debts.filter(x=>x.direction==="in"&&x.status==="open"&&Math.abs(App.debtLeft(x)-r.amount)<1&&norm(r.party).includes(norm(x.counterparty).split(" ")[0]))[0];if(d)return {debtId:d.id,why:"Оплата долга "+d.num}}
  return {catId:"",why:""}}
let BK2=null;
ACT.bankImport=()=>{const accs=S.finaccounts.filter(a=>a.active&&a.kind!=="drawer");
  App.openModal(App.head("Загрузить банковскую выписку")+`<div class="form">${App.fld("bkAcc","Счёт",App.sel("bkAcc",accs.map(a=>[a.id,a.name]),(accs.find(a=>a.kind==="bank")||accs[0]||{}).id))}
    <div class="fld"><label for="bkFile">Файл выписки (формат 1С, .txt)</label><input id="bkFile" type="file" accept=".txt,text/plain"></div></div>
    <p class="muted">В интернет-банке: «Выписка» → «Экспорт в 1С» (файл kl_to_1c.txt). CRM сама разнесёт платежи по статьям, найдёт оплаты поставщикам и долгам и пропустит поступления от эквайринга — они уже учтены как безнал с касс. Повторная загрузка той же выписки дублей не создаёт.</p>
    <div id="bkPrev"></div>`,{wide:true});
  $("#bkFile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;const buf=await f.arrayBuffer();let txt=new TextDecoder("utf-8").decode(buf);if(!/1CClientBankExchange/.test(txt)||/�/.test(txt))txt=new TextDecoder("windows-1251").decode(buf);
    if(!/1CClientBankExchange/.test(txt))return App.toast("Это не выписка в формате 1С");const r=App.parse1C(txt);BK2={rows:r.rows.map(x=>Object.assign(x,classify(x)))};drawBank()})};
function drawBank(){const cats=k=>S.fincats.filter(c=>c.active&&c.kind===k);const rows=BK2.rows;
  const ins=rows.filter(r=>!r.out&&!r.skip).reduce((a,r)=>a+r.amount,0),outs=rows.filter(r=>r.out&&!r.skip).reduce((a,r)=>a+r.amount,0);
  $("#bkPrev").innerHTML=`<p><b>${rows.length}</b> платежей · к загрузке поступлений ${money(ins)}, списаний ${money(outs)} · пропускаем ${rows.filter(r=>r.skip).length}</p>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>Дата</th><th>Контрагент и назначение</th><th class="n">Сумма</th><th>Статья</th></tr></thead><tbody>
    ${rows.map((r,i)=>`<tr class="${r.skip?"muted":""}"><td><input type="checkbox" data-bk="${i}" ${r.skip?"":"checked"} aria-label="Загрузить"></td><td>${App.dt(r.date)}</td>
      <td><b>${esc(r.party)}</b><small class="muted" style="display:block">${esc(r.purpose.slice(0,140))}</small>${r.why?`<small class="${r.debtId?"okc":""}">${esc(r.why)}</small>`:""}</td>
      <td class="n ${r.out?"badc":"okc"}">${r.out?"−":"+"}${money(r.amount)}</td>
      <td>${App.sel("bkc"+i,[["","— без статьи —"],...cats(r.out?"out":"in").map(c=>[c.id,c.name])],r.catId||"",'data-bkc="'+i+'"')}</td></tr>`).join("")}</tbody></table></div>
    <div class="acts"><button class="btn pri" data-act="bankGo">Загрузить отмеченные</button></div>`;
  document.querySelectorAll("[data-bk]").forEach(el=>el.addEventListener("change",()=>{BK2.rows[+el.dataset.bk].skip=!el.checked}));
  document.querySelectorAll("[data-bkc]").forEach(el=>el.addEventListener("change",()=>{BK2.rows[+el.dataset.bkc].catId=el.value}))}
ACT.bankGo=(_,btn)=>run(btn,async()=>{const acc=App.val("bkAcc"),list=BK2.rows.filter(r=>!r.skip);let ok=0,dup=0;
  for(const r of list){const id=await App.api.rpc("fin_op_import",{p:{kind:r.out?"out":"in",account_id:acc,amount:r.amount,op_date:r.date||today(),category_id:r.catId||null,debt_id:r.debtId||null,
      counterparty:r.party.slice(0,200),note:r.purpose.slice(0,500),ext_id:[r.date,r.num,r.out?"o":"i",r.amount,r.inn].join("|")}});if(id)ok++;else dup++}
  await App.reload(["finops","debts","finaccounts"]);App.closeModal();App.render();App.toast(`Загружено ${ok}${dup?", уже были: "+dup:""}`)});

/* --- точки входа --- */
if(App.VIEWS.receive){const a=App.VIEWS.receive.actions;App.VIEWS.receive.actions=()=>`<button class="btn" data-act="dealsList">Выкуп и комиссия</button>`+a()}
if(App.VIEWS.finance){const a=App.VIEWS.finance.actions;App.VIEWS.finance.actions=()=>(App.can("finance")?`<button class="btn" data-act="bankImport">Выписка банка</button>`:"")+a()}
const ce=App.clientExtra;App.clientExtra=function(id){const ds=App.grpOf(S.deals,"customerId",id),b=App.bonusOn()?App.bonusBal(id):null;
  return (b!=null||S.bonusops.some(o=>o.customerId===id)?`<section><h3 class="sub-h">Бонусы</h3><div class="list-mini"><button data-act="bonusHist" data-id="${esc(id)}"><span>На счёте <b>${App.bonusBal(id)}</b> бонусов<small>история и корректировка</small></span><span class="pill ok">бонусы</span></button></div></section>`:"")
    +(ds.length?`<section><h3 class="sub-h">Выкуп и комиссия</h3><div class="list-mini">${ds.map(d=>`<button data-act="dealOpen" data-id="${d.id}"><span>${esc(d.num)} · ${esc(d.device)}<small>${App.dt(d.createdAt)} · ${money(d.amount)}</small></span>${dPill(d)}</button>`).join("")}</div></section>`:"")
    +(ce?ce(id):"")};
// напоминание: продан комиссионный товар — выплатить; срок комиссии вышел
if(App.autoTasks){const at=App.autoTasks;App.autoTasks=async function(force){
  const rows=[];S.deals.forEach(d=>{const c=App.cust(d.customerId)||{};
    if(d.status==="sold"&&!S.tasks.some(t=>t.autoKey==="deal-pay-"+d.id))rows.push({auto_key:"deal-pay-"+d.id,title:`Выплатить комитенту ${c.name||""}: ${money(d.amount)} (${d.num})`,due_date:today(),customer_id:d.customerId,ref_type:"deal",ref_id:d.id});
    if(d.kind==="commission"&&d.status==="open"&&Date.now()-new Date(d.createdAt)>(d.termDays||30)*864e5&&!S.tasks.some(t=>t.autoKey==="deal-term-"+d.id))rows.push({auto_key:"deal-term-"+d.id,title:`Срок комиссии ${d.num} вышел: ${d.device} — снизить цену или вернуть клиенту`,due_date:today(),customer_id:d.customerId,ref_type:"deal",ref_id:d.id})});
  if(rows.length&&App.me.role)try{await App.api.tasksAuto(rows)}catch(e){}
  return at(force)}}
const to=ACT.taskOpen;ACT.taskOpen=id=>{const t=S.tasks.find(x=>x.id===id);if(t&&t.refType==="deal")return ACT.dealOpen(t.refId);return to(id)};
})();
