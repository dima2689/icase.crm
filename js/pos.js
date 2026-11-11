/* iCase CRM v3 · сводка, касса, смены, продажи, возвраты (Supabase) */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;

/* ======================= СВОДКА ======================= */
TITLES.dashboard="Сводка";
VIEWS.dashboard={
  actions:()=>(App.can("repair")&&App.VIEWS.repairs?'<button class="btn" data-act="newRepair">+ Ремонт</button>':"")+(App.can("sale")?'<a class="btn pri" href="#pos">Открыть кассу</a>':""),
  render(){
    const now=new Date(),d0=new Date(now.toDateString()),m0=new Date(now.getFullYear(),now.getMonth(),1),tom=new Date(+d0+864e5);
    const ptF=App.can("allPoints")?null:(App.point()||{}).id;const t=App.periodStats(d0,tom,ptF),m=App.periodStats(m0,tom,ptF);const hasRep=!!App.VIEWS.repairs;
    const act=S.repairs.filter(r=>App.ACTIVE.includes(r.status)),ready=act.filter(r=>r.status==="ready"),late=act.filter(App.isLate),stored=act.filter(App.isStored),waitParts=act.filter(r=>r.status==="parts");
    const low=S.products.filter(App.isLow),sh=App.openShift();
    const days=[];for(let i=13;i>=0;i--){const d=new Date(d0);d.setDate(d.getDate()-i);days.push(d)}
    const vals=days.map(d=>App.periodStats(d,new Date(+d+864e5),ptF).rev);
    const bd=S.customers.filter(c=>c.birthday&&!c.mergedInto&&c.birthday.slice(5)===now.toISOString().slice(5,10));
    const reqs=App.can("staff")?S.staffreq.filter(r=>!App.byId("staff",r.id)):[];
    const showProfit=App.can("cost");
    return `
    ${reqs.length?`<div class="banner info">Новые сотрудники ждут назначения роли: ${reqs.length}. <a href="#settings" data-act="settingsTab" data-id="staff">Назначить</a></div>`:""}
    ${sh&&!App.sameDay(sh.openedAt,now)?`<div class="banner warn">Смена ${esc(sh.num)} открыта ${App.dtt(sh.openedAt)} и не закрыта. <a href="#pos">Закрыть в кассе</a></div>`:""}
    <div class="tiles">
      <div class="tile"><span>Выручка сегодня</span><b>${money(t.rev)}</b><small>все точки · ${App.nw(t.count,"чек","чека","чеков")}${t.reps.length?" · "+App.nw(t.reps.length,"ремонт","ремонта","ремонтов"):""}</small></div>
      <div class="tile"><span>Выручка за месяц</span><b>${money(m.rev)}</b><small>${showProfit?"валовая прибыль "+money(m.profit):"средний чек "+money(m.avg)}</small></div>
      <a class="tile click" href="#pos"><span>Касса</span><b>${sh?money(App.shiftTotals(sh).expectedCash):"закрыта"}</b><small>${sh?"наличных в смене "+esc(sh.num):"откройте смену"}</small></a>
      ${hasRep?`<a class="tile click" href="#repairs"><span>Ремонт в работе</span><b>${act.length}</b><small>${ready.length||waitParts.length?[ready.length?"готово к выдаче: "+ready.length:"",waitParts.length?"ждут запчасть: "+waitParts.length:""].filter(Boolean).join(" · "):"все в процессе"}</small></a>
      <button class="tile click ${late.length?"alert":""}" data-act="repFilter" data-id="late"><span>Просрочено</span><b>${late.length}</b><small>${late.length?[late.length-stored.length>0?"не готовы в срок: "+(late.length-stored.length):"",stored.length?"не забирают дольше "+App.settings().storageDays+" дн.: "+stored.length:""].filter(Boolean).join(" · "):"всё в срок"}</small></button>`:""}
      ${App.tasksDue?`<a class="tile click ${App.tasksDue()?"alert":""}" href="#tasks"><span>Задачи на сегодня</span><b>${App.tasksDue()}</b><small>${S.waitlist.filter(w=>w.status==="ready").length?"из них звонков о поступлении: "+S.waitlist.filter(w=>w.status==="ready").length:"напоминания и звонки"}</small></a>`:""}
      ${App.apprTile?App.apprTile():""}<button class="tile click ${low.length?"warn":""}" data-act="lowStock"><span>Заканчивается</span><b>${low.length}</b><small>товаров ниже минимума</small></button>
    </div>
    <div class="grid g2">
      <section class="card"><div class="card-h"><h2>Выручка за 14 дней</h2><span class="pill">продажи − возвраты + ремонт</span></div>${App.barChart(days,vals)}</section>
      ${hasRep?`<section class="card"><div class="card-h"><h2>Ремонт</h2><a class="btn sm" href="#repairs">Все</a></div>
        <div class="chips">${App.RSTAT.filter(s=>App.ACTIVE.includes(s[0])).map(s=>`<button class="chip" data-act="repFilter" data-id="${s[0]}">${esc(s[1])}<b>${act.filter(r=>r.status===s[0]).length}</b></button>`).join("")}</div>
        <h3 class="sub-h">Готовы к выдаче</h3>
        <div class="list-mini">${ready.length?ready.slice(0,5).map((App.repMini||(()=>''))).join(""):'<div class="empty sm">Нет</div>'}</div>
      </section>`:`<section class="card"><div class="card-h"><h2>Точки сегодня</h2></div><div class="list-mini">${App.myPoints().map(p=>{const s2=App.openShift(p.id);const r=App.periodStats(d0,tom,p.id);return `<div class="lrow"><span><b>${esc(p.name)}</b><small>${r.count} чеков${s2?" · наличных "+money(App.shiftTotals(s2).expectedCash):""}</small></span><span class="row-f"><b class="num">${money(r.rev)}</b><span class="pill ${s2?"ok":"mute"}">${s2?"смена открыта":"закрыта"}</span></span></div>`}).join("")||'<div class="empty sm">Точек нет. Добавьте их в настройках</div>'}</div></section>`}
    </div>
    <div class="grid g3">
      <section class="card"><div class="card-h"><h2>Последние продажи</h2><a class="btn sm" href="#sales">Все</a></div>
        <div class="list-mini">${App.sortDesc(S.sales).slice(0,6).map(App.saleMini).join("")||'<div class="empty sm">Продаж нет</div>'}</div></section>
      <section class="card"><div class="card-h"><h2>Заканчивается</h2><a class="btn sm" href="#stock">Товары</a></div>
        <div class="list-mini">${low.slice(0,6).map(p=>`<button data-act="openProduct" data-id="${esc(p.id)}"><span>${esc(p.name)}<small>${esc(App.catName(p))} · мин. ${num(p.minQty)}</small></span><span class="pill bad">${App.qtyTotal(p)} шт</span></button>`).join("")||'<div class="empty sm">Всё в наличии</div>'}</div></section>
      <section class="card"><div class="card-h"><h2>Внимание</h2></div>
        <div class="list-mini">
          ${waitParts.map(r=>`<button data-act="openRepair" data-id="${esc(r.id)}"><span>${esc(r.num)} ждёт запчасть<small>${esc(r.device)}</small></span>${App.statusPill(r.status)}</button>`).join("")}
          ${stored.map(r=>`<button data-act="openRepair" data-id="${esc(r.id)}"><span>${esc(r.num)} не забирают<small>готов с ${App.dt(r.readyAt)}</small></span><span class="pill warn">хранение</span></button>`).join("")}
          ${S.docs.filter(d=>d.status==="draft").map(d=>`<button data-act="openDoc" data-id="${esc(d.id)}"><span>${esc(App.DOCT[d.type].one)} ${esc(d.num)} не проведён<small>${App.dt(d.createdAt)}</small></span><span class="pill mute">черновик</span></button>`).join("")}
          ${bd.map(c=>`<button data-act="openClient" data-id="${esc(c.id)}"><span>День рождения: ${esc(c.name)}<small>${esc(c.phone)}</small></span><span class="pill ok">сегодня</span></button>`).join("")}
          ${!waitParts.length&&!stored.length&&!bd.length&&!S.docs.some(d=>d.status==="draft")?'<div class="empty sm">Всё спокойно</div>':""}
        </div></section>
    </div>`;
  }
};
App.saleMini = s=>{const c=App.cust(s.customerId);return `<button data-act="openSale" data-id="${esc(s.id)}"><span>${esc(s.num)} · ${esc((s.items||[]).map(i=>i.name).join(", "))}<small>${esc(c?c.name:"Без клиента")} · ${App.dtt(s.createdAt)}${s.status&&s.status!=="done"?" · возврат":""}</small></span><b class="num">${money(s.total)}</b></button>`};
App.barChart = function(days,vals){
  const W=560,H=180,pl=44,pb=22,pt=10,max=Math.max(1,...vals.map(v=>Math.abs(v)));
  const raw=max/4,p=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/p,step=(n<=1?1:n<=2?2:n<=5?5:10)*p,top=Math.ceil(max/step)*step;
  const bw=(W-pl-8)/days.length;let g="";
  for(let v=0;v<=top;v+=step){const y=pt+(H-pt-pb)*(1-v/top);g+=`<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${pl-6}" y="${y+4}" text-anchor="end">${v>=1000?Math.round(v/1000)+"к":v}</text>`}
  days.forEach((d,i)=>{const v=Math.max(0,vals[i]),h=(H-pt-pb)*(v/top),x=pl+i*bw+3,y=H-pb-h,last=i===days.length-1;
    g+=`<rect x="${x}" y="${y}" width="${bw-6}" height="${h}" rx="4" class="${last?"bar-last":"bar"}"><title>${d.toLocaleDateString("ru-RU")}: ${money(vals[i])}</title></rect>`;
    if(i%2===days.length%2||last)g+=`<text x="${x+(bw-6)/2}" y="${H-6}" text-anchor="middle">${d.getDate()}</text>`});
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Выручка по дням">${g}</svg>`;
};
ACT.lowStock=()=>{Object.assign(App.ui.sf,{avail:"low",cat:""});location.hash="stock";App.render()};

