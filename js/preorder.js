/* iCase CRM v3 · предзаказы устройств: приём с предоплатой, автоматическая бронь при поступлении, выдача с зачётом, отмена с возвратом */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.preorders="Предзаказы";
App.NAV.splice(App.NAV.findIndex(n=>n[0]==="orders")+1,0,["preorders","Предзаказы",'<path d="M7 3h10v18l-5-3-5 3z"/><path d="M10 8h4M10 12h4"/>',"sale"]);
Object.assign(App.ui,{pzTab:"open",pzQ:""});
const ST={waiting:["Ждём поставку","warn"],arrived:["Пришёл — в резерве","ok"],done:["Выдан","mute"],cancelled:["Отменён","mute"]};
const run=(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;return Promise.resolve().then(fn).catch(e=>App.toast(e.message||String(e))).finally(()=>{if(btn)btn.disabled=false})};
const RL=["preorders","cashops","units","products","tasks","log","customers"];
App.pzPaid=o=>S.cashops.filter(c=>c.ref===o.num&&(c.type==="prepay"||c.type==="refund")).reduce((a,c)=>a+num(c.amount),0);
App.pzArrived=pt=>S.preorders.filter(o=>o.status==="arrived"&&(!pt||!o.pointId||o.pointId===pt));
const pill=o=>`<span class="pill ${ST[o.status][1]}">${ST[o.status][0]}</span>`;
const unitOf=o=>o.unitId?App.byId("units",o.unitId):null;
const payOpts=()=>Object.entries(App.PAY);

/* ---------- раздел ---------- */
VIEWS.preorders={
  ownSearch:true,
  actions:()=>App.can("sale")?'<button class="btn pri" data-act="pzNew">+ Предзаказ</button>':"",
  render(){const u=App.ui,q=u.pzQ.trim().toLowerCase(),qk=App.phoneKey(u.pzQ);
    const tabs=[["open","Открытые"],["arrived","Пришли"],["waiting","Ждём"],["closed","Закрытые"]];
    const cnt=k=>S.preorders.filter(o=>k==="open"?["waiting","arrived"].includes(o.status):k==="closed"?["done","cancelled"].includes(o.status):o.status===k).length;
    const list=S.preorders.filter(o=>(u.pzTab==="open"?["waiting","arrived"].includes(o.status):u.pzTab==="closed"?["done","cancelled"].includes(o.status):o.status===u.pzTab))
      .filter(o=>{if(!q)return true;const c=App.cust(o.customerId)||{},p=App.byId("products",o.productId)||{};return [o.num,c.name,p.name].join(" ").toLowerCase().includes(q)||(qk.length>=4&&App.phoneKey(c.phone).includes(qk))})
      .sort((a,b)=>(a.status==="arrived"?0:1)-(b.status==="arrived"?0:1)||String(a.createdAt).localeCompare(String(b.createdAt)));
    return `<div class="tabs">${tabs.map(([k,l])=>`<button class="tab ${u.pzTab===k?"on":""}" data-act="pzTab" data-id="${k}">${l}${cnt(k)?` <b>${cnt(k)}</b>`:""}</button>`).join("")}</div>
    <section class="card"><div class="card-h"><input type="search" id="pzQ" placeholder="№, клиент, телефон, устройство" value="${esc(u.pzQ)}" data-filter="pzQ" aria-label="Поиск предзаказов"></div>
    <div class="tbl-wrap"><table class="pztbl"><thead><tr><th>№</th><th>Клиент</th><th>Устройство</th><th class="n">Цена</th><th class="n">Внесено</th><th>Статус</th><th>Срок</th></tr></thead><tbody>
    ${list.map(o=>{const c=App.cust(o.customerId)||{},p=App.byId("products",o.productId)||{},paid=App.pzPaid(o),un=unitOf(o);
      return `<tr class="rowlink" data-act="pzOpen" data-id="${esc(o.id)}"><td><b>${esc(o.num)}</b><span class="sub">${App.dt(o.createdAt)}</span></td><td>${esc(c.name||"")}<span class="sub">${esc(App.fmtPhone(c.phone))}</span></td>
        <td>${esc(p.name||"")}${un?`<span class="sub">${esc(App.unitCode(un))} · ${esc(App.whName(un.whId))}</span>`:""}</td><td class="n">${money(o.price)}</td><td class="n">${money(paid)}</td><td>${pill(o)}</td>
        <td>${o.dueDate?`<span class="${o.status==="waiting"&&o.dueDate<new Date().toISOString().slice(0,10)?"badc":""}">${App.dt(o.dueDate)}</span>`:"—"}</td></tr>`}).join("")||'<tr><td colspan="7" class="empty">Предзаказов нет</td></tr>'}
    </tbody></table></div></section>`}
};
ACT.pzTab=k=>{App.ui.pzTab=k;App.render()};

