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
      <div class="tile"><span>Выручка сегодня</span><b>${money(t.rev)}</b><small>${t.count} чеков · ремонтов ${t.reps.length}</small></div>
      <div class="tile"><span>Выручка за месяц</span><b>${money(m.rev)}</b><small>${showProfit?"прибыль "+money(m.profit):"средний чек "+money(m.avg)}</small></div>
      <a class="tile click" href="#pos"><span>Касса</span><b>${sh?money(App.shiftTotals(sh).expectedCash):"закрыта"}</b><small>${sh?"наличных в смене "+esc(sh.num):"откройте смену"}</small></a>
      ${hasRep?`<a class="tile click" href="#repairs"><span>Ремонт в работе</span><b>${act.length}</b><small>${ready.length} готовы · ${waitParts.length} ждут запчасть</small></a>
      <button class="tile click ${late.length?"alert":""}" data-act="repFilter" data-id="late"><span>Просрочено</span><b>${late.length}</b><small>${stored.length?stored.length+" на хранении дольше "+App.settings().storageDays+" дн.":"срок ремонта прошёл"}</small></button>`:""}
      <button class="tile click ${low.length?"alert":""}" data-act="lowStock"><span>Заканчивается</span><b>${low.length}</b><small>товаров ниже минимума</small></button>
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
ACT.lowStock=()=>{App.ui.stockLow=true;App.ui.stockCat="";location.hash="stock";App.render()};