/* ======================= КАССА ======================= */
App.pos={cart:[],phone:"",name:"",discPct:0,discSum:0,tiDev:"",tiAmt:0,tiImei:"",whId:null,manualPct:false};
const P=App.pos;
App.pointWhOpts=()=>{const p=App.point();const ws=App.whs().filter(w=>p&&w.pointId===p.id);return (ws.length?ws:App.whs()).map(w=>[w.id,w.name])};
const posWh=()=>App.cashWh(); // продажа всегда со склада кассы текущей точки
/* выручка точки за сегодня: продажи минус возвраты, по способам оплаты */
App.posToday=pid=>{const now=new Date(),r={cash:0,non:0,n:0,ret:0,debt:0};
  S.sales.filter(x=>x.pointId===pid&&App.sameDay(x.createdAt,now)).forEach(x=>{r.n++;(x.payments||[]).forEach(p=>{if(p.method==="cash")r.cash+=p.amount;else if(p.method==="debt")r.debt+=p.amount;else r.non+=p.amount})});
  S.returns.filter(x=>App.sameDay(x.createdAt,now)&&((App.byId("sales",x.saleId)||{}).pointId===pid)).forEach(x=>{r.ret+=x.amount;if(x.method==="cash")r.cash-=x.amount;else r.non-=x.amount});
  r.total=r.cash+r.non;return r};
function posToday(){const pt=App.point();if(!pt)return "";const t=App.posToday(pt.id),sh=App.openShift(),open=!!App.ui.posTodayOpen;
  const nw=t.n%10===1&&t.n%100!==11?"чек":t.n%10>=2&&t.n%10<=4&&(t.n%100<10||t.n%100>=20)?"чека":"чеков";
  return `<div class="totbox todaybox ${open?"open":""}"><button class="fsh" data-act="posTodayT" aria-expanded="${open}"><span class="ft">Сегодня</span><span class="fsum">получено ${money(t.total)} · нал. ${money(t.cash)} · безнал ${money(t.non)}${t.debt?" · в долг "+money(t.debt):""}</span><span class="car"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${open?180:0}deg);transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg></span><span class="totbtn">${open?"Свернуть":"Развернуть"}</span></button>
    ${open?`<div class="tb-body"><div class="tb-h muted">${esc(pt.name)} · ${t.n} ${nw}${t.ret?" · возвраты "+money(t.ret):""}${t.debt?" · продано в долг "+money(t.debt):""}</div>
    <div class="tb-row"><div><span>Наличные</span><b>${money(t.cash)}</b>${sh?`<small>в ящике ${money(App.shiftTotals(sh).expectedCash)}</small>`:""}</div><div><span>Безналичные</span><b>${money(t.non)}</b><small>карта, СБП, перевод</small></div><div class="tb-tot"><span>Всего</span><b>${money(t.total)}</b></div></div></div>`:""}</div>`}