/* ---------- новый предзаказ ---------- */
let PZ=null;
ACT.pzNew=(cid)=>{const c=typeof cid==="string"?App.cust(cid):null;
  PZ={phone:c?c.phone:"",name:c?c.name:"",mode:"apple",productId:"",family:"iPhone",modelId:"",mem:"",color:"",opts:{},price:"",deposit:"",method:"cash",due:"",note:""};
  PZ.modelId=(App.models(PZ.family)[0]||{}).id||"";drawNew()};
function pzModel(){return App.byId("models",PZ.modelId)}
function pzName(){if(PZ.mode==="search"){const p=App.byId("products",PZ.productId);return p?p.name:""}const m=pzModel();return m?App.catalogName(m,PZ.mem,PZ.color,PZ.opts):""}
function keep(){[["pzPhone","phone"],["pzName","name"],["pzPrice","price"],["pzDep","deposit"],["pzMethod","method"],["pzDue","due"],["pzNote","note"]].forEach(([id,k])=>{const el=document.getElementById(id);if(el)PZ[k]=el.value})}
function drawNew(){keep();const m=pzModel(),name=pzName(),ex=PZ.mode==="apple"&&name?S.products.find(p=>!p.archived&&p.name===name&&p.condition==="Новый"):PZ.mode==="search"?App.byId("products",PZ.productId):null;
  const stock=ex?(ex.trackSerial?S.units.filter(u=>u.productId===ex.id&&u.status==="in_stock").length:App.qtyTotal(ex)):0;
  if(ex&&!PZ.price&&num(ex.price))PZ.price=String(num(ex.price));
  const chips=(kind,vals,cur)=>vals.map(v=>`<button type="button" class="chip ${cur===v?"on":""}" data-act="pzSet" data-id="${esc(kind+"|"+v)}">${esc(v)}</button>`).join("");
  const html=App.head("Новый предзаказ")+`<div class="form">
    ${App.fld("pzPhone","Телефон клиента",App.inp("pzPhone",PZ.phone,"tel","+7 900 000-00-00",'autocomplete="off"'))}${App.fld("pzName","Имя",App.inp("pzName",PZ.name,"text","Как обращаться"))}
    <div class="fld full"><label>Устройство</label><div class="seg"><button type="button" class="${PZ.mode==="apple"?"on":""}" data-act="pzMode" data-id="apple">Apple по модели</button><button type="button" class="${PZ.mode==="search"?"on":""}" data-act="pzMode" data-id="search">Найти товар</button></div></div>
    ${PZ.mode==="apple"?`<div class="fld full"><div class="chips">${App.FAMILIES.filter(f=>App.models(f).length).map(f=>`<button type="button" class="chip ${PZ.family===f?"on":""}" data-act="pzFamily" data-id="${esc(f)}">${esc(f)}</button>`).join("")}</div></div>
      ${App.fld("pzModel","Модель",App.sel("pzModel",App.models(PZ.family).map(x=>[x.id,x.name]),PZ.modelId),"full")}
      ${m&&m.memories.length?`<div class="fld full"><label>Память</label><div class="chips">${chips("mem",m.memories,PZ.mem)}</div></div>`:""}
      ${m&&m.colors.length?`<div class="fld full"><label>Цвет</label><div class="chips">${chips("color",m.colors,PZ.color)}</div></div>`:""}
      ${m?Object.entries(m.options||{}).map(([k,vals])=>`<div class="fld full"><label>${esc(k)}</label><div class="chips">${chips("opt:"+k,vals,PZ.opts[k]||"")}</div></div>`).join(""):""}`
    :`<div class="fld full"><input id="pzQ2" type="search" autocomplete="off" placeholder="Название, артикул"><div id="pzBox" class="pick" hidden></div></div>`}
    <div class="full dpname">${name?`<b>${esc(name)}</b> ${ex?(stock?`<span class="pill ok">в наличии ${stock} — сразу забронируем</span>`:'<span class="pill warn">нет в наличии — ждём поставку</span>'):'<span class="pill info">карточка будет создана</span>'}`:'<span class="muted">Выберите устройство</span>'}</div>
    ${App.fld("pzPrice","Цена для клиента, ₽",App.inp("pzPrice",PZ.price,"number","0"))}${App.fld("pzDue","Ожидаемая дата",App.inp("pzDue",PZ.due,"date"))}
    ${App.fld("pzDep","Предоплата, ₽",App.inp("pzDep",PZ.deposit,"number","0"))}${App.fld("pzMethod","Способ оплаты",App.sel("pzMethod",payOpts(),PZ.method))}
    ${App.fld("pzNote","Комментарий",App.inp("pzNote",PZ.note,"text","Пожелания клиента, условия"),"full")}
  </div><div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="pzSave">Принять предзаказ</button></div>`;
  if($("#scrim").hidden)App.openModal(html,{wide:true});else{$("#modal").className="modal wide";$("#modal").innerHTML=html}
  const ms=$("#pzModel");if(ms)ms.onchange=()=>{PZ.modelId=ms.value;PZ.mem="";PZ.color="";PZ.opts={};PZ.price="";drawNew()};
  if(PZ.mode==="search"&&$("#pzQ2"))App.productPicker("pzQ2","pzBox",{inStock:false,onPick:p=>{PZ.productId=p.id;PZ.price=num(p.price)?String(num(p.price)):"";drawNew()}});
  const ph=$("#pzPhone");if(ph)ph.onchange=()=>{const c=App.findCustomerByPhone(ph.value),n=$("#pzName");if(c&&n&&!n.value)n.value=c.name||""}}
