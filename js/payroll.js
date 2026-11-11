/* iCase CRM v3 · Зарплата: правила начисления (оклад, за смену, % продаж, % прибыли, % работ мастера), расчёт за месяц, выплаты */
"use strict";
(function(){
const {S,esc,num,money,ACT}=App;
const curM=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
Object.assign(App.ui,{payM:curM()});
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
const ROLE={owner:"Владелец",manager:"Управляющий",seller:"Продавец",master:"Мастер",storekeeper:"Кладовщик"};
const range=m=>{const [y,mo]=m.split("-").map(Number);return [new Date(y,mo-1,1),new Date(y,mo,1)]};
const inR=(t,[a,b])=>{const d=new Date(t);return d>=a&&d<b};
const rule=id=>S.payrules.find(r=>r.staffId===id)||{base:0,perShift:0,pctSales:0,pctProfit:0,pctWorks:0,note:"",none:true};
const isPay=o=>!o.cancelledAt&&o.kind==="out"&&o.payee;
/* расчёт начисления сотруднику за месяц */
App.payCalc=function(st,m){
  const R=range(m),r=rule(st.id);
  const shifts=S.shifts.filter(s=>s.openedBy===st.id&&inR(s.openedAt,R)).length;
  const sales=S.sales.filter(s=>s.by===st.id&&s.status!=="cancelled"&&inR(s.createdAt,R));
  const rets=S.returns.filter(x=>inR(x.createdAt,R)&&(App.byId("sales",x.saleId)||{}).by===st.id);
  const rev=sales.reduce((a,s)=>a+num(s.total),0)-rets.reduce((a,x)=>a+num(x.amount),0);
  const retCost=rets.reduce((a,x)=>a+(x.items||[]).reduce((b,i)=>b+num(i.cost)*num(i.qty),0),0);
  const profit=sales.reduce((a,s)=>a+App.saleProfit(s),0)-rets.reduce((a,x)=>a+num(x.amount),0)+retCost;
  const reps=S.repairs.filter(x=>x.status==="done"&&x.masterId===st.id&&x.closedAt&&inR(x.closedAt,R));
  const works=reps.reduce((a,x)=>a+App.repairWorksSum(x),0);
  const parts={base:num(r.base),shifts:shifts*num(r.perShift),sales:rev*num(r.pctSales)/100,profit:Math.max(0,profit)*num(r.pctProfit)/100,works:works*num(r.pctWorks)/100};
  const total=Math.round(Object.values(parts).reduce((a,b)=>a+b,0));
  const paid=S.finops.filter(o=>isPay(o)&&o.payee===st.id&&String(o.date).slice(0,7)===m).reduce((a,o)=>a+num(o.amount),0);
  return {r,shifts,nSales:sales.length,rev,profit,nRep:reps.length,works,parts,total,paid,left:total-paid};
};
const MONTHS=["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const mName=m=>{const [y,mo]=m.split("-");return MONTHS[+mo-1]+" "+y};
const mOpts=()=>{const out=[],d=new Date();for(let i=0;i<12;i++){const x=new Date(d.getFullYear(),d.getMonth()-i,1);const k=x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0");out.push([k,mName(k)])}return out};
App.payrollView=function(){
  const m=App.ui.payM,staff=S.staff.filter(s=>S.payrules.some(r=>r.staffId===s.id)||(s.active!==false&&s.role!=="owner")),rows=staff.map(s=>[s,App.payCalc(s,m)]);
  const tot=rows.reduce((a,[,c])=>a+c.total,0),paid=rows.reduce((a,[,c])=>a+c.paid,0),owner=App.me.role==="owner";
  return `<div class="anbar">${App.sel("payM",mOpts(),m,'data-filter-sel="payM" aria-label="Месяц"')}<span class="muted">Начисляется по правилам каждого сотрудника. Продажи — по тому, кто пробил чек; работы — по мастеру выданного ремонта.</span></div>
    <div class="tiles"><div class="tile"><span>Начислено</span><b>${money(tot)}</b></div><div class="tile"><span>Выплачено</span><b>${money(paid)}</b></div><div class="tile"><span>Осталось выплатить</span><b class="${tot-paid>0?"badc":""}">${money(Math.max(0,tot-paid))}</b></div></div>
    <section class="card"><div class="flist">${rows.map(([s,c])=>`<button class="frow" data-act="payOpen" data-id="${esc(s.id)}"><span class="fic">${esc((s.fullName||"?").slice(0,1))}</span>
      <span class="cnm"><b>${esc(s.fullName)}</b><small>${esc(ROLE[s.role]||s.role)} · ${c.r.none?'<span class="badc">правила не заданы</span>':ruleText(c.r)}</small>
      <small>смен ${c.shifts} · продаж ${c.nSales} на ${money(c.rev)}${c.nRep?` · ремонтов ${c.nRep}, работы ${money(c.works)}`:""}</small></span>
      <span class="csum">${money(c.total)}<small class="${c.left>0?"badc":"okc"}">${c.left>0?"к выплате "+money(c.left):c.total?"выплачено":""}</small></span></button>`).join("")||'<div class="empty">Сотрудников нет — добавьте их в «Настройки → Сотрудники»</div>'}</div></section>
    ${owner?"":'<p class="muted">Правила начисления меняет только владелец.</p>'}`;
};
const ruleText=r=>[r.base?"оклад "+money(r.base):"",r.perShift?money(r.perShift)+" за смену":"",r.pctSales?r.pctSales+"% продаж":"",r.pctProfit?r.pctProfit+"% прибыли":"",r.pctWorks?r.pctWorks+"% работ":""].filter(Boolean).join(" + ")||"ничего не начисляется";
ACT.payOpen=id=>{const s=App.byId("staff",id),m=App.ui.payM,c=App.payCalc(s,m),r=c.r,owner=App.me.role==="owner";
  const line=(l,v,h)=>v?`<div class="rpr"><span>${l}<small>${h}</small></span><b>${money(v)}</b><span></span></div>`:"";
  const pays=S.finops.filter(o=>isPay(o)&&o.payee===id&&String(o.date).slice(0,7)===m);
  App.openModal(App.head(esc(s.fullName)+" · "+mName(m))+`
    <div class="rpl">${line("Оклад",c.parts.base,"за месяц")}${line("За смены",c.parts.shifts,`${c.shifts} × ${money(r.perShift)}`)}${line("% от продаж",c.parts.sales,`${r.pctSales}% от ${money(c.rev)} (за вычетом возвратов)`)}
      ${line("% от прибыли",c.parts.profit,`${r.pctProfit}% от ${money(Math.max(0,c.profit))}`)}${line("% от работ",c.parts.works,`${r.pctWorks}% от ${money(c.works)} · ${c.nRep} ремонт.`)}
      ${c.total?"":'<div class="muted">За этот месяц ничего не начислено.</div>'}</div>
    <div class="total"><span>Начислено</span><b>${money(c.total)}</b></div>
    ${pays.length?`<div class="rhst">${pays.map(o=>`<div class="rhr"><span class="rhr-d">${App.dt(o.date)}</span><span>Выплата ${money(o.amount)}${o.note?" · "+esc(o.note):""}</span><small>${esc(o.num)}</small></div>`).join("")}</div>`:""}
    <div class="total"><span>${c.left>=0?"Осталось выплатить":"Выплачено больше на"}</span><b class="${c.left>0?"badc":""}">${money(Math.abs(c.left))}</b></div>
    ${owner?`<h3 class="sub-h">Правила начисления</h3><div class="form">
      ${App.fld("prBase","Оклад в месяц, ₽",App.inp("prBase",r.base||"","number","0"))}${App.fld("prShift","За каждую смену, ₽",App.inp("prShift",r.perShift||"","number","0"))}
      ${App.fld("prSales","% от выручки своих продаж",App.inp("prSales",r.pctSales||"","number","0"))}${App.fld("prProfit","% от прибыли своих продаж",App.inp("prProfit",r.pctProfit||"","number","0"))}
      ${App.fld("prWorks","% от работ в ремонтах (мастер)",App.inp("prWorks",r.pctWorks||"","number","0"))}${App.fld("prNote","Заметка",App.inp("prNote",r.note||"","text","Премия за план, штрафы…"))}</div>`:""}
    <div class="acts"><button class="btn" data-act="printPayslip" data-id="${esc(id)}">Расчётный лист</button>${owner?`<button class="btn" data-act="payRuleSave" data-id="${esc(id)}">Сохранить правила</button>`:""}${App.can("finance")?`<button class="btn pri" data-act="payOut" data-id="${esc(id)}">Выплатить</button>`:""}</div>`,{wide:true})};
ACT.payRuleSave=(id,btn)=>run(btn,async()=>{const V=App.val,row={staff_id:id,base_month:num(V("prBase")),per_shift:num(V("prShift")),pct_sales:num(V("prSales")),pct_profit:num(V("prProfit")),pct_works:num(V("prWorks")),note:V("prNote")||null};
  if([row.pct_sales,row.pct_profit,row.pct_works].some(x=>x<0||x>100))throw new Error("Процент — от 0 до 100");
  await App.api.upsertRule(row);await App.reload(["payrules"]);App.toast("Правила сохранены");ACT.payOpen(id)});
ACT.payOut=id=>{const s=App.byId("staff",id),c=App.payCalc(s,App.ui.payM),cat=S.fincats.find(x=>x.kind==="out"&&/зарплат/i.test(x.name));
  ACT.finOp("out",null,{payee:id,amount:Math.max(0,c.left)||"",cp:s.fullName,cat:cat?cat.id:""})};
})();
