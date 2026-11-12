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
        <span class="cav ${o.status==="new"?"":"mute"}">${o.problems?App.ico("alert"):App.ico("cart")}</span>
        <span class="cnm"><b>${esc(o.num)} · ${esc(o.name||"Без имени")}</b><span class="cpills">${soSt(o)}${o.paid?' <span class="pill ok">оплачен</span>':""}</span><small>${App.dtt(o.createdAt)} · ${esc((o.items||[]).map(i=>i.name+(i.qty>1?" ×"+i.qty:"")).join(", "))}</small>${o.problems?`<small class="bad">${esc(o.problems)}</small>`:""}</span>
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
      ${open&&can?`<div class="acts"><button class="btn" data-act="printSO" data-id="${esc(id)}">Печать</button><button class="btn danger" data-act="soCancel" data-id="${esc(id)}">Отменить заказ</button>${o.status==="new"?`<button class="btn" data-act="soConfirm" data-id="${esc(id)}">Подтвердить</button>`:""}<button class="btn pri" data-act="soPay" data-id="${esc(id)}">Провести продажу</button></div>`:`<div class="acts"><button class="btn" data-act="printSO" data-id="${esc(id)}">Печать</button><button class="btn" data-act="close">Закрыть</button></div>`}`);
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
  const s=App.settings(),own=App.can("staff"),ed=App.can("settings"),st=App.ui.siteStatus,custom=s.siteMode!=="woocommerce";
  if(!st&&!App.ui.siteStatusLoading){App.ui.siteStatusLoading=true;App.api.rpc("site_status",{}).then(r=>{App.ui.siteStatus=r||{};App.ui.siteStatusLoading=false;App.render()}).catch(e=>{App.ui.siteStatus={error:e.message};App.ui.siteStatusLoading=false;App.render()})}
  const whs=App.whs(true).filter(w=>w.id!==s.siteReserveWh);
  const api=FN()+"site-api",hook=FN()+"site-api/woo-order";
  const copy=(label,val,id)=>`<div class="kvcopy"><span>${label}</span><code${id?` id="${id}"`:""}>${esc(val)}</code><button class="btn sm" data-act="copyTxt" data-id="${esc(val)}">Копировать</button></div>`;
  const secret=(label,key,act,actNew)=>`<div class="kvcopy"><span>${label}</span><code>${App.ui[key]?esc(App.ui[key]):"••••••••••••"}</code>${App.ui[key]?`<button class="btn sm" data-act="copyTxt" data-id="${esc(App.ui[key])}">Копировать</button><button class="btn sm ghost" data-act="${actNew}">Новый</button>`:`<button class="btn sm" data-act="${act}">Показать</button>`}</div>`;
  const test=App.ui.siteTest?`<div class="banner ${App.ui.siteTest.ok?"ok":"err"}">${App.ui.siteTest.ok?(App.ui.siteTest.mode==="custom"?(App.ui.siteTest.hook?"Сайт принял проверочное уведомление — подпись и адрес верные.":esc(App.ui.siteTest.note||"Готово")):"Подключение работает."+(App.ui.siteTest.sample?" Сайт отвечает, пример товара: «"+esc(App.ui.siteTest.sample)+"».":"")+((App.ui.siteTest.global_attributes||[]).length?" Атрибуты сайта: "+esc(App.ui.siteTest.global_attributes.join(", "))+".":"")):"Не удалось: "+esc(App.ui.siteTest.error||"")}</div>`:"";
  return `<section class="card"><div class="card-h"><h2>Обмен с сайтом</h2>${custom?'<span class="pill info">свой сайт · API</span>':(st&&st.has_keys?'<span class="pill ok">ключи WooCommerce сохранены</span>':'<span class="pill warn">ключи не заданы</span>')}</div>
    <div class="banner warn">Сейчас база CRM — тестовая (Supabase, Франкфурт). Каталог отдавать можно, а <b>приём заказов с настоящего сайта включайте только после переезда базы на российский сервер</b>: в заказах есть персональные данные покупателей (152-ФЗ).</div>
    <div class="form">
      ${App.fld("ssMode","Какой сайт",App.sel("ssMode",[["custom","Свой сайт (Next.js, React и др.) — сайт берёт данные по API"],["woocommerce","WordPress + WooCommerce — CRM сама обновляет товары на сайте"]],custom?"custom":"woocommerce"),"full")}
      <div class="fld full">${App.chk("ssSync",custom?"Отдавать каталог сайту и сообщать об изменениях":"Выгружать на сайт цены, остатки и новые товары",s.siteSync)}</div>
      <div class="fld full">${App.chk("ssOrders","Принимать заказы с сайта (резерв товара и раздел «Заказы»)",s.siteOrders)}</div>
      ${custom?"":App.fld("ssNew","Новые товары появляются на сайте",App.sel("ssNew",[["draft","Черновиком — проверю фото и опубликую сам"],["publish","Сразу опубликованными"]],s.siteNewStatus))}
      <div class="fld full"><label>Склады, остатки которых видны на сайте</label><div class="chips">${whs.map(w=>`<label class="chip ${s.siteWarehouses.includes(w.id)?"on":""}"><input type="checkbox" class="sswh" value="${esc(w.id)}" ${s.siteWarehouses.includes(w.id)?"checked":""} style="display:none">${esc(w.name)}</label>`).join("")}</div>
        <small class="muted">На сайте наличие = сумма по отмеченным складам. Заказ с сайта резервирует товар с этих складов на склад «Резерв · сайт».</small></div>
    </div>
    <div class="acts">${ed?'<button class="btn pri" data-act="siteSave">Сохранить</button>':""}</div></section>

  ${App.siteFieldsCard()}
  ${custom?`<section class="card"><div class="card-h"><h2>Подключение сайта (API)</h2></div>
    <ol class="steps">
      <li>В проект сайта добавьте готовые файлы для Next.js (кнопка ниже) и переменные окружения <code>ICASE_API_URL</code>, <code>ICASE_API_KEY</code>, <code>ICASE_HOOK_SECRET</code> — значения здесь.</li>
      <li>Сайт берёт каталог, карточки и категории по API с кэшем, а по уведомлению CRM сразу сбрасывает кэш — цены и наличие на сайте обновляются за секунды.</li>
      <li>Оформленный на сайте заказ уходит в CRM, товар резервируется, заказ появляется в разделе «Заказы».</li>
    </ol>
    ${copy("Адрес API (ICASE_API_URL)",api)}
    ${own?secret("Ключ API (ICASE_API_KEY)","siteKey","siteKeyShow","siteKeyNew")+secret("Секрет уведомлений (ICASE_HOOK_SECRET)","siteHookKey","siteHookShow","siteHookNew"):'<p class="muted">Ключи показываются только владельцу.</p>'}
    <div class="form" style="margin-top:10px">${App.fld("ssHook","Адрес уведомлений сайта",App.inp("ssHook",s.siteHookUrl,"url","https://ваш-сайт.ru/api/icase",ed?"":"disabled"),"full")}</div>
    <div class="acts">${ed?'<button class="btn" data-act="siteTest">Проверить подключение</button><button class="btn pri" data-act="siteHookSave">Сохранить адрес</button>':""}<a class="btn" href="${esc(App.NEXT_KIT||"#")}" download="icase-nextjs.zip" ${App.NEXT_KIT?"":'data-act="siteKitInfo"'}>Файлы для Next.js</a></div>
    ${test}
    <details class="more"><summary>Методы API</summary><div class="apidoc">
      <p><code>GET /catalog</code> — товары: <code>q, category, in_stock=1, type=product|used_unit, sort=price|-price|name, page, per_page</code></p>
      <p><code>GET /product?slug=</code> (или <code>sku=</code>, <code>id=</code>) — карточка товара</p>
      <p><code>GET /categories</code> — категории с количеством в наличии</p>
      <p><code>POST /order</code> — заказ: <code>{id, customer:{name,phone,email}, items:[{sku,qty,price}], delivery, address, comment, paid}</code></p>
      <p><code>GET /order-status?num=С-…&amp;phone=1234</code> — статус заказа для покупателя</p>
      <p>Все запросы — с сервера сайта с заголовком <code>X-Api-Key</code>. Уведомления CRM приходят POST-запросом с заголовками <code>X-Icase-Event</code> и <code>X-Icase-Signature</code> (HMAC-SHA256 тела, base64).</p></div></details>
  </section>`
  :`<section class="card"><div class="card-h"><h2>Подключение WooCommerce</h2></div>
    <ol class="steps">
      <li>В админке сайта: <b>WooCommerce → Настройки → Дополнительно → REST API → Добавить ключ</b>, права «Чтение/Запись». Скопируйте Consumer key и Consumer secret сюда — они хранятся в защищённом хранилище базы и больше нигде не показываются.</li>
      <li>Для заказов: <b>WooCommerce → Настройки → Дополнительно → Веб-хуки → Добавить</b>: тема «Заказ создан», адрес доставки — ниже, секрет — ключ API из этого раздела. Второй веб-хук такой же, тема «Заказ обновлён».</li>
      <li>У товаров в CRM отметьте «На сайте». Товары сопоставляются по артикулу (SKU), б/у экземпляры получают артикул «U-IMEI».</li>
    </ol>
    ${own?`<div class="form">
      ${App.fld("ssUrl","Адрес сайта",App.inp("ssUrl",s.siteUrl,"url","https://…"),"full")}
      ${App.fld("ssKey","Consumer key",App.inp("ssKey","","password",st&&st.has_keys?"сохранён — введите, чтобы заменить":"ck_…",'autocomplete="off"'))}
      ${App.fld("ssSecret","Consumer secret",App.inp("ssSecret","","password",st&&st.has_keys?"сохранён — введите, чтобы заменить":"cs_…",'autocomplete="off"'))}
    </div><div class="acts"><button class="btn" data-act="siteTest">Проверить подключение</button><button class="btn pri" data-act="siteKeys">Сохранить подключение</button></div>
    ${test}${copy("Адрес веб-хука заказов",hook)}${secret("Ключ API (секрет веб-хука)","siteKey","siteKeyShow","siteKeyNew")}`
    :'<p class="muted">Ключи подключения задаёт владелец.</p>'}
  </section>`}

  <section class="card"><div class="card-h"><h2>Состояние обмена</h2><div class="row-f">${ed?`<button class="btn sm" data-act="siteResync">${custom?"Уведомить сайт обо всём":"Выгрузить всё заново"}</button><button class="btn sm pri" data-act="siteNow">${custom?"Отправить сейчас":"Выгрузить сейчас"}</button>`:""}</div></div>
    ${st&&st.error?`<div class="banner err">${esc(st.error)}</div>`:""}
    <div class="tiles"><div class="tile"><span>${custom?"Последнее уведомление":"Последняя выгрузка"}</span><b class="mid">${s.siteLastSync?App.dtt(s.siteLastSync):"ещё не было"}</b>${s.siteLastError?`<small class="bad">${esc(s.siteLastError)}</small>`:'<small>без ошибок</small>'}</div>
      <div class="tile"><span>Товаров «на сайте»</span><b>${st?num(st.on_site):"…"}</b><small>${custom?"отдаются по API":"связано с сайтом: "+(st?num(st.linked):"…")}</small></div>
      <div class="tile"><span>В очереди</span><b>${st?num(st.pending):"…"}</b><small>с ошибкой: ${st?num(st.errors):"…"}</small></div></div>
    ${st&&(st.last_errors||[]).length?`<details class="more"><summary>Последние ошибки</summary><div class="list-mini">${st.last_errors.map(e=>`<div class="hist"><b>${esc(e.action)}</b> ${App.dtt(e.created_at)}<br><small>${esc(e.last_error)}</small></div>`).join("")}</div></details>`:""}
    <p class="muted">${custom?"Об изменениях цен, остатков и товаров сайт узнаёт в течение 2 минут; без адреса уведомлений — по таймеру кэша сайта (5 минут).":"Изменения цен и остатков уходят на сайт автоматически в течение 2 минут."}</p>
  </section>`;
};
ACT.siteSave=(_,btn)=>run(btn,async()=>{
  const wh=[...document.querySelectorAll(".sswh:checked")].map(x=>x.value);
  if(App.checked("ssSync")&&!wh.length)return App.toast("Отметьте хотя бы один склад для сайта");
  await App.api.update("settings",1,{site_mode:App.val("ssMode"),site_sync:App.checked("ssSync"),site_orders:App.checked("ssOrders"),site_new_status:App.val("ssNew")||App.settings().siteNewStatus||"draft",site_warehouses:wh});
  App.ui.siteStatus=null;App.toast("Сохранено");
});
ACT.siteKeys=(_,btn)=>run(btn,async()=>{
  const url=App.val("ssUrl");if(url&&!/^https:\/\//.test(url))return App.toast("Адрес сайта должен начинаться с https://");
  await App.api.rpc("site_set_credentials",{p_url:url,p_key:App.val("ssKey"),p_secret:App.val("ssSecret")},["settings"]);
  App.ui.siteStatus=null;App.toast("Подключение сохранено");
});
/* что передавать на сайт */
const SF_DEF={create:{categories:true,attributes:true,description:true,photos:true},
  update:{price:true,stock:true,status:true,name:false,categories:false,attributes:false,description:false,photos:false},
  attrs:{brand:true,model:true,memory:true,color:true,condition:true,warranty:true,battery:true,kit:true,used:true,extra:true},global_attrs:true};
const sfNow=()=>{const f=App.settings().siteFields||{};return{create:{...SF_DEF.create,...(f.create||{})},update:{...SF_DEF.update,...(f.update||{})},attrs:{...SF_DEF.attrs,...(f.attrs||{})},global_attrs:f.global_attrs!==false}};
const SF_LBL={
  create:[["categories","Категория (создаётся на сайте, если её нет)"],["attributes","Характеристики"],["description","Описание (у б/у — состояние, АКБ, комплект, диагностика)"],["photos","Фото из карточки товара"]],
  update:[["price","Цена"],["stock","Остаток"],["status","Прятать проданное, снятое с сайта и архив"],["name","Название"],["categories","Категория"],["attributes","Характеристики"],["description","Описание"],["photos","Фото"]],
  attrs:[["brand","Бренд"],["model","Модель"],["memory","Память"],["color","Цвет"],["condition","Состояние"],["warranty","Гарантия"],["battery","Ёмкость АКБ (б/у)"],["kit","Комплект (б/у)"],["used","Параметры б/у: циклы, корпус, экран, ремонт, Face ID, True Tone, регион"],["extra","Доп. параметры из карточки: SIM, ОЗУ, размер и др."]]};
App.siteFieldsCard=()=>{const f=sfNow(),ed=App.can("settings"),custom=App.settings().siteMode!=="woocommerce";
  const box=(g,k,l)=>`<label class="chk sfchk"><input type="checkbox" data-sitef="${g}.${k}" ${f[g][k]?"checked":""} ${ed?"":"disabled"}> ${esc(l)}</label>`;
  return `<section class="card"><div class="card-h"><h2>Что передавать на сайт</h2></div>
    <div class="sfgrid ${custom?"two":""}">
      <div><h3 class="sub-h">${custom?"Поля товара":"Новая карточка на сайте"}</h3><label class="chk sfchk"><input type="checkbox" checked disabled> Название, артикул, цена, наличие${custom?", адрес (slug)":""} — всегда</label>${SF_LBL.create.map(([k,l])=>box("create",k,l)).join("")}</div>
      ${custom?"":`<div><h3 class="sub-h">Обновление существующей</h3>${SF_LBL.update.map(([k,l])=>box("update",k,l)).join("")}
        <small class="muted">Название, категорию, описание и фото лучше не включать, если вы правите их на сайте вручную — CRM их перезапишет.</small></div>`}
      <div><h3 class="sub-h">Характеристики</h3>${SF_LBL.attrs.map(([k,l])=>box("attrs",k,l)).join("")}
        <label class="chk sfchk"><input type="checkbox" data-sitef="global_attrs" ${f.global_attrs?"checked":""} ${ed?"":"disabled"}> Использовать атрибуты сайта с тем же названием (для фильтров каталога)</label></div>
    </div>
    ${ed?'<div class="acts"><button class="btn pri" data-act="siteFieldsSave">Сохранить</button></div>':""}
    <p class="muted">После сохранения товары, уже связанные с сайтом, выгрузятся заново по новым правилам. Как конкретный товар уйдёт на сайт — кнопка «Как уйдёт на сайт» в карточке товара.</p></section>`};
ACT.siteFieldsSave=(_,btn)=>run(btn,async()=>{const f=sfNow();
  document.querySelectorAll("[data-sitef]").forEach(x=>{const [g,k]=x.dataset.sitef.split(".");if(k)f[g][k]=x.checked;else f[g]=x.checked});
  await App.api.update("settings",1,{site_fields:f});App.toast("Сохранено")});
ACT.siteTest=(_,btn)=>run(btn,async()=>{App.ui.siteTest=await App.api.invoke("site-sync",{test:true});App.render()});
/* предпросмотр: как товар уйдёт на сайт */
ACT.sitePreview=(id,btn)=>run(btn,async()=>{
  const r=await App.api.invoke("site-sync",{preview:id});const p=App.byId("products",id)||{};
  const show=v=>Array.isArray(v)?(v.length&&v[0]&&v[0].options?v.map(a=>`${esc(a.name||("атрибут сайта #"+a.id))}: <b>${esc(a.options.join(", "))}</b>`).join("<br>"):v.map(x=>esc(x.name||x.src||JSON.stringify(x))).join("<br>")):typeof v==="string"&&/^</.test(v)?`<div class="pvdesc">${v}</div>`:esc(String(v));
  const HV={manage_stock:{true:"да",false:"нет"},stock_status:{instock:"в наличии",outofstock:"нет в наличии"},status:{draft:"черновик (не виден покупателям)",publish:"опубликован",private:"скрыт"}};
  const L={name:"Название",sku:"Артикул",regular_price:"Цена",manage_stock:"Учёт остатка",stock_quantity:"Остаток",stock_status:"Наличие",status:"Статус",categories:"Категория",attributes:"Характеристики",description:"Описание",images:"Фото"};
  const tbl=o=>{const ks=Object.keys(o).filter(k=>k!=="type");return ks.length?`<dl class="kv pv">${ks.map(k=>`<dt>${L[k]||k}</dt><dd>${HV[k]&&HV[k][String(o[k])]?HV[k][String(o[k])]:o[k]===""||(Array.isArray(o[k])&&!o[k].length)?'<span class="muted">—</span>':show(o[k])}</dd>`).join("")}</dl>`:'<p class="muted">Ничего не меняется</p>'};
  if(r.mode==="custom"){
    const SL={id:"ID в CRM",sku:"Артикул",slug:"Адрес (slug)",type:"Тип",name:"Название",price:"Цена",in_stock:"В наличии",qty:"Количество",visible:"Показывать",category:"Категория",specs:"Характеристики",brand:"Бренд",model:"Модель",memory:"Память",color:"Цвет",condition:"Состояние",warranty_months:"Гарантия, мес.",battery:"АКБ, %",description:"Описание",photos:"Фото"};
    const val=(k,v)=>v===null||v===undefined||v===""||(Array.isArray(v)&&!v.length)?'<span class="muted">—</span>':k==="specs"?v.map(x=>`${esc(x.name)}: <b>${esc(x.value)}</b>`).join("<br>"):k==="type"?(v==="used_unit"?"б/у экземпляр":"товар"):typeof v==="boolean"?(v?"да":"нет"):Array.isArray(v)?v.map(x=>esc(x)).join(k==="category"?" / ":"<br>"):esc(String(v));
    return App.openModal(App.head("Как товар видит сайт: "+esc(p.name||""))+`<p class="muted">Так товар отдаётся сайту по API (<code>GET /product</code>). Закупочные цены не передаются.</p>`+((r.items||[]).map(it=>`<section class="pvbox"><h3 class="sub-h">${it.kind==="unit"?"Экземпляр":"Товар"} ${esc(it.sku)} ${it.visible?'<span class="pill ok">на сайте</span>':'<span class="pill mute">скрыт</span>'}</h3>
      <dl class="kv pv">${Object.entries(it.api).map(([k,v])=>`<dt>${SL[k]||k}</dt><dd>${val(k,v)}</dd>`).join("")}</dl>
      <details class="more"><summary>JSON</summary><pre class="pvjson">${esc(JSON.stringify(it.api,null,2))}</pre></details></section>`).join("")||'<p class="muted">Товар не отмечен «На сайте» или нет на складах сайта.</p>'),{wide:true});
  }
  App.openModal(App.head("Как уйдёт на сайт: "+esc(p.name||""))+((r.items||[]).map(it=>`<section class="pvbox"><h3 class="sub-h">${it.kind==="unit"?"Экземпляр "+esc(it.sku):"Товар "+esc(it.sku)} ${it.visible?'<span class="pill ok">на сайте</span>':'<span class="pill mute">скрыт</span>'}${it.woo_id?' <span class="pill info">связан, #'+it.woo_id+"</span>":""}</h3>
    ${it.woo_id?`<p class="muted">Карточка уже есть на сайте — при изменениях уйдёт:</p>${tbl(it.update)}`:`<p class="muted">Карточки на сайте ещё нет — будет создана:</p>${tbl(it.create)}`}</section>`).join("")||'<p class="muted">Товар не отмечен «На сайте» или нет на складах сайта.</p>'),{wide:true});
});
ACT.siteHookSave=(_,btn)=>run(btn,async()=>{const u=App.val("ssHook");if(u&&!/^https:\/\//.test(u))return App.toast("Адрес должен начинаться с https://");
  await App.api.update("settings",1,{site_hook_url:u||null});App.toast("Сохранено")});
ACT.siteHookShow=(_,btn)=>run(btn,async()=>{App.ui.siteHookKey=await App.api.rpc("site_hook_secret",{p_regenerate:false});App.render()});
ACT.siteHookNew=(_,btn)=>{if(!App.confirm2(btn,"Нажмите ещё раз: старый секрет перестанет работать, его нужно заменить на сайте"))return;
  run(btn,async()=>{App.ui.siteHookKey=await App.api.rpc("site_hook_secret",{p_regenerate:true});App.render();App.toast("Создан новый секрет")})};
ACT.siteKitInfo=()=>App.toast("Файлы для Next.js лежат в репозитории CRM: integrations/nextjs");
ACT.siteKeyShow=(_,btn)=>run(btn,async()=>{App.ui.siteKey=await App.api.rpc("site_api_key",{p_regenerate:false});App.render()});
ACT.siteKeyNew=(_,btn)=>{if(!App.confirm2(btn,"Нажмите ещё раз: старый ключ перестанет работать, его нужно будет заменить в веб-хуках сайта"))return;
  run(btn,async()=>{App.ui.siteKey=await App.api.rpc("site_api_key",{p_regenerate:true});App.render();App.toast("Создан новый ключ")})};
ACT.siteResync=(_,btn)=>run(btn,async()=>{const n=await App.api.rpc("site_resync",{});App.ui.siteStatus=null;App.toast("В очередь поставлено товаров: "+n);App.render()});
ACT.siteNow=(_,btn)=>run(btn,async()=>{const r=await App.api.invoke("site-sync");App.ui.siteStatus=null;await App.reload(["settings"]);
  App.toast(r&&r.skipped?"Выгрузка выключена или не заданы ключи":r&&r.error?r.error:"Готово: обновлено "+num(r&&r.updated)+", создано "+num(r&&r.created)+(num(r&&r.failed)?", ошибок "+num(r.failed):""));App.render()});
document.addEventListener("change",e=>{if(e.target.classList&&e.target.classList.contains("sswh"))e.target.parentElement.classList.toggle("on",e.target.checked)});
ACT.copyTxt=t=>{try{navigator.clipboard.writeText(t);App.toast("Скопировано")}catch(e){App.toast("Не удалось скопировать")}};
})();