ACT.pzMode=k=>{PZ.mode=k;PZ.price="";drawNew()};
ACT.pzFamily=f=>{PZ.family=f;PZ.modelId=(App.models(f)[0]||{}).id||"";PZ.mem="";PZ.color="";PZ.opts={};PZ.price="";drawNew()};
ACT.pzSet=v=>{const [k,val]=v.split(/\|(.*)/s);if(k.startsWith("opt:")){const o=k.slice(4);PZ.opts[o]=PZ.opts[o]===val?"":val}else PZ[k]=PZ[k]===val?"":val;PZ.price="";drawNew()};
ACT.pzSave=(_,btn)=>run(btn,async()=>{keep();
  if(App.phoneKey(PZ.phone).length!==10)throw new Error("Укажите телефон клиента — по нему сообщим о поступлении");
  let pid=PZ.productId;
  if(PZ.mode==="apple"){const m=pzModel();if(!m)throw new Error("Выберите модель");
    pid=await App.api.rpc("preorder_catalog_product",{p:{model_id:m.id,memory:PZ.mem||null,color:PZ.color||null,attrs:Object.fromEntries(Object.entries(PZ.opts).filter(([k,v])=>v)),name:pzName(),price:num(PZ.price)}})}
  if(!pid)throw new Error("Выберите устройство");
  const cid=await App.api.customer(PZ.phone,PZ.name.trim(),"Магазин");
  const id=await App.api.rpc("preorder_create",{p:{customer_id:cid,product_id:pid,price:num(PZ.price),deposit:num(PZ.deposit),method:PZ.method,due_date:PZ.due||null,note:PZ.note,point_id:(App.point()||{}).id||null}});
  await App.reload(RL);App.closeModal();const o=App.byId("preorders",id);
  App.toast(o&&o.status==="arrived"?"Предзаказ принят, устройство забронировано":"Предзаказ принят — сообщим клиенту о поступлении");ACT.pzOpen(id)});

