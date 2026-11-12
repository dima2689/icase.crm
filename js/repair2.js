/* iCase CRM v3 · ремонт, часть 2: фото и чек-лист осмотра, графический ключ, наклейка с QR, модель и прайс по моделям,
   заявки на запчасти, мастера и сроки, согласование клиентом по ссылке, устройства клиента */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS}=App;
const run=async(btn,fn)=>{if(btn&&btn.disabled)return;if(btn)btn.disabled=true;try{await fn()}catch(e){App.toast(e.message||String(e))}finally{if(btn&&document.body.contains(btn))btn.disabled=false}};

/* ---------- модель устройства из текста ---------- */
const mk=s=>String(s||"").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();
App.detectModel=text=>{const t=mk(text);if(!t)return null;let best=null;
  S.models.forEach(m=>{const n=mk(m.name);if(n&&(t===n||t.startsWith(n+" ")||t.includes(" "+n+" ")||t.endsWith(" "+n)||t.includes(n+","))&&(!best||n.length>mk(best.name).length))best=m});
  if(!best)S.models.forEach(m=>{const n=mk(m.name);if(n&&t.includes(n)&&(!best||n.length>mk(best.name).length))best=m});return best};
App.repModel=r=>(r.modelId&&App.byId("models",r.modelId))||App.detectModel(r.device);
/* прайс работ для модели: [{svc, price, part}] — цена модели, иначе базовая */
App.modelPrice=modelId=>{const rows=S.svcprices.filter(x=>x.modelId===modelId);return rows.map(x=>({svc:App.byId("services",x.serviceId),price:x.price,part:x.partId?App.byId("products",x.partId):null})).filter(x=>x.svc)
  .sort((a,b)=>String(a.svc.group||"").localeCompare(b.svc.group||"")||String(a.svc.name).localeCompare(b.svc.name))};
const partStock=(p,wh)=>p?(wh?App.qtyIn(p,wh):App.qtyTotal(p)):0;

/* ---------- чек-лист осмотра ---------- */
App.CHECK=["Экран","Сенсор","Корпус / рамка","Задняя крышка","Камеры","Face ID / Touch ID","Кнопки","Динамики и микрофон","Зарядка","Wi-Fi / Bluetooth","Связь / SIM","Следы влаги"];
const CS={"":["—","не проверено",""],ok:["✓","в порядке","ok"],bad:["✕","дефект","bad"],na:["?","не проверить","mute"]};
const nextS=v=>({"":"ok",ok:"bad",bad:"na",na:""})[v||""];
App.checkHtml=(pref,state={},ro=false)=>`<div class="chk-grid">${App.CHECK.map(k=>{const v=state[k]||"";return `<button type="button" class="chkst ${CS[v][2]}" ${ro?"disabled":`data-act="chkToggle" data-id="${esc(pref+"|"+k)}"`} title="${esc(k)}: ${CS[v][1]}"><i>${CS[v][0]}</i><span>${esc(k)}</span></button>`}).join("")}</div>`;
const CK={};   // состояние чек-листа в открытой форме: {pref: {item: state}}
ACT.chkToggle=v=>{const [p,k]=v.split(/\|(.*)/s);CK[p]=CK[p]||{};if(p==="out"){const o=document.getElementById("issOk");if(o)o.classList.remove("on")}CK[p][k]=nextS(CK[p][k]);const b=document.querySelector(`[data-act="chkToggle"][data-id="${CSS.escape(v)}"]`);
  if(b){const s=CK[p][k]||"";b.className="chkst "+CS[s][2];b.querySelector("i").textContent=CS[s][0];b.title=k+": "+CS[s][1]}};
ACT.chkAll=v=>{const [p,s]=v.split("|");CK[p]={};App.CHECK.forEach(k=>CK[p][k]=s);const box=document.getElementById("chk_"+p);if(box)box.innerHTML=App.checkHtml(p,CK[p]);
  const ok=document.getElementById("issOk");if(ok&&p==="out"&&s==="ok")ok.classList.add("on")};
const checkSummary=st=>{const e=Object.entries(st||{}),of=v=>e.filter(([,x])=>x===v).map(([k])=>k),bad=of("bad"),na=of("na"),ok=of("ok");
  const out=[];if(bad.length)out.push("дефект: "+bad.join(", "));if(na.length)out.push(na.length>=App.CHECK.length-1?"не включается, проверить нельзя":"не проверить: "+na.join(", "));
  if(!out.length&&ok.length)out.push(ok.length>=App.CHECK.length?"всё в порядке":"в порядке: "+ok.length+" из "+App.CHECK.length);
  const t=out.join("; ");return t?t[0].toUpperCase()+t.slice(1):""};