ACT.posTodayT=()=>{App.ui.posTodayOpen=!App.ui.posTodayOpen;App.render()};
function posTotals(){
  const sub=P.cart.reduce((a,i)=>a+num(i.qty)*num(i.price)-num(i.disc),0);
  const disc=Math.round(sub*num(P.discPct)/100)+num(P.discSum);
  const total=Math.max(0,sub-disc-num(P.tiAmt));
  return{sub,disc,total};
}
TITLES.pos="Касса";
VIEWS.pos={
  ownSearch:true,
  actions(){const sh=App.openShift();return sh?"":`<button class="btn pri" data-act="openShiftDlg">Открыть смену</button>`},
  render(){
    const sh=App.openShift(),wh=posWh(),t=posTotals(),c=App.findCustomerByPhone(P.phone);
    const st=App.settings();
    if(!App.point())return '<div class="card empty">Нет торговых точек. Владелец добавляет их в «Настройки → Точки и склады».</div>';
    const shiftBar=sh?`<div class="shiftbar ok"><b>Смена ${esc(sh.num)}</b> открыта ${App.dtt(sh.openedAt)} · ${esc(App.nameOf(sh.openedBy))} · наличных в кассе ≈ <b>${money(App.shiftTotals(sh).expectedCash)}</b>${!App.sameDay(sh.openedAt,new Date())?' <span class="pill warn">открыта не сегодня, закройте её</span>':""}</div>`
      :`<div class="shiftbar ${st.requireShift?"bad":""}"><b>Смена закрыта.</b> ${st.requireShift?"Продажи и наличные операции недоступны, пока смена не открыта.":"Продажи без смены разрешены настройками, но наличные операции требуют смены."} <button class="btn sm pri" data-act="openShiftDlg">Открыть смену</button></div>`;
    const inStock=S.products.filter(p=>!p.archived&&App.qtyIn(p,wh)>0).sort((a,b)=>App.catName(a).localeCompare(App.catName(b))||String(a.name).localeCompare(b.name));
    const groups={};inStock.forEach(p=>{const k=App.catName(p);(groups[k]=groups[k]||[]).push(p)});

    return `${sh?"":shiftBar}
    <div class="pos">
      <section class="card">
        <div class="row-f"><div class="fld grow"><label for="posQ">Товар или сканер</label><input id="posQ" type="search" autocomplete="off" placeholder="Название, артикул, штрихкод, IMEI / S/N"><div class="pick" id="posPick" hidden></div></div><button class="btn" data-act="posCustom" style="align-self:flex-end">+ Услуга / товар вне каталога</button>
</div>
        <div class="plist ${App.ui.posListOpen?"open":""}" id="plist">
          <button type="button" class="pl-trig" data-act="posListT" aria-expanded="${!!App.ui.posListOpen}"><span class="pl-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span><span class="pl-t">Выбрать из списка</span><span class="pl-n">${inStock.length} в наличии</span><svg class="pl-car" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
          ${App.ui.posListOpen?`<div class="pl-dim" data-act="posListT" aria-hidden="true"></div><div class="pl-pop">
            <div class="pl-head"><input type="search" id="plQ" placeholder="Фильтр по названию" autocomplete="off" data-nodirty aria-label="Фильтр списка">
              <div class="chips">${[["","Все"],...[...new Set(Object.keys(groups).map(g=>g.split(" / ")[0]))].map(g=>[g,g])].map(([k,l])=>`<button type="button" class="chip ${k?"":"on"}" data-plg="${esc(k)}">${esc(l)}</button>`).join("")}</div></div>
            <div class="pl-body">${inStock.length?Object.keys(groups).map(g=>`<div class="pl-grp" data-g="${esc(g)}"><div class="pl-gh">${esc(g)}<span>${groups[g].length}</span></div>${groups[g].map(p=>{const q=App.qtyIn(p,wh);return `<button type="button" class="pl-row" data-act="posPickL" data-id="${esc(p.id)}" data-s="${esc((p.name+" "+(p.brand||"")+" "+(p.sku||"")).toLowerCase())}">
                <span class="pl-nm"><b>${esc(p.name)}</b><small>${[p.brand?esc(p.brand):"",p.condition&&p.condition!=="Новый"?`<span class="pill warn">${esc(p.condition)}</span>`:"",p.trackSerial?`<span class="pill info">${App.codeLbl(p)}</span>`:""].filter(Boolean).join(" ")}</small></span>
                <span class="pl-q ${q<=num(p.minQty)?"low":""}">${q} шт</span><span class="pl-pr">${money(p.price)}</span></button>`}).join("")}</div>`).join("")+'<div class="pl-empty" hidden>Ничего не найдено</div>':'<div class="pl-empty">На этом складе нет товаров в наличии</div>'}</div>
          </div>`:""}
        </div>

      </section>
      <section class="card cartcard">
        <div class="card-h"><h2>Чек</h2>${P.cart.length?'<button class="btn sm ghost danger" data-act="posClear">Очистить</button>':""}</div>
        <div class="form">
          ${App.fld("posPhone","Телефон клиента",App.inp("posPhone",P.phone,"tel","необязательно",'data-pos="phone" autocomplete="off"'))}
          ${App.fld("posName","Имя",App.inp("posName",P.name,"text","",'data-pos="name"'))}
        </div>
        ${c?`<div class="hint ${c.blacklisted?"bad":"ok"}" style="margin-top:6px">${c.blacklisted?'<span class="pill bad">Чёрный список</span> '+esc(c.blackReason||"")+" · ":""}${esc(c.name)} · покупок ${S.sales.filter(s=>s.customerId===c.id).length}${num(c.discount)?" · скидка "+num(c.discount)+"%":""}${(c.tags||[]).length?" · "+esc(c.tags.join(", ")):""}${App.bonusOn&&App.bonusOn()?" · бонусов "+App.bonusBal(c.id):""}</div>`:App.phoneKey(P.phone).length===10?'<div class="hint" style="margin-top:6px">Новый клиент, добавится при продаже</div>':""}
        <div class="clist">
        ${P.cart.length?P.cart.map((i,k)=>{const p=App.byId("products",i.productId);const below=p&&num(i.price)-num(i.disc)/Math.max(1,num(i.qty))<num(i.unitId?i.cost:p.cost);
          return `<div class="cline"><div class="cl-top"><div class="cl-name"><b>${esc(i.name)}${i.productId?"":` <span class="pill ${i.kind==="goods"?"":"info"}">${i.kind==="goods"?"вне каталога":"услуга"}</span>`}</b>${i.serial?'<span class="sub">'+App.codeLbl(i.productId)+" "+esc(i.serial)+(i.battery!=null&&i.battery!==""?" · АКБ "+i.battery+"%":"")+"</span>":""}${below?'<span class="sub bad">ниже закупки</span>':""}</div>
            <button class="btn sm ghost danger" data-act="posDel" data-id="${k}" aria-label="Убрать">✕</button></div>
            <div class="cl-row"><label>Кол-во<input type="number" min="1" value="${num(i.qty)}" data-cart="${k}" data-f="qty" id="cq${k}" ${i.serial?"disabled":""}></label>
            <label>Цена<input type="number" min="0" value="${num(i.price)}" data-cart="${k}" data-f="price" id="cp${k}" ${App.can("price")?"":"disabled"}></label>
            <label>Скидка<input type="number" min="0" value="${num(i.disc)||""}" data-cart="${k}" data-f="disc" id="cd${k}" placeholder="0"></label>
            <div class="cl-sum"><span>Сумма</span><b>${money(num(i.qty)*num(i.price)-num(i.disc))}</b></div></div></div>`}).join(""):'<div class="empty">Добавьте товар поиском, сканером или выберите из списка</div>'}
        </div>
        <details class="more" ${P.discPct||P.discSum||P.tiDev?"open":""}><summary>Скидка на чек и trade-in</summary>
          <div class="form">
            ${App.fld("posPct","Скидка, %",App.inp("posPct",P.discPct||"","number","0",'data-pos="discPct"'))}
            ${App.fld("posDsum","Скидка, ₽",App.inp("posDsum",P.discSum||"","number","0",'data-pos="discSum"'))}
            ${App.fld("posTi","Trade-in: устройство",App.inp("posTi",P.tiDev,"text","iPhone 11 64 ГБ",'data-pos="tiDev"'))}
            ${App.fld("posTiA","Trade-in: зачёт, ₽",App.inp("posTiA",P.tiAmt||"","number","0",'data-pos="tiAmt"'))}
            ${App.fld("posTiI","Trade-in: IMEI",App.inp("posTiI",P.tiImei,"text","",'data-pos="tiImei"'),"full")}
          </div></details>
        <div class="sumlines"><span>Товары</span><span>${money(t.sub)}</span>${t.disc?`<span>Скидка</span><span>−${money(t.disc)}</span>`:""}${num(P.tiAmt)?`<span>Trade-in</span><span>−${money(P.tiAmt)}</span>`:""}</div>
        <div class="total"><span>К оплате</span><b id="posTotal">${money(t.total)}</b></div>
        <button class="btn pri big" data-act="posPay" ${P.cart.length?"":"disabled"}>Оплата</button>
      </section>
    </div>
    ${posToday()}
    ${sh?`<div class="shiftbottom">${shiftBar}<div class="sb-acts"><button class="btn" data-act="cashMove" data-id="in">Внесение</button>${App.can("cashout")?'<button class="btn" data-act="cashMove" data-id="out">Изъятие</button>':""}<button class="btn" data-act="xReport">X-отчёт</button><button class="btn" data-act="closeShift">Закрыть смену</button></div></div>`:""}`;
  },
  after(){
    const box=document.getElementById("plist");
    if(box&&App.ui.posListOpen){let grp="";const q=document.getElementById("plQ");
      const apply=()=>{const t=(q.value||"").trim().toLowerCase();let any=false;
        box.querySelectorAll(".pl-grp").forEach(g=>{let n=0;g.querySelectorAll(".pl-row").forEach(r=>{const ok=(!grp||g.dataset.g===grp||g.dataset.g.startsWith(grp+" / "))&&(!t||t.split(/\s+/).every(w=>r.dataset.s.includes(w)));r.hidden=!ok;if(ok)n++});g.hidden=!n;if(n)any=true});
        const e=box.querySelector(".pl-empty");if(e&&box.querySelector(".pl-grp"))e.hidden=any};
      q.addEventListener("input",apply);
      box.querySelectorAll("[data-plg]").forEach(c=>c.addEventListener("click",()=>{grp=c.dataset.plg;box.querySelectorAll("[data-plg]").forEach(x=>x.classList.toggle("on",x===c));apply()}));
      q.addEventListener("keydown",e=>{if(e.key==="Escape"){App.ui.posListOpen=false;App.render()}});
      if(!App.ui._plFocus){App.ui._plFocus=1;setTimeout(()=>q.focus(),0)}}
    App.productPicker("posQ","posPick",{wh:posWh,inStock:false,onPick:(p,u)=>posAdd(p.id,u)});
    document.querySelectorAll("[data-pos]").forEach(el=>el.addEventListener("input",()=>{const f=el.dataset.pos;P[f]=["discPct","discSum","tiAmt"].includes(f)?num(el.value):el.value;
      if(f==="phone"){const c=App.findCustomerByPhone(P.phone);if(c){if(!P.name)P.name=c.name;if(!P.manualPct)P.discPct=num(c.discount)}}
      if(f==="discPct")P.manualPct=true;
      if(f==="whId"){P.cart=P.cart.filter(i=>{const p=App.byId("products",i.productId);if(i.unitId){const u=App.byId("units",i.unitId);return u&&u.status==="in_stock"&&u.whId===el.value}return p&&App.qtyIn(p,el.value)>=num(i.qty)});}
      App.schedule()}));
    document.querySelectorAll("[data-cart]").forEach(el=>el.addEventListener("input",()=>{const i=P.cart[+el.dataset.cart];if(!i)return;const v=num(el.value);
      if(el.dataset.f==="qty"&&!i.productId)i.qty=Math.max(1,v||1);else if(el.dataset.f==="qty"){const p=App.byId("products",i.productId),max=App.qtyIn(p,posWh());i.qty=Math.max(1,Math.min(v||1,max));if(v>max)App.toast("На складе только "+max)}else i[el.dataset.f]=Math.max(0,v);App.schedule()}));
  }
};
function posAdd(pid,unit){
  const p=App.byId("products",pid),wh=posWh();if(!p)return;
  if(p.approval==="pending_create")return App.toast("«"+p.name+"» ещё не подтверждён управляющим — продать его нельзя");
  if(p.trackSerial){
    const add=u=>{if(P.cart.some(i=>i.unitId===u.id))return App.toast("Этот экземпляр уже в чеке");
      if(u.status!=="in_stock")return App.toast(App.codeLbl(u.productId)+" "+App.unitCode(u)+": "+(App.UNIT_ST[u.status]||[u.status])[0].toLowerCase());
      if(u.whId!==wh)return App.toast("Этот экземпляр на складе «"+App.whName(u.whId)+"» — сделайте перемещение");
      P.cart.push({line:App.uid("ln"),productId:pid,unitId:u.id,name:p.name,qty:1,price:App.unitPrice(u,p),cost:num(u.cost),disc:0,serial:App.unitCode(u),
        battery:u.batteryHealth,warranty:App.isDevice(p)?(num(p.warrantyMonths)||App.settings().deviceWarrantyMonths):num(p.warrantyMonths)});App.schedule()};
    if(unit&&typeof unit==="object"&&unit.id)return add(unit);
    return App.chooseUnit({productId:pid,wh,exclude:P.cart.map(i=>i.unitId).filter(Boolean),title:"Какой экземпляр продаём?",onPick:add});
  }
  const have=App.qtyIn(p,wh);
  if(have<=0){const o=App.whereElse(p,wh);App.toast("Нет на складе «"+App.whName(wh)+"»"+(o?". Есть: "+o+" — сделайте перемещение":""));return}
  const ex=P.cart.find(i=>i.productId===pid);
  if(ex){if(ex.qty>=have){App.toast("На складе только "+have);return}ex.qty++}
  else P.cart.push({line:App.uid("ln"),productId:pid,name:p.name,qty:1,price:num(p.price),cost:num(p.cost),disc:0,serial:p.serial||"",warranty:App.isDevice(p)?(num(p.warrantyMonths)||App.settings().deviceWarrantyMonths):num(p.warrantyMonths)});
  App.schedule();
}
ACT.posAdd=id=>posAdd(id);
ACT.posListT=()=>{App.ui.posListOpen=!App.ui.posListOpen;App.ui._plFocus=0;App.render()};
ACT.posPickL=id=>{App.ui.posListOpen=false;App.render();posAdd(id)};
document.addEventListener("click",e=>{if(App.ui.posListOpen&&!e.target.closest("#plist")&&!e.target.closest(".scrim")){App.ui.posListOpen=false;App.render()}});
/* произвольная позиция: услуга или товар, которого нет в справочнике (без списания со склада) */
const PC={kind:"service"};
ACT.posCustom=()=>{
  const svc=S.services||[],cost=App.can("cost");
  App.openModal(App.head("Позиция вне каталога")+`
    <div class="chips" style="margin-bottom:12px"><button class="chip ${PC.kind==="service"?"on":""}" data-act="pcKind" data-id="service">Услуга</button><button class="chip ${PC.kind==="goods"?"on":""}" data-act="pcKind" data-id="goods">Товар</button></div>
    <div class="form">
      ${App.fld("pcName","Название",App.inp("pcName","","text",PC.kind==="service"?"Например: наклейка плёнки, настройка телефона":"Например: чехол без штрихкода",'list="pcSvc" autocomplete="off"'),"full")}
      <datalist id="pcSvc">${svc.map(x=>`<option value="${esc(x.name)}">${money(x.price)}</option>`).join("")}</datalist>
      ${App.fld("pcPrice","Цена, ₽",App.inp("pcPrice","","number","0"))}${App.fld("pcQty","Количество",App.inp("pcQty","1","number","1",'min="1"'))}
      ${cost?App.fld("pcCost","Себестоимость, ₽",App.inp("pcCost","","number","0")):""}${App.fld("pcWar","Гарантия, мес.",App.inp("pcWar","","number","0"))}
      ${PC.kind==="goods"?App.fld("pcSn","Серийный номер (если есть)",App.inp("pcSn","","text","",'autocomplete="off"'),"full"):""}
    </div>
    <p class="muted" style="margin:10px 0 0">Позиция попадёт в чек и выручку, но не спишется со склада${PC.kind==="goods"?". Если товар будет продаваться регулярно — заведите его в каталоге":""}.</p>
    <div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="pcAdd">Добавить в чек</button></div>`);
  const nm=document.getElementById("pcName");
  nm.addEventListener("input",()=>{const x=svc.find(x=>x.name===nm.value);const pr=document.getElementById("pcPrice");if(x&&pr&&!pr.value)pr.value=x.price});
  setTimeout(()=>nm.focus(),0);
};
ACT.pcKind=k=>{PC.kind=k;ACT.posCustom()};
ACT.pcAdd=()=>{
  const name=App.val("pcName"),price=num(App.val("pcPrice")),qty=Math.max(1,Math.round(num(App.val("pcQty"))||1));
  if(!name)return App.toast("Укажите название");
  if(price<0)return App.toast("Цена не может быть отрицательной");
  P.cart.push({line:App.uid("ln"),productId:null,kind:PC.kind,name,qty,price,cost:num(App.val("pcCost")),disc:0,serial:App.val("pcSn").toUpperCase(),warranty:num(App.val("pcWar"))});
  App.closeModal();App.schedule();
};
ACT.posDel=k=>{P.cart.splice(+k,1);App.schedule()};
ACT.posClear=()=>{Object.assign(P,{cart:[],phone:"",name:"",discPct:0,discSum:0,tiDev:"",tiAmt:0,tiImei:"",manualPct:false});App.schedule()};
ACT.posCat=id=>{App.ui.posCat=id;App.render()};
ACT.saleFor=id=>{const c=App.cust(id);ACT.posClear();P.phone=c.phone;P.name=c.name;P.discPct=num(c.discount);location.hash="pos";App.render()};

