/* iCase CRM v3 · подтверждение создания и удаления товаров, объединение карточек */
"use strict";
(function(){
const {S,$,esc,ACT}=App;
App.isApprover=()=>["owner","manager"].includes(App.me.role);
App.apprOn=k=>!!((App.settings().approvals||{})[k]);
App.apprCount=()=>App.isApprover()?S.products.filter(p=>p.approval).length:0;
const mine=p=>p.approvalBy&&p.approvalBy===App.me.id;
const run=(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;return Promise.resolve().then(fn).catch(e=>App.toast(e.message||String(e))).finally(()=>{if(btn)btn.disabled=false})};
const RL=["products","log","stock","units","movements"];

App.apprPill=(p,sp="")=>p.approval==="pending_create"?sp+'<span class="pill warn">ждёт подтверждения</span>':p.approval==="pending_delete"?sp+'<span class="pill bad">запрошено удаление</span>':"";

/* блок в карточке товара */
App.apprPanel=p=>{if(!p.approval)return "";const by=esc(App.nameOf(p.approvalBy)),at=App.dtt(p.approvalAt),ap=App.isApprover();
  if(p.approval==="pending_create")return `<div class="apprbox warn"><div><b>Новый товар ждёт подтверждения</b><span>Завёл ${by} · ${at}. Пока не подтверждён, его можно принять на склад, но нельзя продать.</span></div>
    <div class="acts">${ap?`<button class="btn" data-act="prodMergeDlg" data-id="${esc(p.id)}">Это дубль — объединить…</button><button class="btn danger" data-act="prodReject" data-id="${esc(p.id)}">Отклонить</button><button class="btn pri" data-act="prodApprove" data-id="${esc(p.id)}">Подтвердить</button>`:'<span class="muted">Решение примет управляющий или владелец</span>'}</div></div>`;
  return `<div class="apprbox bad"><div><b>Запрошено удаление</b><span>${by} · ${at}${p.approvalNote?` · «${esc(p.approvalNote)}»`:""}</span></div>
    <div class="acts">${ap?`<button class="btn" data-act="prodReject" data-id="${esc(p.id)}">Оставить товар</button><button class="btn danger" data-act="prodApprove" data-id="${esc(p.id)}">Удалить</button>`:mine(p)?`<button class="btn" data-act="prodCancelReq" data-id="${esc(p.id)}">Отозвать запрос</button>`:'<span class="muted">Ждёт решения управляющего</span>'}</div></div>`};

/* кнопка удаления в карточке: напрямую или запросом */
App.prodDelBtn=(p,moves)=>{if(p.approval==="pending_delete")return "";
  const lbl=(moves&&moves.length)||App.qtyTotal(p)>0?(p.archived?"Вернуть из архива":"В архив"):"Удалить";
  const merge=App.isApprover()&&!p.approval?`<button class="btn" data-act="prodMergeDlg" data-id="${esc(p.id)}">Объединить…</button>`:"";
  if(App.isApprover()||(App.can("stock")&&(p.archived||!App.apprOn("productDelete"))))return merge+`<button class="btn danger" data-act="delProduct" data-id="${esc(p.id)}">${lbl}</button>`;
  if(App.can("stock"))return `<button class="btn danger" data-act="prodReqDel" data-id="${esc(p.id)}">Запросить удаление</button>`;
  return ""};

ACT.prodReqDel=id=>{const p=App.byId("products",id);if(!p)return;
  App.openModal(App.head("Запрос на удаление")+`<p><b>${esc(p.name)}</b></p><p class="muted">Управляющий или владелец получат запрос и решат: удалить, отправить в архив или оставить.</p>
    ${App.fld("prdNote","Причина",App.inp("prdNote","","text","Дубль или больше не продаём"),"full")}
    <div class="acts"><button class="btn" data-act="openProduct" data-id="${esc(id)}">Назад</button><button class="btn danger" data-act="prodReqGo" data-id="${esc(id)}">Отправить запрос</button></div>`)};
ACT.prodReqGo=(id,btn)=>run(btn,async()=>{await App.api.rpc("product_request_delete",{p_id:id,p_note:App.val("prdNote")||null});await App.reload(RL);App.closeModal();App.toast("Запрос отправлен")});
ACT.prodCancelReq=(id,btn)=>run(btn,async()=>{await App.api.rpc("product_cancel_request",{p_id:id});await App.reload(RL);App.closeModal();App.toast("Запрос отозван")});
const RES={approved:"Товар подтверждён",deleted:"Товар удалён",archived:"У товара есть история — он отправлен в архив",kept:"Запрос отклонён, товар оставлен",merged:"Карточки объединены"};
ACT.prodApprove=(id,btn)=>run(btn,async()=>{const p=App.byId("products",id);if(p&&p.approval==="pending_delete"&&!App.confirm2(btn,"Удалить? Нажмите ещё раз"))return;
  const r=await App.api.rpc("product_decide",{p_id:id,p_ok:true,p_note:null,p_merge_into:null});await App.reload(RL);App.closeModal();App.toast(RES[r]||"Готово")});
ACT.prodReject=(id,btn)=>run(btn,async()=>{const p=App.byId("products",id);if(p&&p.approval==="pending_create"&&!App.confirm2(btn,"Отклонить и удалить карточку? Ещё раз"))return;
  const r=await App.api.rpc("product_decide",{p_id:id,p_ok:false,p_note:null,p_merge_into:null});await App.reload(RL);App.closeModal();App.toast(RES[r]||"Готово")});

/* история карточки из журнала (видят те, кому доступен журнал) */
App.prodHist=p=>{if(!App.can("log"))return "";const L=App.sortDesc(S.log.filter(l=>l.entity==="product"&&l.entityId===p.id),"at").slice(0,10);if(!L.length)return "";
  return `<section><h3 class="sub-h">История карточки</h3><div class="tbl-wrap"><table><tbody>${L.map(l=>`<tr><td>${App.dtt(l.at)}</td><td>${esc(l.action)}</td><td>${esc(l.details)}</td><td>${esc(App.nameOf(l.by))}</td></tr>`).join("")}</tbody></table></div></section>`};

/* объединение дублей */
let MG=null;
ACT.prodMergeDlg=id=>{const p=App.byId("products",id);if(!p)return;MG={from:id,to:null};drawMerge()};
function drawMerge(){const a=App.byId("products",MG.from),b=MG.to&&App.byId("products",MG.to);
  App.openModal(App.head("Объединить карточки")+`<p class="muted">Всё, что есть у «${esc(a.name)}» — остатки, IMEI, продажи, приёмки, история, — перейдёт в выбранный товар, а эта карточка будет удалена. Отменить нельзя.</p>
    <div class="fld full"><label for="mgQ">Оставить товар</label><input id="mgQ" type="search" autocomplete="off" placeholder="Название, артикул, штрихкод"><div id="mgBox" class="pick" hidden></div></div>
    ${b?`<div class="apprbox"><div><b>${esc(a.name)}</b><span>${App.qtyTotal(a)} шт → будет удалён</span></div><div style="font-size:20px">→</div><div><b>${esc(b.name)}</b><span>${App.qtyTotal(b)} шт, станет ${App.qtyTotal(a)+App.qtyTotal(b)} шт</span></div></div>`:""}
    <div class="acts"><button class="btn" data-act="openProduct" data-id="${esc(MG.from)}">Назад</button><button class="btn pri" data-act="prodMergeGo" ${b?"":"disabled"}>Объединить</button></div>`);
  App.productPicker("mgQ","mgBox",{inStock:false,onPick:p=>{if(p.id===MG.from)return App.toast("Выберите другой товар");if(!!p.trackSerial!==!!a.trackSerial)return App.toast("Нельзя объединить товар с IMEI и товар без IMEI");MG.to=p.id;drawMerge()}})}
ACT.prodMergeGo=(_,btn)=>run(btn,async()=>{if(!MG||!MG.to)return;const a=App.byId("products",MG.from);
  if(a&&a.approval)await App.api.rpc("product_decide",{p_id:MG.from,p_ok:false,p_note:null,p_merge_into:MG.to});else await App.api.rpc("product_merge",{p_from:MG.from,p_into:MG.to});
  const to=MG.to;MG=null;await App.reload(RL.concat(["docs","sales","porders","sprices"]));App.closeModal();App.toast("Карточки объединены");ACT.openProduct(to)});

/* сводка и раздел «Товары»: что ждёт решения */
App.apprTile=()=>{const n=App.apprCount();if(!n)return "";const c=S.products.filter(p=>p.approval==="pending_create").length;
  return `<button class="tile click" data-act="apprList"><span>Товары ждут решения</span><b>${n}</b><small>${c?"новых "+c:""}${c&&n-c?" · ":""}${n-c?"удалить "+(n-c):""}</small></button>`};
ACT.apprList=()=>{App.ui.sf.appr=true;App.ui.sf.arch=false;if(App.ui.view!=="stock")location.hash="stock";else App.render()};
ACT.apprAll=()=>{App.ui.sf.appr=false;App.render()};
const sv=App.VIEWS.stock;if(sv){const r0=sv.render.bind(sv);sv.render=function(){const n=App.apprCount(),f=App.ui.sf||{};
  const bar=f.appr?`<div class="apprbar"><b>Показаны товары, ждущие решения</b><button class="btn sm" data-act="apprAll">Показать все</button></div>`
    :n?`<div class="apprbar"><span>Ждут решения управляющего: <b>${n}</b></span><button class="btn sm" data-act="apprList">Показать</button></div>`:"";
  return bar+r0()}}
})();