/* ---------- карточка ---------- */
ACT.pzOpen=id=>{const o=App.byId("preorders",id);if(!o)return;const c=App.cust(o.customerId)||{},p=App.byId("products",o.productId)||{},paid=App.pzPaid(o),un=unitOf(o),open=["waiting","arrived"].includes(o.status);
  const ops=S.cashops.filter(x=>x.ref===o.num).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  App.openModal(App.head("Предзаказ "+esc(o.num),pill(o))+`
    <dl class="kv"><dt>Клиент</dt><dd><button class="linkbtn" data-act="openClient" data-id="${esc(o.customerId)}">${esc(c.name||"")}</button> ${esc(App.fmtPhone(c.phone))}</dd>
    <dt>Устройство</dt><dd>${App.can("stock")||App.can("sale")?`<button class="linkbtn" data-act="openProduct" data-id="${esc(o.productId)}">${esc(p.name||"")}</button>`:esc(p.name||"")}</dd>
    ${un?`<dt>Экземпляр</dt><dd><button class="linkbtn" data-act="openUnit" data-id="${esc(un.id)}">${esc(App.unitCode(un))}</button> · ${esc(App.whName(un.whId))}${pzAway(o)?` <span class="pill warn">не на точке клиента</span> <button class="btn sm" data-act="pzMove" data-id="${esc(o.id)}">Переместить на точку</button>`:""}</dd>`:""}
    <dt>Цена</dt><dd><b>${money(o.price)}</b></dd><dt>Внесено</dt><dd>${money(paid)}</dd><dt>К доплате</dt><dd><b>${money(Math.max(0,o.price-paid))}</b></dd>
    <dt>Принят</dt><dd>${App.dtt(o.createdAt)} · ${esc(App.nameOf(o.by))}${o.pointId?" · "+esc((App.byId("points",o.pointId)||{}).name||""):""}</dd>
    ${o.dueDate?`<dt>Ожидаем</dt><dd>${App.dt(o.dueDate)}</dd>`:""}${o.arrivedAt?`<dt>Поступил</dt><dd>${App.dtt(o.arrivedAt)}</dd>`:""}
    ${o.note?`<dt>Комментарий</dt><dd>${esc(o.note)}</dd>`:""}${o.cancelReason?`<dt>Причина отмены</dt><dd>${esc(o.cancelReason)}</dd>`:""}
    ${o.saleId?`<dt>Продажа</dt><dd><button class="btn sm" data-act="openSale" data-id="${esc(o.saleId)}">${esc((App.byId("sales",o.saleId)||{}).num||"чек")}</button></dd>`:""}</dl>
    ${ops.length?`<h3 class="sub-h">Платежи</h3><div class="tbl-wrap"><table><tbody>${ops.map(x=>`<tr><td>${App.dtt(x.at)}</td><td>${esc(x.note||x.type)}</td><td>${esc(App.PAYALL[x.method]||x.method)}</td><td class="n">${money(x.amount)}</td></tr>`).join("")}</tbody></table></div>`:""}
    ${o.status==="waiting"?'<p class="muted">Как только экземпляр поступит на склад, CRM забронирует его за этим предзаказом и поставит задачу позвонить клиенту.</p>':""}
    <div class="acts">${open?`<button class="btn danger" data-act="pzCancel" data-id="${esc(o.id)}">Отменить</button><button class="btn" data-act="pzEdit" data-id="${esc(o.id)}">Изменить</button>${paid<o.price?`<button class="btn" data-act="pzPay" data-id="${esc(o.id)}">Доплата</button>`:""}`:""}
      <button class="btn" data-act="pzPrint" data-id="${esc(o.id)}">Печать</button>${o.status==="arrived"&&App.can("sale")?`<button class="btn pri" data-act="pzSell" data-id="${esc(o.id)}">Выдать клиенту</button>`:""}</div>`,{wide:true})};