const PAYK=()=>Object.keys(App.PAY).concat(document.getElementById("pay_debt")?["debt"]:[]);
ACT.posPay=()=>{
  if(!App.can("sale"))return App.toast("Нет права проводить продажи");
  if(!P.cart.length)return;
  const sh=App.openShift();if(!sh&&App.settings().requireShift)return App.toast("Сначала откройте смену");
  const t=posTotals();
  for(const i of P.cart){const p=App.byId("products",i.productId);if(p&&num(i.price)-num(i.disc)/Math.max(1,num(i.qty))<num(i.unitId?i.cost:p.cost)&&!App.can("belowCost"))return App.toast("«"+i.name+"» дешевле закупки: продать так может только управляющий")}
  const c=App.findCustomerByPhone(P.phone);
  const bal=c&&App.bonusOn&&App.bonusOn()?App.bonusBal(c.id):0,bmax=bal?Math.min(bal,Math.floor(t.total*num((App.settings().loyalty||{}).max_pay_pct||100)/100)):0;
  App.openModal(App.head("Оплата · "+money(t.total))+`
    ${bmax>0?`<div class="fbox bonusbox"><div class="fld"><label for="pay_bonus">Списать бонусы <small class="muted">есть ${bal}, можно до ${bmax}</small></label><div class="row-f">${App.inp("pay_bonus","","number","0",'min="0" max="'+bmax+'"')}<button class="btn sm" data-act="payBonusMax">Максимум</button></div></div></div>`:""}
    ${c&&c.blacklisted?`<div class="banner err">Клиент в чёрном списке: ${esc(c.blackReason||"без причины")}</div>`:""}
    <div class="paygrid">${Object.entries(App.PAY).map(([m,l])=>`<div class="fld"><label for="pay_${m}">${l}</label><div class="row-f">${App.inp("pay_"+m,"","number","0")}<button class="btn sm" data-act="payAll" data-id="${m}">Всё</button></div></div>`).join("")}</div>
    ${App.phoneKey(P.phone).length===10?`<div class="paydebt"><div class="fld"><label for="pay_debt">В долг</label><div class="row-f">${App.inp("pay_debt","","number","0")}<button class="btn sm" data-act="payAll" data-id="debt">Всё</button></div></div>
      ${App.fld("payDue","Вернуть до",App.inp("payDue","","date"))}</div>`:`<p class="muted paydebt-hint">Чтобы продать в долг, укажите телефон покупателя.</p>`}
    <div class="form" style="margin-top:10px">${App.fld("payGot","Получено наличными (для сдачи)",App.inp("payGot","","number"))}<div class="fld"><label>Сдача</label><b id="payChange" class="big-n">—</b></div></div>
    <div class="total"><span>Осталось распределить</span><b id="payLeft">${money(t.total)}</b></div>
    ${App.fld("payWarr","Гарантия на устройства, мес.",App.inp("payWarr",App.settings().deviceWarrantyMonths,"number"))}
    <div class="acts"><button class="btn" data-act="close">Назад</button><button class="btn pri" data-act="posConfirm" id="payOk">Провести продажу</button></div>`);
  const bon=()=>Math.max(0,Math.min(bmax,Math.round(num(App.val("pay_bonus")))));
  const upd=()=>{const paid=PAYK().reduce((a,m)=>a+num(App.val("pay_"+m)),0);const left=t.total-bon()-paid;
    $("#payLeft").textContent=money(left);$("#payLeft").className=Math.abs(left)<0.5?"ok":"bad";
    const got=num(App.val("payGot")),cash=num(App.val("pay_cash"));$("#payChange").textContent=got?money(got-cash):"—"};
  document.querySelectorAll("#modal input").forEach(el=>el.addEventListener("input",upd));
  ACT.payAll=m=>{PAYK().forEach(k=>{document.getElementById("pay_"+k).value=k===m?t.total-bon():""});upd()};
  ACT.payBonusMax=()=>{$("#pay_bonus").value=bmax;const filled=PAYK().filter(k=>num(App.val("pay_"+k)));if(filled.length===1)ACT.payAll(filled[0]);else upd()};
  if(t.total===0){upd()}
};
ACT.posConfirm=async(_,btn)=>{
  if(btn.disabled)return;
  const t=posTotals(),wh=posWh();
  const payments=PAYK().map(m=>({method:m,amount:num(App.val("pay_"+m))})).filter(p=>p.amount);
  const paid=payments.reduce((a,p)=>a+p.amount,0),debt=payments.filter(p=>p.method==="debt").reduce((a,p)=>a+p.amount,0);
  const bonus=Math.max(0,Math.round(num(App.val("pay_bonus"))));
  if(payments.some(p=>p.amount<0))return App.toast("Суммы оплат не могут быть отрицательными");
  if(debt&&App.phoneKey(P.phone).length!==10)return App.toast("Для продажи в долг укажите телефон покупателя");
  if(Math.abs(paid+bonus-t.total)>=0.5)return App.toast("Сумма оплат ("+money(paid+bonus)+") не равна сумме чека ("+money(t.total)+")");
  const sh=App.openShift();
  if(!sh&&(App.settings().requireShift||payments.some(p=>p.method==="cash")))return App.toast("Для этой оплаты нужна открытая смена");
  btn.disabled=true;btn.textContent="Проводим…";
  try{
    const customerId=(P.phone||P.name)?await App.api.customer(P.phone,P.name,"Магазин"):null;
    const items=P.cart.map(i=>i.productId?{product_id:i.productId,unit_id:i.unitId||null,qty:num(i.qty),price:num(i.price),discount:num(i.disc)}
      :{product_id:null,name:i.name,kind:i.kind,serial:i.serial||null,qty:num(i.qty),price:num(i.price),discount:num(i.disc),cost:num(i.cost),warranty:num(i.warranty)});
    const args={p_wh:wh,p_customer:customerId,p_items:items,p_payments:payments,p_discount:t.disc,p_tradein_device:P.tiDev||null,p_tradein_amount:num(P.tiAmt),p_tradein_imei:P.tiImei||null};
    if(debt)args.p_due=App.val("payDue")||null;
    const id=bonus?await App.api.rpc("create_sale_bonus",{p_bonus:bonus,p:args},["sales","stock","stock_movements","cash_ops","products","audit_log","units","debts","bonus_ops"])
      :await App.api.rpc(debt?"create_sale_debt":"create_sale",args,["sales","stock","stock_movements","cash_ops","products","audit_log","units","debts"]);
    if(bonus)App.toast("Списано бонусов: "+bonus);
    if(debt)App.toast("В долг: "+money(debt));
    ACT.posClear();App.closeModal();App.toast("Продажа проведена");
    await App.reload(["sales","products","cashops","units","debts","bonusops","deals"]);
    if(App.byId("sales",id))ACT.openSale(id);
  }catch(e){btn.disabled=false;btn.textContent="Провести продажу";App.toast(e.message||"Ошибка продажи")}
};
App.saleText=function(s){
  const st=App.settings(),c=App.cust(s.customerId)||{};
  const lines=(s.items||[]).map(i=>`${i.name}${i.serial?" ("+App.codeLbl(i.productId)+" "+i.serial+")":""}\n   ${i.qty} × ${money(i.price)}${num(i.disc)?" − "+money(i.disc):""} = ${money(i.qty*i.price-num(i.disc))}${i.warranty?"  гарантия "+i.warranty+" мес.":""}`).join("\n");
  return [`${st.shopName}${st.city?" · "+st.city:""}${st.address?", "+st.address:""}${st.phone?" · "+st.phone:""}`,st.inn?"ИНН "+st.inn:"",
    `ТОВАРНЫЙ ЧЕК № ${s.num} от ${App.dtt(s.createdAt)}`,c.name?`Покупатель: ${c.name} ${c.phone||""}`:"","",lines,"",
    num(s.discount)?`Скидка: −${money(s.discount)}`:"",s.tradeIn?`Trade-in (${s.tradeIn.device}): −${money(s.tradeIn.amount)}`:"",
    `ИТОГО: ${money(s.total)}`,`Оплата: ${App.paysText(s.payments)||"—"}`,`Продавец: ${App.nameOf(s.by)}`,"",st.receiptFooter].filter((x,i,a)=>x!==""||a[i-1]!=="").join("\n");
};