/* ======================= КАССА ======================= */
App.pos={cart:[],phone:"",name:"",discPct:0,discSum:0,tiDev:"",tiAmt:0,tiImei:"",whId:null,manualPct:false};
const P=App.pos;
App.pointWhOpts=()=>{const p=App.point();const ws=App.whs().filter(w=>p&&w.pointId===p.id);return (ws.length?ws:App.whs()).map(w=>[w.id,w.name])};
const posWh=()=>P.whId&&App.pointWhOpts().some(o=>o[0]===P.whId)?P.whId:App.cashWh();
function posTotals(){
  const sub=P.cart.reduce((a,i)=>a+num(i.qty)*num(i.price)-num(i.disc),0);
  const disc=Math.round(sub*num(P.discPct)/100)+num(P.discSum);
  const total=Math.max(0,sub-disc-num(P.tiAmt));
  return{sub,disc,total};
}
TITLES.pos="Касса";
VIEWS.pos={
  actions(){const sh=App.openShift();return sh?`<button class="btn" data-act="cashMove" data-id="in">Внесение</button>${App.can("cashout")?'<button class="btn" data-act="cashMove" data-id="out">Изъятие</button>':""}<button class="btn" data-act="xReport">X-отчёт</button><button class="btn" data-act="closeShift">Закрыть смену</button>`:`<button class="btn pri" data-act="openShiftDlg">Открыть смену</button>`},
  render(){
    const sh=App.openShift(),wh=posWh(),t=posTotals(),c=App.findCustomerByPhone(P.phone);
    const st=App.settings();
    if(!App.point())return '<div class="card empty">Нет торговых точек. Владелец добавляет их в «Настройки → Точки и склады».</div>';
    const shiftBar=sh?`<div class="shiftbar ok"><b>Смена ${esc(sh.num)}</b> открыта ${App.dtt(sh.openedAt)} · ${esc(App.nameOf(sh.openedBy))} · наличных в кассе ≈ <b>${money(App.shiftTotals(sh).expectedCash)}</b>${!App.sameDay(sh.openedAt,new Date())?' <span class="pill warn">открыта не сегодня, закройте её</span>':""}</div>`
      :`<div class="shiftbar ${st.requireShift?"bad":""}"><b>Смена закрыта.</b> ${st.requireShift?"Продажи и наличные операции недоступны, пока смена не открыта.":"Продажи без смены разрешены настройками, но наличные операции требуют смены."} <button class="btn sm pri" data-act="openShiftDlg">Открыть смену</button></div>`;
    const quick=S.products.filter(p=>!p.archived&&App.qtyIn(p,wh)>0&&(!App.ui.posCat||App.inCat(p,App.ui.posCat))).sort((a,b)=>String(a.name).localeCompare(b.name)).slice(0,40);
    const cats=App.catChildren("").filter(cg=>S.products.some(p=>App.inCat(p,cg.id)&&App.qtyIn(p,wh)>0));
    return `${shiftBar}
    <div class="pos">
      <section class="card">
        <div class="row-f"><div class="fld grow"><label for="posQ">Товар: название, артикул, штрихкод или IMEI (сканер + Enter)</label><input id="posQ" type="search" autocomplete="off" placeholder="Начните вводить или отсканируйте"><div class="pick" id="posPick" hidden></div></div>
        ${App.fld("posWh","Склад продажи",App.sel("posWh",App.pointWhOpts(),wh,'data-pos="whId"'))}</div>
        <div class="chips" style="margin:12px 0"><button class="chip ${!App.ui.posCat?"on":""}" data-act="posCat" data-id="">Все</button>${cats.map(cg=>`<button class="chip ${App.ui.posCat===cg.id?"on":""}" data-act="posCat" data-id="${esc(cg.id)}">${esc(cg.name)}</button>`).join("")}</div>
        <div class="tilegrid">${quick.map(p=>`<button class="ptile" data-act="posAdd" data-id="${esc(p.id)}"><span>${esc(p.name)}</span><small>${esc(p.condition||"")} · ${App.qtyIn(p,wh)} шт</small><b>${money(p.price)}</b></button>`).join("")||'<div class="empty">На этом складе нет товаров в наличии</div>'}</div>
      </section>
      <section class="card cartcard">
        <div class="card-h"><h2>Чек</h2>${P.cart.length?'<button class="btn sm ghost danger" data-act="posClear">Очистить</button>':""}</div>
        <div class="form">
          ${App.fld("posPhone","Телефон клиента",App.inp("posPhone",P.phone,"tel","необязательно",'data-pos="phone" autocomplete="off"'))}
          ${App.fld("posName","Имя",App.inp("posName",P.name,"text","",'data-pos="name"'))}
        </div>
        ${c?`<div class="hint ${c.blacklisted?"bad":"ok"}" style="margin-top:6px">${c.blacklisted?'<span class="pill bad">Чёрный список</span> '+esc(c.blackReason||"")+" · ":""}${esc(c.name)} · покупок ${S.sales.filter(s=>s.customerId===c.id).length}${num(c.discount)?" · скидка "+num(c.discount)+"%":""}${(c.tags||[]).length?" · "+esc(c.tags.join(", ")):""}</div>`:App.phoneKey(P.phone).length===10?'<div class="hint" style="margin-top:6px">Новый клиент, добавится при продаже</div>':""}
        <div class="tbl-wrap" style="margin-top:10px"><table class="cart"><thead><tr><th>Товар</th><th class="n">Кол-во</th><th class="n">Цена</th><th class="n">Скидка</th><th class="n">Сумма</th><th></th></tr></thead><tbody>
        ${P.cart.length?P.cart.map((i,k)=>{const p=App.byId("products",i.productId);const below=p&&num(i.price)-num(i.disc)/Math.max(1,num(i.qty))<num(p.cost);
          return `<tr><td>${esc(i.name)}${i.serial?'<span class="sub">IMEI '+esc(i.serial)+"</span>":""}${below?'<span class="sub bad">ниже закупки</span>':""}</td>
          <td class="n"><input type="number" min="1" value="${num(i.qty)}" data-cart="${k}" data-f="qty" id="cq${k}" aria-label="Количество" ${i.serial?"disabled":""}></td>
          <td class="n"><input type="number" min="0" value="${num(i.price)}" data-cart="${k}" data-f="price" id="cp${k}" aria-label="Цена" ${App.can("price")?"":"disabled"}></td>
          <td class="n"><input type="number" min="0" value="${num(i.disc)||""}" data-cart="${k}" data-f="disc" id="cd${k}" aria-label="Скидка на строку" placeholder="0"></td>
          <td class="n">${money(num(i.qty)*num(i.price)-num(i.disc))}</td><td class="n"><button class="btn sm ghost danger" data-act="posDel" data-id="${k}" aria-label="Убрать">✕</button></td></tr>`}).join(""):'<tr><td colspan="6" class="empty">Добавьте товар поиском, сканером или плиткой слева</td></tr>'}
        </tbody></table></div>
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
    </div>`;
  },
  after(){
    App.productPicker("posQ","posPick",{wh:posWh,inStock:false,onPick:p=>posAdd(p.id)});
    document.querySelectorAll("[data-pos]").forEach(el=>el.addEventListener("input",()=>{const f=el.dataset.pos;P[f]=["discPct","discSum","tiAmt"].includes(f)?num(el.value):el.value;
      if(f==="phone"){const c=App.findCustomerByPhone(P.phone);if(c){if(!P.name)P.name=c.name;if(!P.manualPct)P.discPct=num(c.discount)}}
      if(f==="discPct")P.manualPct=true;
      if(f==="whId"){P.cart=P.cart.filter(i=>{const p=App.byId("products",i.productId);return p&&App.qtyIn(p,el.value)>=num(i.qty)});}
      App.schedule()}));
    document.querySelectorAll("[data-cart]").forEach(el=>el.addEventListener("input",()=>{const i=P.cart[+el.dataset.cart];if(!i)return;const v=num(el.value);
      if(el.dataset.f==="qty"){const p=App.byId("products",i.productId),max=App.qtyIn(p,posWh());i.qty=Math.max(1,Math.min(v||1,max));if(v>max)App.toast("На складе только "+max)}else i[el.dataset.f]=Math.max(0,v);App.schedule()}));
  }
};
function posAdd(pid){
  const p=App.byId("products",pid),wh=posWh();if(!p)return;
  const have=App.qtyIn(p,wh);
  if(have<=0){const o=App.whereElse(p,wh);App.toast("Нет на складе «"+App.whName(wh)+"»"+(o?". Есть: "+o+" — сделайте перемещение":""));return}
  const ex=P.cart.find(i=>i.productId===pid);
  if(ex){if(ex.qty>=have){App.toast("На складе только "+have);return}ex.qty++}
  else P.cart.push({line:App.uid("ln"),productId:pid,name:p.name,qty:1,price:num(p.price),cost:num(p.cost),disc:0,serial:p.serial||"",warranty:App.isDevice(p)?(num(p.warrantyMonths)||App.settings().deviceWarrantyMonths):num(p.warrantyMonths)});
  App.schedule();
}
ACT.posAdd=posAdd;
ACT.posDel=k=>{P.cart.splice(+k,1);App.schedule()};
ACT.posClear=()=>{Object.assign(P,{cart:[],phone:"",name:"",discPct:0,discSum:0,tiDev:"",tiAmt:0,tiImei:"",manualPct:false});App.schedule()};
ACT.posCat=id=>{App.ui.posCat=id;App.render()};
ACT.saleFor=id=>{const c=App.cust(id);ACT.posClear();P.phone=c.phone;P.name=c.name;P.discPct=num(c.discount);location.hash="pos";App.render()};

