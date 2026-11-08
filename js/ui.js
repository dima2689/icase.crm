/* iCase CRM v3 · интерфейс: вход, отрисовка, окна, формы, поиск */
"use strict";
(function(){
const {S,$,esc,num,money}=App;

App.toast = t=>{const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(App.toast.t);App.toast.t=setTimeout(()=>el.hidden=true,3200)};
App.banner = (t,cls)=>{const b=$("#banner");b.textContent=t||"";b.className="banner"+(cls?" "+cls:"")};

/* ---------- навигация ---------- */
App.NAV = [
  ["dashboard","Сводка",'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',null],
  ["pos","Касса",'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 8h4M7 11h7"/>',"sale"],
  ["repairs","Ремонт",'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',"repair"],
  ["sales","Продажи",'<path d="M4 4h16v16l-3-2-3 2-2-2-2 2-3-2-3 2z"/><path d="M8 9h8M8 13h5"/>',"sale"],
  ["stock","Товары",'<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',null],
  ["receive","Приёмка",'<path d="M3 9l9-5 9 5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 9v7M9 13l3 3 3-3"/>',"stock"],
  ["docs","Склад",'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',"stock"],
  ["clients","Клиенты",'<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M19 15c2 .8 3 2.6 3 6"/>',"clients"],
  ["reports","Отчёты",'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',"reports"],
  ["print","Печать",'<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/><path d="M17 12h.01"/>',null],
  ["settings","Настройки",'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',"settings"]
];
App.navAllowed = v=>{const n=App.NAV.find(x=>x[0]===v);return n&&App.VIEWS[v]&&(!n[3]||App.can(n[3]))};
function drawNav(){
  const counts={repairs:S.repairs.filter(r=>App.ACTIVE.includes(r.status)).length,stock:S.products.filter(App.isLow).length};
  const items=App.NAV.filter(n=>App.VIEWS[n[0]]&&(!n[3]||App.can(n[3])));
  $("#navlist").innerHTML=items.map(([v,l,ic])=>`<a class="nav ${App.ui.view===v?"on":""}" href="#${v}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${ic}</svg><span>${l}</span>${counts[v]?`<span class="cnt">${counts[v]}</span>`:""}</a>`).join("");
  const sh=App.openShift(),pts=App.myPoints(),cur=App.point();
  $("#who").innerHTML=`<b>${esc(App.me.name)}</b><span>${esc(App.ROLES[App.me.role]||"")}</span>
    ${pts.length>1?`<select id="pointSel" aria-label="Точка">${pts.map(p=>`<option value="${esc(p.id)}"${cur&&cur.id===p.id?" selected":""}>${esc(p.name)}</option>`).join("")}</select>`:`<span>${esc(cur?cur.name:"Точка не выбрана")}</span>`}
    <span class="pill ${sh?"ok":"mute"}">${sh?"Смена "+esc(sh.num)+" открыта":"Смена закрыта"}</span>
    <button class="btn sm ghost" data-act="logout">Выйти</button>`;
  const ps=$("#pointSel");if(ps)ps.onchange=()=>{App.ui.pointId=ps.value;try{localStorage.setItem("icase_point",ps.value)}catch(e){}App.render()};
}

/* ---------- отрисовка ---------- */
let rq=0,lastView=null;
App.schedule = ()=>{if(rq)return;rq=requestAnimationFrame(()=>{rq=0;App.render();if(App.modalRefresh&&!$("#scrim").hidden)App.modalRefresh()})};
App.render = function(){
  if(!App.navAllowed(App.ui.view)){App.ui.view="dashboard"}
  drawNav();
  const V=App.VIEWS[App.ui.view];
  $("#title").textContent=App.TITLES[App.ui.view]||"";
  $("#top-acts").innerHTML=V&&V.actions?V.actions():"";
  // один поиск на экране: где у раздела свой поиск, общий скрываем
  const gs=document.querySelector(".top .search");if(gs){gs.style.display=V&&V.ownSearch?"none":"";if(V&&V.ownSearch)$("#gresults").hidden=true}
  // сохраняем фокус и курсор в полях фильтров
  const a=document.activeElement,fid=a&&a.id&&$("#view").contains(a)?a.id:null;let pos=null;try{pos=fid?a.selectionStart:null}catch(e){}
  // формы в разделе (настройки и т.п.) не теряют введённое при обновлении данных
  const dirty={};if(lastView===App.ui.view)$("#view").querySelectorAll("[data-dirty]").forEach(el=>{dirty[el.id]=el.type==="checkbox"?el.checked:el.value});
  lastView=App.ui.view;
  $("#view").innerHTML=V?V.render():"";
  Object.keys(dirty).forEach(k=>{const el=document.getElementById(k);if(el){if(el.type==="checkbox")el.checked=dirty[k];else el.value=dirty[k];el.dataset.dirty="1"}});
  if(fid){const n=document.getElementById(fid);if(n){n.focus();try{if(pos!=null)n.setSelectionRange(pos,pos)}catch(e){}}}
  if(V&&V.after)V.after();
};
App.route = function(){const h=location.hash.slice(1);App.ui.view=App.VIEWS[h]?h:"dashboard";App.render();$("#main").scrollTop=0;$("#rail").classList.remove("open")};

/* ---------- модальные окна ---------- */
App.modalRefresh=null;
App.openModal = function(html,{wide=false,refresh=null}={}){
  const m=$("#modal");m.className="modal"+(wide?" wide":"");m.innerHTML=html;$("#scrim").hidden=false;App.modalRefresh=refresh;
  if(!refresh){const f=m.querySelector("input:not([type=checkbox]):not([disabled]),select,textarea");if(f)f.focus()}
};
App.closeModal = ()=>{$("#scrim").hidden=true;$("#modal").innerHTML="";App.modalRefresh=null};
/* перерисовка окна без потери введённых значений */
App.redrawModal = function(html,after){
  const m=$("#modal"),keep={};
  m.querySelectorAll("input,select,textarea").forEach(el=>{if(el.id&&el.dataset.live!=="1")keep[el.id]=el.type==="checkbox"?el.checked:el.value});
  const f=document.activeElement&&document.activeElement.id,sc=m.parentElement.scrollTop;
  m.innerHTML=html;
  Object.keys(keep).forEach(k=>{const el=document.getElementById(k);if(el&&el.dataset.live!=="1"){if(el.type==="checkbox")el.checked=keep[k];else el.value=keep[k]}});
  if(f){const el=document.getElementById(f);if(el)el.focus()}
  m.parentElement.scrollTop=sc;if(after)after();
};
App.head = (t,extra="")=>`<div class="m-h"><h2>${t}</h2>${extra}<button class="btn ghost" data-act="close" aria-label="Закрыть">✕</button></div>`;
App.fld = (id,label,input,cls="")=>`<div class="fld ${cls}"><label for="${id}">${label}</label>${input}</div>`;
App.inp = (id,v="",type="text",ph="",attrs="")=>`<input id="${id}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}"${type==="number"?' inputmode="decimal" step="any"':""} ${attrs}>`;
App.sel = (id,opts,v="",attrs="")=>`<select id="${id}" ${attrs}>${opts.map(o=>{const [val,lab]=Array.isArray(o)?o:[o,o];return `<option value="${esc(val)}"${String(val)===String(v)?" selected":""}>${esc(lab)}</option>`}).join("")}</select>`;
App.area = (id,v="",ph="")=>`<textarea id="${id}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
App.chk = (id,label,on)=>`<label class="chk"><input type="checkbox" id="${id}" ${on?"checked":""}> ${label}</label>`;
App.whOpts = (all=false)=>App.whs().map(w=>[w.id,w.name]).concat(all?[]:[]);
App.catOpts = (withEmpty=true)=>{const out=withEmpty?[["","Без категории"]]:[];App.catChildren("").forEach(c=>{out.push([c.id,c.name]);App.catChildren(c.id).forEach(s=>out.push([s.id,"— "+s.name]))});return out};
App.statusPill = s=>{const x=App.RS[s]||{label:s,cls:"mute"};return `<span class="pill ${x.cls}">${esc(x.label)}</span>`};
App.payLabel = m=>App.PAY[m]||m||"—";
App.paysText = pays=>(pays||[]).filter(p=>num(p.amount)).map(p=>App.payLabel(p.method)+" "+money(p.amount)).join(" + ");
App.confirm2 = function(el,text){if(el.dataset.sure)return true;el.dataset.sure="1";const o=el.textContent;el.textContent=text||"Нажмите ещё раз для подтверждения";setTimeout(()=>{if(document.body.contains(el)){delete el.dataset.sure;el.textContent=o}},4000);return false};

App.textModal = function(title,text,hint){
  App.openModal(App.head(esc(title))+(hint?`<p class="muted">${esc(hint)}</p>`:"")+`<pre class="receipt" id="copytext">${esc(text)}</pre><div class="acts"><button class="btn pri" data-act="copy">Скопировать</button></div>`);
};
App.ACT.copy = async ()=>{const t=$("#copytext").textContent;try{await navigator.clipboard.writeText(t);App.toast("Скопировано")}catch(e){const r=document.createRange();r.selectNodeContents($("#copytext"));const s=getSelection();s.removeAllRanges();s.addRange(r);App.toast("Текст выделен: нажмите Ctrl+C")}};
App.ACT.close = App.closeModal;
App.ACT.nav = v=>{location.hash=v};
App.ACT.menu = ()=>$("#rail").classList.toggle("open");

/* ---------- поле клиента с поиском по телефону ---------- */
App.customerFields = function(prefix,c){
  return App.fld(prefix+"Phone","Телефон клиента",App.inp(prefix+"Phone",c?c.phone:"","tel","+7 9__ ___-__-__",'autocomplete="off"'))+
    App.fld(prefix+"Name","Имя",App.inp(prefix+"Name",c?c.name:"","text","Как обращаться"))+
    `<div class="fld full"><span class="hint" id="${prefix}Hint"></span></div>`;
};
App.bindCustomer = function(prefix,onFound){
  const ph=document.getElementById(prefix+"Phone"),nm=document.getElementById(prefix+"Name"),h=document.getElementById(prefix+"Hint");
  if(!ph)return;
  const upd=()=>{const c=App.findCustomerByPhone(ph.value);
    if(c){const sales=S.sales.filter(s=>s.customerId===c.id).length,reps=S.repairs.filter(r=>r.customerId===c.id).length;
      h.innerHTML=(c.blacklisted?'<span class="pill bad">Чёрный список</span> '+esc(c.blackReason||"")+" · ":"")+"В базе: <b>"+esc(c.name)+"</b> · покупок "+sales+", ремонтов "+reps+(num(c.discount)?" · скидка "+num(c.discount)+"%":"")+((c.tags||[]).length?" · "+esc(c.tags.join(", ")):"");
      h.className="hint "+(c.blacklisted?"bad":"ok");if(!nm.value)nm.value=c.name}
    else{h.textContent=App.phoneKey(ph.value).length===10?"Новый клиент: добавится в базу":"";h.className="hint"}
    if(onFound)onFound(c)};
  ph.addEventListener("input",upd);if(ph.value)upd();
};

/* ---------- выбор товара (поиск + сканер) ---------- */
App.productPicker = function(inputId,boxId,{wh=null,inStock=false,onPick,showCost=false}){
  const q=document.getElementById(inputId),box=document.getElementById(boxId);if(!q)return;
  const draw=()=>{const s=q.value.trim();if(!s){box.hidden=true;return}
    const whv=typeof wh==="function"?wh():wh;
    const list=App.searchProducts(s,{wh:whv,inStock,limit:10});
    box.innerHTML=list.length?list.map(p=>{const here=whv?App.qtyIn(p,whv):App.qtyTotal(p);const other=whv&&here<=0?App.whereElse(p,whv):"";
      return `<button type="button" data-pick="${esc(p.id)}"><span>${esc(p.name)}<small> · ${esc(App.catName(p))}${p.serial?" · "+esc(p.serial):""} · ${whv?"здесь ":"всего "}${here}${other?" · есть: "+esc(other):""}</small></span><b>${money(showCost?p.cost:p.price)}</b></button>`}).join(""):'<div class="empty">Не найдено'+(inStock?" в наличии":"")+'</div>';
    box.hidden=false};
  q.addEventListener("input",draw);
  q.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const u=App.findUnit?App.findUnit(q.value):null;const p=App.findByCode(q.value)||(App.searchProducts(q.value,{wh:typeof wh==="function"?wh():wh,inStock,limit:2}).length===1?App.searchProducts(q.value,{wh:typeof wh==="function"?wh():wh,inStock,limit:1})[0]:null);
    if(p){q.value="";box.hidden=true;onPick(p,u||null)}else App.toast("Код не найден: уточните поиск")}});
  box.addEventListener("click",e=>{const b=e.target.closest("[data-pick]");if(!b)return;e.preventDefault();e.stopPropagation();const p=App.byId("products",b.dataset.pick);q.value="";box.hidden=true;if(p)onPick(p);q.focus()});
};

/* ---------- вход ---------- */
App.showApp=()=>{$("#login").hidden=true;$(".app").hidden=false};
App.showLogin=function(mode){
  $(".app").hidden=true;const L=$("#login");L.hidden=false;
  const reg=mode==="register",np=mode==="newpass";
  L.innerHTML=`<form class="login-card" id="loginForm"><div class="brand"><b>iCase</b><span>CRM</span></div>
    <h1>${np?"Новый пароль":reg?"Регистрация сотрудника":"Вход"}</h1>
    ${reg?App.fld("lgName","Имя и фамилия",App.inp("lgName","","text","",'autocomplete="name" required')):""}
    ${np?"":App.fld("lgEmail","Email",App.inp("lgEmail","","email","",'autocomplete="username" required'))}
    ${App.fld("lgPass",np?"Новый пароль":"Пароль",App.inp("lgPass","","password","",(reg||np?'autocomplete="new-password" minlength="8"':'autocomplete="current-password"')+" required"))}
    <div class="hint bad" id="lgErr"></div>
    <button class="btn pri big" type="submit">${np?"Сохранить пароль":reg?"Зарегистрироваться":"Войти"}</button>
    ${np?"":`<div class="acts" style="justify-content:space-between"><button class="btn ghost sm" type="button" id="lgSwitch">${reg?"У меня есть аккаунт":"Я новый сотрудник"}</button>${reg?"":`<button class="btn ghost sm" type="button" id="lgReset">Забыли пароль?</button>`}</div>`}
  </form>`;
  const e=$("#lgErr");
  $("#loginForm").onsubmit=async ev=>{ev.preventDefault();e.textContent="";const b=ev.target.querySelector("button[type=submit]");b.disabled=true;
    try{
      if(np){const {error}=await App.sb.auth.updateUser({password:App.val("lgPass")});if(error)throw error;location.hash="";location.reload();return}
      if(reg){const d=await App.auth.signUp(App.val("lgEmail"),App.val("lgPass"),App.val("lgName"));
        if(!d.session){L.querySelector("form").innerHTML='<div class="brand"><b>iCase</b><span>CRM</span></div><h1>Почти готово</h1><p>Мы отправили письмо на '+App.esc(App.val("lgEmail")||"ваш email")+'. Откройте ссылку из письма, затем войдите.</p><button class="btn pri" type="button" onclick="location.reload()">Ко входу</button>';return}
        await App.enter(d.session.user);return}
      await App.auth.signIn(App.val("lgEmail"),App.val("lgPass"));const {data}=await App.sb.auth.getSession();await App.enter(data.session.user);
    }catch(x){e.textContent=x.message||String(x);b.disabled=false}};
  const sw=$("#lgSwitch");if(sw)sw.onclick=()=>App.showLogin(reg?"":"register");
  const rs=$("#lgReset");if(rs)rs.onclick=async()=>{const em=App.val("lgEmail");if(!em){e.textContent="Введите email, на него придёт ссылка";return}
    try{await App.auth.reset(em);e.className="hint ok";e.textContent="Ссылка для смены пароля отправлена на "+em}catch(x){e.textContent=x.message}};
};
App.showPending=function(noOwner,disabled){
  $(".app").hidden=true;const L=$("#login");L.hidden=false;
  L.innerHTML=`<div class="login-card"><div class="brand"><b>iCase</b><span>CRM</span></div>
    ${disabled?`<h1>Доступ отключён</h1><p>Владелец отключил ваш доступ к CRM. Если это ошибка, свяжитесь с ним.</p>`:
    noOwner?`<h1>Первый вход</h1><p>В CRM ещё нет сотрудников. Станьте владельцем: вы сможете добавить точки, склады и назначить роли остальным.</p>
      ${App.fld("ownName","Ваше имя",App.inp("ownName",App.me.name===App.me.email?"":App.me.name,"text"))}<div class="hint bad" id="ownErr"></div><button class="btn pri big" id="ownBtn">Я владелец iCase</button>`:
    `<h1>Ждём подтверждения</h1><p>Вы вошли как ${App.esc(App.me.email)}. Владелец увидит вашу заявку в «Настройки → Сотрудники» и назначит роль и точку. После этого обновите страницу.</p>
      ${App.fld("reqName","Как вас зовут",App.inp("reqName",App.me.name===App.me.email?"":App.me.name,"text"))}<div class="hint" id="reqHint"></div><button class="btn pri" id="reqBtn">Отправить заявку</button>`}
    <div class="acts" style="margin-top:12px"><button class="btn ghost sm" onclick="location.reload()">Обновить</button><button class="btn ghost sm" id="outBtn">Выйти</button></div></div>`;
  $("#outBtn").onclick=()=>App.auth.signOut();
  const ob=$("#ownBtn");if(ob)ob.onclick=async()=>{ob.disabled=true;try{await App.claimOwner(App.val("ownName"))}catch(x){$("#ownErr").textContent=x.message;ob.disabled=false}};
  const rb=$("#reqBtn");if(rb){const send=async()=>{try{await App.requestAccess(App.val("reqName")||App.me.email);$("#reqHint").className="hint ok";$("#reqHint").textContent="Заявка отправлена владельцу"}catch(x){$("#reqHint").className="hint bad";$("#reqHint").textContent=x.message}};rb.onclick=send;if(!disabled)send()}
};
App.ACT.logout=()=>App.auth.signOut();

/* ---------- глобальный поиск ---------- */
function gsearch(){
  const q=App.val("gsearch").toLowerCase(),box=$("#gresults");if(q.length<2){box.hidden=true;return}
  const k=App.phoneKey(q),out=[];
  S.repairs.forEach(r=>{if([r.num,r.device,r.imei].join(" ").toLowerCase().includes(q))out.push(`<button data-act="openRepair" data-id="${esc(r.id)}"><b>Ремонт ${esc(r.num)}</b> · ${esc(r.device)} <small>${esc((App.RS[r.status]||{}).label)}</small></button>`)});
  S.customers.forEach(c=>{if(!c.mergedInto&&(String(c.name).toLowerCase().includes(q)||(k.length>=4&&App.phoneKey(c.phone).includes(k))))out.push(`<button data-act="openClient" data-id="${esc(c.id)}"><b>${esc(c.name)}</b> <small>${esc(c.phone)}</small></button>`)});
  if(q.length>=4)S.units.filter(u=>[u.imei,u.imei2,u.serialNo].some(x=>x&&x.toLowerCase().includes(q))).slice(0,6).forEach(u=>{const p=App.byId("products",u.productId)||{};out.push(`<button data-act="openUnit" data-id="${esc(u.id)}"><b>${esc(App.unitCode(u))}</b> <small>${esc(p.name||"")} · ${esc((App.UNIT_ST[u.status]||[u.status])[0])}</small></button>`)});
  App.searchProducts(q,{limit:8}).forEach(p=>out.push(`<button data-act="openProduct" data-id="${esc(p.id)}"><b>${esc(p.name)}</b> <small>${App.qtyTotal(p)} шт · ${money(p.price)}</small></button>`));
  S.sales.forEach(s=>{if(String(s.num).toLowerCase().includes(q))out.push(`<button data-act="openSale" data-id="${esc(s.id)}"><b>Продажа ${esc(s.num)}</b> <small>${App.dtt(s.createdAt)} · ${money(s.total)}</small></button>`)});
  S.docs.forEach(d=>{if(String(d.num).toLowerCase().includes(q))out.push(`<button data-act="openDoc" data-id="${esc(d.id)}"><b>${esc(App.DOCT[d.type].one)} ${esc(d.num)}</b> <small>${App.dt(d.createdAt)}</small></button>`)});
  box.innerHTML=out.slice(0,14).join("")||'<div class="empty">Ничего не найдено</div>';box.hidden=false;
}

/* ---------- обработчики ---------- */
document.addEventListener("click",e=>{
  const el=e.target.closest("[data-act]");
  if(!el){if(!e.target.closest(".search"))$("#gresults").hidden=true;if(e.target===$("#scrim"))App.closeModal();return}
  const fn=App.ACT[el.dataset.act];if(!fn)return;
  e.preventDefault();$("#gresults").hidden=true;
  const opener=["openRepair","openClient","openProduct","openSale","openDoc","openShift"].includes(el.dataset.act);
  if(opener&&el.closest("#modal"))App.closeModal();
  Promise.resolve().then(()=>fn(el.dataset.id,el,e)).catch(err=>{console.error(err);App.toast(err&&err.message?err.message:"Ошибка")});
});
document.addEventListener("input",e=>{
  const t=e.target;
  if(t.id==="gsearch")return gsearch();
  if(t.id&&$("#view").contains(t)&&!t.dataset.filter&&!t.dataset.filterSel&&!t.dataset.pos&&!t.dataset.cart&&t.type!=="search"&&!t.closest("[data-nodirty]"))t.dataset.dirty="1";
  if(t.dataset&&t.dataset.filter){App.ui[t.dataset.filter]=t.value;App.render()}
});
document.addEventListener("change",e=>{const t=e.target;if(t.dataset&&t.dataset.filterSel){App.ui[t.dataset.filterSel]=t.type==="checkbox"?t.checked:t.value;App.render()}});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&!$("#scrim").hidden)App.closeModal();
  if(e.key==="/"&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();const own=$("#view input[type=search]");(own&&own.offsetParent?own:$("#gsearch")).focus()}
});
window.addEventListener("hashchange",()=>{if(App.me.role)App.route()});
})();