/* ---------- смены ---------- */
ACT.openShiftDlg=()=>{
  if(!App.point())return App.toast("Нет торговой точки");
  if(!App.can("shift"))return App.toast("Нет права открывать смену");
  if(App.openShift())return App.toast("Смена уже открыта");
  const last=App.sortDesc(S.shifts.filter(s=>s.pointId===App.point().id),"closedAt").find(s=>s.status==="closed");
  App.openModal(App.head("Открыть смену")+`<div class="form">${App.fld("shCash","Наличные в кассе на начало, ₽",App.inp("shCash",last?num(last.countedCash):0,"number"))}${App.fld("shNote","Комментарий",App.inp("shNote"))}</div>
  ${last?`<p class="muted">При закрытии прошлой смены ${esc(last.num)} было ${money(last.countedCash)}.</p>`:""}
  <div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="openShiftOk">Открыть</button></div>`);
};
ACT.openShiftOk=async(_,btn)=>{
  const p=App.point();if(!p)return App.toast("Выберите точку");if(btn.disabled)return;btn.disabled=true;
  try{const d=await App.api.insert("shifts",{point_id:p.id,open_cash:num(App.val("shCash"))});
    await App.api.audit("Открытие смены",d.num,p.name+" · в кассе "+money(App.val("shCash")));
    App.closeModal();App.toast("Смена "+d.num+" открыта");App.reload(["shifts"]);
  }catch(e){btn.disabled=false;App.toast(e.message)}
};
ACT.cashMove=dir=>{
  const sh=App.openShift();if(!sh)return App.toast("Смена закрыта");
  if(dir==="out"&&!App.can("cashout"))return App.toast("Изъятие делает управляющий или владелец");
  App.openModal(App.head(dir==="in"?"Внесение наличных":"Изъятие наличных")+`<div class="form">${App.fld("cmSum","Сумма, ₽",App.inp("cmSum","","number"))}${App.fld("cmNote","Основание",App.inp("cmNote","",dir==="in"?"Размен":"Инкассация, оплата курьеру…"))}</div>
  <div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="cashMoveOk" data-id="${dir}">Провести</button></div>`);
};
ACT.cashMoveOk=async(dir,btn)=>{
  const a=num(App.val("cmSum"));if(a<=0)return App.toast("Укажите сумму");
  const sh=App.openShift();
  if(dir==="out"&&a>App.shiftTotals(sh).expectedCash)return App.toast("В кассе нет столько наличных");
  if(!App.val("cmNote"))return App.toast("Укажите основание");
  if(btn.disabled)return;btn.disabled=true;
  try{await App.api.insert("cash_ops",{point_id:sh.pointId,shift_id:sh.id,type:dir==="in"?"cashin":"cashout",method:"cash",amount:dir==="in"?a:-a,ref:sh.num,note:App.val("cmNote")});
    await App.api.audit(dir==="in"?"Внесение":"Изъятие",sh.num,money(a)+" · "+App.val("cmNote"));
    App.closeModal();App.toast("Проведено");App.reload(["cashops"]);
  }catch(e){btn.disabled=false;App.toast(e.message)}
};
function shiftReport(sh,title){
  const t=App.shiftTotals(sh);
  return [`${title} · смена ${sh.num}`,`Открыта: ${App.dtt(sh.openedAt)} · ${App.nameOf(sh.openedBy)}`,sh.closedAt?`Закрыта: ${App.dtt(sh.closedAt)} · ${App.nameOf(sh.closedBy)}`:"","",
    `Чеков продажи: ${t.count}`,`Продажи: ${money(t.sales)}`,`Возвраты: −${money(t.refunds)}`,`Ремонт (оплаты и предоплаты): ${money(t.repairs)}`,...(t.preorders?[`Предоплаты за предзаказы: ${money(t.preorders)}`]:[]),"",
    "По способам оплаты:",...Object.entries(App.PAY).map(([m,l])=>`  ${l}: ${money(t.byPay[m]||0)}`),"",
    `Наличные на начало: ${money(sh.openCash)}`,`Внесения: ${money(t.cashin)}`,`Изъятия: −${money(t.cashout)}`,`Должно быть наличных: ${money(t.expectedCash)}`,
    sh.status==="closed"?`Пересчитано: ${money(sh.countedCash)} · расхождение: ${money(sh.diff)}`:""].filter(x=>x!=="" ).join("\n");
}
/* отчёт смены таблицей — читается быстрее, чем текст */
function shiftHtml(sh){const t=App.shiftTotals(sh),R=(l,v,cls="")=>`<div class="srow ${cls}"><span>${l}</span><b>${v}</b></div>`;
  const pays=Object.entries(App.PAY).filter(([m])=>num(t.byPay[m])).map(([m,l])=>R(l,money(t.byPay[m])));
  return `<div class="srep"><p class="muted">Открыта ${App.dtt(sh.openedAt)} · ${esc(App.nameOf(sh.openedBy))}${sh.closedAt?` · закрыта ${App.dtt(sh.closedAt)} · ${esc(App.nameOf(sh.closedBy))}`:""}</p>
    <section><h3>Выручка</h3>${R("Продажи · "+App.nw(t.count,"чек","чека","чеков"),money(t.sales))}${t.refunds?R("Возвраты","−"+money(t.refunds),"badc"):""}${t.repairs?R("Ремонт: оплаты и предоплаты",money(t.repairs)):""}${t.preorders?R("Предоплаты за предзаказы",money(t.preorders)):""}</section>
    ${pays.length?`<section><h3>Как платили клиенты</h3>${pays.join("")}</section>`:""}${t.payouts?`<section><h3>Выплаты не из кассы</h3>${R("Выкуп, комиссия и др. безналом",money(t.payouts))}</section>`:""}
    <section><h3>Наличные в кассе</h3>${R("На начало смены",money(sh.openCash))}${t.cashin?R("Внесли",money(t.cashin)):""}${t.cashout?R("Изъяли","−"+money(t.cashout)):""}${R("Должно быть в ящике",money(t.expectedCash),"tot")}
      ${sh.status==="closed"?R("Пересчитали",money(sh.countedCash))+R("Расхождение",(sh.diff>0?"+":"")+money(sh.diff),Math.abs(num(sh.diff))<1?"okc":"badc"):""}</section>
    ${sh.closeNote?`<p class="muted">Комментарий: ${esc(sh.closeNote)}</p>`:""}</div>`}
