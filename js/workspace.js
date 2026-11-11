/* iCase CRM v3 · рабочие места: «Касса», «Сервис» и полная CRM на одной базе
   Адрес: ?ws=pos | ?ws=service | ?ws=crm. Без параметра — последнее выбранное или по роли:
   продавец → Касса, мастер → Сервис, остальные → CRM. Каждое место грузит только нужные данные. */
"use strict";
(function(){
const {S,$,esc,ACT}=App;
const WS={
  pos:{title:"Касса",home:"pos",need:"sale",
    nav:["pos","repairs","preorders","receive","sales","orders","stock","clients","tasks","print"],
    tabs:[["pos","Касса"],["repairs","Ремонт"],["__scan","Скан"],["clients","Клиенты"],["__more","Ещё"]],
    skip:["sprices","finaccounts","fincats","finops","finplans","debts","porders","payrules","unitcosts","log","staffreq","docs"]},
  service:{title:"Сервис",home:"repairs",need:"repair",
    nav:["repairs","stock","clients","tasks","print"],
    tabs:[["repairs","Ремонт"],["stock","Запчасти"],["__scan","Скан"],["tasks","Задачи"],["__more","Ещё"]],
    skip:["sprices","finaccounts","fincats","finops","finplans","debts","porders","payrules","log","staffreq","docs","evotor","deals","siteorders","bonusops","lostdemand"]},
  crm:{title:"CRM",home:"dashboard",need:null,nav:null,
    tabs:[["pos","Касса"],["repairs","Ремонт"],["__scan","Скан"],["tasks","Задачи"],["__more","Ещё"]],skip:[]}
};
App.WS=WS;
const DEF={seller:"pos",master:"service"};
App.wsAllowed=w=>!!WS[w]&&(!WS[w].need||App.can(WS[w].need));
App.wsList=()=>Object.keys(WS).filter(App.wsAllowed);
const param=()=>{try{return new URLSearchParams(location.search).get("ws")||""}catch(e){return ""}};
App.ws="crm";
App.pickWs=()=>{let w=param();const key="icase_ws_"+(App.me.id||"");
  if(!App.wsAllowed(w)){try{w=localStorage.getItem(key)||""}catch(e){w=""}}
  if(!App.wsAllowed(w))w=DEF[App.me.role]&&App.wsAllowed(DEF[App.me.role])?DEF[App.me.role]:"crm";
  try{localStorage.setItem(key,w)}catch(e){}
  App.ws=w;document.documentElement.dataset.ws=w;
  document.title=(document.title.startsWith("Демо")?"Демо · ":"")+"iCase "+WS[w].title;
  const br=document.querySelector(".rail .brand span");if(br)br.textContent=WS[w].title;
  return w};
App.wsSkip=c=>WS[App.ws].skip.includes(c);
App.wsHome=()=>{const h=WS[App.ws].home;return App.VIEWS[h]&&App.navAllowed(h)?h:"dashboard"};
App.wsHas=v=>!WS[App.ws].nav||WS[App.ws].nav.includes(v);
App.wsTabs=()=>WS[App.ws].tabs;
/* переход в другое рабочее место — с перезагрузкой, чтобы подгрузились нужные данные */
ACT.wsGo=w=>{if(!App.wsAllowed(w))return;try{localStorage.setItem("icase_ws_"+App.me.id,w)}catch(e){}
  location.href=location.pathname+"?ws="+w+"#"+WS[w].home};
App.wsSwitch=()=>{const l=App.wsList();if(l.length<2)return "";
  return `<div class="wsswitch" role="group" aria-label="Рабочее место">${l.map(w=>`<button type="button" class="${App.ws===w?"on":""}" data-act="wsGo" data-id="${w}"${App.ws===w?' aria-current="true"':""}>${WS[w].title}</button>`).join("")}</div>`};

/* ---------- касса: приём и выдача ремонта прямо с экрана продажи ---------- */
const pv=App.VIEWS.pos;
if(pv){const r0=pv.render.bind(pv);pv.render=function(){const html=r0();if(!App.point())return html;if(!App.can("repair"))return (App.pzStrip?`<div class="posrep"><b>Предзаказ</b>${App.pzStrip()}</div>`:"")+html;
  const pt=(App.point()||{}).id,ready=S.repairs.filter(r=>r.status==="ready"&&(!r.pointId||r.pointId===pt)).sort((a,b)=>String(a.readyAt||"").localeCompare(String(b.readyAt||"")));
  const pzs=App.pzStrip?`<div class="posrep"><b>Предзаказ</b>${App.pzStrip()}</div>`:"";
  const strip=`<div class="posrep"><b>Ремонт</b><button class="btn sm pri" data-act="newRepair">+ Принять в ремонт</button>
    ${ready.length?`<span class="muted">Готовы к выдаче:</span>${ready.slice(0,4).map(r=>{const c=App.cust(r.customerId)||{};return `<button class="btn sm" data-act="repIssue" data-id="${esc(r.id)}" title="${esc(r.device)}">${esc(r.num)} · ${esc((c.name||"").split(" ")[0]||r.device)}</button>`}).join("")}${ready.length>4?`<a class="btn sm ghost" href="#repairs">ещё ${ready.length-4}</a>`:""}`:'<span class="muted">Готовых к выдаче нет</span>'}</div>`;
  return (App.ws!=="crm"&&App.installCard?App.installCard():"")+strip+pzs+html}}
const rv=App.VIEWS.repairs;
if(rv){const r1=rv.render.bind(rv);rv.render=function(){return (App.ws==="service"&&App.installCard?App.installCard():"")+r1.apply(this,arguments)}}
})();