ACT.pzPay=id=>{const o=App.byId("preorders",id),left=o.price-App.pzPaid(o);
  App.openModal(App.head("Доплата · "+esc(o.num))+`<div class="form">${App.fld("ppAmt","Сумма, ₽",App.inp("ppAmt",String(Math.round(left)),"number"))}${App.fld("ppM","Способ",App.sel("ppM",payOpts(),"cash"))}</div>
    <div class="acts"><button class="btn" data-act="pzOpen" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="pzPayGo" data-id="${esc(id)}">Принять</button></div>`)};
ACT.pzPayGo=(id,btn)=>run(btn,async()=>{await App.api.rpc("preorder_pay",{p_id:id,p_amount:num(App.val("ppAmt")),p_method:App.val("ppM")});await App.reload(RL);App.toast("Доплата принята");ACT.pzOpen(id)});

ACT.pzEdit=id=>{const o=App.byId("preorders",id),mgr=App.isApprover&&App.isApprover();
  App.openModal(App.head("Изменить · "+esc(o.num))+`<div class="form">${App.fld("peP","Цена, ₽",App.inp("peP",String(num(o.price)),"number","",mgr?"":"disabled"))}${App.fld("peD","Ожидаемая дата",App.inp("peD",o.dueDate||"","date"))}
    ${App.fld("peN","Комментарий",App.inp("peN",o.note||""),"full")}</div>${mgr?"":'<p class="muted">Цену меняет управляющий или владелец.</p>'}
    <div class="acts"><button class="btn" data-act="pzOpen" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="pzEditGo" data-id="${esc(id)}">Сохранить</button></div>`)};
ACT.pzEditGo=(id,btn)=>run(btn,async()=>{const o=App.byId("preorders",id),p={due_date:App.val("peD")||null,note:App.val("peN")};const np=num(App.val("peP"));if(np!==num(o.price))p.price=np;
  await App.api.rpc("preorder_update",{p_id:id,p});await App.reload(["preorders","log"]);ACT.pzOpen(id)});

ACT.pzSell=id=>{const o=App.byId("preorders",id),paid=App.pzPaid(o),left=Math.max(0,o.price-paid),un=unitOf(o);
  App.openModal(App.head("Выдача · "+esc(o.num))+`<dl class="kv"><dt>Устройство</dt><dd>${esc((App.byId("products",o.productId)||{}).name||"")}${un?" · "+esc(App.unitCode(un)):""}</dd>
    <dt>Цена</dt><dd>${money(o.price)}</dd><dt>Зачёт предоплаты</dt><dd>${money(paid)}</dd><dt>К оплате сейчас</dt><dd><b class="big">${money(left)}</b></dd></dl>
    ${left>0?`<div class="form">${App.fld("psM","Способ оплаты",App.sel("psM",payOpts(),"card"))}</div>`:""}
    <div class="acts"><button class="btn" data-act="pzOpen" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="pzSellGo" data-id="${esc(id)}">Продать и выдать</button></div>`)};
ACT.pzSellGo=(id,btn)=>run(btn,async()=>{const o=App.byId("preorders",id),left=Math.max(0,o.price-App.pzPaid(o));
  const sid=await App.api.rpc("preorder_sell",{p_id:id,p_payments:left>0?[{method:App.val("psM"),amount:left}]:[],p_wh:null});
  await App.reload(RL.concat(["sales","stock","movements","bonusops"]));App.closeModal();App.toast("Продажа оформлена");if(sid&&ACT.openSale)ACT.openSale(sid)});