ACT.posPay=()=>{
  if(!App.can("sale"))return App.toast("Нет права проводить продажи");
  if(!P.cart.length)return;
  const sh=App.openShift();if(!sh&&App.settings().requireShift)return App.toast("Сначала откройте смену");
  const t=posTotals();
  for(const i of P.cart){const p=App.byId("products",i.productId);if(p&&num(i.price)-num(i.disc)/Math.max(1,num(i.qty))<num(p.cost)&&!App.can("belowCost"))return App.toast("«"+i.name+"» дешевле закупки: продать так может только управляющий")}
  const c=App.findCustomerByPhone(P.phone);
  App.openModal(App.head("Оплата · "+money(t.total))+`
    ${c&&c.blacklisted?`<div class="banner err">Клиент в чёрном списке: ${esc(c.blackReason||"без причины")}</div>`:""}
    <div class="paygrid">${Object.entries(App.PAY).map(([m,l])=>`<div class="fld"><label for="pay_${m}">${l}</label><div class="row-f">${App.inp("pay_"+m,"","number","0")}<button class="btn sm" data-act="payAll" data-id="${m}">Всё</button></div></div>`).join("")}</div>
    <div class="form" style="margin-top:10px">${App.fld("payGot","Получено наличными (для сдачи)",App.inp("payGot","","number"))}<div class="fld"><label>Сдача</label><b id="payChange" class="big-n">—</b></div></div>
    <div class="total"><span>Осталось распределить</span><b id="payLeft">${money(t.total)}</b></div>
    ${App.fld("payWarr","Гарантия на устройства, мес.",App.inp("payWarr",App.settings().deviceWarrantyMonths,"number"))}
    <div class="acts"><button class="btn" data-act="close">Назад</button><button class="btn pri" data-act="posConfirm" id="payOk">Провести продажу</button></div>`);
  const upd=()=>{const paid=Object.keys(App.PAY).reduce((a,m)=>a+num(App.val("pay_"+m)),0);const left=t.total-paid;
    $("#payLeft").textContent=money(left);$("#payLeft").className=Math.abs(left)<0.5?"ok":"bad";
    const got=num(App.val("payGot")),cash=num(App.val("pay_cash"));$("#payChange").textContent=got?money(got-cash):"—"};
  document.querySelectorAll("#modal input").forEach(el=>el.addEventListener("input",upd));
  ACT.payAll=m=>{Object.keys(App.PAY).forEach(k=>{document.getElementById("pay_"+k).value=k===m?t.total:""});upd()};
  if(t.total===0){upd()}
};
ACT.posConfirm=async(_,btn)=>{
  if(btn.disabled)return;
  const t=posTotals(),wh=posWh();
  const payments=Object.keys(App.PAY).map(m=>({method:m,amount:num(App.val("pay_"+m))})).filter(p=>p.amount);
  const paid=payments.reduce((a,p)=>a+p.amount,0);
  if(Math.abs(paid-t.total)>=0.5)return App.toast("Сумма оплат ("+money(paid)+") не равна сумме чека ("+money(t.total)+")");
  const sh=App.openShift();
  if(!sh&&(App.settings().requireShift||payments.some(p=>p.method==="cash")))return App.toast("Для этой оплаты нужна открытая смена");
  btn.disabled=true;btn.textContent="Проводим…";
  try{
    const customerId=(P.phone||P.name)?await App.api.customer(P.phone,P.name,"Магазин"):null;
    const items=P.cart.map(i=>({product_id:i.productId,qty:num(i.qty),price:num(i.price),discount:num(i.disc)}));
    const id=await App.api.rpc("create_sale",{p_wh:wh,p_customer:customerId,p_items:items,p_payments:payments,p_discount:t.disc,
      p_tradein_device:P.tiDev||null,p_tradein_amount:num(P.tiAmt),p_tradein_imei:P.tiImei||null},["sales","stock","stock_movements","cash_ops","products","audit_log"]);
    ACT.posClear();App.closeModal();App.toast("Продажа проведена");
    await App.reload(["sales","products","cashops"]);
    if(App.byId("sales",id))ACT.openSale(id);
  }catch(e){btn.disabled=false;btn.textContent="Провести продажу";App.toast(e.message||"Ошибка продажи")}
};
App.saleText=function(s){
  const st=App.settings(),c=App.cust(s.customerId)||{};
  const lines=(s.items||[]).map(i=>`${i.name}${i.serial?" (IMEI "+i.serial+")":""}\n   ${i.qty} × ${money(i.price)}${num(i.disc)?" − "+money(i.disc):""} = ${money(i.qty*i.price-num(i.disc))}${i.warranty?"  гарантия "+i.warranty+" мес.":""}`).join("\n");
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
    `Чеков продажи: ${t.count}`,`Продажи: ${money(t.sales)}`,`Возвраты: −${money(t.refunds)}`,`Ремонт (оплаты и предоплаты): ${money(t.repairs)}`,"",
    "По способам оплаты:",...Object.entries(App.PAY).map(([m,l])=>`  ${l}: ${money(t.byMethod[m]||0)}`),"",
    `Наличные на начало: ${money(sh.openCash)}`,`Внесения: ${money(t.cashin)}`,`Изъятия: −${money(t.cashout)}`,`Должно быть наличных: ${money(t.expectedCash)}`,
    sh.status==="closed"?`Пересчитано: ${money(sh.countedCash)} · расхождение: ${money(sh.diff)}`:""].filter(x=>x!=="" ).join("\n");
}
ACT.xReport=()=>{const sh=App.openShift();if(sh)App.textModal("X-отчёт",shiftReport(sh,"X-отчёт"))};
ACT.closeShift=()=>{
  const sh=App.openShift();if(!sh)return;
  const t=App.shiftTotals(sh);
  App.openModal(App.head("Закрыть смену "+esc(sh.num))+`<pre class="receipt">${esc(shiftReport(sh,"Итоги"))}</pre>
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
ACT.openShift=id=>{const sh=App.byId("shifts",id);if(sh)App.textModal("Смена "+sh.num,shiftReport(sh,sh.status==="open"?"X-отчёт":"Z-отчёт")+(sh.closeNote?"\nКомментарий: "+sh.closeNote:""))};

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
  actions:()=>(App.can("sale")?'<a class="btn pri" href="#pos">+ Новая продажа</a>':""),
  render(){
    const u=App.ui,[from,to]=App.periodRange(u.salesPeriod);
    const q=u.salesQ.toLowerCase();
    const tabs=`<div class="tabs">${[["sales","Чеки"],["returns","Возвраты"],["shifts","Смены"],["cash","Кассовые операции"]].map(([k,l])=>`<button class="tab ${u.salesTab===k?"on":""}" data-act="salesTab" data-id="${k}">${l}</button>`).join("")}</div>`;
    const filt=`<div class="row-f">${App.sel("salesPeriod",App.PERIODS,u.salesPeriod,'data-filter-sel="salesPeriod" aria-label="Период"')}${u.salesTab==="sales"?App.sel("salesPay",[["","Любая оплата"],...Object.entries(App.PAY)],u.salesPay,'data-filter-sel="salesPay" aria-label="Оплата"'):""}<input id="salesQ" type="search" placeholder="№, клиент, товар" value="${esc(u.salesQ)}" data-filter="salesQ" aria-label="Поиск"></div>`;
    const inP0=d=>{const t=new Date(d);return t>=from&&t<to};
    const myPt=App.can("allPoints")?null:(App.point()||{}).id;
    const inP=(d,x)=>inP0(d)&&(!myPt||!x||x.pointId===myPt||(App.byId("sales",x.saleId)||{}).pointId===myPt);
    let body="";
    if(u.salesTab==="sales"){
      const list=App.sortDesc(S.sales.filter(s=>inP(s.createdAt,s)&&(!u.salesPay||(s.payments||[]).some(p=>p.method===u.salesPay))&&(!q||[s.num,(App.cust(s.customerId)||{}).name,(App.cust(s.customerId)||{}).phone,(s.items||[]).map(i=>i.name+" "+i.serial).join(" ")].join(" ").toLowerCase().includes(q))));
      const sum=list.reduce((a,s)=>a+num(s.total),0);
      body=`<div class="tiles"><div class="tile"><span>Чеков</span><b>${list.length}</b></div><div class="tile"><span>Сумма</span><b>${money(sum)}</b></div><div class="tile"><span>Средний чек</span><b>${money(list.length?sum/list.length:0)}</b></div>${App.can("cost")?`<div class="tile"><span>Прибыль</span><b>${money(list.reduce((a,s)=>a+App.saleProfit(s),0))}</b></div>`:""}</div>
      <section class="card"><div class="tbl-wrap"><table><thead><tr><th>№</th><th>Дата</th><th>Клиент</th><th>Товары</th><th>Оплата</th><th>Продавец</th><th class="n">Сумма</th></tr></thead><tbody>
      ${list.map(s=>{const c=App.cust(s.customerId);return `<tr class="rowlink" data-act="openSale" data-id="${esc(s.id)}"><td><b>${esc(s.num)}</b>${s.status==="returned"?' <span class="pill bad">возврат</span>':s.status==="partial"?' <span class="pill warn">частичный возврат</span>':""}</td><td>${App.dtt(s.createdAt)}</td><td>${esc(c?c.name:"—")}<span class="sub">${esc(c?c.phone:"")}</span></td><td>${esc((s.items||[]).map(i=>i.name+(i.qty>1?" ×"+i.qty:"")).join(", "))}${s.tradeIn?'<span class="sub">Trade-in: '+esc(s.tradeIn.device)+"</span>":""}</td><td>${esc(App.paysText(s.payments))}</td><td>${esc(App.nameOf(s.by))}</td><td class="n"><b>${money(s.total)}</b></td></tr>`}).join("")||'<tr><td colspan="7" class="empty">Нет продаж за период</td></tr>'}
      </tbody></table></div></section>`;
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
    <dt>Склад</dt><dd>${esc(App.whName(s.whId))}</dd><dt>Продавец</dt><dd>${esc(App.nameOf(s.by))}</dd><dt>Оплата</dt><dd>${esc(App.paysText(s.payments))}</dd>
    ${s.tradeIn?`<dt>Trade-in</dt><dd>${esc(s.tradeIn.device)} · ${money(s.tradeIn.amount)}</dd>`:""}</dl>
    <div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Кол-во</th><th class="n">Цена</th><th class="n">Скидка</th><th class="n">Сумма</th><th class="n">Возвращено</th></tr></thead><tbody>
    ${(s.items||[]).map(i=>`<tr><td>${esc(i.name)}${i.serial?'<span class="sub">IMEI '+esc(i.serial)+"</span>":""}</td><td class="n">${i.qty}</td><td class="n">${money(i.price)}</td><td class="n">${num(i.disc)?money(i.disc):"—"}</td><td class="n">${money(i.qty*i.price-num(i.disc))}</td><td class="n">${App.returnedQty(id,i.productId,i.line)||"—"}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="sumlines"><span>Скидка на чек</span><span>${money(s.discount)}</span><span><b>Итого</b></span><span><b>${money(s.total)}</b></span>${App.can("cost")?`<span>Прибыль</span><span>${money(App.saleProfit(s))}</span>`:""}</div>
    ${rets.length?`<h3 class="sub-h">Возвраты</h3><div class="hist">${rets.map(r=>`<span>${esc(r.num)} · ${App.dtt(r.createdAt)} · ${esc((r.items||[]).map(i=>i.name+" ×"+i.qty).join(", "))} · ${money(r.amount)} · ${esc(r.reason)}</span>`).join("")}</div>`:""}
    <div class="acts"><button class="btn pri" data-act="printReceipt" data-id="${esc(id)}|a4">Товарный чек A4</button><button class="btn" data-act="printReceipt" data-id="${esc(id)}|80">Чек 80 мм</button><button class="btn" data-act="saleReceipt" data-id="${esc(id)}">Текст</button>${canRet?`<button class="btn danger" data-act="returnDlg" data-id="${esc(id)}">Возврат</button>`:""}</div>`);
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
        ["returns","sales","stock","stock_movements","cash_ops","audit_log"]);
      App.closeModal();App.toast("Возврат оформлен");
    }catch(e){btn.disabled=false;App.toast(e.message)}
  };
};
})();
