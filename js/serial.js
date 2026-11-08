/* iCase CRM v3 · серийный учёт (IMEI / SN) и каталог моделей Apple */
"use strict";
(function(){
const {S,$,esc,num,money,ACT}=App;

/* ---------- экземпляры ---------- */
App.UNIT_ST={in_stock:["В наличии","ok"],reserved:["В резерве","info"],in_repair:["В ремонте","warn"],sold:["Продан","mute"],written_off:["Списан","bad"],returned_supplier:["Возвращён поставщику","mute"]};
App.unitCode=u=>u?(u.imei||u.serialNo||""):"";
App.unitsOf=(pid,{wh="",status="in_stock"}={})=>S.units.filter(u=>u.productId===pid&&(!status||u.status===status)&&(!wh||u.whId===wh));
App.unitCodes=pid=>S.units.filter(u=>u.productId===pid&&u.status==="in_stock").map(u=>[u.imei,u.imei2,u.serialNo].filter(Boolean).join(" ")).join(" ");
App.findUnit=code=>{const c=String(code||"").trim().toLowerCase();if(!c)return null;return S.units.find(u=>[u.imei,u.imei2,u.serialNo].some(x=>x&&String(x).toLowerCase()===c))||null};
App.unitPrice=(u,p)=>u&&u.price!==""&&u.price!=null?num(u.price):num((p||App.byId("products",u.productId)||{}).price);
App.luhn=s=>{if(!/^\d{15}$/.test(s))return false;let sum=0;for(let i=0;i<15;i++){let d=+s[14-i];if(i%2){d*=2;if(d>9)d-=9}sum+=d}return sum%10===0};
/* код со сканера → поле: 15 цифр — IMEI, иначе серийный номер */
App.parseCode=raw=>{const s=String(raw||"").trim().replace(/\s+/g,"");if(!s)return null;
  return /^\d{15}$/.test(s)?{imei:s,warn:App.luhn(s)?"":"IMEI не проходит проверку контрольной цифры — проверьте"}:{serial_no:s.toUpperCase(),warn:/^\d{14,16}$/.test(s)?"Похоже на IMEI, но не 15 цифр":""}};
App.unitLabel=u=>{const p=App.byId("products",u.productId);return [App.unitCode(u),u.condition&&p&&u.condition!==p.condition?u.condition:"",u.batteryHealth!=null&&u.batteryHealth!==""?"АКБ "+u.batteryHealth+"%":""].filter(Boolean).join(" · ")};
App.unitSt=u=>{const s=App.UNIT_ST[u.status]||[u.status,""];return `<span class="pill ${s[1]}">${s[0]}${u.status==="in_stock"&&u.whId?" · "+esc(App.whName(u.whId)):""}</span>`};

/* карточка экземпляра */
ACT.openUnit=id=>{
  const u=App.byId("units",id);if(!u)return;const p=App.byId("products",u.productId)||{};
  const ed=App.can("stock")||App.can("price"),pr=App.can("price"),cost=App.can("cost");
  const sale=u.saleItemId?S.sales.find(s=>(s.items||[]).some(i=>i.line===u.saleItemId)):null;
  App.openModal(App.head(esc(App.unitCode(u)),App.unitSt(u))+`
    <p class="muted" style="margin-top:-4px">${esc(p.name||"")}</p>
    <div class="form">
      ${App.fld("uImei","IMEI",App.inp("uImei",u.imei,"text","15 цифр",ed?"":"disabled"))}${App.fld("uImei2","IMEI 2",App.inp("uImei2",u.imei2,"text","",ed?"":"disabled"))}
      ${App.fld("uSn","Серийный номер",App.inp("uSn",u.serialNo,"text","",ed?"":"disabled"))}
      ${App.fld("uCond","Состояние",App.sel("uCond",App.CONDS,u.condition||p.condition,ed?"":"disabled"))}
      ${App.fld("uBatt","Ёмкость АКБ, %",App.inp("uBatt",u.batteryHealth==null?"":u.batteryHealth,"number","",ed?"":"disabled"))}
      ${App.fld("uPrice","Цена этого экземпляра, ₽",App.inp("uPrice",u.price,"number","как у товара: "+num(p.price),pr?"":"disabled"))}
      ${cost?App.fld("uCost","Закупка",`<input id="uCost" value="${money(u.cost)}" disabled>`):""}
      ${App.fld("uKit","Комплектация",App.inp("uKit",u.kit,"text","",ed?"":"disabled"),"full")}
      ${App.fld("uDiag","Диагностика",App.inp("uDiag",u.diagnostics,"text","",ed?"":"disabled"),"full")}
      ${App.fld("uNote","Заметка",`<textarea id="uNote" ${ed?"":"disabled"}>${esc(u.note)}</textarea>`,"full")}
    </div>
    <dl class="kv"><dt>Последний документ</dt><dd>${esc(u.lastRef||"—")}</dd>${sale?`<dt>Продажа</dt><dd><button class="btn sm" data-act="openSale" data-id="${esc(sale.id)}">${esc(sale.num)}</button> ${App.dtt(sale.createdAt)}</dd>`:""}<dt>Принят</dt><dd>${App.dtt(u.createdAt)}</dd></dl>
    <div class="acts"><button class="btn" data-act="openProduct" data-id="${esc(u.productId)}">Карточка товара</button>${ed?`<button class="btn pri" data-act="saveUnit" data-id="${esc(id)}">Сохранить</button>`:""}</div>`);
};
ACT.saveUnit=async(id,btn)=>{
  const V=App.val,n=v=>v===""?null:num(v);
  const data={imei:V("uImei")||null,imei2:V("uImei2")||null,serial_no:V("uSn")?V("uSn").toUpperCase():null,condition:V("uCond")||null,battery_health:n(V("uBatt")),kit:V("uKit")||null,diagnostics:V("uDiag")||null,note:V("uNote")||null};
  if(!data.imei&&!data.serial_no)return App.toast("Нужен IMEI или серийный номер");
  if(data.imei&&!/^\d{15}$/.test(data.imei))return App.toast("IMEI — это 15 цифр");
  if(App.can("price"))data.price=n(V("uPrice"));
  btn.disabled=true;
  try{await App.api.update("units",id,data);await App.reload(["units"]);App.toast("Сохранено");App.closeModal()}catch(e){btn.disabled=false;App.toast(e.message)}
};

/* выбор экземпляра (касса, документы) */
App.chooseUnit=function({productId,wh,exclude=[],title="Выберите экземпляр",onPick}){
  const p=App.byId("products",productId),list=App.unitsOf(productId,{wh}).filter(u=>!exclude.includes(u.id));
  if(!list.length){const other=App.unitsOf(productId).filter(u=>!exclude.includes(u.id));
    return App.toast("Нет экземпляров на складе «"+App.whName(wh)+"»"+(other.length?". Есть: "+[...new Set(other.map(u=>App.whName(u.whId)))].join(", "):""))}
  if(list.length===1)return onPick(list[0]);
  App.chooseUnit.cb=onPick;
  App.openModal(App.head(esc(title))+`<p class="muted" style="margin-top:-4px">${esc(p.name)} · ${list.length} шт. на складе «${esc(App.whName(wh))}». Можно отсканировать IMEI.</p>
    <div class="list-mini">${list.map(u=>`<button data-act="unitChosen" data-id="${esc(u.id)}"><span>${esc(App.unitCode(u))}<small>${esc([u.condition,u.batteryHealth!=null&&u.batteryHealth!==""?"АКБ "+u.batteryHealth+"%":"",u.kit].filter(Boolean).join(" · "))}</small></span><b>${money(App.unitPrice(u,p))}</b></button>`).join("")}</div>`);
};
ACT.unitChosen=id=>{const u=App.byId("units",id),cb=App.chooseUnit.cb;App.closeModal();if(u&&cb)cb(u)};

/* ---------- каталог Apple ---------- */
App.FAMILIES=["iPhone","iPad","Mac","Apple Watch","AirPods","Другое"];
App.models=(family)=>S.models.filter(m=>m.active!==false&&(!family||m.family===family)).sort((a,b)=>num(b.order)-num(a.order));
App.catalogName=(m,mem,color,opts)=>{
  const o=Object.assign({},opts),ram=o["ОЗУ"];delete o["ОЗУ"];
  const memPart=ram&&mem?ram+"/"+mem:(mem||ram||"");
  const extra=Object.entries(o).filter(([k,v])=>v&&k!=="SIM").map(([k,v])=>v);
  const sim=o.SIM?"("+o.SIM+")":"";
  return [m.name,memPart,...extra,color,sim].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
};
let CP=null;
ACT.catalogNew=()=>{
  if(!App.can("stock"))return App.toast("Нет права создавать товары");
  if(!S.models.length)return App.toast("Каталог моделей пуст: заполните «Настройки → Каталог Apple»");
  CP={family:"iPhone",modelId:"",mems:[],colors:[],opts:{},cond:"Новый",price:"",warranty:"",track:true};
  CP.modelId=(App.models(CP.family)[0]||{}).id||"";drawCP();
};
function cpModel(){return App.byId("models",CP.modelId)}
function cpCombos(){
  const m=cpModel();if(!m)return [];
  const mems=m.memories.length?(CP.mems.length?CP.mems:[]):[""],cols=m.colors.length?(CP.colors.length?CP.colors:[]):[""];
  const out=[];mems.forEach(me=>cols.forEach(co=>out.push({mem:me,color:co,name:App.catalogName(m,me,co,CP.opts)})));return out;
}
function drawCP(){
  const m=cpModel(),combos=cpCombos();
  const exists=n=>S.products.some(p=>!p.archived&&p.name===n&&p.condition===CP.cond);
  const chip=(kind,v,on)=>`<button class="chip ${on?"on":""}" data-act="cpToggle" data-id="${esc(kind+"|"+v)}">${esc(v)}</button>`;
  const html=App.head("Товары из каталога Apple")+`
    <div class="chips">${App.FAMILIES.filter(f=>App.models(f).length).map(f=>`<button class="chip ${CP.family===f?"on":""}" data-act="cpFamily" data-id="${esc(f)}">${esc(f)}</button>`).join("")}</div>
    <div class="form">
      ${App.fld("cpModel","Модель",App.sel("cpModel",App.models(CP.family).map(x=>[x.id,x.name+(x.year?" · "+x.year:"")]),CP.modelId),"full")}
      ${m&&m.memories.length?`<div class="fld full"><label>Память ${CP.mems.length?"":'<span class="muted">— отметьте одну или несколько</span>'}</label><div class="chips">${m.memories.map(v=>chip("mem",v,CP.mems.includes(v))).join("")}<button class="btn sm ghost" data-act="cpAll" data-id="mem">все</button></div></div>`:""}
      ${m&&m.colors.length?`<div class="fld full"><label>Цвет ${CP.colors.length?"":'<span class="muted">— отметьте один или несколько</span>'}</label><div class="chips">${m.colors.map(v=>chip("color",v,CP.colors.includes(v))).join("")}<button class="btn sm ghost" data-act="cpAll" data-id="color">все</button></div></div>`
        :m?`<div class="fld full"><label>Цвет</label><input id="cpColorFree" placeholder="Цвета этой модели не заполнены — впишите цвет" value="${esc(CP.freeColor||"")}"></div>`:""}
      ${m?Object.entries(m.options||{}).map(([k,vals])=>App.fld("cpo_"+k,k,`<select id="cpo_${esc(k)}" data-cpopt="${esc(k)}"><option value="">—</option>${vals.map(v=>`<option${CP.opts[k]===v?" selected":""}>${esc(v)}</option>`).join("")}</select>`)).join(""):""}
      ${App.fld("cpCond","Состояние",App.sel("cpCond",App.CONDS,CP.cond))}
      ${App.can("price")?App.fld("cpPrice","Цена продажи, ₽",App.inp("cpPrice",CP.price,"number","можно позже")):""}
      ${App.fld("cpWarr","Гарантия, мес.",App.inp("cpWarr",CP.warranty,"number","по умолчанию"))}
      <div class="fld full">${App.chk("cpTrack","Учёт по IMEI / серийным номерам",CP.track)}</div>
    </div>
    <h3 class="sub-h">Будет создано: ${combos.filter(c=>!exists(c.name)).length}</h3>
    <div class="hist">${combos.map(c=>`<span>${esc(c.name)}${exists(c.name)?' <span class="pill mute">уже есть</span>':""}</span>`).join("")||'<span class="muted">Выберите память и цвет</span>'}</div>
    <div class="acts"><button class="btn pri" data-act="cpCreate">Создать товары</button></div>`;
  if($("#scrim").hidden)App.openModal(html,{wide:true});else{$("#modal").className="modal wide";$("#modal").innerHTML=html}
  const ms=$("#cpModel");if(ms)ms.onchange=()=>{CP.modelId=ms.value;CP.mems=[];CP.colors=[];CP.opts={};drawCP()};
  document.querySelectorAll("[data-cpopt]").forEach(el=>el.onchange=()=>{CP.opts[el.dataset.cpopt]=el.value;drawCP()});
  const c=$("#cpCond");if(c)c.onchange=()=>{CP.cond=c.value;drawCP()};
  const pr=$("#cpPrice");if(pr)pr.oninput=()=>CP.price=pr.value;
  const w=$("#cpWarr");if(w)w.oninput=()=>CP.warranty=w.value;
  const t=$("#cpTrack");if(t)t.onchange=()=>CP.track=t.checked;
  const fc=$("#cpColorFree");if(fc)fc.onchange=()=>{CP.freeColor=fc.value.trim();drawCP()};
}
ACT.cpFamily=f=>{CP.family=f;CP.modelId=(App.models(f)[0]||{}).id||"";CP.mems=[];CP.colors=[];CP.opts={};drawCP()};
ACT.cpToggle=v=>{const [k,val]=v.split(/\|(.*)/s);const arr=k==="mem"?CP.mems:CP.colors;const i=arr.indexOf(val);i>=0?arr.splice(i,1):arr.push(val);drawCP()};
ACT.cpAll=k=>{const m=cpModel();if(!m)return;if(k==="mem")CP.mems=CP.mems.length===m.memories.length?[]:m.memories.slice();else CP.colors=CP.colors.length===m.colors.length?[]:m.colors.slice();drawCP()};
async function familyCategory(family){
  let c=S.categories.find(x=>!x.parentId&&x.name.toLowerCase()===family.toLowerCase());
  if(!c){c=await App.api.insert("categories",{name:family,is_device:family!=="Другое"});await App.reload(["categories"]);c=App.byId("categories",c.id)||c}
  return c.id;
}
ACT.cpCreate=async(_,btn)=>{
  const m=cpModel();if(!m)return;
  if(m.memories.length&&!CP.mems.length)return App.toast("Отметьте память");
  if(m.colors.length&&!CP.colors.length)return App.toast("Отметьте цвет");
  let combos=cpCombos();if(!m.colors.length&&CP.freeColor)combos=combos.map(c=>({...c,color:CP.freeColor,name:App.catalogName(m,c.mem,CP.freeColor,CP.opts)}));
  combos=combos.filter(c=>!S.products.some(p=>!p.archived&&p.name===c.name&&p.condition===CP.cond));
  if(!combos.length)return App.toast("Все эти товары уже есть");
  btn.disabled=true;
  try{
    const cat=await familyCategory(m.family);
    const rows=combos.map(c=>({name:c.name,category_id:cat,brand:"Apple",model:m.name,memory:c.mem||null,color:c.color||null,condition:CP.cond,
      attrs:Object.fromEntries(Object.entries(CP.opts).filter(([k,v])=>v)),catalog_id:m.id,track_serial:CP.track,
      price:App.can("price")?num(CP.price):0,warranty_months:num(CP.warranty)}));
    await App.api.insertMany("products",rows);await App.reload(["products"]);
    App.toast("Создано товаров: "+rows.length);App.closeModal();
  }catch(e){btn.disabled=false;App.toast(e.message)}
};

/* ---------- настройки: каталог моделей ---------- */
App.catalogTab=function(){
  const ed=App.can("settings");
  return `<section class="card"><div class="card-h"><h2>Каталог Apple</h2>${ed?'<button class="btn pri sm" data-act="modelForm">+ Модель</button>':""}</div>
  <p class="muted">Модели, память, цвета и параметры для быстрого создания товаров («Товары → Из каталога Apple»). Новые модели добавляйте сюда сами.</p>
  ${App.FAMILIES.map(f=>{const list=S.models.filter(m=>m.family===f).sort((a,b)=>num(b.order)-num(a.order));if(!list.length)return "";
    return `<h3 class="sub-h">${esc(f)} <span class="muted">${list.length}</span></h3><div class="tbl-wrap"><table><thead><tr><th>Модель</th><th>Год</th><th>Память</th><th>Цвета</th><th>Параметры</th></tr></thead><tbody>
    ${list.map(m=>`<tr class="rowlink" data-act="modelForm" data-id="${esc(m.id)}"><td><b>${esc(m.name)}</b>${m.active===false?' <span class="pill mute">скрыта</span>':""}</td><td>${m.year||""}</td><td>${esc(m.memories.join(", "))}</td>
      <td>${m.colors.length?esc(m.colors.join(", ")):'<span class="pill warn">не заполнены</span>'}</td><td>${esc(Object.keys(m.options||{}).join(", "))}</td></tr>`).join("")}</tbody></table></div>`}).join("")}
  </section>`;
};
ACT.modelForm=id=>{
  if(!App.can("settings"))return;
  const m=id?App.byId("models",id):{family:"iPhone",memories:[],colors:[],options:{},active:true,order:0};
  const opts=Object.entries(m.options||{}).map(([k,v])=>k+": "+v.join(", ")).join("\n");
  App.openModal(App.head(id?"Модель":"Новая модель")+`<div class="form">
    ${App.fld("mFam","Семейство",App.sel("mFam",App.FAMILIES,m.family))}${App.fld("mName","Название",App.inp("mName",m.name,"text","iPhone 17 Pro"))}
    ${App.fld("mYear","Год",App.inp("mYear",m.year||"","number"))}${App.fld("mSort","Порядок (больше — выше)",App.inp("mSort",m.order||0,"number"))}
    ${App.fld("mMem","Память через запятую",App.inp("mMem",m.memories.join(", "),"text","128 ГБ, 256 ГБ, 512 ГБ, 1 ТБ"),"full")}
    ${App.fld("mCol","Цвета через запятую",App.inp("mCol",m.colors.join(", "),"text","Черный, Белый"),"full")}
    ${App.fld("mOpt","Параметры: по строке «Название: вариант, вариант»",`<textarea id="mOpt" rows="3" placeholder="SIM: nano-SIM + eSIM, eSIM&#10;ОЗУ: 16 ГБ, 24 ГБ">${esc(opts)}</textarea>`,"full")}
    <div class="fld full">${App.chk("mAct","Показывать при создании товаров",m.active!==false)}</div></div>
    <div class="acts">${id?`<button class="btn danger" data-act="modelDel" data-id="${esc(id)}">Удалить</button>`:""}<button class="btn pri" data-act="modelSave" data-id="${esc(id||"")}">Сохранить</button></div>`);
};
const splitList=s=>String(s||"").split(",").map(x=>x.trim()).filter(Boolean);
ACT.modelSave=async(id,btn)=>{
  const V=App.val;if(!V("mName"))return App.toast("Укажите название");
  const options={};String(V("mOpt")||"").split("\n").forEach(line=>{const i=line.indexOf(":");if(i>0){const k=line.slice(0,i).trim(),v=splitList(line.slice(i+1));if(k&&v.length)options[k]=v}});
  const data={family:V("mFam"),name:V("mName").trim(),year:num(V("mYear"))||null,sort:num(V("mSort")),memories:splitList(V("mMem")),colors:splitList(V("mCol")),options,is_active:App.checked("mAct")};
  btn.disabled=true;
  try{if(id)await App.api.update("apple_models",id,data);else await App.api.insert("apple_models",data);await App.reload(["models"]);App.toast("Модель сохранена");App.closeModal()}
  catch(e){btn.disabled=false;App.toast(e.message)}
};
ACT.modelDel=async(id,el)=>{if(!App.confirm2(el,"Удалить модель? Нажмите ещё раз"))return;
  try{await App.api.remove("apple_models",id);await App.reload(["models"]);App.closeModal();App.toast("Модель удалена")}catch(e){App.toast(e.message)}};
})();
