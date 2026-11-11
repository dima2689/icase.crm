/* iCase CRM v3 · клиенты (Supabase) */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.clients="Клиенты";
Object.assign(App.ui,{clientQ:"",clientTag:"",clientSort:"last"});
function stat(c){
  const s=S.sales.filter(x=>x.customerId===c.id),r=S.repairs.filter(x=>x.customerId===c.id),ret=S.returns.filter(x=>x.customerId===c.id);
  const spent=s.reduce((a,x)=>a+num(x.total),0)-ret.reduce((a,x)=>a+num(x.amount),0)+r.filter(x=>x.status==="done"||x.status==="cancel").reduce((a,x)=>a+num(x.finalPrice),0);
  const last=[...s.map(x=>x.createdAt),...r.map(x=>x.createdAt)].sort().pop()||c.createdAt;
  return{s,r,ret,spent,last};
}
VIEWS.clients={
  ownSearch:true,
  actions:()=>(App.can("io")?'<button class="btn" data-act="exportDlg" data-id="customers">Экспорт</button><button class="btn" data-act="importDlg" data-id="customers">Импорт</button>':"")+'<button class="btn pri" data-act="newClient">+ Клиент</button>',
  render(){
    const u=App.ui,q=u.clientQ.toLowerCase(),qk=App.phoneKey(u.clientQ);
    const tags=[...new Set(S.customers.flatMap(c=>c.tags||[]))].sort();
    let rows=S.customers.filter(c=>!c.mergedInto&&(!q||String(c.name).toLowerCase().includes(q)||(qk.length>=3&&App.phoneKey(c.phone).includes(qk))||String(c.email||"").toLowerCase().includes(q))&&(!u.clientTag||(u.clientTag==="__black"?c.blacklisted:(c.tags||[]).includes(u.clientTag))))
      .map(c=>Object.assign({c},stat(c)));
    rows.sort((a,b)=>u.clientSort==="spent"?b.spent-a.spent:u.clientSort==="name"?String(a.c.name).localeCompare(b.c.name):String(b.last).localeCompare(String(a.last)));
    const dup=dupGroups().length;
    return `<div class="cfilt"><input id="clientQ" type="search" placeholder="Имя, телефон, email" value="${esc(u.clientQ)}" data-filter="clientQ" aria-label="Поиск клиента">
      ${App.sel("clientTag",[["","Все клиенты"],["__black","Чёрный список"],...tags.map(t=>[t,"Метка: "+t])],u.clientTag,'data-filter-sel="clientTag" aria-label="Фильтр"')}
      ${App.sel("clientSort",[["last","Сначала недавние"],["spent","По сумме покупок"],["name","По имени"]],u.clientSort,'data-filter-sel="clientSort" aria-label="Сортировка"')}</div>
    ${dup?`<div class="banner info">Похоже на дубликаты: ${dup} ${dup===1?"группа":"группы"} клиентов с одинаковым именем. <button class="btn sm" data-act="showDups">Посмотреть</button></div>`:""}
    <section class="card crow-list">${rows.slice(0,300).map(({c,spent})=>{const ini=String(c.name||"").replace(/\([^)]*\)/g," ").split(/\s+/).map(w=>w.replace(/[^A-Za-zА-Яа-яЁё0-9]/g,"")).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
      return `<button type="button" class="crow" data-act="openClient" data-id="${esc(c.id)}"><span class="cav ${c.blacklisted?"bad":""}">${esc(ini)}</span>
        <span class="cnm"><b>${esc(c.name)}${c.blacklisted?' <span class="pill bad">ЧС</span>':""}</b><small>${esc(c.phone)}</small></span>
        <span class="csum">${money(spent)}</span></button>`}).join("")||'<div class="empty">Клиенты не найдены</div>'}
    </section>`;
  }
};
function dupGroups(){const m={};S.customers.filter(c=>!c.mergedInto&&c.name&&c.name!=="Без имени").forEach(c=>{const k=c.name.trim().toLowerCase();(m[k]=m[k]||[]).push(c)});return Object.values(m).filter(g=>g.length>1)}
ACT.showDups=()=>{const g=dupGroups();App.openModal(App.head("Возможные дубликаты")+`<div class="list-mini">${g.map(gr=>gr.map(c=>`<button data-act="openClient" data-id="${esc(c.id)}"><span>${esc(c.name)}<small>${esc(c.phone)} · с ${App.dt(c.createdAt)}</small></span><span class="pill">открыть</span></button>`).join("")).join('<hr>')}</div><p class="muted">Откройте лишнюю карточку и нажмите «Объединить с…».</p>`)};