/* ---------- графический ключ ---------- */
let PAT=[];
ACT.patOpen=()=>{PAT=[];const box=$("#patBox");if(!box)return;box.hidden=!box.hidden;drawPat()};
function drawPat(){const box=$("#patBox");if(!box)return;
  box.innerHTML=`<div class="patgrid">${[1,2,3,4,5,6,7,8,9].map(n=>{const i=PAT.indexOf(n);return `<button type="button" class="patdot ${i>=0?"on":""}" data-act="patTap" data-id="${n}">${i>=0?i+1:""}</button>`}).join("")}</div>
    <div class="row-f"><span class="muted">${PAT.length?"Ключ: "+PAT.join("-"):"Нажмите точки по порядку, как рисует клиент"}</span><button type="button" class="btn sm ghost" data-act="patClear">Сбросить</button><button type="button" class="btn sm pri" data-act="patOk">Готово</button></div>`}
ACT.patTap=n=>{n=+n;if(PAT.includes(n))return;PAT.push(n);drawPat()};
ACT.patClear=()=>{PAT=[];drawPat()};
ACT.patOk=()=>{const i=$("#rPass");if(i&&PAT.length)i.value="Ключ: "+PAT.join("-");const box=$("#patBox");if(box)box.hidden=true};
App.patSvg=s=>{const m=String(s||"").match(/Ключ:\s*([1-9](?:-[1-9])+)/);if(!m)return "";const pts=m[1].split("-").map(Number),xy=n=>[((n-1)%3)*30+15,Math.floor((n-1)/3)*30+15];
  return `<svg viewBox="0 0 90 90" width="72" height="72" class="patsvg" aria-label="Графический ключ ${m[1]}">${[1,2,3,4,5,6,7,8,9].map(n=>{const [x,y]=xy(n);return `<circle cx="${x}" cy="${y}" r="4" fill="${pts.includes(n)?"#2563EB":"#ccc"}"/>`}).join("")}<polyline points="${pts.map(n=>xy(n).join(",")).join(" ")}" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${xy(pts[0])[0]}" cy="${xy(pts[0])[1]}" r="7" fill="none" stroke="#2563EB" stroke-width="2"/></svg>`};

/* ---------- фото ---------- */
const BUCKET="repair-photos";
async function shrink(file){if(!/^image\//.test(file.type))throw new Error("Это не фото");
  const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=URL.createObjectURL(file)});
  const k=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(img.src);return await new Promise(ok=>c.toBlob(ok,"image/jpeg",.82))}
App.repUploadPhotos=async(r,files,kind="intake")=>{let n=0;for(const f of files){const blob=await shrink(f),path=`${r.id}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2,7)}.jpg`;
  const {error}=await App.sb.storage.from(BUCKET).upload(path,blob,{contentType:"image/jpeg",upsert:false});if(error)throw new Error("Фото не загрузилось: "+error.message);
  await App.api.insert("repair_photos",{repair_id:r.id,path,kind,created_by:App.me.id});n++}return n};
const URLS=new Map();
async function signed(paths){const need=paths.filter(p=>{const u=URLS.get(p);return !u||u.exp<Date.now()});
  if(need.length){const {data}=await App.sb.storage.from(BUCKET).createSignedUrls(need,3600);(data||[]).forEach(x=>{if(x.signedUrl)URLS.set(x.path,{url:x.signedUrl,exp:Date.now()+3300e3})})}}
App.fillPhotos=async()=>{const imgs=[...document.querySelectorAll("img[data-ph]")];if(!imgs.length)return;try{await signed([...new Set(imgs.map(i=>i.dataset.ph))])}catch(e){}
  imgs.forEach(i=>{const u=URLS.get(i.dataset.ph);if(u&&i.getAttribute("src")!==u.url)i.src=u.url})};