App.shiftModal=(sh,title)=>App.openModal(App.head(esc(title))+shiftHtml(sh)+`<pre id="copytext" hidden>${esc(shiftReport(sh,title)+(sh.closeNote?"\nКомментарий: "+sh.closeNote:""))}</pre>
  <div class="acts"><button class="btn" data-act="printShift" data-id="${esc(sh.id)}">Печать A4</button><button class="btn" data-act="copy">Скопировать текстом</button><button class="btn pri" data-act="close">Готово</button></div>`);
ACT.xReport=()=>{const sh=App.openShift();if(sh)App.shiftModal(sh,"X-отчёт · смена "+sh.num)};
ACT.closeShift=()=>{
  const sh=App.openShift();if(!sh)return;
  const t=App.shiftTotals(sh);
  App.openModal(App.head("Закрыть смену "+esc(sh.num))+`${shiftHtml(sh)}
  <div class="form">${App.fld("csCash","Пересчитанные наличные, ₽",App.inp("csCash","","number",String(Math.round(t.expectedCash))))}<div class="fld"><label>Расхождение</label><b id="csDiff" class="big-n">—</b></div>
  ${App.fld("csNote","Комментарий (обязательно при расхождении)",App.inp("csNote"),"full")}</div>
  <div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="closeShiftOk">Закрыть смену</button></div>`);
  $("#csCash").addEventListener("input",()=>{const d=num(App.val("csCash"))-t.expectedCash;$("#csDiff").textContent=(d>0?"+":"")+money(d)+(Math.abs(d)<1?" · сходится":d>0?" · излишек":" · недостача");$("#csDiff").className="big-n "+(Math.abs(d)<1?"ok":"bad")});
};
ACT.closeShiftOk=async(_,btn)=>{
  const sh=App.openShift();const t=App.shiftTotals(sh);
  if(App.val("csCash")==="")return App.toast("Пересчитайте наличные и введите сумму");
  const counted=num(App.val("csCash")),diff=counted-t.expectedCash;
  if(Math.abs(diff)>=1&&!App.val("csNote"))return App.toast("Опишите причину расхождения");
  if(btn.disabled)return;btn.disabled=true;
  try{await App.api.rpc("close_shift",{p_point:sh.pointId,p_counted:counted,p_note:App.val("csNote")||null},["shifts"]);
    await App.api.audit("Закрытие смены",sh.num,"наличных "+money(counted)+(Math.abs(diff)>=1?" · расхождение "+money(diff):""));
    App.closeModal();App.toast("Смена "+sh.num+" закрыта");App.reload(["shifts"]);
  }catch(e){btn.disabled=false;App.toast(e.message)}
};
ACT.openShift=id=>{const sh=App.byId("shifts",id);if(sh)App.shiftModal(sh,(sh.status==="open"?"X-отчёт":"Z-отчёт")+" · смена "+sh.num)};