ACT.pzCancel=id=>{const o=App.byId("preorders",id),paid=App.pzPaid(o),mgr=App.isApprover&&App.isApprover();
  App.openModal(App.head("Отмена · "+esc(o.num))+`<div class="form">${paid>0?App.fld("pcR","Вернуть клиенту, ₽",App.inp("pcR",String(Math.round(paid)),"number","",mgr?"":"disabled"))+App.fld("pcM","Способ возврата",App.sel("pcM",payOpts(),(S.cashops.find(x=>x.ref===o.num&&x.type==="prepay")||{}).method||"cash")):""}
    ${App.fld("pcW","Причина",App.inp("pcW","","text","Передумал, не дождался, нашёл дешевле…"),"full")}</div>
    ${paid>0&&!mgr?'<p class="muted">Удержать часть предоплаты может только управляющий.</p>':""}${o.unitId?'<p class="muted">Бронь снимется — экземпляр перейдёт следующему в очереди или вернётся в продажу.</p>':""}
    <div class="acts"><button class="btn" data-act="pzOpen" data-id="${esc(id)}">Назад</button><button class="btn danger" data-act="pzCancelGo" data-id="${esc(id)}">Отменить предзаказ</button></div>`)};
ACT.pzCancelGo=(id,btn)=>run(btn,async()=>{if(!App.confirm2(btn,"Отменить? Нажмите ещё раз"))return;const o=App.byId("preorders",id),paid=App.pzPaid(o);
  await App.api.rpc("preorder_cancel",{p_id:id,p_refund:paid>0?num(App.val("pcR")):0,p_method:paid>0?App.val("pcM"):"cash",p_reason:App.val("pcW")});
  await App.reload(RL);App.toast("Предзаказ отменён");ACT.pzOpen(id)});

/* ---------- устройство пришло на другую точку: переместить к клиенту ---------- */
function pzAway(o){const un=unitOf(o);if(!un||!o.pointId||o.status!=="arrived")return false;const w=App.byId("warehouses",un.whId);return !w||w.pointId!==o.pointId}
const pzWhs=o=>S.warehouses.filter(w=>w.pointId===o.pointId&&w.active!==false);
ACT.pzMove=id=>{const o=App.byId("preorders",id),ws=pzWhs(o),pt=App.byId("points",o.pointId)||{};if(!ws.length)return App.toast("У точки «"+(pt.name||"")+"» нет складов");
  const def=(ws.find(w=>w.id===pt.cashWh)||ws[0]).id;
  App.openModal(App.head("Переместить · "+esc(o.num))+`<p>Экземпляр переедет со склада «${esc(App.whName(unitOf(o).whId))}» на склад точки клиента. Бронь сохраняется.</p>
    <div class="form">${App.fld("pmW","На склад",App.sel("pmW",ws.map(w=>[w.id,w.name]),def),"full")}</div>
    <div class="acts"><button class="btn" data-act="pzOpen" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="pzMoveGo" data-id="${esc(id)}">Переместить</button></div>`)};
ACT.pzMoveGo=(id,btn)=>run(btn,async()=>{await App.api.rpc("preorder_move",{p_id:id,p_wh:App.val("pmW")});await App.reload(RL.concat(["stock","movements"]));App.toast("Перемещено");ACT.pzOpen(id)});

/* ---------- закупка: ждущие предзаказы — первоочередной спрос ---------- */
const dr=App.demandRows;if(dr)App.demandRows=function(){const rows=dr.apply(this,arguments),by=new Map(rows.map(x=>[x.p.id,x]));
  S.preorders.filter(o=>o.status==="waiting").forEach(o=>{let x=by.get(o.productId);if(!x){const p=App.byId("products",o.productId);if(!p)return;x={p,wait:0,lost:0};by.set(p.id,x);rows.push(x)}x.wait+=1;x.pre=(x.pre||0)+1});
  return rows};