const KIND={intake:"при приёме",work:"в работе",issue:"при выдаче"};
const photosHtml=r=>{const ph=r.photos||[];return `<div class="phgrid">${ph.map(p=>`<button type="button" class="ph" data-act="phView" data-id="${esc(p.path)}" title="${esc(KIND[p.kind]||"")} · ${esc(App.dtt(p.at))}"><img data-ph="${esc(p.path)}" alt="Фото ${esc(KIND[p.kind]||"")}"><small>${esc(KIND[p.kind]||"")}</small></button>`).join("")}
  <label class="ph add" title="Добавить фото"><input type="file" accept="image/*" capture="environment" multiple data-phup="${esc(r.id)}" hidden><span>+ Фото</span></label></div>`};
document.addEventListener("change",async e=>{const t=e.target;if(!t.dataset||!t.dataset.phup||!t.files.length)return;const r=App.byId("repairs",t.dataset.phup);if(!r)return;
  const kind=["done","ready"].includes(r.status)?"issue":["new","diag"].includes(r.status)?"intake":"work";
  try{App.toast("Загружаем фото…");const n=await App.repUploadPhotos(r,[...t.files],kind);await App.reload(["repairs"]);App.toast("Фото добавлено: "+n)}catch(err){App.toast(err.message)}});
ACT.phView=path=>{const u=URLS.get(path);if(!u)return;const w=window.open("","_blank");if(w){w.document.write(`<title>Фото</title><body style="margin:0;background:#111;display:grid;place-items:center;min-height:100vh"><img src="${esc(u.url)}" style="max-width:100%;max-height:100vh">`);w.document.close()}};

/* ---------- приём ---------- */
let NEWPH=[],SEL=new Set(),INMODEL=null;
App.checkSummary=st=>checkSummary(st);
App.repPhotosHtml=r=>`<div class="rph"><small class="muted">Фото${(r.photos||[]).length?" · "+r.photos.length:""}</small>${photosHtml(r)}</div>`;
/* приём: блок проверки (сбрасывает состояние формы) */
App.repIntakeCheck=()=>{NEWPH=[];SEL=new Set();INMODEL=null;CK.in={};PAT=[];
  return `<div id="chk_in">${App.checkHtml("in",{})}</div>
    <div class="qk"><button type="button" class="chip" data-act="chkAll" data-id="in|ok">Всё в порядке</button><button type="button" class="chip" data-act="chkAll" data-id="in|na">Не включается — проверить нельзя</button></div>`};
App.repIntakePhotos=()=>`<div class="phgrid" id="rPhPrev"><label class="ph add"><input type="file" accept="image/*" capture="environment" multiple id="rPhIn" hidden><span>+ Фото</span></label></div>`;
function drawInModel(){const box=$("#rInModel");if(!box)return;const m=INMODEL;
  if(!m){box.innerHTML="";return}
  const pt=App.point(),wh=pt&&pt.serviceWh?pt.serviceWh:pt&&pt.cashWh,rows=App.modelPrice(m.id);
  box.innerHTML=`<div class="inmodel"><b>${esc(m.name)}</b>${rows.length?` <span class="muted">— отметьте работы, стоимость посчитается</span><div class="qk">${rows.map(x=>{const st=partStock(x.part,wh);
    return `<button type="button" class="chip ${SEL.has(x.svc.id)?"on":""}" data-act="inSvc" data-id="${esc(x.svc.id)}">${esc(x.svc.name)} · ${money(x.price)}${x.part?` <small class="${st>0?"okc":"badc"}">${st>0?"запчасть есть":"запчасти нет"}</small>`:""}</button>`}).join("")}</div>`
    :` <span class="muted">· цен по этой модели пока нет</span>`}</div>`}
