/* iCase CRM v3 · Точная прибыль: расходы по точкам и распределение общих, эквайринг, зарплата по начислению, патенты ПСН, лимит ПСН */
"use strict";
(function(){
const {S,esc,num,money,ACT}=App;
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const DEF={acq:{card:1.8,sbp:0.7,transfer:0},acqAuto:true,accrual:true,alloc:"revenue",psn:{limit:60000000,patents:[]}};
App.finCfg=()=>{const c=App.settings().finConfig||{};return {...DEF,...c,acq:{...DEF.acq,...(c.acq||{})},psn:{...DEF.psn,...(c.psn||{}),patents:(c.psn&&c.psn.patents)||[]}}};
const points=()=>S.points.filter(p=>p.active!==false);
const DAY=864e5;
const overlap=(a0,a1,b0,b1)=>Math.max(0,Math.min(+a1,+b1)-Math.max(+a0,+b0));
const salaryCat=c=>c&&/зарплат/i.test(c.name);

/* ---------- прибыль за период (по всей сети или по точке) ---------- */
App.finPnl=function(from,to,pointId){
  const cfg=App.finCfg(),pts=points();
  const st=App.periodStats(from,to,pointId||null),all=pointId?App.periodStats(from,to,null):st;
  // доля точки в общих расходах
  const share=!pointId?1:cfg.alloc==="equal"?1/Math.max(1,pts.length):all.rev>0?st.rev/all.rev:1/Math.max(1,pts.length);
  const w=pt=>!pointId?1:pt?(pt===pointId?1:0):share;
  const inP=o=>{const t=new Date(o.date+"T12:00");return t>=from&&t<to};
  const m={},oth={},add=(map,n,v)=>{if(v)map[n]=(map[n]||0)+v};
  let direct=0,shared=0;
  S.finops.filter(o=>!o.cancelledAt&&o.kind!=="transfer"&&inP(o)).forEach(o=>{
    const c=S.fincats.find(x=>x.id===o.catId);if(c&&!c.inPnl)return;
    if(o.kind==="out"&&cfg.accrual&&(o.payee||salaryCat(c)))return; // зарплата считается по начислению
    const v=num(o.amount)*w(o.pointId);if(!v)return;
    if(o.kind==="out"){add(m,c?c.name:"Без статьи",v);if(pointId){if(o.pointId)direct+=v;else shared+=v}}else add(oth,c?c.name:"Прочие доходы",v)});
  // эквайринг: процент банка с безналичных оплат в кассе
  let acq=0;if(cfg.acqAuto){const inPa=x=>{const t=new Date(x.at);return t>=from&&t<to};
    S.cashops.filter(c=>inPa(c)&&["sale","refund","repair","prepay"].includes(c.type)&&(!pointId||c.pointId===pointId)).forEach(c=>{acq+=num(c.amount)*num(cfg.acq[c.method])/100});
    acq=Math.round(acq);add(m,"Эквайринг (по ставкам банка)",acq)}
  // зарплата по начислению: сотрудник с точкой — на свою точку, без точки — делится
  let pay=0;if(cfg.accrual&&App.payAccrued){App.payAccrued(from,to).forEach(x=>{const v=x.total*w(x.pointId);pay+=v;if(pointId){if(x.pointId)direct+=v;else shared+=v}});pay=Math.round(pay);add(m,"Зарплата (начислено)",pay)}
  // патенты ПСН: стоимость равномерно по дням действия
  let pat=0;cfg.psn.patents.forEach(p=>{if(!p.from||!p.to||!num(p.cost))return;const a=new Date(p.from),b=new Date(+new Date(p.to)+DAY);
    const v=num(p.cost)*overlap(a,b,from,to)/Math.max(DAY,b-a)*w(p.pointId);pat+=v});pat=Math.round(pat);add(m,"Патент ПСН",pat);
  const exp=Object.entries(m).sort((a,b)=>b[1]-a[1]),othE=Object.entries(oth).sort((a,b)=>b[1]-a[1]);
  const expSum=exp.reduce((s,x)=>s+x[1],0),othSum=othE.reduce((s,x)=>s+x[1],0);
  return{rev:st.rev,cogs:st.rev-st.profit,gross:st.profit,exp,expSum,oth:othE,othSum,net:st.profit-expSum+othSum,share,acq,pay,pat,direct,shared,stats:st};
};

/* ---------- сравнение точек ---------- */
App.finPointsTable=function(from,to){
  const pts=points();if(pts.length<2)return"";const tot=App.finPnl(from,to),cost=App.can("cost");
  const rows=pts.map(p=>[p,App.finPnl(from,to,p.id)]);
  const td=v=>`<td class="n ${v<0?"badc":""}">${money(v)}</td>`;
  return `<section class="card"><div class="card-h"><h2>Прибыль по точкам</h2></div><div class="tbl-wrap"><table><thead><tr><th>Точка</th><th class="n">Выручка</th>${cost?'<th class="n">Валовая</th>':""}<th class="n">Свои расходы</th><th class="n">Доля общих</th><th class="n">Эквайринг</th><th class="n">Патент</th><th class="n">Чистая</th><th class="n">Рентаб.</th></tr></thead><tbody>
    ${rows.map(([p,r])=>`<tr><td>${esc(p.name)}<small class="muted"> · ${Math.round(r.share*100)}% общих</small></td>${td(r.rev)}${cost?td(r.gross):""}${td(-r.direct)}${td(-r.shared)}${td(-r.acq)}${td(-r.pat)}${td(r.net)}<td class="n">${r.rev?Math.round(r.net/r.rev*100)+"%":"—"}</td></tr>`).join("")}
    <tr class="f"><td><b>Вся сеть</b></td>${td(tot.rev)}${cost?td(tot.gross):""}<td class="n" colspan="2">${money(-(tot.expSum-tot.acq-tot.pat))}</td>${td(-tot.acq)}${td(-tot.pat)}${td(tot.net)}<td class="n">${tot.rev?Math.round(tot.net/tot.rev*100)+"%":"—"}</td></tr></tbody></table></div>
    <p class="muted">Расходы с указанной точкой относятся к ней. Общие (без точки: бухгалтерия, реклама на всю сеть, владелец) делятся ${App.finCfg().alloc==="equal"?"поровну":"пропорционально выручке"} — это меняется в «Счета и статьи → Учёт прибыли». Зарплата идёт на точку сотрудника.</p></section>`;
};

/* ---------- лимит ПСН ---------- */
App.psnStatus=function(){const cfg=App.finCfg(),y=new Date().getFullYear(),f=new Date(y,0,1),t=new Date(y+1,0,1);
  const st=App.periodStats(f,t,null),lim=num(cfg.psn.limit)||60000000,inc=st.saleRev-st.retSum+st.repRev;
  const day=Math.max(1,(Date.now()-f)/DAY),fc=inc/day*365;
  const soon=cfg.psn.patents.filter(p=>p.to&&new Date(p.to)>=new Date(Date.now()-DAY)&&new Date(p.to)<new Date(Date.now()+30*DAY));
  return {inc,lim,pct:inc/lim,fc,soon,patents:cfg.psn.patents}};
App.psnTile=function(){const s=App.psnStatus();const cls=s.pct>=.9?"badc":s.pct>=.75?"warnc":"";
  return `<button class="tile" data-act="finTab" data-id="setup"><span>Доход для лимита ПСН с начала года</span><b class="${cls}">${money(s.inc)}</b><small>${Math.round(s.pct*100)}% лимита ${money(s.lim)} · к концу года ≈ ${money(s.fc)}${s.fc>s.lim?' · <span class="badc">превысим</span>':""}${s.soon.length?` · <span class="badc">патент заканчивается</span>`:""}</small></button>`};

/* ---------- настройки учёта прибыли ---------- */
App.finConfigCard=function(){const c=App.finCfg(),ed=App.can("settings");const dis=ed?"":"disabled";
  return `<section class="card" data-nodirty><div class="card-h"><h2>Учёт прибыли</h2></div>
    <div class="form">
      <div class="fld full">${App.chk("fcAcqAuto","Считать комиссию эквайринга автоматически по ставкам банка",c.acqAuto)}</div>
      ${App.fld("fcCard","Карта, %",App.inp("fcCard",c.acq.card,"number","1.8",dis))}${App.fld("fcSbp","QR (СБП), %",App.inp("fcSbp",c.acq.sbp,"number","0.7",dis))}
      ${App.fld("fcTr","Перевод, %",App.inp("fcTr",c.acq.transfer,"number","0",dis))}
      ${App.fld("fcAlloc","Общие расходы делить между точками",App.sel("fcAlloc",[["revenue","пропорционально выручке"],["equal","поровну"]],c.alloc,dis))}
      <div class="fld full">${App.chk("fcAccr","Зарплата в прибыли — по начислению (по правилам из «Зарплаты»), а не по дате выплаты",c.accrual)}</div>
    </div>
    <p class="muted">Если комиссия считается автоматически, не записывайте её ещё и расходом «Банк и эквайринг» — иначе она учтётся дважды.</p>
    <h3 class="sub-h">ПСН: патенты и лимит дохода</h3>
    <div class="form">${App.fld("fcLim","Лимит дохода за год, ₽",App.inp("fcLim",c.psn.limit,"number","60000000",dis))}</div>
    <div class="tbl-wrap"><table><thead><tr><th>Точка</th><th>С</th><th>По</th><th class="n">Стоимость</th><th></th></tr></thead><tbody>
      ${c.psn.patents.map((p,i)=>`<tr><td>${App.sel("pt_p"+i,[["","Все точки"],...points().map(x=>[x.id,x.name])],p.pointId||"",dis)}</td><td>${App.inp("pt_f"+i,p.from||"","date","",dis)}</td><td>${App.inp("pt_t"+i,p.to||"","date","",dis)}</td><td class="n">${App.inp("pt_c"+i,p.cost||"","number","0",dis)}</td><td>${ed?`<button class="btn sm ghost" data-act="psnDel" data-id="${i}" aria-label="Убрать">✕</button>`:""}</td></tr>`).join("")||'<tr><td colspan="5" class="muted">Патентов нет</td></tr>'}
    </tbody></table></div>
    <p class="muted">Стоимость патента распределяется по дням его действия и попадает в прибыль точки. За 30 дней до окончания CRM напомнит продлить.</p>
    ${ed?`<div class="acts"><button class="btn" data-act="psnAdd">+ Патент</button><button class="btn pri" data-act="finCfgSave">Сохранить</button></div>`:""}</section>`};
const readCfg=()=>{const c=App.finCfg(),V=App.val;const pats=c.psn.patents.map((_,i)=>({pointId:V("pt_p"+i),from:V("pt_f"+i),to:V("pt_t"+i),cost:num(V("pt_c"+i))}));
  return {acqAuto:App.checked("fcAcqAuto"),acq:{card:num(V("fcCard")),sbp:num(V("fcSbp")),transfer:num(V("fcTr"))},alloc:V("fcAlloc")||"revenue",accrual:App.checked("fcAccr"),psn:{limit:num(V("fcLim"))||60000000,patents:pats}}};
const saveCfg=async c=>{if(Object.values(c.acq).some(v=>v<0||v>10))throw new Error("Ставка эквайринга — от 0 до 10%");
  await App.api.update("settings",1,{fin_config:c});await App.reload(["settings"]);App.render()};
ACT.finCfgSave=(_,btn)=>run(btn,async()=>{await saveCfg(readCfg());App.toast("Сохранено")});
ACT.psnAdd=(_,btn)=>run(btn,async()=>{const c=readCfg(),y=new Date().getFullYear();c.psn.patents.push({pointId:"",from:y+"-01-01",to:y+"-12-31",cost:0});await saveCfg(c)});
ACT.psnDel=(i,btn)=>run(btn,async()=>{const c=readCfg();c.psn.patents.splice(+i,1);await saveCfg(c)});

/* ---------- точка и канал у операции ---------- */
App.finOpTagForm=function(o){const ed=App.can("finance");if(!ed||o.kind==="transfer")return "";
  const c=S.fincats.find(x=>x.id===o.catId),ad=c&&/реклам/i.test(c.name);
  return `<div class="form">${App.fld("ftPoint","Точка",App.sel("ftPoint",[["","Общий расход (делится между точками)"],...points().map(p=>[p.id,p.name])],o.pointId))}
    ${ad||o.channel?App.fld("ftCh","Рекламный канал",App.sel("ftCh",[["","—"],...App.SOURCES.map(s=>[s,s])],o.channel)):""}
    <div class="fld"><label>&nbsp;</label><button class="btn" data-act="finOpTag" data-id="${o.id}">Сохранить точку${ad?" и канал":""}</button></div></div>`};
ACT.finOpTag=(id,btn)=>run(btn,async()=>{await App.api.rpc("fin_op_tag",{p_id:id,p_point:App.val("ftPoint")||null,p_channel:App.val("ftCh")||null},["fin_ops"]);await App.reload(["finops"]);App.toast("Сохранено")});
})();