/* ---------- задачи: просроченные предзаказы; переход из задачи в предзаказ ---------- */
let pzTaskAt=0;
const at=App.autoTasks;if(at)App.autoTasks=async function(force){const r=await at.apply(this,arguments);
  if(!App.me.role||!App.can("sale")||(!force&&Date.now()-pzTaskAt<10*60e3))return r;pzTaskAt=Date.now();
  const t0=new Date().toISOString().slice(0,10),rows=[];
  S.preorders.filter(o=>o.status==="waiting"&&o.dueDate&&o.dueDate<t0).forEach(o=>{const key="po-late-"+o.num;if(S.tasks.some(t=>t.autoKey===key))return;const c=App.cust(o.customerId)||{};
    rows.push({auto_key:key,title:`Предзаказ ${o.num} задерживается: предупредить клиента и уточнить срок поставки`,due_date:t0,note:[c.name,App.fmtPhone(c.phone),(App.byId("products",o.productId)||{}).name].filter(Boolean).join(" · "),customer_id:o.customerId,ref_type:"preorder",ref_id:o.id,point_id:o.pointId||null})});
  if(rows.length){try{await App.api.insertMany("tasks",rows);await App.reload(["tasks"])}catch(e){console.warn(e)}}
  return r};
const to=ACT.taskOpen;if(to)ACT.taskOpen=function(id){const t=S.tasks.find(x=>x.id===id);if(t&&t.refType==="preorder"&&t.refId&&App.byId("preorders",t.refId))return ACT.pzOpen(t.refId);return to.apply(this,arguments)};

/* ---------- печать: квитанция клиенту ---------- */
ACT.pzPrint=id=>{const o=App.byId("preorders",id),c=App.cust(o.customerId)||{},p=App.byId("products",o.productId)||{},paid=App.pzPaid(o),st=App.settings();
  const body=App.docHead("Предзаказ",o.num,App.dt(o.createdAt),o.pointId)
    +App.docMeta([["Клиент",c.name||""],["Телефон",App.fmtPhone(c.phone)],["Принял",App.nameOf(o.by)],["Ожидаемая дата",o.dueDate?App.dt(o.dueDate):"по поступлении"]])
    +App.docTable([["Устройство"],["Цена","n"],["Внесено","n"],["К доплате","n"]],[[p.name||"",money(o.price),money(paid),money(Math.max(0,o.price-paid))]])
    +`<p class="note">Цена устройства зафиксирована на дату предзаказа. Когда устройство поступит, мы забронируем его за вами и сообщим по телефону ${esc(App.fmtPhone(c.phone))}. Предоплата возвращается при отмене предзаказа${st.legalName?"":""}.</p>`
    +(o.note?`<p class="note">Комментарий: ${esc(o.note)}</p>`:"")+`<div class="sg"><div>Продавец</div><div>Клиент</div></div>`;
  App.printHtml(App.docPage("Предзаказ "+o.num,body))};

/* ---------- касса: кнопка и пришедшие предзаказы; карточка клиента ---------- */
App.pzStrip=()=>{if(!App.can("sale"))return "";const pt=(App.point()||{}).id,ar=App.pzArrived(pt);
  return `<button class="btn sm" data-act="pzNew">+ Предзаказ</button>${ar.length?`<span class="muted">Предзаказы пришли:</span>${ar.slice(0,3).map(o=>{const c=App.cust(o.customerId)||{};return `<button class="btn sm" data-act="pzOpen" data-id="${esc(o.id)}">${esc(o.num)} · ${esc((c.name||"").split(" ")[0]||"")}</button>`}).join("")}${ar.length>3?`<a class="btn sm ghost" href="#preorders">ещё ${ar.length-3}</a>`:""}`:""}`};
const ce=App.clientExtra;App.clientExtra=function(id){const l=App.grpOf(S.preorders,"customerId",id);
  return (l.length?`<section><h3 class="sub-h">Предзаказы</h3><div class="list-mini">${l.map(o=>`<button data-act="pzOpen" data-id="${esc(o.id)}"><span>${esc(o.num)} · ${esc((App.byId("products",o.productId)||{}).name||"")}</span>${pill(o)}</button>`).join("")}</div>
    ${App.can("sale")?`<button class="btn sm" data-act="pzNew" data-id="${esc(id)}">+ Предзаказ</button>`:""}</section>`:"")+(ce?ce(id):"")};
})();