ACT.inSvc=id=>{SEL.has(id)?SEL.delete(id):SEL.add(id);drawInModel();const sum=App.modelPrice(INMODEL.id).filter(x=>SEL.has(x.svc.id)).reduce((a,x)=>a+x.price,0);const e=$("#rEst");if(e){e.value=sum||"";e.dispatchEvent(new Event("input",{bubbles:true}))}};
App.repIntakeBind=()=>{
  const dev=$("#rDevice");if(dev){const upd=()=>{const m=App.detectModel(dev.value);if((m&&m.id)!==(INMODEL&&INMODEL.id)){INMODEL=m;SEL=new Set();drawInModel()}};dev.addEventListener("input",upd);dev.addEventListener("change",upd);upd()}
  const fi=$("#rPhIn");if(fi)fi.addEventListener("change",()=>{NEWPH.push(...fi.files);const pv=$("#rPhPrev");[...fi.files].forEach(f=>{const u=URL.createObjectURL(f);pv.insertAdjacentHTML("afterbegin",`<span class="ph"><img src="${u}" alt="Новое фото"></span>`)});fi.value=""});
};
ACT.inDev=i=>{const box=$("#rCust");const d=box&&box._ds&&box._ds[+i];if(!d)return;const dv=$("#rDevice"),im=$("#rImei");if(dv){dv.value=d.name;dv.dispatchEvent(new Event("input",{bubbles:true}))}if(im&&d.code)im.value=d.code};
/* после создания ремонта: работы из прайса, модель, чек-лист, фото */
App.repAfterCreate=async id=>{if(!id)return;const r={id};
  const rows=INMODEL?App.modelPrice(INMODEL.id).filter(x=>SEL.has(x.svc.id)):[];
  if(rows.length)await App.api.insertMany("repair_services",rows.map(x=>({repair_id:id,service_id:x.svc.id,name:x.svc.name,price:x.price,qty:1})));
  const p={};if(INMODEL)p.model_id=INMODEL.id;if(Object.keys(CK.in||{}).length)p.checklist={intake:CK.in};
  if(Object.keys(p).length)await App.api.rpc("repair_set",{p_id:id,p});
  if(NEWPH.length){try{await App.repUploadPhotos(r,NEWPH,"intake")}catch(e){App.toast(e.message)}}
  NEWPH=[]};

/* ---------- карточка ремонта: модель, прайс модели ---------- */
App.repModelSel=(r,m)=>App.sel("rxModel",[["","— не определена —"],...App.models(m?m.family:"").map(x=>[x.id,x.name])],m?m.id:"",'aria-label="Модель устройства" data-rid="'+esc(r.id)+'"');
App.repModelChips=r=>{const m=App.repModel(r);if(!m)return "";const rows=App.modelPrice(m.id);if(!rows.length)return "";
  const wh=App.serviceWhOf(r),have=new Set((r.services||[]).map(s=>s.serviceId));
  return `<div class="inmodel"><span class="muted">Прайс ${esc(m.name)} — нажмите, чтобы добавить:</span><div class="qk">${rows.map(x=>{const st=partStock(x.part,wh);
    return `<button type="button" class="chip ${have.has(x.svc.id)?"on":""}" data-act="rxAdd" data-id="${esc(r.id)}|${esc(x.svc.id)}" ${have.has(x.svc.id)?"disabled":""}>${esc(x.svc.name)} · ${money(x.price)}${x.part?` <small class="${st>0?"okc":"badc"}">${st>0?"+ запчасть со склада":"запчасть закажем"}</small>`:""}</button>`}).join("")}</div></div>`};
/* выдача: проверка при клиенте */
App.repIssueCheckInit=r=>{CK.out=Object.assign({},((r.checklist||{}).issue)||{})};
App.repIssueCheckHtml=()=>`<div class="isschk"><button type="button" class="btn issok" data-act="chkAll" data-id="out|ok" id="issOk"><i aria-hidden="true">✓</i> Клиент проверил — всё работает</button>
  <details class="issmore"><summary>Есть замечания — отметить по пунктам</summary><div id="chk_out">${App.checkHtml("out",CK.out||{})}</div></details></div>`;
App.repIssueCheckSave=async id=>{if(Object.keys(CK.out||{}).length)await App.api.rpc("repair_set",{p_id:id,p:{checklist:{issue:CK.out}}})};
ACT.rxAdd=(arg,btn)=>run(btn,async()=>{const [id,sid]=arg.split("|"),r=App.byId("repairs",id),m=App.repModel(r),x=App.modelPrice(m.id).find(y=>y.svc.id===sid);if(!x)return;
  await App.api.insert("repair_services",{repair_id:id,service_id:sid,name:x.svc.name,price:x.price,qty:1});
  let msg="Работа добавлена";
  if(x.part){const wh=App.serviceWhOf(r);if(partStock(x.part,wh)>0&&App.can("repairWork")){await App.api.insert("repair_parts",{repair_id:id,product_id:x.part.id,warehouse_id:wh,name:x.part.name,qty:1,price:0,cost:num(x.part.cost)});msg+=", запчасть списана со склада сервиса"}
    else if(partStock(x.part,wh)<=0){await App.api.rpc("repair_part_request",{p_repair:id,p_product:x.part.id,p_name:null,p_qty:1,p_note:null});msg+=" · запчасти нет — заявка создана, статус «Ждёт запчасть»"}}
  if(!r.modelId)await App.api.rpc("repair_set",{p_id:id,p:{model_id:m.id}});
  await App.reload(["repairs","products","movements"]);App.toast(msg)});
