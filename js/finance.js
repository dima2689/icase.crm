/* iCase CRM v3 · Финансы: деньги на счетах, приход/расход/перевод, долги (нам должны / мы должны), регулярные платежи, прибыль */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.finance="Финансы";
Object.assign(App.ui,{finTab:"sum",finPeriod:"month",finAcc:"",finKind:"",finCat:"",finQ:"",debtDir:"in",debtSt:"open",debtQ:"",repFinPeriod:"month"});
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const RELOAD=["finops","finaccounts","debts","finplans","cashops","shifts"];
const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const ymd=d=>{const x=new Date(d);return new Date(x-x.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const dshort=s=>s?new Date(s+"T12:00").toLocaleDateString("ru-RU",{day:"numeric",month:"short"}):"—";
const KIND={drawer:"Касса точки",bank:"Расчётный счёт",cash:"Наличные",card:"Карта",other:"Другое"};
const DKIND={supplier:"Поставщик",customer:"Клиент",loan:"Займ",staff:"Сотрудник",other:"Другое"};
const PERIOD={week:"раз в неделю",month:"раз в месяц",quarter:"раз в квартал",year:"раз в год",once:"один раз"};
const accs=(all)=>S.finaccounts.filter(a=>all||a.active).sort((a,b)=>(a.kind==="drawer"?0:1)-(b.kind==="drawer"?0:1)||a.sort-b.sort||a.name.localeCompare(b.name));
const acc=id=>S.finaccounts.find(a=>a.id===id)||{name:"—"};
const cat=id=>S.fincats.find(c=>c.id===id);
const live=o=>!o.cancelledAt;

/* ---------- расчёты ---------- */
const NONCASH=["card","sbp","transfer"];
App.finBalance=a=>{
  if(a.kind==="drawer"){
    const sh=S.shifts.filter(s=>s.pointId===a.pointId).sort((x,y)=>String(y.openedAt).localeCompare(x.openedAt));
    const open=sh.find(s=>s.status==="open");
    if(open)return num(open.openCash)+S.cashops.filter(c=>c.shiftId===open.id&&c.method==="cash").reduce((s,c)=>s+num(c.amount),0);
    const last=sh.find(s=>s.status==="closed");return last?num(last.countedCash):0;
  }
  let b=num(a.opening);
  for(const o of S.finops){if(!live(o))continue;
    if(o.accountId===a.id)b+=o.kind==="in"?o.amount:-o.amount;
    if(o.kind==="transfer"&&o.toAccountId===a.id)b+=o.amount}
  if(a.noncash){const t0=a.createdAt||"";b+=S.cashops.filter(c=>NONCASH.includes(c.method)&&String(c.at)>=t0).reduce((s,c)=>s+num(c.amount),0)}
  return b;
};
App.debtPaid=d=>S.finops.filter(o=>live(o)&&o.debtId===d.id).reduce((s,o)=>s+o.amount,0);
App.debtLeft=d=>Math.max(0,num(d.amount)-App.debtPaid(d));
const overdue=d=>d.status==="open"&&d.dueDate&&d.dueDate<today();
const openDebts=dir=>S.debts.filter(d=>d.direction===dir&&d.status==="open");
const sumLeft=list=>list.reduce((s,d)=>s+App.debtLeft(d),0);
/* прибыль за период: продажи и ремонт из учёта + расходы по статьям */
App.finPnl=function(from,to){
  const st=App.periodStats(from,to,null);
  const inP=o=>{const t=new Date(o.date+"T12:00");return t>=from&&t<to};
  const ops=S.finops.filter(o=>live(o)&&o.kind!=="transfer"&&inP(o));
  const by=(k)=>{const m={};ops.filter(o=>o.kind===k).forEach(o=>{const c=cat(o.catId);if(c&&!c.inPnl)return;const n=c?c.name:(k==="out"?"Без статьи":"Прочие доходы");m[n]=(m[n]||0)+o.amount});return Object.entries(m).sort((a,b)=>b[1]-a[1])};
  const exp=by("out"),oth=by("in");
  const expSum=exp.reduce((s,x)=>s+x[1],0),othSum=oth.reduce((s,x)=>s+x[1],0);
  return{rev:st.rev,cogs:st.rev-st.profit,gross:st.profit,exp,expSum,oth,othSum,net:st.profit-expSum+othSum};
};

/* ---------- экран ---------- */
const TABS=[["sum","Сводка"],["ops","Операции"],["debts","Долги"],["plans","Платежи"],["report","Прибыль"],["setup","Счета и статьи"]];
VIEWS.finance={
  ownSearch:true,
  actions:()=>`<button class="btn" data-act="finOp" data-id="in">+ Приход</button><button class="btn" data-act="finOp" data-id="out">− Расход</button><button class="btn pri" data-act="finOp" data-id="transfer">⇄ Перевод</button>`,
  render(){
    if(!S.finaccounts.length)return `<section class="card"><div class="empty"><p>Раздел ещё не настроен.</p><button class="btn pri" data-act="finSetup">Создать счета и статьи</button>
      <p class="muted">Появятся касса для каждой точки, расчётный счёт (сюда идёт безнал с касс), сейф и обычные статьи расходов. Всё можно поменять.</p></div></section>`;
    const t=App.ui.finTab;
    return `<div class="tabs">${TABS.map(([k,l])=>`<button class="tab ${t===k?"on":""}" data-act="finTab" data-id="${k}">${l}${k==="debts"&&S.debts.some(overdue)?' <span class="dot bad"></span>':""}${k==="plans"&&duePlans().length?' <span class="dot warn"></span>':""}</button>`).join("")}</div>
      <div class="fin" data-nodirty>${({sum,ops,debts,plans,report,setup})[t]()}</div>`;
  },
  after(){if(!S.finaccounts.length||S.points.some(p=>!S.finaccounts.some(a=>a.kind==="drawer"&&a.pointId===p.id)))autoSetup()}
};
let setupTried=false;
async function autoSetup(){if(setupTried||!App.can("finance"))return;setupTried=true;try{await App.api.rpc("fin_setup",{});await App.reload(["finaccounts","fincats"]);App.render()}catch(e){}}
ACT.finSetup=(_,btn)=>run(btn,async()=>{await App.api.rpc("fin_setup",{});await App.reload(["finaccounts","fincats"]);App.render()});
ACT.finTab=k=>{App.ui.finTab=k;App.render()};
const duePlans=(days=7)=>{const lim=ymd(Date.now()+days*864e5);return S.finplans.filter(p=>p.active&&p.nextDate<=lim).sort((a,b)=>a.nextDate.localeCompare(b.nextDate))};

/* --- сводка --- */
function sum(){
  const list=accs(),total=list.reduce((s,a)=>s+App.finBalance(a),0);
  const inD=openDebts("in"),outD=openDebts("out");
  const [f,t]=App.periodRange("month"),pnl=App.finPnl(f,t);
  const od=S.debts.filter(overdue).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),plans=duePlans(14);
  return `<div class="tiles">
      <button class="tile" data-act="finTab" data-id="setup"><span>Деньги на счетах</span><b>${money(total)}</b><small>${list.length} ${plural(list.length,"счёт","счёта","счетов")}</small></button>
      <button class="tile" data-act="finDebts" data-id="in"><span>Нам должны</span><b class="okc">${money(sumLeft(inD))}</b><small>${inD.length?inD.length+" "+plural(inD.length,"долг","долга","долгов"):"долгов нет"}${inD.some(overdue)?` · <span class="badc">просрочено ${inD.filter(overdue).length}</span>`:""}</small></button>
      <button class="tile" data-act="finDebts" data-id="out"><span>Мы должны</span><b class="badc">${money(sumLeft(outD))}</b><small>${outD.length?outD.length+" "+plural(outD.length,"долг","долга","долгов"):"долгов нет"}${outD.some(overdue)?` · <span class="badc">просрочено ${outD.filter(overdue).length}</span>`:""}</small></button>
      <button class="tile" data-act="finTab" data-id="report"><span>Прибыль за месяц</span><b class="${pnl.net<0?"badc":""}">${money(pnl.net)}</b><small>выручка ${money(pnl.rev)} · расходы ${money(pnl.expSum)}</small></button>
    </div>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Счета</h2><button class="btn sm" data-act="finOp" data-id="transfer">Инкассация / перевод</button></div>
        <div class="flist">${list.map(a=>{const b=App.finBalance(a);return `<button class="frow" data-act="finAcc" data-id="${a.id}"><span class="fic ${a.kind}">${icon(a.kind)}</span>
          <span class="cnm"><b>${esc(a.name)}</b><small>${KIND[a.kind]}${a.kind==="drawer"?" · "+drawerNote(a):""}${a.noncash?" · сюда приходит безнал с касс":""}</small></span><span class="csum ${b<0?"badc":""}">${money(b)}</span></button>`}).join("")}</div></section>
      <section class="card"><div class="card-h"><h2>Ближайшие платежи</h2><button class="btn sm" data-act="finTab" data-id="plans">Все</button></div>
        ${plans.length?`<div class="flist">${plans.map(planRow).join("")}</div>`:`<div class="empty">На две недели вперёд ничего не запланировано.<br><button class="btn sm" data-act="finPlan">+ Регулярный платёж</button></div>`}</section>
    </div>
    ${od.length?`<section class="card"><div class="card-h"><h2>Просроченные долги</h2></div><div class="flist">${od.slice(0,8).map(debtRow).join("")}</div></section>`:""}
    <section class="card"><div class="card-h"><h2>Последние операции</h2><button class="btn sm" data-act="finTab" data-id="ops">Все</button></div>
      ${opsList(S.finops.slice().sort(byNew).slice(0,8))}</section>`;
}
const drawerNote=a=>{const sh=S.shifts.find(s=>s.pointId===a.pointId&&s.status==="open");return sh?"смена "+sh.num+" открыта":"по закрытию смены"};
const icon=k=>({drawer:"🧾",bank:"🏦",cash:"💵",card:"💳",other:"•"})[k]||"•";
const plural=(n,a,b,c)=>{const x=n%10,y=n%100;return x===1&&y!==11?a:x>=2&&x<=4&&(y<12||y>14)?b:c};
const byNew=(a,b)=>String(b.date+b.createdAt).localeCompare(a.date+a.createdAt);
ACT.finDebts=dir=>{App.ui.finTab="debts";App.ui.debtDir=dir;App.ui.debtSt="open";App.render()};
ACT.finAcc=id=>{App.ui.finTab="ops";App.ui.finAcc=id;App.ui.finPeriod="all";App.render()};

/* --- операции --- */
function opText(o){const c=cat(o.catId),d=o.debtId?S.debts.find(x=>x.id===o.debtId):null;
  if(o.kind==="transfer")return `${esc(acc(o.accountId).name)} → ${esc(acc(o.toAccountId).name)}`;
  return [c?esc(c.name):"",d?"долг "+esc(d.num):"",o.counterparty?esc(o.counterparty):""].filter(Boolean).join(" · ")||(o.kind==="in"?"Приход":"Расход")}
function opsList(list){
  if(!list.length)return `<div class="empty">Операций пока нет</div>`;
  return `<div class="flist">${list.map(o=>`<button class="frow ${live(o)?"":"off"}" data-act="finOpOpen" data-id="${o.id}">
    <span class="fic op ${o.kind}">${o.kind==="in"?"+":o.kind==="out"?"−":"⇄"}</span>
    <span class="cnm"><b>${opText(o)}</b><small>${dshort(o.date)} · ${esc(o.num)}${o.kind!=="transfer"?" · "+esc(acc(o.accountId).name):""}${o.note?" · "+esc(o.note):""}${live(o)?"":" · отменена"}</small></span>
    <span class="csum ${o.kind==="in"?"okc":o.kind==="out"?"badc":""}">${o.kind==="in"?"+":o.kind==="out"?"−":""}${money(o.amount)}</span></button>`).join("")}</div>`;
}
function ops(){
  const u=App.ui,[from,to]=App.periodRange(u.finPeriod),q=u.finQ.trim().toLowerCase();
  const list=S.finops.filter(o=>{const t=new Date(o.date+"T12:00");return t>=from&&t<to}).filter(o=>!u.finAcc||o.accountId===u.finAcc||o.toAccountId===u.finAcc)
    .filter(o=>!u.finKind||o.kind===u.finKind).filter(o=>!u.finCat||o.catId===u.finCat)
    .filter(o=>!q||[o.num,o.counterparty,o.note,(cat(o.catId)||{}).name].join(" ").toLowerCase().includes(q)).sort(byNew);
  const l=list.filter(live),inS=l.filter(o=>o.kind==="in").reduce((s,o)=>s+o.amount,0),outS=l.filter(o=>o.kind==="out").reduce((s,o)=>s+o.amount,0);
  return `<div class="cfilt fin4">${App.sel("finPeriod",App.PERIODS,u.finPeriod,'data-filter-sel="finPeriod" aria-label="Период"')}
      ${App.sel("finAcc",[["","Все счета"],...accs(true).map(a=>[a.id,a.name])],u.finAcc,'data-filter-sel="finAcc" aria-label="Счёт"')}
      ${App.sel("finKind",[["","Приход и расход"],["in","Только приход"],["out","Только расход"],["transfer","Переводы"]],u.finKind,'data-filter-sel="finKind" aria-label="Тип"')}
      ${App.sel("finCat",[["","Все статьи"],...S.fincats.map(c=>[c.id,(c.kind==="in"?"+ ":"− ")+c.name])],u.finCat,'data-filter-sel="finCat" aria-label="Статья"')}
      <input id="finQ" type="search" placeholder="Поиск: кому, за что, номер" value="${esc(u.finQ)}" data-filter="finQ" aria-label="Поиск"></div>
    <div class="tiles"><div class="tile"><span>Приход</span><b class="okc">${money(inS)}</b></div><div class="tile"><span>Расход</span><b class="badc">${money(outS)}</b></div><div class="tile"><span>Разница</span><b>${money(inS-outS)}</b></div></div>
    <section class="card">${opsList(list.slice(0,300))}${list.length>300?`<div class="empty">Показаны первые 300 из ${list.length}</div>`:""}</section>
    <p class="muted">Продажи и возвраты на кассе здесь не повторяются: наличные видны в остатке кассы точки, безнал — на счёте, куда он поступает.</p>`;
}

/* --- форма операции --- */
ACT.finOp=(kind,_,pre)=>{
  pre=pre||{};const k=["in","out","transfer"].includes(kind)?kind:"out";
  const list=accs(),pt=App.point(),drawer=list.find(a=>a.kind==="drawer"&&pt&&a.pointId===pt.id)||list.find(a=>a.kind==="drawer");
  const d0=pre.debt,drawerFirst=k==="transfer"||(d0&&d0.direction==="in"&&d0.kind==="customer");
  const def=pre.account||(drawerFirst?drawer:list.find(a=>a.kind!=="drawer"))||list[0]||{};
  const toDef=pre.to||(list.find(a=>a.id!==def.id&&a.kind!=="drawer")||list.find(a=>a.id!==def.id)||{});
  const cats=S.fincats.filter(c=>c.active&&c.kind===(k==="in"?"in":"out")).sort((a,b)=>a.sort-b.sort);
  const d=pre.debt;
  App.openModal(App.head(d?(d.direction==="in"?"Получить оплату долга":"Оплатить долг"):pre.plan?"Оплатить: "+esc(pre.plan.name):{in:"Приход денег",out:"Расход денег",transfer:"Перевод между счетами"}[k])+`
    ${d||pre.plan?"":`<div class="seg wide3">${[["in","+ Приход"],["out","− Расход"],["transfer","⇄ Перевод"]].map(([v,l])=>`<button class="${v===k?"on":""}" data-act="finOp" data-id="${v}">${l}</button>`).join("")}</div>`}
    ${d?`<div class="fbox"><b>${esc(d.counterparty)}</b> · ${esc(d.num)}<br><small>Остаток долга ${money(App.debtLeft(d))} из ${money(d.amount)}${d.note?" · "+esc(d.note):""}</small></div>`:""}
    <div class="form">
      ${App.fld("foAmt","Сумма, ₽",App.inp("foAmt",d?App.debtLeft(d):pre.plan?pre.plan.amount:"","number","0",'min="0" autofocus'))}
      ${App.fld("foDate","Дата",App.inp("foDate",today(),"date"))}
      ${App.fld("foAcc",k==="in"?"Куда пришли деньги":k==="out"?"Откуда платим":"Откуда",App.sel("foAcc",list.map(a=>[a.id,a.name+" · "+money(App.finBalance(a))]),def.id),k==="transfer"?"":"full")}
      ${k==="transfer"?App.fld("foTo","Куда",App.sel("foTo",list.map(a=>[a.id,a.name]),toDef.id)):""}
      ${k!=="transfer"?App.fld("foCat","Статья",App.sel("foCat",[["","— без статьи —"],...cats.map(c=>[c.id,c.name])],pre.cat||(d?(cats.find(c=>c.name===(d.direction==="in"?"Оплата долга клиентом":d.kind==="supplier"?"Закупка товара":d.kind==="loan"?"Возврат займа":""))||{}).id:"")||""))
        +App.fld("foCp",k==="in"?"От кого":"Кому",App.inp("foCp",d?d.counterparty:pre.plan?pre.plan.counterparty||"":"","text",k==="in"?"Клиент, банк, владелец…":"Арендодатель, поставщик…")):""}
      ${App.fld("foNote","Комментарий",App.inp("foNote","","text","Необязательно"),"full")}
    </div>
    <p class="muted" id="foHint">${hintFor(def,k)}</p>
    <div class="acts"><button class="btn pri" data-act="finOpSave">${k==="in"?"Записать приход":k==="out"?"Записать расход":"Перевести"}</button></div>`);
  App.ui.finOpCtx={kind:k,debtId:d?d.id:null,planId:pre.plan?pre.plan.id:null};
  const a=$("#foAcc");if(a)a.addEventListener("change",()=>{$("#foHint").textContent=hintFor(acc(a.value),k)});
};
const hintFor=(a,k)=>a&&a.kind==="drawer"?(S.shifts.some(s=>s.pointId===a.pointId&&s.status==="open")?(k==="in"?"Наличные попадут в кассу точки — будут видны в X-отчёте смены.":"Наличные будут изъяты из кассы точки — будут видны в X-отчёте смены."):"Смена на этой точке закрыта: чтобы двигать наличные в кассе, откройте смену."):"";
ACT.finOpSave=(_,btn)=>run(btn,async()=>{
  const c=App.ui.finOpCtx||{},V=App.val;const amt=num(V("foAmt"));if(!(amt>0))throw new Error("Укажите сумму");
  const p={kind:c.kind,account_id:V("foAcc"),amount:amt,op_date:V("foDate")||today(),note:V("foNote")||null,debt_id:c.debtId,plan_id:c.planId};
  if(c.kind==="transfer")p.to_account_id=V("foTo");else{p.category_id=V("foCat")||null;p.counterparty=V("foCp")||null}
  await App.api.rpc("fin_op_create",{p},["fin_ops","debts","fin_plans","cash_ops"]);
  await App.reload(RELOAD);App.closeModal();App.render();App.toast(c.kind==="in"?"Приход записан":c.kind==="out"?"Расход записан":"Перевод выполнен");
});
ACT.finOpOpen=id=>{
  const o=S.finops.find(x=>x.id===id);if(!o)return;const c=cat(o.catId),d=o.debtId?S.debts.find(x=>x.id===o.debtId):null,pl=o.planId?S.finplans.find(x=>x.id===o.planId):null;
  App.openModal(App.head(`${{in:"Приход",out:"Расход",transfer:"Перевод"}[o.kind]} ${esc(o.num)}`,live(o)?"":'<span class="pill bad">отменена</span>')+`
    <div class="kv">
      <div><span>Сумма</span><b>${money(o.amount)}</b></div><div><span>Дата</span><b>${dshort(o.date)}</b></div>
      <div><span>${o.kind==="transfer"?"Откуда":"Счёт"}</span><b>${esc(acc(o.accountId).name)}</b></div>
      ${o.kind==="transfer"?`<div><span>Куда</span><b>${esc(acc(o.toAccountId).name)}</b></div>`:`<div><span>Статья</span><b>${c?esc(c.name):"—"}</b></div>`}
      ${o.counterparty?`<div><span>${o.kind==="in"?"От кого":"Кому"}</span><b>${esc(o.counterparty)}</b></div>`:""}
      ${d?`<div><span>Долг</span><b><a href="#" data-act="debtOpen" data-id="${d.id}">${esc(d.num)} · ${esc(d.counterparty)}</a></b></div>`:""}
      ${pl?`<div><span>Регулярный платёж</span><b>${esc(pl.name)}</b></div>`:""}
      ${o.note?`<div><span>Комментарий</span><b>${esc(o.note)}</b></div>`:""}
      <div><span>Кто записал</span><b>${esc(App.nameOf(o.by))} · ${App.dtt(o.createdAt)}</b></div>
      ${o.cashOpIds.length?`<div><span>Касса точки</span><b>движение наличных в смене</b></div>`:""}
    </div>
    ${live(o)?`<div class="acts"><button class="btn danger" data-act="finOpCancel" data-id="${o.id}">Отменить операцию</button></div>
      <p class="muted">Отмена вернёт деньги на счёт${o.debtId?" и снова откроет долг":""}. Наличные в кассе вернутся, только пока смена открыта.</p>`:""}`);
};
ACT.finOpCancel=(id,btn)=>{if(!App.confirm2(btn,"Точно отменить? Нажмите ещё раз"))return;run(btn,async()=>{await App.api.rpc("fin_op_cancel",{p_id:id});await App.reload(RELOAD);App.closeModal();App.render();App.toast("Операция отменена")})};

/* --- долги --- */
function debtRow(d){const left=App.debtLeft(d),ov=overdue(d);
  return `<button class="frow" data-act="debtOpen" data-id="${d.id}"><span class="fic d ${d.direction}">${d.direction==="in"?"↙":"↗"}</span>
    <span class="cnm"><b>${esc(d.counterparty)}</b><small>${DKIND[d.kind]} · ${esc(d.num)}${d.note?" · "+esc(d.note):""}${d.dueDate?` · <span class="${ov?"badc":""}">${ov?"просрочен с":"до"} ${dshort(d.dueDate)}</span>`:""}${d.status==="closed"?" · погашен":d.status==="cancelled"?" · отменён":""}</small></span>
    <span class="csum"><span class="${d.status==="open"?(d.direction==="in"?"okc":"badc"):"muted"}">${money(d.status==="open"?left:d.amount)}</span>${d.status==="open"&&left<d.amount?`<small>из ${money(d.amount)}</small>`:""}</span></button>`}
function debts(){
  const u=App.ui,q=u.debtQ.trim().toLowerCase();
  let list=S.debts.filter(d=>d.direction===u.debtDir).filter(d=>u.debtSt==="all"||d.status===u.debtSt)
    .filter(d=>!q||[d.counterparty,d.num,d.note].join(" ").toLowerCase().includes(q));
  list.sort((a,b)=>(overdue(b)-overdue(a))||String(a.dueDate||"9999").localeCompare(b.dueDate||"9999")||String(b.createdAt).localeCompare(a.createdAt));
  const open=openDebts(u.debtDir);
  // по контрагентам
  const byCp={};open.forEach(d=>{const k=d.counterparty;byCp[k]=(byCp[k]||0)+App.debtLeft(d)});
  const top=Object.entries(byCp).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return `<div class="dhead"><div class="seg big">${[["in","Нам должны · "+money(sumLeft(openDebts("in")))],["out","Мы должны · "+money(sumLeft(openDebts("out")))]].map(([v,l])=>`<button class="${u.debtDir===v?"on":""}" data-act="debtDir" data-id="${v}">${l}</button>`).join("")}</div>
      <button class="btn pri" data-act="debtNew" data-id="${u.debtDir}">+ ${u.debtDir==="in"?"Долг нам":"Наш долг"}</button></div>
    ${top.length>1?`<div class="chips cps">${top.map(([n,s])=>`<button class="chip" data-act="debtCp" data-id="${esc(n)}">${esc(n)} · <b>${money(s)}</b></button>`).join("")}</div>`:""}
    <div class="cfilt fin2"><input id="debtQ" type="search" placeholder="${u.debtDir==="in"?"Кто должен":"Кому должны"}, номер, комментарий" value="${esc(u.debtQ)}" data-filter="debtQ" aria-label="Поиск">
      ${App.sel("debtSt",[["open","Не погашены"],["closed","Погашены"],["cancelled","Отменённые"],["all","Все"]],u.debtSt,'data-filter-sel="debtSt" aria-label="Статус"')}</div>
    <section class="card">${list.length?`<div class="flist">${list.map(debtRow).join("")}</div>`:`<div class="empty">${u.debtSt==="open"?(u.debtDir==="in"?"Вам никто не должен.":"Вы никому не должны."):"Ничего не найдено"}</div>`}</section>
    <p class="muted">${u.debtDir==="in"?"Долги клиентов появляются сами, когда на кассе часть чека оплачена «В долг». Займы, долги сотрудников и прочее записывайте кнопкой выше.":"Долг поставщику появляется сам при проведении приёмки с указанным поставщиком, если при приёмке не выбрано «Оплачено сразу». Займы и прочее записывайте кнопкой выше."}</p>`;
}
ACT.debtDir=v=>{App.ui.debtDir=v;App.render()};
ACT.debtCp=n=>{App.ui.debtQ=n;App.render()};
ACT.debtOpen=id=>{
  const draw=()=>{const d=S.debts.find(x=>x.id===id);if(!d)return App.closeModal();
    const pays=S.finops.filter(o=>o.debtId===d.id).sort(byNew),left=App.debtLeft(d);
    const sale=d.saleId?App.byId("sales",d.saleId):null,doc=d.docId?App.byId("docs",d.docId):null;
    App.redrawModal(App.head(`${d.direction==="in"?"Нам должен":"Мы должны"}: ${esc(d.counterparty)}`,`<span class="pill ${d.status==="open"?(overdue(d)?"bad":"warn"):d.status==="closed"?"ok":"mute"}">${d.status==="open"?(overdue(d)?"просрочен":"не погашен"):d.status==="closed"?"погашен":"отменён"}</span>`)+`
      <div class="tiles"><div class="tile"><span>Сумма долга</span><b>${money(d.amount)}</b></div><div class="tile"><span>Оплачено</span><b>${money(d.amount-left)}</b></div><div class="tile"><span>Осталось</span><b class="${left&&d.status==="open"?(d.direction==="in"?"okc":"badc"):""}">${money(d.status==="cancelled"?0:left)}</b></div></div>
      <div class="kv">
        <div><span>Номер</span><b>${esc(d.num)} · ${DKIND[d.kind]}</b></div><div><span>Записан</span><b>${App.dtt(d.createdAt)}</b></div>
        ${sale?`<div><span>Продажа</span><b><a href="#" data-act="openSale" data-id="${sale.id}">${esc(sale.num)} · ${money(sale.total)}</a></b></div>`:""}
        ${doc?`<div><span>Приёмка</span><b>${esc(doc.num)}${doc.invoice?" · накладная "+esc(doc.invoice):""}</b></div>`:""}
        ${d.customerId?`<div><span>Клиент</span><b><a href="#" data-act="openClient" data-id="${d.customerId}">${esc((App.cust(d.customerId)||{}).phone||"карточка")}</a></b></div>`:""}
      </div>
      ${d.status!=="cancelled"?`<div class="form">${App.fld("dDue","Вернуть до",App.inp("dDue",d.dueDate||"","date"))}${App.fld("dAmt","Сумма долга, ₽",App.inp("dAmt",d.amount,"number"))}${App.fld("dNote","Комментарий",App.inp("dNote",d.note||""),"full")}</div>`:""}
      <h3 class="sub-h">Оплаты</h3>
      ${pays.length?opsList(pays):`<div class="empty">Оплат ещё не было</div>`}
      <div class="acts">${d.status!=="cancelled"&&d.amount-left===0?`<button class="btn danger" data-act="debtCancel" data-id="${d.id}">Отменить долг</button>`:""}
        ${d.status!=="cancelled"?`<button class="btn" data-act="debtSave" data-id="${d.id}">Сохранить</button>`:""}
        ${d.status==="open"?`<button class="btn pri" data-act="debtPay" data-id="${d.id}">${d.direction==="in"?"Получить оплату":"Оплатить"}</button>`:""}</div>`)};
  App.openModal("",{wide:true,refresh:draw});draw();
};
ACT.debtPay=id=>{const d=S.debts.find(x=>x.id===id);if(d)ACT.finOp(d.direction==="in"?"in":"out",null,{debt:d})};
ACT.debtSave=(id,btn)=>run(btn,async()=>{await App.api.rpc("debt_update",{p_id:id,p:{due_date:App.val("dDue")||"",amount:num(App.val("dAmt")),note:App.val("dNote")}});await App.reload(["debts"]);App.toast("Сохранено")});
ACT.debtCancel=(id,btn)=>{if(!App.confirm2(btn,"Отменить долг? Ещё раз"))return;run(btn,async()=>{await App.api.rpc("debt_update",{p_id:id,p:{cancel:true}});await App.reload(["debts"]);App.closeModal();App.render();App.toast("Долг отменён")})};
ACT.debtNew=dir=>{
  dir=dir==="out"?"out":"in";
  App.openModal(App.head(dir==="in"?"Записать долг нам":"Записать наш долг")+`
    <div class="seg wide3">${[["in","Нам должны"],["out","Мы должны"]].map(([v,l])=>`<button class="${v===dir?"on":""}" data-act="debtNew" data-id="${v}">${l}</button>`).join("")}</div>
    <div class="form">
      ${App.fld("dnKind","Кто",App.sel("dnKind",(dir==="in"?[["customer","Клиент"],["staff","Сотрудник"],["loan","Займ (мы дали)"],["other","Другое"]]:[["supplier","Поставщик"],["loan","Займ (нам дали)"],["staff","Сотрудник"],["other","Другое"]]),dir==="in"?"customer":"supplier"))}
      ${App.fld("dnCp","Имя / название",App.inp("dnCp","","text","Например: Иван, ООО «Опт»")+(dir==="out"?`<datalist id="dnSup">${S.suppliers.map(s=>`<option value="${esc(s.name)}">`).join("")}</datalist>`:""),"")}
      ${App.fld("dnAmt","Сумма, ₽",App.inp("dnAmt","","number","0"))}
      ${App.fld("dnDue","Вернуть до",App.inp("dnDue","","date"))}
      ${App.fld("dnNote","За что",App.inp("dnNote","","text","Например: займ на закупку, аванс"),"full")}
    </div>
    <p class="muted">Деньги этой записью не двигаются. Если долг возник из-за выдачи или получения денег (займ), запишите ещё приход или расход.</p>
    <div class="acts"><button class="btn pri" data-act="debtCreate" data-id="${dir}">Записать</button></div>`);
  const cp=$("#dnCp");if(cp&&dir==="out")cp.setAttribute("list","dnSup");
};
ACT.debtCreate=(dir,btn)=>run(btn,async()=>{const V=App.val,cp=V("dnCp").trim(),sup=S.suppliers.find(s=>s.name===cp);
  await App.api.rpc("debt_create",{p:{direction:dir,kind:V("dnKind"),counterparty:cp,supplier_id:sup&&V("dnKind")==="supplier"?sup.id:null,amount:num(V("dnAmt")),due_date:V("dnDue")||null,note:V("dnNote")||null}});
  await App.reload(["debts"]);App.closeModal();App.ui.finTab="debts";App.ui.debtDir=dir;App.ui.debtSt="open";App.render();App.toast("Долг записан")});

/* --- регулярные платежи --- */
function planRow(p){const due=p.nextDate<=today();
  return `<div class="frow static"><span class="fic op ${p.kind}">${p.kind==="in"?"+":"−"}</span>
    <span class="cnm"><b>${esc(p.name)}</b><small><span class="${due?"badc":""}">${due?"пора платить · ":""}${dshort(p.nextDate)}</span> · ${PERIOD[p.period]}${p.accountId?" · "+esc(acc(p.accountId).name):""}</small></span>
    <span class="frow-acts"><span class="csum">${money(p.amount)}</span><button class="btn sm ${due?"pri":""}" data-act="planPay" data-id="${p.id}">${p.kind==="in"?"Получено":"Оплатить"}</button><button class="btn sm ghost" data-act="finPlan" data-id="${p.id}" aria-label="Изменить">✎</button></span></div>`}
function plans(){
  const act=S.finplans.filter(p=>p.active).sort((a,b)=>a.nextDate.localeCompare(b.nextDate)),off=S.finplans.filter(p=>!p.active);
  const month=act.filter(p=>p.kind==="out").reduce((s,p)=>s+num(p.amount)*({week:4.33,month:1,quarter:1/3,year:1/12,once:0})[p.period],0);
  return `<div class="dhead"><div class="muted">Аренда, зарплата, связь и другие повторяющиеся платежи. Нажмите «Оплатить» — расход запишется, а дата сдвинется на следующий раз.</div><button class="btn pri" data-act="finPlan">+ Платёж</button></div>
    <div class="tiles"><div class="tile"><span>Обязательные расходы в месяц</span><b>${money(month)}</b></div><div class="tile"><span>Пора платить</span><b class="${duePlans(0).length?"badc":""}">${duePlans(0).length}</b></div></div>
    <section class="card">${act.length?`<div class="flist">${act.map(planRow).join("")}</div>`:`<div class="empty">Регулярных платежей нет</div>`}</section>
    ${off.length?`<section class="card"><div class="card-h"><h2>Выключенные</h2></div><div class="flist">${off.map(planRow).join("")}</div></section>`:""}`;
}
ACT.planPay=id=>{const p=S.finplans.find(x=>x.id===id);if(!p)return;ACT.finOp(p.kind,null,{plan:p,account:p.accountId?acc(p.accountId):null,cat:p.catId})};
ACT.finPlan=id=>{
  const p=S.finplans.find(x=>x.id===id)||{kind:"out",period:"month",nextDate:today(),active:true,amount:""};
  App.openModal(App.head(p.id?"Регулярный платёж":"Новый регулярный платёж")+`<div class="form">
    ${App.fld("plName","Название",App.inp("plName",p.name||"","text","Аренда ТЦ, зарплата Ольге…"),"full")}
    ${App.fld("plKind","Тип",App.sel("plKind",[["out","Расход"],["in","Приход"]],p.kind))}
    ${App.fld("plAmt","Сумма, ₽",App.inp("plAmt",p.amount,"number","0"))}
    ${App.fld("plPer","Как часто",App.sel("plPer",Object.entries(PERIOD),p.period))}
    ${App.fld("plDate","Следующий раз",App.inp("plDate",p.nextDate,"date"))}
    ${App.fld("plAcc","Откуда платим",App.sel("plAcc",[["","— выбрать при оплате —"],...accs().map(a=>[a.id,a.name])],p.accountId||""))}
    ${App.fld("plCat","Статья",App.sel("plCat",[["","—"],...S.fincats.filter(c=>c.active).map(c=>[c.id,(c.kind==="in"?"+ ":"− ")+c.name])],p.catId||""))}
    ${App.fld("plCp","Кому",App.inp("plCp",p.counterparty||""),"full")}
    ${p.id?`<div class="fld full">${App.chk("plOn","Включён",p.active)}</div>`:""}
  </div><div class="acts">${p.id?`<button class="btn danger" data-act="planDel" data-id="${p.id}">Удалить</button>`:""}<button class="btn pri" data-act="planSave" data-id="${p.id||""}">Сохранить</button></div>`)};
ACT.planSave=(id,btn)=>run(btn,async()=>{const V=App.val;if(!V("plName"))throw new Error("Укажите название");if(!V("plDate"))throw new Error("Укажите дату");
  const row={name:V("plName"),kind:V("plKind"),amount:num(V("plAmt")),period:V("plPer"),next_date:V("plDate"),account_id:V("plAcc")||null,category_id:V("plCat")||null,counterparty:V("plCp")||null};
  if(id){row.is_active=App.checked("plOn");await App.api.update("fin_plans",id,row)}else await App.api.insert("fin_plans",row);
  await App.reload(["finplans"]);App.closeModal();App.render();App.toast("Сохранено")});
ACT.planDel=(id,btn)=>{if(!App.confirm2(btn,"Удалить платёж? Ещё раз"))return;run(btn,async()=>{await App.api.remove("fin_plans",id);await App.reload(["finplans"]);App.closeModal();App.render()})};

/* --- прибыль и движение денег --- */
function report(){
  const u=App.ui,[from,to]=App.periodRange(u.repFinPeriod),p=App.finPnl(from,to),cost=App.can("cost");
  const inP=o=>{const t=new Date(o.date+"T12:00");return t>=from&&t<to},inPa=x=>{const t=new Date(x.at);return t>=from&&t<to};
  const cash=S.cashops.filter(inPa),sumM=(f)=>cash.filter(f).reduce((s,c)=>s+num(c.amount),0);
  const salesCash=sumM(c=>["sale","refund","repair","prepay"].includes(c.type)&&c.method==="cash"),salesNon=sumM(c=>["sale","refund","repair","prepay"].includes(c.type)&&NONCASH.includes(c.method));
  const ops=S.finops.filter(o=>live(o)&&o.kind!=="transfer"&&inP(o));
  const grp=k=>{const m={};ops.filter(o=>o.kind===k).forEach(o=>{const n=(cat(o.catId)||{}).name||"Без статьи";m[n]=(m[n]||0)+o.amount});return Object.entries(m).sort((a,b)=>b[1]-a[1])};
  const fin=grp("in"),fout=grp("out"),finS=fin.reduce((s,x)=>s+x[1],0),foutS=fout.reduce((s,x)=>s+x[1],0);
  const line=(l,v,cls="")=>`<div class="pl ${cls}"><span>${l}</span><b>${money(v)}</b></div>`;
  return `<div class="cfilt fin2">${App.sel("repFinPeriod",App.PERIODS,u.repFinPeriod,'data-filter-sel="repFinPeriod" aria-label="Период"')}<span></span></div>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Прибыль</h2></div>
        ${line("Выручка (продажи − возвраты + ремонт)",p.rev)}
        ${cost?line("Себестоимость проданного",-p.cogs,"sub"):""}
        ${line("Валовая прибыль",p.gross,"tot")}
        ${p.exp.map(([n,v])=>line(n,-v,"sub")).join("")||`<div class="pl sub"><span>Расходов по статьям нет</span><b>0 ₽</b></div>`}
        ${p.oth.map(([n,v])=>line(n,v,"sub")).join("")}
        ${line("Чистая прибыль",p.net,"tot big "+(p.net<0?"neg":""))}
        <p class="muted">Закупка товара, вложения и выплаты владельцу, займы и оплата долгов не уменьшают прибыль — товар попадает в расход через себестоимость при продаже. Какие статьи считать в прибыли, настраивается во вкладке «Счета и статьи».</p></section>
      <section class="card"><div class="card-h"><h2>Движение денег</h2></div>
        <h3 class="sub-h">Поступило</h3>
        ${line("Касса: наличные (продажи, ремонт, минус возвраты)",salesCash,"sub")}${line("Касса: безнал",salesNon,"sub")}
        ${fin.map(([n,v])=>line(n,v,"sub")).join("")}
        ${line("Всего поступило",salesCash+salesNon+finS,"tot")}
        <h3 class="sub-h">Выплачено</h3>
        ${fout.map(([n,v])=>line(n,-v,"sub")).join("")||`<div class="pl sub"><span>Выплат не было</span><b>0 ₽</b></div>`}
        ${line("Всего выплачено",-foutS,"tot")}
        ${line("Итого за период",salesCash+salesNon+finS-foutS,"tot big "+(salesCash+salesNon+finS-foutS<0?"neg":""))}</section>
    </div>`;
}

/* --- счета и статьи --- */
function setup(){
  return `<div class="fgrid">
    <section class="card"><div class="card-h"><h2>Счета</h2><button class="btn sm" data-act="accForm">+ Счёт</button></div>
      <div class="flist">${accs(true).map(a=>`<button class="frow ${a.active?"":"off"}" data-act="accForm" data-id="${a.id}"><span class="fic ${a.kind}">${icon(a.kind)}</span>
        <span class="cnm"><b>${esc(a.name)}</b><small>${KIND[a.kind]}${a.noncash?" · сюда безнал с касс":""}${a.kind!=="drawer"&&a.opening?" · начальный остаток "+money(a.opening):""}${a.active?"":" · скрыт"}</small></span><span class="csum">${money(App.finBalance(a))}</span></button>`).join("")}</div>
      <p class="muted">Касса точки показывает наличные в ящике по текущей смене. Безнал с касс (карта, СБП, перевод) прибавляется к счёту с отметкой «сюда безнал с касс».</p></section>
    <section class="card"><div class="card-h"><h2>Статьи</h2><button class="btn sm" data-act="fcatForm">+ Статья</button></div>
      ${["out","in"].map(k=>`<h3 class="sub-h">${k==="out"?"Расходы":"Доходы"}</h3><div class="chips">${S.fincats.filter(c=>c.kind===k).sort((a,b)=>a.sort-b.sort).map(c=>`<button class="chip ${c.active?"":"off"}" data-act="fcatForm" data-id="${c.id}">${esc(c.name)}${c.inPnl?"":' <small class="muted">вне прибыли</small>'}</button>`).join("")}</div>`).join("")}</section>
  </div>`;
}
ACT.accForm=id=>{const a=S.finaccounts.find(x=>x.id===id)||{kind:"cash",active:true,opening:0,noncash:false},drawer=a.kind==="drawer";
  App.openModal(App.head(a.id?"Счёт":"Новый счёт")+`<div class="form">
    ${App.fld("acName","Название",App.inp("acName",a.name||"","text","Сейф, карта Тинькофф…"),"full")}
    ${drawer?"":App.fld("acKind","Тип",App.sel("acKind",Object.entries(KIND).filter(([k])=>k!=="drawer"),a.kind))+App.fld("acOpen","Остаток сейчас / на начало, ₽",App.inp("acOpen",a.opening||"","number","0"))}
    ${drawer?"":`<div class="fld full">${App.chk("acNon","Сюда поступает безнал с касс (карта, СБП, переводы)",a.noncash)}</div>`}
    ${a.id?`<div class="fld full">${App.chk("acOn","Показывать",a.active)}</div>`:""}
  </div>${drawer?'<p class="muted">Это касса точки: её остаток считается по кассовой смене, менять его здесь не нужно.</p>':""}
  <div class="acts"><button class="btn pri" data-act="accSave" data-id="${a.id||""}">Сохранить</button></div>`)};
ACT.accSave=(id,btn)=>run(btn,async()=>{const V=App.val;if(!V("acName"))throw new Error("Укажите название");
  const a=S.finaccounts.find(x=>x.id===id),row={name:V("acName")};
  if(!a||a.kind!=="drawer"){row.kind=V("acKind");row.opening=num(V("acOpen"));row.noncash=App.checked("acNon")}
  if(id)row.is_active=App.checked("acOn");
  if(id)await App.api.update("fin_accounts",id,row);else await App.api.insert("fin_accounts",Object.assign(row,{sort:30}));
  await App.reload(["finaccounts"]);App.closeModal();App.render();App.toast("Сохранено")});
ACT.fcatForm=id=>{const c=S.fincats.find(x=>x.id===id)||{kind:"out",inPnl:true,active:true};
  App.openModal(App.head(c.id?"Статья":"Новая статья")+`<div class="form">
    ${App.fld("ctName","Название",App.inp("ctName",c.name||""),"full")}
    ${App.fld("ctKind","Тип",App.sel("ctKind",[["out","Расход"],["in","Доход"]],c.kind))}
    <div class="fld full">${App.chk("ctPnl","Учитывать в прибыли",c.inPnl)}</div>
    ${c.id?`<div class="fld full">${App.chk("ctOn","Показывать в списке",c.active)}</div>`:""}
  </div><p class="muted">Снимите «Учитывать в прибыли» для закупки товара, займов, вложений и выплат владельцу.</p>
  <div class="acts"><button class="btn pri" data-act="fcatSave" data-id="${c.id||""}">Сохранить</button></div>`)};
ACT.fcatSave=(id,btn)=>run(btn,async()=>{const V=App.val;if(!V("ctName"))throw new Error("Укажите название");
  const row={name:V("ctName"),kind:V("ctKind"),in_pnl:App.checked("ctPnl")};if(id)row.is_active=App.checked("ctOn");
  if(id)await App.api.update("fin_categories",id,row);else await App.api.insert("fin_categories",Object.assign(row,{sort:50}));
  await App.reload(["fincats"]);App.closeModal();App.render();App.toast("Сохранено")});
})();