/* ======================= ПРОДАЖИ ======================= */
TITLES.sales="Продажи";
App.ui.salesPeriod="month";App.ui.salesQ="";App.ui.salesPay="";App.ui.salesTab="sales";
App.periodRange=function(p,from,to){
  const d0=new Date(new Date().toDateString()),tom=new Date(+d0+864e5);
  switch(p){case"today":return[d0,tom];case"yesterday":return[new Date(+d0-864e5),d0];case"7d":return[new Date(+d0-6*864e5),tom];
    case"month":return[new Date(d0.getFullYear(),d0.getMonth(),1),tom];case"prev":return[new Date(d0.getFullYear(),d0.getMonth()-1,1),new Date(d0.getFullYear(),d0.getMonth(),1)];
    case"custom":return[from?new Date(from):new Date(0),to?new Date(+new Date(to)+864e5):tom];default:return[new Date(0),tom]}
};
App.PERIODS=[["today","Сегодня"],["yesterday","Вчера"],["7d","7 дней"],["month","Этот месяц"],["prev","Прошлый месяц"],["all","Всё время"]];
VIEWS.sales={
  ownSearch:true,
  actions:()=>'<button class="btn" data-act="printView">Печать</button>'+(App.can("sale")?'<a class="btn pri" href="#pos">+ Новая продажа</a>':""),
  render(){
    const u=App.ui,[from,to]=App.periodRange(u.salesPeriod);
    const q=u.salesQ.toLowerCase();
    const tabs=`<div class="tabs">${[["sales","Чеки"],["returns","Возвраты"],["shifts","Смены"],["cash","Кассовые операции"],...(App.evoOn&&App.evoOn()?[["evotor","Сверка с Эвотором"]]:[])].map(([k,l])=>`<button class="tab ${u.salesTab===k?"on":""}" data-act="salesTab" data-id="${k}">${l}</button>`).join("")}</div>`;
    const filt=`<div class="row-f">${App.sel("salesPeriod",App.PERIODS,u.salesPeriod,'data-filter-sel="salesPeriod" aria-label="Период"')}${u.salesTab==="sales"?App.sel("salesPay",[["","Любая оплата"],...Object.entries(App.PAY)],u.salesPay,'data-filter-sel="salesPay" aria-label="Оплата"'):""}<input id="salesQ" type="search" placeholder="№, клиент, товар" value="${esc(u.salesQ)}" data-filter="salesQ" aria-label="Поиск"></div>`;
    const inP0=d=>{const t=new Date(d);return t>=from&&t<to};
    const myPt=App.can("allPoints")?null:(App.point()||{}).id;
    const inP=(d,x)=>inP0(d)&&(!myPt||!x||x.pointId===myPt||(App.byId("sales",x.saleId)||{}).pointId===myPt);
    let body="";
    if(u.salesTab==="sales"){
      const list=App.sortDesc(S.sales.filter(s=>inP(s.createdAt,s)&&(!u.salesPay||(s.payments||[]).some(p=>p.method===u.salesPay))&&(!q||[s.num,(App.cust(s.customerId)||{}).name,(App.cust(s.customerId)||{}).phone,(s.items||[]).map(i=>i.name+" "+i.serial).join(" ")].join(" ").toLowerCase().includes(q))));
      const sum=list.reduce((a,s)=>a+num(s.total),0);
      body=`<div class="tiles"><div class="tile"><span>Чеков</span><b>${list.length}</b></div><div class="tile"><span>Сумма</span><b>${money(sum)}</b></div><div class="tile"><span>Средний чек</span><b>${money(list.length?sum/list.length:0)}</b></div>${App.can("cost")?`<div class="tile"><span>Прибыль</span><b>${money(list.reduce((a,s)=>a+App.saleProfit(s),0))}</b></div>`:""}</div>
      <section class="card"><div class="tbl-wrap"><table class="stbl"><thead><tr><th>№</th><th>Дата</th><th>Клиент</th><th>Товары</th><th>Оплата</th><th>Продавец</th><th class="n">Сумма</th></tr></thead><tbody>
      ${list.map(s=>{const c=App.cust(s.customerId);return `<tr class="rowlink" data-act="openSale" data-id="${esc(s.id)}"><td><b>${esc(s.num)}</b>${s.status==="returned"?' <span class="pill bad">возврат</span>':s.status==="partial"?' <span class="pill warn">частичный возврат</span>':""}</td><td>${App.dtt(s.createdAt)}</td><td>${esc(c?c.name:"—")}<span class="sub">${esc(c?c.phone:"")}</span></td><td>${esc((s.items||[]).map(i=>i.name+(i.qty>1?" ×"+i.qty:"")).join(", "))}${s.tradeIn?'<span class="sub">Trade-in: '+esc(s.tradeIn.device)+"</span>":""}</td><td>${esc(App.paysText(s.payments))}</td><td>${esc(App.nameOf(s.by))}</td><td class="n"><b>${money(s.total)}</b></td></tr>`}).join("")||'<tr><td colspan="7" class="empty">Нет продаж за период</td></tr>'}
      </tbody></table></div></section>`;
    }else if(u.salesTab==="evotor"&&App.evoView){
      body=App.evoView(from,to,myPt);
    }else if(u.salesTab==="returns"){
      const list=App.sortDesc(S.returns.filter(r=>inP(r.createdAt,r)&&(!q||[r.num,r.saleNum,r.reason].join(" ").toLowerCase().includes(q))));
      body=`<section class="card"><div class="tbl-wrap"><table><thead><tr><th>№</th><th>Дата</th><th>Продажа</th><th>Товары</th><th>Причина</th><th>Куда</th><th>Возврат денег</th><th class="n">Сумма</th></tr></thead><tbody>
      ${list.map(r=>`<tr class="rowlink" data-act="openSale" data-id="${esc(r.saleId)}"><td><b>${esc(r.num)}</b></td><td>${App.dtt(r.createdAt)}</td><td>${esc(r.saleNum)}</td><td>${esc((r.items||[]).map(i=>i.name+" ×"+i.qty).join(", "))}</td><td>${esc(r.reason)}</td><td>${r.defect?'<span class="pill bad">списан как брак</span>':esc(App.whName(r.whId))}</td><td>${esc(App.payLabel(r.method))}</td><td class="n"><b>${money(r.amount)}</b></td></tr>`).join("")||'<tr><td colspan="8" class="empty">Возвратов нет</td></tr>'}
      </tbody></table></div></section>`;
    }else if(u.salesTab==="shifts"){
      const list=App.sortDesc(S.shifts.filter(s=>inP(s.openedAt,s)),"openedAt");
      body=`<section class="card"><div class="tbl-wrap"><table><thead><tr><th>Смена</th><th>Открыта</th><th>Закрыта</th><th class="n">Продажи</th><th class="n">Наличные ожид.</th><th class="n">Пересчитано</th><th class="n">Расхождение</th></tr></thead><tbody>
      ${list.map(s=>{const t=App.shiftTotals(s);const exp=s.status==="open"?App.shiftTotals(s).expectedCash:s.expectedCash;return `<tr class="rowlink" data-act="openShift" data-id="${esc(s.id)}"><td><b>${esc(s.num)}</b> ${s.status==="open"?'<span class="pill ok">открыта</span>':""}<span class="sub">${esc(App.pointName(s.pointId))}</span></td><td>${App.dtt(s.openedAt)}<span class="sub">${esc(App.nameOf(s.openedBy))}</span></td><td>${App.dtt(s.closedAt)}<span class="sub">${s.closedBy?esc(App.nameOf(s.closedBy)):""}</span></td><td class="n">${money(t.sales)}</td><td class="n">${money(exp)}</td><td class="n">${s.status==="closed"?money(s.countedCash):"—"}</td><td class="n">${s.status==="closed"?`<span class="pill ${Math.abs(num(s.diff))<1?"ok":"bad"}">${money(s.diff)}</span>`:"—"}</td></tr>`}).join("")||'<tr><td colspan="7" class="empty">Смен нет</td></tr>'}
      </tbody></table></div></section>`;
    }else{
      const list=App.sortDesc(S.cashops.filter(o=>inP(o.at,o)&&(!q||[o.ref,o.note].join(" ").toLowerCase().includes(q))),"at");
      body=`<section class="card"><div class="tbl-wrap"><table><thead><tr><th>Когда</th><th>Операция</th><th>Способ</th><th>Основание</th><th>Кто</th><th class="n">Сумма</th></tr></thead><tbody>
      ${list.slice(0,300).map(o=>`<tr><td>${App.dtt(o.at)}</td><td>${esc(App.CASHOP[o.type]||o.type)}</td><td>${esc(App.payLabel(o.method))}</td><td>${esc(o.ref)}${o.note?'<span class="sub">'+esc(o.note)+"</span>":""}</td><td>${esc(App.nameOf(o.by))}</td><td class="n"><span class="pill ${num(o.amount)>=0?"ok":"bad"}">${num(o.amount)>0?"+":""}${money(o.amount)}</span></td></tr>`).join("")||'<tr><td colspan="6" class="empty">Операций нет</td></tr>'}
      </tbody></table></div></section>`;
    }
    return tabs+filt+body;
  }
};
ACT.salesTab=k=>{App.ui.salesTab=k;App.render()};