document.addEventListener("change",async e=>{if(e.target.id!=="rxModel"||!e.target.dataset.rid)return;
  try{await App.api.rpc("repair_set",{p_id:e.target.dataset.rid,p:{model_id:e.target.value||null}});await App.reload(["repairs"])}catch(err){App.toast(err.message)}});

/* заявка на запчасть */
let RQ=null;
ACT.rqNew=id=>{RQ={id,productId:""};const r=App.byId("repairs",id),m=App.repModel(r);
  App.openModal(App.head("Заказать запчасть · "+esc(r.num))+`<div class="form"><div class="fld full"><label for="rqQ">Товар из каталога (если есть)</label><input id="rqQ" type="search" autocomplete="off" placeholder="${esc(m?"Дисплей "+m.name:"Название запчасти")}"><div id="rqBox" class="pick" hidden></div><small id="rqPicked" class="muted"></small></div>
    ${App.fld("rqName","Или название",App.inp("rqName","","text","Дисплей OLED iPhone 13, оригинал"),"full")}${App.fld("rqQty","Количество",App.inp("rqQty","1","number"))}${App.fld("rqNote","Комментарий",App.inp("rqNote","","text","Поставщик, срок, цена"))}</div>
    <p class="muted">Ремонт перейдёт в «Ждёт запчасть». Когда запчасть из каталога придёт на склад, заявка закроется сама, ремонт вернётся «в работу» и мастер получит задачу.</p>
    <div class="acts"><button class="btn" data-act="openRepair" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="rqSave">Заказать</button></div>`);
  App.productPicker("rqQ","rqBox",{inStock:false,onPick:p=>{RQ.productId=p.id;$("#rqPicked").textContent="Выбрано: "+p.name+" · в наличии "+App.qtyTotal(p);$("#rqQ").value=p.name}})};
ACT.rqSave=(_,btn)=>run(btn,async()=>{if(!RQ.productId&&!App.val("rqName"))throw new Error("Выберите запчасть или впишите название");
  await App.api.rpc("repair_part_request",{p_repair:RQ.id,p_product:RQ.productId||null,p_name:App.val("rqName")||null,p_qty:Math.max(1,num(App.val("rqQty"))),p_note:App.val("rqNote")||null});
  await App.reload(["repairs"]);App.toast("Запчасть заказана");ACT.openRepair(RQ.id)});
ACT.rqSet=(arg,btn)=>run(btn,async()=>{const [id,s]=arg.split("|");await App.api.rpc("repair_part_request_set",{p_id:id,p_status:s});await App.reload(["repairs","tasks"]);App.toast(s==="arrived"?"Отмечено: запчасть пришла":"Заказ запчасти отменён")});

/* чек-лист в карточке: при приёме и при выдаче */
ACT.repCheck=id=>{const r=App.byId("repairs",id),ck=r.checklist||{};CK.ci=Object.assign({},ck.intake||{});CK.co=Object.assign({},ck.issue||{});
  App.openModal(App.head("Осмотр · "+esc(r.num))+`<h3 class="sub-h">При приёме</h3><div id="chk_ci">${App.checkHtml("ci",CK.ci)}</div>
    <h3 class="sub-h">При выдаче</h3><div id="chk_co">${App.checkHtml("co",CK.co)}</div><div class="row-f"><button type="button" class="btn sm ghost" data-act="chkAll" data-id="co|ok">Всё в порядке</button></div>
    ${App.fld("ckNote","Заметка",App.inp("ckNote",ck.note||"","text","Например: царапина на рамке"),"full")}
    <div class="acts"><button class="btn" data-act="openRepair" data-id="${esc(id)}">Назад</button><button class="btn pri" data-act="repCheckSave" data-id="${esc(id)}">Сохранить</button></div>`,{wide:true})};
ACT.repCheckSave=(id,btn)=>run(btn,async()=>{const c={intake:CK.ci||{},note:App.val("ckNote")||""};if(Object.keys(CK.co||{}).length)c.issue=CK.co;
  await App.api.rpc("repair_set",{p_id:id,p:{checklist:c}});await App.reload(["repairs"]);App.toast("Осмотр сохранён");ACT.openRepair(id)});

