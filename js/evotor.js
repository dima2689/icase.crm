/* iCase CRM v3 · Касса Эвотор: подключение, выгрузка товаров на кассы, приём чеков, сверка продаж CRM с фискальными чеками */
"use strict";
(function(){
const {S,$,esc,num,money,ACT}=App;
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
let ST=null,STORES=null;
App.evoOn=()=>S.points.some(p=>p.evotorStoreId)||S.evotor.length>0;
const since=()=>{const t=S.evotor.reduce((a,r)=>!a||r.at<a?r.at:a,"");return t?new Date(t):null}; // с какого момента идут чеки — раньше сверять нечего
App.evoBadge=s=>{if(!App.evoOn())return "";const r=S.evotor.find(x=>x.saleId===s.id);const st=since();
  if(r)return `<dt>Фискальный чек</dt><dd><span class="pill ok">Эвотор № ${esc(r.number)}</span> ${App.dtt(r.at)}${r.status==="created"?" · продажа создана из чека":""}</dd>`;
  if(st&&new Date(s.createdAt)>=st&&s.channel!=="site"){
    // чеки с кассы приходят сразу (вебхук) или раз в 10 минут — первые полчаса просто ждём
    if(Date.now()-new Date(s.createdAt)<30*60000)return `<dt>Фискальный чек</dt><dd><span class="pill">ждём чек с кассы Эвотор</span></dd>`;
    return `<dt>Фискальный чек</dt><dd><span class="pill bad">не найден на Эвоторе — пробит ли чек?</span></dd>`}
  return ""};

/* ---------- настройки ---------- */
App.evoTab=function(){const own=App.me.role==="owner";
  if(!ST){App.api.rpc("evotor_status",{}).then(r=>{ST=r||{};App.render()}).catch(e=>{ST={error:e.message};App.render()});return '<section class="card"><div class="empty">Загружаем…</div></section>'}
  const base=String((window.ICASE_CONFIG||{}).supabaseUrl||"").replace(/\/+$/,""),hook=ST.hook_key?`${base}/functions/v1/evotor/hook?key=${ST.hook_key}`:"";
  const pts=S.points.filter(p=>p.active!==false);
  return `<section class="card"><div class="card-h"><h2>Касса Эвотор</h2>${ST.has_token?'<span class="pill ok">подключено</span>':'<span class="pill">не подключено</span>'}</div>
    <p>Фискальный чек пробивается на кассе Эвотор. CRM выгружает на кассы товары, цены и остатки, получает каждый пробитый чек и сверяет его с продажей в CRM: видно продажи без чека и чеки без продажи. Чек, пробитый только на кассе, можно одной кнопкой превратить в продажу CRM — товар спишется со склада.</p>
    ${ST.error?`<div class="banner err">${esc(ST.error)}</div>`:""}
    ${own?`<div class="form">${App.fld("evTok","Токен Облака Эвотор",App.inp("evTok","","password",ST.has_token?"токен сохранён — вставьте новый, чтобы заменить":"вставьте токен",'autocomplete="off"'),"full")}</div>
      <div class="acts" style="justify-content:flex-start"><button class="btn pri" data-act="evToken">Сохранить токен</button>${ST.has_token?'<button class="btn" data-act="evTest">Проверить и показать магазины Эвотора</button>':""}</div>
      <p class="muted small">Токен хранится в защищённом хранилище базы (Vault) и не виден в CRM. Не присылайте его в чат.</p>`:`<p class="muted">Подключение настраивает владелец.</p>`}
    ${STORES?`<h3 class="sub-h">Магазины в Эвоторе</h3><div class="tbl-wrap"><table><thead><tr><th>Магазин Эвотора</th><th>ID</th><th>Точка CRM</th></tr></thead><tbody>${STORES.map(s=>`<tr><td>${esc(s.name||"")}<small class="muted" style="display:block">${esc(s.address||"")}</small></td><td><code>${esc(s.id)}</code></td>
      <td>${App.sel("evPt_"+s.id,[["","— не связывать —"],...pts.map(p=>[p.id,p.name])],(pts.find(p=>p.evotorStoreId===s.id)||{}).id||"",'data-evstore="'+esc(s.id)+'"')}</td></tr>`).join("")}</tbody></table></div>`:""}
    <h3 class="sub-h">Точки и магазины Эвотора</h3>
    <div class="flist">${pts.map(p=>`<div class="frow"><span class="fic">🧾</span><span class="cnm"><b>${esc(p.name)}</b><small>${p.evotorStoreId?"Эвотор: "+esc(p.evotorStoreId):"магазин Эвотора не указан"}</small></span>
      <span class="csum">${S.evotor.filter(r=>r.pointId===p.id).length} чеков</span></div>`).join("")}</div>
    ${ST.has_token?`<div class="acts" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn" data-act="evPush">Выгрузить товары и цены на кассы</button><button class="btn" data-act="evPull">Загрузить чеки за 7 дней</button></div>
      <p class="muted">Чеки загружаются сами каждые 10 минут. Последний чек: ${ST.last?App.dtt(ST.last):"ещё не было"}${ST.new?` · не сверено: <b>${ST.new}</b> — «Продажи → Сверка с Эвотором»`:""}.</p>`:""}
    ${hook&&own?`<h3 class="sub-h">Мгновенная передача чеков (необязательно)</h3><p class="muted">Если в настройках приложения Эвотора можно указать адрес для вебхука «Отправить чек», вставьте туда этот адрес — чек будет приходить сразу после пробития:</p>
      <div class="kvcopy"><code style="word-break:break-all">${esc(hook)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(hook)}">Копировать</button></div>`:""}
    <h3 class="sub-h">Как получить токен</h3>
    <ol class="muted small"><li>В личном кабинете Эвотора установите приложение, которое выдаёт токен доступа к REST API (или создайте своё приложение на dev.evotor.ru и включите доступ к REST API).</li><li>Скопируйте токен и вставьте выше.</li><li>Нажмите «Проверить» и свяжите магазины Эвотора с точками CRM.</li><li>Нажмите «Выгрузить товары» — на кассах появятся товары CRM с теми же ценами и штрихкодами.</li></ol></section>`};
ACT.evToken=(_,btn)=>run(btn,async()=>{const t=App.val("evTok");if(!t)throw new Error("Вставьте токен");await App.api.rpc("evotor_set_token",{p_token:t});ST=null;App.render();App.toast("Токен сохранён")});
ACT.evTest=(_,btn)=>run(btn,async()=>{const r=await App.api.invoke("evotor",{action:"test"});STORES=r.stores||[];App.render();
  setTimeout(()=>document.querySelectorAll("[data-evstore]").forEach(el=>el.addEventListener("change",()=>evLink(el.dataset.evstore,el.value))),0);App.toast("Подключение работает: магазинов "+STORES.length)});
async function evLink(storeId,pointId){try{for(const p of S.points.filter(x=>x.evotorStoreId===storeId&&x.id!==pointId))await App.api.update("points",p.id,{evotor_store_id:null});
  if(pointId)await App.api.update("points",pointId,{evotor_store_id:storeId});await App.reload(["points"]);App.render();App.toast("Связано")}catch(e){App.toast(e.message)}}
const resText=r=>(r.result||[]).map(x=>x.error?`${x.point}: ошибка — ${x.error}`:`${x.point}: ${x.sent!=null?"товаров "+x.sent:"чеков "+x.got+", новых "+x.new+", сверено "+x.matched}`).join("\n");
ACT.evPush=(_,btn)=>run(btn,async()=>{const r=await App.api.invoke("evotor",{action:"push_products"});App.textModal("Выгрузка на кассы",resText(r))});
ACT.evPull=(_,btn)=>run(btn,async()=>{const r=await App.api.invoke("evotor",{action:"pull",days:7});await App.reload(["evotor"]);ST=null;App.textModal("Загрузка чеков",resText(r));App.render()});

/* ---------- сверка ---------- */
App.evoView=function(from,to,myPt){const st=since(),inP=t=>{const d=new Date(t);return d>=from&&d<to};
  const rec=S.evotor.filter(r=>inP(r.at)&&(!myPt||r.pointId===myPt));
  const lost=rec.filter(r=>r.status==="new"),sales=S.sales.filter(s=>inP(s.createdAt)&&s.channel!=="site"&&(!myPt||s.pointId===myPt)&&(!st||new Date(s.createdAt)>=st));
  const noFisc=sales.filter(s=>!S.evotor.some(r=>r.saleId===s.id));
  const days={};const key=t=>App.dt(t);sales.forEach(s=>{const k=key(s.createdAt)+"|"+s.pointId;(days[k]=days[k]||{crm:0,evo:0,pt:s.pointId,d:s.createdAt}).crm+=num(s.total)});
  rec.filter(r=>r.type==="SELL").forEach(r=>{const k=key(r.at)+"|"+r.pointId;(days[k]=days[k]||{crm:0,evo:0,pt:r.pointId,d:r.at}).evo+=num(r.total)});
  const dRows=Object.values(days).sort((a,b)=>String(b.d).localeCompare(a.d));
  const ptN=id=>(App.byId("points",id)||{}).name||"—";
  return `<div class="tiles"><div class="tile"><span>Чеков Эвотора за период</span><b>${rec.length}</b><small>сверено ${rec.filter(r=>["matched","created"].includes(r.status)).length}</small></div>
      <div class="tile ${lost.length?"alert":""}"><span>Чеки без продажи в CRM</span><b>${lost.length}</b><small>${money(lost.reduce((a,r)=>a+(r.type==="PAYBACK"?-1:1)*num(r.total),0))} · товар не списан</small></div>
      <div class="tile ${noFisc.length?"alert":""}"><span>Продажи CRM без чека</span><b>${noFisc.length}</b><small>${money(noFisc.reduce((a,s)=>a+num(s.total),0))} · проверьте 54-ФЗ</small></div></div>
    ${!st?`<section class="card"><div class="empty">Чеков с Эвотора ещё не было. Подключение — «Настройки → Эвотор».</div></section>`:""}
    ${lost.length?`<section class="card"><div class="card-h"><h2>Чеки, которых нет в CRM</h2></div><div class="tbl-wrap"><table><thead><tr><th>Чек</th><th>Когда</th><th>Точка</th><th>Позиции</th><th>Оплата</th><th class="n">Сумма</th><th></th></tr></thead><tbody>
      ${lost.map(r=>`<tr><td>${r.type==="PAYBACK"?'<span class="pill warn">возврат</span> ':""}№ ${esc(r.number)}</td><td>${App.dtt(r.at)}</td><td>${esc(ptN(r.pointId))}</td><td>${esc(r.items.map(i=>i.name+(num(i.qty)!==1?" ×"+num(i.qty):"")).join(", ").slice(0,160))}</td>
        <td>${num(r.payments.cash)?"нал "+money(r.payments.cash)+" ":""}${num(r.payments.card)?"безнал "+money(r.payments.card):""}</td><td class="n">${money(r.total)}</td>
        <td><div class="row-f nowrap">${r.type==="SELL"&&App.can("sale")?`<button class="btn sm pri" data-act="evCreate" data-id="${esc(r.id)}">Создать продажу</button>`:""}${App.can("del")?`<button class="btn sm" data-act="evLinkDlg" data-id="${esc(r.id)}">Связать</button><button class="btn sm ghost" data-act="evIgnore" data-id="${esc(r.id)}" title="Не учитывать">✕</button>`:""}</div></td></tr>`).join("")}</tbody></table></div>
      <p class="muted">«Создать продажу» спишет товар со склада точки и проведёт деньги в её смену. Товары с IMEI так не продать — оформите продажу в кассе CRM и выберите экземпляр, чек свяжется сам.</p></section>`:""}
    ${noFisc.length?`<section class="card"><div class="card-h"><h2>Продажи CRM без фискального чека</h2></div><div class="tbl-wrap"><table><thead><tr><th>Продажа</th><th>Когда</th><th>Точка</th><th>Оплата</th><th class="n">Сумма</th></tr></thead><tbody>
      ${noFisc.map(s=>`<tr class="rowlink" data-act="openSale" data-id="${esc(s.id)}"><td><b>${esc(s.num)}</b></td><td>${App.dtt(s.createdAt)}</td><td>${esc(ptN(s.pointId))}</td><td>${esc(App.paysText(s.payments))}</td><td class="n">${money(s.total)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">Чек сопоставляется с продажей автоматически: та же точка, та же сумма, разница во времени до ${num((App.settings().evotor||{}).match_minutes)||30} минут. Если чек пробит позже — свяжите вручную.</p></section>`:""}
    ${dRows.length?`<section class="card"><div class="card-h"><h2>По дням</h2></div><div class="tbl-wrap"><table><thead><tr><th>День</th><th>Точка</th><th class="n">Продажи CRM</th><th class="n">Чеки Эвотора</th><th class="n">Разница</th></tr></thead><tbody>
      ${dRows.map(x=>{const d=x.crm-x.evo;return `<tr><td>${App.dt(x.d)}</td><td>${esc(ptN(x.pt))}</td><td class="n">${money(x.crm)}</td><td class="n">${money(x.evo)}</td><td class="n ${Math.abs(d)>=1?"badc":"okc"}">${Math.abs(d)<1?"сходится":money(d)}</td></tr>`}).join("")}</tbody></table></div></section>`:""}`};
ACT.evCreate=(id,btn)=>run(btn,async()=>{const sid=await App.api.rpc("evotor_create_sale",{p_id:id},["evotor_receipts","sales","stock","cash_ops"]);await App.reload(["evotor","sales","products","cashops"]);App.toast("Продажа создана");if(App.byId("sales",sid))ACT.openSale(sid)});
ACT.evIgnore=(id,btn)=>{if(!App.confirm2(btn,"Не учитывать чек? Ещё раз"))return;run(btn,async()=>{await App.api.rpc("evotor_link",{p_id:id,p_sale:null,p_ignore:true});await App.reload(["evotor"]);App.render()})};
ACT.evLinkDlg=id=>{const r=S.evotor.find(x=>x.id===id);if(!r)return;const t=+new Date(r.at);
  const cand=S.sales.filter(s=>s.pointId===r.pointId&&!S.evotor.some(x=>x.saleId===s.id)&&Math.abs(+new Date(s.createdAt)-t)<3*864e5).sort((a,b)=>Math.abs(num(a.total)-r.total)-Math.abs(num(b.total)-r.total)||Math.abs(+new Date(a.createdAt)-t)-Math.abs(+new Date(b.createdAt)-t)).slice(0,15);
  App.openModal(App.head(`Чек № ${esc(r.number)} · ${money(r.total)}`)+`<p class="muted">${App.dtt(r.at)} · ${esc(r.items.map(i=>i.name).join(", "))}</p>
    <div class="flist">${cand.map(s=>`<button class="frow" data-act="evLinkOk" data-id="${esc(id)}|${esc(s.id)}"><span class="cnm"><b>${esc(s.num)} · ${money(s.total)}</b><small>${App.dtt(s.createdAt)} · ${esc((s.items||[]).map(i=>i.name).join(", ").slice(0,120))}</small></span>${Math.abs(num(s.total)-r.total)<1?'<span class="pill ok">сумма совпадает</span>':""}</button>`).join("")||'<div class="empty">Подходящих продаж нет</div>'}</div>`)};
ACT.evLinkOk=(arg,btn)=>run(btn,async()=>{const [id,sid]=arg.split("|");await App.api.rpc("evotor_link",{p_id:id,p_sale:sid,p_ignore:false});await App.reload(["evotor"]);App.closeModal();App.render();App.toast("Связано")});
})();