ACT.openSale=id=>{
  const draw=()=>{
    const s=App.byId("sales",id);if(!s)return App.closeModal();
    const c=App.cust(s.customerId),rets=S.returns.filter(r=>r.saleId===id);
    const canRet=App.can("ret")&&(s.items||[]).some(i=>num(i.qty)-App.returnedQty(id,i.productId,i.line)>0);
    App.redrawModal(App.head("Продажа "+esc(s.num),s.status==="returned"?'<span class="pill bad">возвращена</span>':s.status==="partial"?'<span class="pill warn">частичный возврат</span>':"")+`
    <dl class="kv"><dt>Дата</dt><dd>${App.dtt(s.createdAt)}</dd><dt>Клиент</dt><dd>${c?`<button class="btn sm" data-act="openClient" data-id="${esc(c.id)}">${esc(c.name)}</button> ${esc(c.phone)}`:"—"}</dd>
    <dt>Склад</dt><dd>${esc(App.whName(s.whId))}</dd><dt>Продавец</dt><dd>${esc(App.nameOf(s.by))}</dd>${App.evoBadge?App.evoBadge(s):""}<dt>Оплата</dt><dd>${esc(App.paysText(s.payments))}</dd>
    ${s.tradeIn?`<dt>Trade-in</dt><dd>${esc(s.tradeIn.device)} · ${money(s.tradeIn.amount)}</dd>`:""}</dl>
    <div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Кол-во</th><th class="n">Цена</th><th class="n">Скидка</th><th class="n">Сумма</th><th class="n">Возвращено</th></tr></thead><tbody>
    ${(s.items||[]).map(i=>`<tr><td>${esc(i.name)}${i.serial?'<span class="sub">'+App.codeLbl(i.productId)+" "+esc(i.serial)+"</span>":""}</td><td class="n">${i.qty}</td><td class="n">${money(i.price)}</td><td class="n">${num(i.disc)?money(i.disc):"—"}</td><td class="n">${money(i.qty*i.price-num(i.disc))}</td><td class="n">${App.returnedQty(id,i.productId,i.line)||"—"}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="sumlines"><span>Скидка на чек</span><span>${money(s.discount)}</span><span><b>Итого</b></span><span><b>${money(s.total)}</b></span>${App.can("cost")?`<span>Прибыль</span><span>${money(App.saleProfit(s))}</span>`:""}</div>
    ${rets.length?`<h3 class="sub-h">Возвраты</h3><div class="hist">${rets.map(r=>`<span>${esc(r.num)} · ${App.dtt(r.createdAt)} · ${esc((r.items||[]).map(i=>i.name+" ×"+i.qty).join(", "))} · ${money(r.amount)} · ${esc(r.reason)} <button class="btn sm ghost" data-act="printReturn" data-id="${esc(r.id)}">Печать акта</button></span>`).join("")}</div>`:""}
    <div class="acts"><button class="btn pri" data-act="printReceipt" data-id="${esc(id)}|a4">Товарный чек A4</button><button class="btn" data-act="printReceipt" data-id="${esc(id)}|80">Чек 80 мм</button><button class="btn" data-act="saleReceipt" data-id="${esc(id)}">Текст</button>${(s.items||[]).some(i=>num(i.warranty)>0||i.serial)?`<button class="btn" data-act="printWarranty" data-id="${esc(id)}">Гарантийный талон</button>`:""}${canRet?`<button class="btn danger" data-act="returnDlg" data-id="${esc(id)}">Возврат</button>`:""}</div>`);
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
ACT.saleReceipt=id=>{const s=App.byId("sales",id);App.textModal("Чек "+s.num,App.saleText(s))};

/* ---------- возврат ---------- */
ACT.returnDlg=id=>{
  const s=App.byId("sales",id);if(!s)return;
  const lines=(s.items||[]).map(i=>Object.assign({},i,{left:num(i.qty)-App.returnedQty(id,i.productId,i.line)})).filter(i=>i.left>0);
  const sub=num(s.subtotal)||(s.items||[]).reduce((a,i)=>a+i.qty*i.price-num(i.disc),0);
  const k=sub?(num(s.total)+num(s.tradeIn&&s.tradeIn.amount))/sub:1; // доля чековой скидки
  const unit=i=>(num(i.price)-num(i.disc)/Math.max(1,num(i.qty)))*k;
  const firstPay=((s.payments||[])[0]||{}).method||"cash";
  App.openModal(App.head("Возврат по продаже "+esc(s.num))+`
    <div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Можно</th><th class="n">Вернуть</th><th class="n">К возврату</th></tr></thead><tbody>
    ${lines.map((i,n)=>`<tr><td>${esc(i.name)}</td><td class="n">${i.left}</td><td class="n"><input type="number" min="0" max="${i.left}" value="${lines.length===1?i.left:0}" id="rq${n}" data-unit="${unit(i)}" aria-label="Количество к возврату"></td><td class="n" id="rs${n}">—</td></tr>`).join("")}
    </tbody></table></div>
    <div class="form">
      ${App.fld("rReason","Причина",App.sel("rReason",App.RETURN_REASONS))}
      ${App.fld("rWh","Куда товар",App.sel("rWh",[...App.whs().map(w=>[w.id,w.name]),["__defect","Не на склад: списать как брак"]],s.whId))}
      ${App.fld("rMethod","Как вернуть деньги",App.sel("rMethod",Object.entries(App.PAY),firstPay))}
      ${App.fld("rAmount","Сумма возврата, ₽",App.inp("rAmount","","number","",App.can("price")?"":"disabled"))}
      ${App.fld("rNote","Комментарий",App.inp("rNote"),"full")}
    </div>
    ${s.tradeIn?'<p class="muted">В чеке был trade-in: сумма возврата пересчитана с учётом зачёта, проверьте её.</p>':""}
    <div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri danger-bg" data-act="returnOk" data-id="${esc(id)}">Оформить возврат</button></div>`);
  const upd=()=>{let tot=0;lines.forEach((i,n)=>{const q=Math.min(i.left,Math.max(0,num(App.val("rq"+n))));const v=Math.round(q*unit(i));tot+=v;$("#rs"+n).textContent=money(v)});$("#rAmount").value=Math.round(tot)};
  document.querySelectorAll("#modal [id^=rq]").forEach(el=>el.addEventListener("input",upd));upd();
  ACT.returnOk=async(_,btn)=>{
    const items=lines.map((i,n)=>({sale_item_id:i.line,qty:Math.min(i.left,Math.max(0,Math.floor(num(App.val("rq"+n)))))})).filter(i=>i.qty>0);
    if(!items.length)return App.toast("Укажите количество к возврату");
    const amount=num(App.val("rAmount")),method=App.val("rMethod"),wh=App.val("rWh"),defect=wh==="__defect";
    const sh=App.openShift(s.pointId);
    if(method==="cash"&&!sh)return App.toast("Наличный возврат требует открытой смены на точке продажи");
    if(method==="cash"&&sh&&amount>App.shiftTotals(sh).expectedCash)return App.toast("В кассе недостаточно наличных для возврата");
    if(btn.disabled)return;btn.disabled=true;
    try{
      await App.api.rpc("create_return",{p_sale:s.id,p_items:items,p_amount:amount,p_method:method,p_reason:App.val("rReason"),p_wh:defect?null:wh,p_defect:defect,p_note:App.val("rNote")||null},
        ["returns","sales","stock","stock_movements","cash_ops","audit_log","units"]);
      App.closeModal();App.toast("Возврат оформлен");
    }catch(e){btn.disabled=false;App.toast(e.message)}
  };
};
})();