/* взять себе */
ACT.repTake=(id,btn)=>run(btn,async()=>{const r=App.byId("repairs",id);await App.api.rpc("repair_update",{p_id:id,p:{master_id:App.me.id,status:["new"].includes(r.status)?"diag":r.status}});await App.reload(["repairs"]);App.toast("Ремонт ваш")});

/* ---------- наклейка с QR ---------- */
ACT.repLabel=id=>{const r=App.byId("repairs",id),c=App.cust(r.customerId)||{},st=App.settings();
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(r.num)}</title><style>@page{size:58mm 40mm;margin:2mm}body{margin:0;font:9pt/1.2 Arial,sans-serif;color:#000}
    .l{display:flex;gap:2mm;height:36mm}.q{width:20mm;height:20mm;flex:none}.q svg{width:100%;height:100%}.t{min-width:0;display:flex;flex-direction:column;gap:.6mm}
    b{font-size:14pt}.d{font-weight:700;overflow:hidden;max-height:9mm}.s{font-size:7.5pt;color:#333}</style></head><body><div class="l"><div class="q">${App.qrSvg(r.num)}</div>
    <div class="t"><b>${esc(r.num)}</b><div class="d">${esc(r.device)}</div><div>${esc((c.name||"").split(" ")[0]||"")} · …${esc(App.phoneKey(c.phone).slice(-4))}</div>
    <div class="s">Принят ${App.dt(r.createdAt)}${r.dueDate?" · до "+App.dt(r.dueDate):""}</div><div class="s">${esc(st.shopName||"iCase")}</div></div></div></body></html>`;
  App.printHtml(html)};

/* ---------- ссылка на согласование ---------- */
App.repApproveLink=r=>{const site=String(App.settings().siteUrl||"").replace(/\/+$/,"");return site&&r.approveToken?`${site}/repair/approve?n=${encodeURIComponent(r.num)}&t=${r.approveToken}`:""};
ACT.repLink=id=>{const r=App.byId("repairs",id),url=App.repApproveLink(r),c=App.cust(r.customerId)||{},tel=App.phoneKey(c.phone);
  if(!url)return App.toast("Укажите адрес сайта: Настройки → Магазин → «Сайт»");
  const txt=`Здравствуйте${c.name?", "+c.name:""}! ${App.settings().shopName||"iCase"}: по ремонту ${r.num} (${r.device}) готова смета на ${money(App.repairTotal(r)||r.approvedSum||r.estimate)}. Посмотреть и согласовать: ${url}`;
  App.openModal(App.head("Согласование по ссылке · "+esc(r.num))+`<p class="muted">Клиент откроет страницу на вашем сайте, увидит работы, запчасти и сумму и нажмёт «Согласен» или «Отказываюсь». Решение сразу придёт в CRM: ремонт уйдёт в работу, мастер получит задачу.</p>
    ${App.fld("rlT","Сообщение",`<textarea id="rlT" rows="5">${esc(txt)}</textarea>`,"full")}
    <div class="acts"><button class="btn" data-act="rlCopy">Скопировать</button>${tel?`<a class="btn" href="https://wa.me/7${tel}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn pri" href="sms:+7${tel}?body=${encodeURIComponent(txt)}">SMS</a>`:""}</div>
    <p class="muted">Страница согласования — готовый файл для сайта на Next.js: integrations/nextjs/app/repair/approve/page.tsx.</p>`)};
ACT.rlCopy=()=>ACT.copyTxt?ACT.copyTxt(App.val("rlT")):navigator.clipboard.writeText(App.val("rlT"));

/* ---------- список: мои ремонты, нагрузка мастеров ---------- */
App.plural=App.plural||((n,a,b,c)=>{n=Math.abs(n)%100;const k=n%10;return n>10&&n<20?c:k===1?a:k>=2&&k<=4?b:c});
const masters=()=>S.staff.filter(s=>s.active!==false&&["master","owner","manager"].includes(s.role));
App.repWorkload=()=>{if(!["owner","manager"].includes(App.me.role))return "";const ms=masters().filter(m=>m.id!==App.me.id||App.me.role==="master");if(!ms.length)return "";
  const act=S.repairs.filter(r=>App.ACTIVE.includes(r.status));const un=act.filter(r=>!r.masterId).length;
  return `<div class="workload">${ms.map(m=>{const mine=act.filter(r=>r.masterId===m.id),late=mine.filter(App.isLate).length,ready=mine.filter(r=>r.status==="ready").length,inw=mine.length-ready;
    return `<button type="button" class="wl ${App.ui.repMaster===m.id?"on":""}" data-act="repMasterPick" data-id="${esc(m.id)}"><b class="wl-f">${esc(m.fullName)}</b><b class="wl-s">${esc((m.fullName||"").split(/\s+/).slice(0,2).map((w,i)=>i?w[0]+".":w).join(" "))}</b><span>${inw} в работе${ready?" · "+ready+" готово":""}</span>${late?`<em>${late} просрочено</em>`:""}<i class="wl-n" title="в работе">${inw+ready}</i>${late?`<i class="wl-late" title="просрочено">${late}</i>`:""}</button>`}).join("")}
    ${un?`<button type="button" class="wl warn ${App.ui.repMaster==="__none"?"on":""}" data-act="repMasterPick" data-id="__none"><b>Без мастера</b><span>${un} ${App.plural?App.plural(un,"ремонт","ремонта","ремонтов"):"шт."}</span><i class="wl-n">${un}</i></button>`:""}</div>`};
ACT.repMasterPick=id=>{App.ui.repMaster=App.ui.repMaster===id?"":id;App.render()};
let mineInit=false;
const rv=VIEWS.repairs;if(rv){const r0=rv.render.bind(rv);rv.render=function(){
  if(!mineInit){mineInit=true;if(App.me.role==="master")App.ui.repMaster=App.me.id}
  const mine=App.can("repairWork");const n=S.repairs.filter(r=>r.masterId===App.me.id&&App.ACTIVE.includes(r.status)).length;
  const bar=mine||App.repWorkload()?`<div class="repbar">${mine?`<button type="button" class="wl ${App.ui.repMaster===App.me.id?"on":""}" data-act="repMine"><b class="wl-f">Мои ремонты</b><b class="wl-s">Мои</b><span>${n?n+" в работе":"нет активных"}</span><i class="wl-n">${n}</i></button>`:""}${App.repWorkload()}</div>`:"";
  return bar+r0()}}
ACT.repMine=()=>{App.ui.repMaster=App.ui.repMaster===App.me.id?"":App.me.id;App.render()};

/* ---------- устройства клиента ---------- */
App.clientDevices=cid=>{const out=new Map(),add=(key,o)=>{const k=key||o.name;if(!k)return;const x=out.get(k);if(!x||String(o.at)>String(x.at))out.set(k,Object.assign({},x||{},o,{events:((x&&x.events)||0)+1}))};
  S.sales.filter(s=>s.customerId===cid).forEach(s=>(s.items||[]).forEach(i=>{if(!i.unitId&&!i.serial)return;const u=i.unitId?App.byId("units",i.unitId):null;add(u?App.unitCode(u):i.serial,{name:i.name,code:u?App.unitCode(u):i.serial,at:s.createdAt,unitId:u?u.id:"",src:"Куплен "+App.dt(s.createdAt)})}));
  S.repairs.filter(r=>r.customerId===cid).forEach(r=>add(r.imei||r.device,{name:r.device,code:r.imei||"",at:r.createdAt,repairId:r.id,src:"Ремонт "+r.num}));
  (S.deals||[]).filter(d=>d.customerId===cid).forEach(d=>add(d.imei||d.device,{name:d.device,code:d.imei||"",at:d.createdAt,src:(d.kind==="commission"?"Комиссия ":"Выкуп ")+d.num}));
  return [...out.values()].sort((a,b)=>String(b.at).localeCompare(String(a.at)))};
const ce=App.clientExtra;App.clientExtra=function(id){const ds=App.clientDevices(id);
  return (ds.length?`<section><h3 class="sub-h">Устройства клиента</h3><div class="list-mini">${ds.map(d=>`<button data-act="${d.unitId?"openUnit":d.repairId?"openRepair":"openClient"}" data-id="${esc(d.unitId||d.repairId||id)}"><span>${esc(d.name)}${d.code?` <small>${esc(d.code)}</small>`:""}</span><small>${esc(d.src)}${d.events>1?" · ещё "+(d.events-1):""}</small></button>`).join("")}</div>
    ${App.can("repair")?`<button class="btn sm" data-act="repairFor" data-id="${esc(id)}">+ Принять в ремонт</button>`:""}</section>`:"")+(ce?ce(id):"")};

/* ---------- настройки: цены по моделям ---------- */
let MP=null;
ACT.mpOpen=()=>{MP={family:"iPhone",modelId:(App.models("iPhone")[0]||{}).id||""};drawMP()};
function drawMP(){const m=App.byId("models",MP.modelId),svcs=S.services.filter(s=>s.active!==false).sort((a,b)=>String(a.group||"").localeCompare(b.group||"")||String(a.name).localeCompare(b.name));
  const cur=new Map(S.svcprices.filter(x=>x.modelId===MP.modelId).map(x=>[x.serviceId,x]));
  const parts=m?S.products.filter(p=>!p.archived&&!p.trackSerial&&mk(p.name).includes(mk(m.name))):[];
  const html=App.head("Цены работ по моделям")+`<div class="chips">${App.FAMILIES.filter(f=>App.models(f).length).map(f=>`<button class="chip ${MP.family===f?"on":""}" data-act="mpFam" data-id="${esc(f)}">${esc(f)}</button>`).join("")}</div>
    ${App.fld("mpModel","Модель",App.sel("mpModel",App.models(MP.family).map(x=>[x.id,x.name]),MP.modelId),"full")}
    ${svcs.length?`<div class="tbl-wrap"><table><thead><tr><th>Работа</th><th class="n">Базовая</th><th class="n">Для модели, ₽</th><th>Запчасть со склада</th></tr></thead><tbody>
    ${svcs.map(s=>{const x=cur.get(s.id);return `<tr><td>${esc(s.name)}${s.group?`<span class="sub">${esc(s.group)}</span>`:""}</td><td class="n">${money(s.price)}</td>
      <td class="n"><input type="number" inputmode="decimal" data-mp="${esc(s.id)}" value="${x?num(x.price):""}" placeholder="—" style="width:110px;text-align:right"></td>
      <td>${App.sel("mpPart_"+s.id,[["","—"],...parts.map(p=>[p.id,p.name+" · "+App.qtyTotal(p)+" шт"])],x?x.partId:"",'data-mpp="'+esc(s.id)+'"')}</td></tr>`}).join("")}</tbody></table></div>
    <p class="muted">Пустая цена — работа для этой модели не показывается. Запчасть: товары, в названии которых есть «${esc(m?m.name:"")}». Выбранная запчасть списывается со склада сервиса при добавлении работы в ремонт, а если её нет — создаётся заявка.</p>`:'<p class="muted">Сначала добавьте работы в прайс.</p>'}
    <div class="acts"><button class="btn" data-act="close">Закрыть</button><button class="btn pri" data-act="mpSave">Сохранить цены для модели</button></div>`;
  if($("#scrim").hidden)App.openModal(html,{wide:true});else{$("#modal").className="modal wide";$("#modal").innerHTML=html}
  const ms=$("#mpModel");if(ms)ms.onchange=()=>{MP.modelId=ms.value;drawMP()}}
ACT.mpFam=f=>{MP.family=f;MP.modelId=(App.models(f)[0]||{}).id||"";drawMP()};
ACT.mpSave=(_,btn)=>run(btn,async()=>{const cur=new Map(S.svcprices.filter(x=>x.modelId===MP.modelId).map(x=>[x.serviceId,x]));let n=0;
  for(const inp of document.querySelectorAll("#modal [data-mp]")){const sid=inp.dataset.mp,v=inp.value.trim(),part=(document.querySelector(`#modal [data-mpp="${CSS.escape(sid)}"]`)||{}).value||null,x=cur.get(sid);
    if(v===""){if(x){await App.api.remove("service_prices",x.id);n++}continue}
    const row={service_id:sid,model_id:MP.modelId,price:num(v),part_product_id:part};
    if(x){if(num(v)!==x.price||(part||"")!==(x.partId||"")){await App.api.update("service_prices",x.id,{price:row.price,part_product_id:part});n++}}else{await App.api.insert("service_prices",row);n++}}
  await App.reload(["svcprices"]);App.toast(n?"Сохранено: "+n:"Без изменений");drawMP()});
})();
/* открывая новое окно, закрываем просмотр документа — иначе он остаётся поверх */
(function(){const om=App.openModal;App.openModal=function(){const p=document.getElementById("prv");if(p)p.remove();return om.apply(this,arguments)}})();