ACT.newClient=()=>clientForm(null);
ACT.editClient=id=>clientForm(id);
function clientForm(id){
  const c=id?App.cust(id):{source:"Магазин",discount:0,tags:[]};
  App.openModal(App.head(id?"Изменить клиента":"Новый клиент")+`<div class="form">
    ${App.fld("cName","Имя",App.inp("cName",c.name))}${App.fld("cPhone","Телефон",App.inp("cPhone",c.phone,"tel","+7"))}
    ${App.fld("cPhone2","Доп. телефон",App.inp("cPhone2",c.phone2,"tel"))}${App.fld("cEmail","Email",App.inp("cEmail",c.email,"email"))}
    ${App.fld("cBirth","День рождения",App.inp("cBirth",c.birthday,"date"))}${App.fld("cSource","Откуда",App.sel("cSource",App.SOURCES,c.source))}
    ${App.fld("cDisc","Персональная скидка, %",App.inp("cDisc",c.discount||"","number","0",App.can("price")?"":"disabled"))}${App.fld("cTags","Метки через запятую",App.inp("cTags",(c.tags||[]).join(", "),"text","VIP, оптовик"))}
    ${App.fld("cNote","Заметка",App.area("cNote",c.note||"","Устройства, предпочтения, договорённости"),"full")}
    <div class="fld full">${App.chk("cBlack","Чёрный список (предупреждать на кассе и при приёме)",c.blacklisted)}</div>
    ${App.fld("cBlackR","Причина",App.inp("cBlackR",c.blackReason),"full")}
  </div><div class="acts"><button class="btn" data-act="close">Отмена</button><button class="btn pri" data-act="saveClient" data-id="${esc(id||"")}">Сохранить</button></div>`);
}
ACT.saveClient=async(id,btn)=>{
  const V=App.val,k=App.phoneKey(V("cPhone"));
  if(k.length!==10)return App.toast("Нужен телефон: 10 цифр после +7");
  const dup=S.customers.find(x=>!x.mergedInto&&App.phoneKey(x.phone)===k&&x.id!==id);if(dup)return App.toast("Этот телефон уже у клиента «"+dup.name+"»");
  const p2=App.phoneKey(V("cPhone2"));
  const data={name:V("cName")||"Без имени",phone:k,phone2:p2.length===10?p2:null,email:V("cEmail")||null,birthday:V("cBirth")||null,source:V("cSource"),
    tags:V("cTags").split(",").map(s=>s.trim()).filter(Boolean),note:V("cNote")||null,blacklisted:App.checked("cBlack"),black_reason:V("cBlackR")||null};
  if(App.can("price"))data.discount=Math.min(100,num(V("cDisc")));
  if(btn.disabled)return;btn.disabled=true;
  try{if(id)await App.api.update("customers",id,data);else await App.api.insert("customers",data);App.closeModal();App.toast("Клиент сохранён")}
  catch(e){btn.disabled=false;App.toast(e.message)}
};
ACT.openClient=id=>{
  const draw=()=>{
    let c=App.cust(id);if(!c)return App.closeModal();
    if(c.mergedInto){id=c.mergedInto;c=App.cust(id);if(!c)return App.closeModal()}
    const {s,r,ret,spent}=stat(c);
    App.redrawModal(App.head(esc(c.name),(c.blacklisted?'<span class="pill bad">Чёрный список</span>':"")+`<button class="btn sm" data-act="editClient" data-id="${esc(id)}">Изменить</button>`)+`
    ${c.blacklisted?`<div class="banner err">${esc(c.blackReason||"Клиент в чёрном списке")}</div>`:""}
    <div class="tiles"><div class="tile"><span>Телефон</span><b class="mid">${esc(c.phone)}</b>${c.phone2?`<small>${esc(c.phone2)}</small>`:""}</div><div class="tile"><span>Сумма покупок</span><b>${money(spent)}</b><small>средний чек ${money(s.length?s.reduce((a,x)=>a+num(x.total),0)/s.length:0)}</small></div><div class="tile"><span>Покупок</span><b>${s.length}</b><small>возвратов ${ret.length}</small></div><div class="tile"><span>Ремонтов</span><b>${r.length}</b></div></div>
    <dl class="kv"><dt>Откуда</dt><dd>${esc(c.source||"—")}</dd><dt>Email</dt><dd>${esc(c.email||"—")}</dd><dt>День рождения</dt><dd>${c.birthday?App.dt(c.birthday):"—"}</dd><dt>Скидка</dt><dd>${num(c.discount)?num(c.discount)+"%":"—"}</dd><dt>Метки</dt><dd>${esc((c.tags||[]).join(", ")||"—")}</dd><dt>Последний визит</dt><dd>${App.dt(stat(c).last)}</dd><dt>В базе с</dt><dd>${App.dt(c.createdAt)}</dd><dt>Заметка</dt><dd>${esc(c.note||"—")}</dd></dl>
    <section><h3 class="sub-h">Ремонты</h3><div class="list-mini">${App.sortDesc(r).map(x=>`<button data-act="openRepair" data-id="${esc(x.id)}"><span>${esc(x.num)} · ${esc(x.device)}<small>${App.dt(x.createdAt)} · ${esc(x.problem)}</small></span>${App.statusPill(x.status)}</button>`).join("")||'<div class="hist">Нет</div>'}</div></section>
    <section><h3 class="sub-h">Покупки</h3><div class="list-mini">${App.sortDesc(s).map(App.saleMini).join("")||'<div class="hist">Нет</div>'}</div></section>
    <div class="acts"><button class="btn" data-act="printClient" data-id="${esc(id)}">Печать</button>${App.can("del")?`<button class="btn" data-act="mergeDlg" data-id="${esc(id)}">Объединить с…</button>`:""}${App.can("repair")?`<button class="btn" data-act="repairFor" data-id="${esc(id)}">Принять в ремонт</button>`:""}${App.can("sale")?`<button class="btn pri" data-act="saleFor" data-id="${esc(id)}">Продать</button>`:""}</div>`);
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
ACT.mergeDlg=id=>{
  const c=App.cust(id);
  App.openModal(App.head("Объединить «"+esc(c.name)+"»")+`<p class="muted">Эта карточка станет дубликатом: её покупки, ремонты и возвраты перейдут к выбранному клиенту.</p>
  <div class="fld"><label for="mQ">Основной клиент (телефон или имя)</label><input id="mQ" type="search" autocomplete="off"><div class="pick" id="mPick"></div></div>`);
  const q=$("#mQ"),box=$("#mPick");
  q.addEventListener("input",()=>{const s=q.value.toLowerCase(),k=App.phoneKey(q.value);
    box.innerHTML=S.customers.filter(x=>x.id!==id&&!x.mergedInto&&(String(x.name).toLowerCase().includes(s)||(k.length>=4&&App.phoneKey(x.phone).includes(k)))).slice(0,8)
      .map(x=>`<button data-act="mergeOk" data-id="${esc(id)}|${esc(x.id)}"><span>${esc(x.name)}<small> · ${esc(x.phone)}</small></span></button>`).join("")||'<div class="empty">Не найдено</div>'});
};
ACT.mergeOk=async(arg,el)=>{
  const [from,to]=arg.split("|");if(!App.confirm2(el,"Подтвердите: нажмите ещё раз"))return;
  try{await App.api.rpc("merge_customers",{p_from:from,p_to:to},["customers","sales","returns","audit_log"]);App.closeModal();App.toast("Клиенты объединены");ACT.openClient(to)}
  catch(e){App.toast(e.message)}
};
})();
