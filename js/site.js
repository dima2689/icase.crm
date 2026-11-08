/* iCase CRM v3 · обмен с сайтом (WooCommerce): настройки и заказы с сайта */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
const FN=()=>(window.ICASE_CONFIG&&window.ICASE_CONFIG.supabaseUrl||"").replace(/\/+$/,"")+"/functions/v1/";
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message)}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};
App.SO_ST={new:["Новый","warn"],confirmed:["Подтверждён","info"],done:["Проведён","ok"],cancelled:["Отменён","mute"]};
const soSt=o=>{const s=App.SO_ST[o.status]||[o.status,""];return `<span class="pill ${s[1]}">${s[0]}</span>`};

/* ======================= заказы с сайта ======================= */
TITLES.orders="Заказы с сайта";
Object.assign(App.ui,{soSt:"open",soQ:""});
VIEWS.orders={
  ownSearch:true,
  render(){
    const u=App.ui,q=u.soQ.toLowerCase();
    const st=App.settings();
    const list=App.sortDesc(S.siteorders).filter(o=>(u.soSt==="all"||(u.soSt==="open"?["new","confirmed"].includes(o.status):o.status===u.soSt))
      &&(!q||[o.num,o.name,o.phone,o.email,(o.items||[]).map(i=>i.name).join(" ")].join(" ").toLowerCase().includes(q)));
    const cnt=k=>S.siteorders.filter(o=>k==="open"?["new","confirmed"].includes(o.status):k==="all"||o.status===k).length;
    return `${!st.siteOrders?`<div class="banner info">Приём заказов с сайта выключен. Включить: «Настройки → Сайт».${App.can("settings")?' <button class="btn sm" data-act="settingsTab" data-id="site">Открыть</button>':""}</div>`:""}
    <div class="chips">${[["open","В работе"],["done","Проведённые"],["cancelled","Отменённые"],["all","Все"]].map(([k,l])=>`<button class="chip ${u.soSt===k?"on":""}" data-act="soSt" data-id="${k}">${l}<b>${cnt(k)}</b></button>`).join("")}</div>
    <div class="row-f"><input id="soQ" type="search" placeholder="№ заказа, имя, телефон, товар" value="${esc(u.soQ)}" data-filter="soQ" aria-label="Поиск заказа" style="flex:1 1 260px"></div>
    <section class="card crow-list">${list.map(o=>`<button type="button" class="crow sorow" data-act="openSO" data-id="${esc(o.id)}">
        <span class="cav ${o.status==="new"?"":"mute"}">${o.problems?"!":"🛒"}</span>
        <span class="cnm"><b>${esc(o.num)} · ${esc(o.name||"Без имени")} ${soSt(o)}${o.paid?' <span class="pill ok">оплачен</span>':""}</b><small>${App.dtt(o.createdAt)} · ${esc((o.items||[]).map(i=>i.name+(i.qty>1?" ×"+i.qty:"")).join(", "))}</small>${o.problems?`<small class="bad">${esc(o.problems)}</small>`:""}</span>
        <span class="csum">${money(o.total)}</span></button>`).join("")||'<div class="empty">Заказов нет. Они появятся здесь, когда покупатель оформит заказ на сайте.</div>'}</section>`;
  }
};
ACT.soSt=k=>{App.ui.soSt=k;App.render()};
ACT.openSO=id=>{
  const draw=()=>{
    const o=App.byId("siteorders",id);if(!o)return App.closeModal();
    const open=["new","confirmed"].includes(o.status),can=App.can("sale");
    const c=o.customerId?App.cust(o.customerId):null,sale=o.saleId?App.byId("sales",o.saleId):null;
    App.redrawModal(App.head("Заказ "+esc(o.num),soSt(o)+(o.paid?' <span class="pill ok">оплачен на сайте</span>':""))+`
      ${o.problems?`<div class="banner err">${esc(o.problems)}${open?"<br><small>Позиции, которых нет в каталоге CRM, при проведении попадут в чек как «товар вне каталога» без списания со склада.</small>":""}</div>`:""}
      <div class="tiles"><div class="tile"><span>Покупатель</span><b class="mid">${esc(o.name||"—")}</b><small>${o.phone?"+7 "+esc(o.phone):""}${o.email?" · "+esc(o.email):""}</small></div>
        <div class="tile"><span>Сумма</span><b>${money(o.total)}</b><small>${esc(o.payment||"")}</small></div>
        <div class="tile"><span>Получение</span><b class="mid">${esc(o.delivery||"—")}</b><small>${esc(o.address||"")}</small></div></div>
      ${o.note?`<p class="muted">Комментарий покупателя: ${esc(o.note)}</p>`:""}
      <div class="whlist" style="margin-top:12px">${(o.items||[]).map(i=>{const p=i.productId?App.byId("products",i.productId):null;const reserved=(i.from||[]).reduce((a,f)=>a+num(f.qty),0);
        return `<div class="whr"><span class="whr-main" style="cursor:default"><b>${esc(i.name)}</b><small>${p?esc(App.catName(p)):"нет в CRM"}${i.sku?" · "+esc(i.sku):""}${(i.from||[]).length?" · резерв: "+(i.from||[]).map(f=>esc(App.whName(f.wh))+(f.qty>1?" ×"+f.qty:"")).join(", "):""}</small>${i.problem?`<small class="bad">${esc(i.problem)}</small>`:""}</span>
          <span class="whr-q ${reserved<i.qty&&open?"bad":""}">${i.qty} шт</span><span class="whr-p">${money(i.price*i.qty)}</span></div>`}).join("")}</div>
      ${c?`<p style="margin-top:10px"><button class="btn sm" data-act="openClient" data-id="${esc(c.id)}">Карточка клиента</button>${sale?` <button class="btn sm" data-act="openSale" data-id="${esc(sale.id)}">Продажа ${esc(sale.num)}</button>`:""}</p>`:""}
      ${open&&can?`<div class="acts"><button class="btn danger" data-act="soCancel" data-id="${esc(id)}">Отменить заказ</button>${o.status==="new"?`<button class="btn" data-act="soConfirm" data-id="${esc(id)}">Подтвердить</button>`:""}<button class="btn pri" data-act="soPay" data-id="${esc(id)}">Провести продажу</button></div>`:`<div class="acts"><button class="btn" data-act="close">Закрыть</button></div>`}`);
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
ACT.soConfirm=(id,btn)=>run(btn,async()=>{await App.api.rpc("site_order_confirm",{p_id:id},["site_orders"]);App.toast("Заказ подтверждён")});
ACT.soCancel=(id,btn)=>{if(!App.confirm2(btn,"Нажмите ещё раз: резерв снимется, на сайте заказ станет «Отменён»"))return;
  run(btn,async()=>{await App.api.rpc("site_order_cancel",{p_id:id,p_reason:null},["site_orders","products","units","movements"]);App.toast("Заказ отменён, резерв снят")})};
ACT.soPay=id=>{
  const o=App.byId("siteorders",id);if(!o)return;
  App.openModal(App.head("Провести заказ "+esc(o.num)+" · "+money(o.total))+`
    <p class="muted">Товар спишется из резерва, продажа попадёт в выручку с каналом «Сайт», на сайте заказ станет «Выполнен».</p>
    <div class="form">${App.fld("soMethod","Как оплачен",App.sel("soMethod",Object.entries(App.PAY),o.paid?"transfer":"cash"))}${App.fld("soSum","Сумма, ₽",App.inp("soSum",o.total,"number"))}</div>
    <div class="acts"><button class="btn" data-act="openSO" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="soPayOk" data-id="${esc(id)}">Провести</button></div>`);
};
ACT.soPayOk=(id,btn)=>run(btn,async()=>{
  const o=App.byId("siteorders",id),amt=num(App.val("soSum"));
  if(Math.abs(amt-num(o.total))>=0.5)return App.toast("Сумма оплаты должна совпадать с суммой заказа ("+money(o.total)+")");
  await App.api.rpc("site_order_complete",{p_id:id,p_payments:[{method:App.val("soMethod"),amount:amt}]},["site_orders","sales","products","units","cash_ops","movements"]);
  App.closeModal();App.toast("Заказ проведён");
});

/* ======================= настройки → сайт ======================= */
App.siteTab=()=>{
  const s=App.settings(),own=App.can("staff"),ed=App.can("settings"),st=App.ui.siteStatus;
  if(!st&&!App.ui.siteStatusLoading){App.ui.siteStatusLoading=true;App.api.rpc("site_status",{}).then(r=>{App.ui.siteStatus=r||{};App.ui.siteStatusLoading=false;App.render()}).catch(e=>{App.ui.siteStatus={error:e.message};App.ui.siteStatusLoading=false;App.render()})}
  const whs=App.whs(true).filter(w=>w.id!==s.siteReserveWh);
  const hook=FN()+"site-api/woo-order",feed=FN()+"site-api/feed";
  return `<section class="card"><div class="card-h"><h2>Обмен с сайтом</h2>${st&&st.has_keys?'<span class="pill ok">ключи WooCommerce сохранены</span>':'<span class="pill warn">ключи не заданы</span>'}</div>
    <div class="banner warn">Сейчас база CRM — тестовая (Supabase, Франкфурт). Цены и остатки выгружать можно, а <b>приём заказов с настоящего сайта включайте только после переезда базы на российский сервер</b>: в заказах есть персональные данные покупателей (152-ФЗ).</div>
    <div class="form">
      <div class="fld full">${App.chk("ssSync","Выгружать на сайт цены, остатки и новые товары",s.siteSync)}</div>
      <div class="fld full">${App.chk("ssOrders","Принимать заказы с сайта (резерв товара и раздел «Заказы»)",s.siteOrders)}</div>
      ${App.fld("ssNew","Новые товары появляются на сайте",App.sel("ssNew",[["draft","Черновиком — проверю фото и опубликую сам"],["publish","Сразу опубликованными"]],s.siteNewStatus))}
      <div class="fld full"><label>Склады, остатки которых видны на сайте</label><div class="chips">${whs.map(w=>`<label class="chip ${s.siteWarehouses.includes(w.id)?"on":""}"><input type="checkbox" class="sswh" value="${esc(w.id)}" ${s.siteWarehouses.includes(w.id)?"checked":""} style="display:none">${esc(w.name)}</label>`).join("")}</div>
        <small class="muted">На сайте наличие = сумма по отмеченным складам. Заказ с сайта резервирует товар с этих складов на склад «Резерв · сайт».</small></div>
    </div>
    <div class="acts">${ed?'<button class="btn pri" data-act="siteSave">Сохранить</button>':""}</div></section>

  <section class="card"><div class="card-h"><h2>Подключение WooCommerce</h2></div>
    <ol class="steps">
      <li>В админке сайта: <b>WooCommerce → Настройки → Дополнительно → REST API → Добавить ключ</b>, права «Чтение/Запись». Скопируйте Consumer key и Consumer secret сюда — они хранятся в защищённом хранилище базы и больше нигде не показываются.</li>
      <li>Для заказов: <b>WooCommerce → Настройки → Дополнительно → Веб-хуки → Добавить</b>: тема «Заказ создан», адрес доставки — ниже, секрет — ключ API из этого раздела. Второй веб-хук такой же, тема «Заказ обновлён».</li>
      <li>У товаров в CRM отметьте «На сайте». Товары сопоставляются по артикулу (SKU), б/у экземпляры получают артикул «U-IMEI».</li>
    </ol>
    ${own?`<div class="form">
      ${App.fld("ssUrl","Адрес сайта",App.inp("ssUrl",s.siteUrl,"url","https://icase52.ru"),"full")}
      ${App.fld("ssKey","Consumer key",App.inp("ssKey","","password",st&&st.has_keys?"сохранён — введите, чтобы заменить":"ck_…",'autocomplete="off"'))}
      ${App.fld("ssSecret","Consumer secret",App.inp("ssSecret","","password",st&&st.has_keys?"сохранён — введите, чтобы заменить":"cs_…",'autocomplete="off"'))}
    </div><div class="acts"><button class="btn pri" data-act="siteKeys">Сохранить подключение</button></div>
    <div class="kvcopy"><span>Адрес веб-хука заказов</span><code>${esc(hook)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(hook)}">Копировать</button></div>
    <div class="kvcopy"><span>Каталог для сайта (JSON)</span><code>${esc(feed)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(feed)}">Копировать</button></div>
    <div class="kvcopy"><span>Ключ API (секрет веб-хука)</span><code id="ssApiKey">${App.ui.siteKey?esc(App.ui.siteKey):"••••••••••••"}</code>${App.ui.siteKey?`<button class="btn sm" data-act="copyTxt" data-id="${esc(App.ui.siteKey)}">Копировать</button><button class="btn sm ghost" data-act="siteKeyNew">Новый ключ</button>`:'<button class="btn sm" data-act="siteKeyShow">Показать</button>'}</div>`
    :'<p class="muted">Ключи подключения задаёт владелец.</p>'}
  </section>

  <section class="card"><div class="card-h"><h2>Состояние обмена</h2><div class="row-f">${ed?'<button class="btn sm" data-act="siteResync">Выгрузить всё заново</button><button class="btn sm pri" data-act="siteNow">Выгрузить сейчас</button>':""}</div></div>
    ${st&&st.error?`<div class="banner err">${esc(st.error)}</div>`:""}
    <div class="tiles"><div class="tile"><span>Последняя выгрузка</span><b class="mid">${s.siteLastSync?App.dtt(s.siteLastSync):"ещё не было"}</b>${s.siteLastError?`<small class="bad">${esc(s.siteLastError)}</small>`:'<small>без ошибок</small>'}</div>
      <div class="tile"><span>Товаров «на сайте»</span><b>${st?num(st.on_site):"…"}</b><small>связано с сайтом: ${st?num(st.linked):"…"}</small></div>
      <div class="tile"><span>В очереди</span><b>${st?num(st.pending):"…"}</b><small>с ошибкой: ${st?num(st.errors):"…"}</small></div></div>
    ${st&&(st.last_errors||[]).length?`<details class="more"><summary>Последние ошибки</summary><div class="list-mini">${st.last_errors.map(e=>`<div class="hist"><b>${esc(e.action)}</b> ${App.dtt(e.created_at)}<br><small>${esc(e.last_error)}</small></div>`).join("")}</div></details>`:""}
    <p class="muted">Изменения цен и остатков уходят на сайт автоматически в течение 2 минут.</p>
  </section>`;
};
ACT.siteSave=(_,btn)=>run(btn,async()=>{
  const wh=[...document.querySelectorAll(".sswh:checked")].map(x=>x.value);
  if(App.checked("ssSync")&&!wh.length)return App.toast("Отметьте хотя бы один склад для сайта");
  await App.api.update("settings",1,{site_sync:App.checked("ssSync"),site_orders:App.checked("ssOrders"),site_new_status:App.val("ssNew"),site_warehouses:wh});
  App.ui.siteStatus=null;App.toast("Сохранено");
});
ACT.siteKeys=(_,btn)=>run(btn,async()=>{
  const url=App.val("ssUrl");if(url&&!/^https:\/\//.test(url))return App.toast("Адрес сайта должен начинаться с https://");
  await App.api.rpc("site_set_credentials",{p_url:url,p_key:App.val("ssKey"),p_secret:App.val("ssSecret")},["settings"]);
  App.ui.siteStatus=null;App.toast("Подключение сохранено");
});
ACT.siteKeyShow=(_,btn)=>run(btn,async()=>{App.ui.siteKey=await App.api.rpc("site_api_key",{p_regenerate:false});App.render()});
ACT.siteKeyNew=(_,btn)=>{if(!App.confirm2(btn,"Нажмите ещё раз: старый ключ перестанет работать, его нужно будет заменить в веб-хуках сайта"))return;
  run(btn,async()=>{App.ui.siteKey=await App.api.rpc("site_api_key",{p_regenerate:true});App.render();App.toast("Создан новый ключ")})};
ACT.siteResync=(_,btn)=>run(btn,async()=>{const n=await App.api.rpc("site_resync",{});App.ui.siteStatus=null;App.toast("В очередь поставлено товаров: "+n);App.render()});
ACT.siteNow=(_,btn)=>run(btn,async()=>{const r=await App.api.invoke("site-sync");App.ui.siteStatus=null;await App.reload(["settings"]);
  App.toast(r&&r.skipped?"Выгрузка выключена или не заданы ключи":r&&r.error?r.error:"Готово: обновлено "+num(r&&r.updated)+", создано "+num(r&&r.created)+(num(r&&r.failed)?", ошибок "+num(r.failed):""));App.render()});
document.addEventListener("change",e=>{if(e.target.classList&&e.target.classList.contains("sswh"))e.target.parentElement.classList.toggle("on",e.target.checked)});
ACT.copyTxt=t=>{try{navigator.clipboard.writeText(t);App.toast("Скопировано")}catch(e){App.toast("Не удалось скопировать")}};
})();
