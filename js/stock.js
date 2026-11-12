/* iCase CRM v3 · товары и складские документы (Supabase) */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;

/* ======================= ТОВАРЫ ======================= */
TITLES.stock="Товары";
Object.assign(App.ui,{stockQ:"",stockWh:"",docWh:""});
const SF_KEY="icase_sf";
const isMob=()=>window.matchMedia&&matchMedia("(max-width:760px)").matches;
const isNarrow=()=>window.matchMedia&&matchMedia("(max-width:860px)").matches;
const SF0=()=>({cat:"",brands:[],avail:"all",conds:[],mems:[],colors:[],track:"",chan:"",pmin:"",pmax:"",arch:false,sort:"name",group:"cat",open:{},ub:{batt:"",repair:"",box:false,never:false,icloud:false},
  sec:isMob()?{cat:false,brand:false,avail:false,params:false}:{cat:true,brand:false,avail:true,params:false}});
App.ui.sf=(()=>{try{const o=Object.assign(SF0(),JSON.parse(localStorage.getItem(SF_KEY)||"{}"));o.ub=Object.assign(SF0().ub,o.ub);o.sec=Object.assign({used:false},o.sec);return o}catch(e){return SF0()}})();
const sfSave=()=>{try{localStorage.setItem(SF_KEY,JSON.stringify(App.ui.sf))}catch(e){}};
function lastMove(p){let m="";S.movements.forEach(x=>{if(x.productId===p.id&&x.at>m)m=x.at});return m||p.createdAt}
App.isDead = p=>App.qtyTotal(p)>0&&App.days(lastMove(p))>App.settings().deadDays;
const brandOf=p=>(p.brand||"").trim()||"Без бренда";
const AVAIL=[["all","Все"],["in","В наличии"],["out","Нет в наличии"],["low","Ниже минимума"],["dead","Залежались"]];
const SORTS=[["name","По названию"],["new","Сначала новые"],["qty","По остатку"],["price_asc","Цена ↑"],["price_desc","Цена ↓"],["markup","По наценке"]];
const GROUPS=[["cat","По категориям"],["brand","По брендам"],["model","По моделям"],["none","Без группировки"]];
/* базовый список: всё, кроме фасетов (для подсчётов в фильтрах) */
function stockBase(skip){
  const u=App.ui,f=u.sf,q=u.stockQ.trim().toLowerCase(),words=q?q.split(/\s+/):[];
  const qty=p=>u.stockWh?App.qtyIn(p,u.stockWh):App.qtyTotal(p);
  return S.products.filter(p=>(f.arch?p.archived:!p.archived)&&(!f.appr||p.approval)
    &&(skip==="cat"||App.inCat(p,f.cat==="__none"?"":f.cat)&&(f.cat!=="__none"||!p.categoryId))
    &&(skip==="brand"||!f.brands.length||f.brands.includes(brandOf(p)))
    &&(skip==="cond"||!f.conds.length||f.conds.includes(p.condition))
    &&(skip==="mem"||!f.mems.length||f.mems.includes(p.memory||"—"))
    &&(skip==="color"||!f.colors.length||f.colors.includes(p.color||"—"))
    &&(skip==="used"||!ubOn(f)||usedMatch(p,f,u.stockWh))
    &&(!f.track||(f.track==="ser")===!!p.trackSerial)
    &&(!f.chan||(f.chan==="site"?p.onSite:f.chan==="avito"?p.onAvito:!p.onSite&&!p.onAvito))
    &&(f.pmin===""||num(p.price)>=num(f.pmin))&&(f.pmax===""||num(p.price)<=num(f.pmax))
    &&(f.avail==="all"||f.avail==="in"&&qty(p)>0||f.avail==="out"&&qty(p)<=0||f.avail==="low"&&App.isLow(p)||f.avail==="dead"&&App.isDead(p))
    &&words.every(w=>[p.name,p.sku,p.barcode,p.serial,p.brand,p.model,p.memory,p.color,App.catName(p),App.unitCodes(p.id)].join(" ").toLowerCase().includes(w)));
}
const ubOn=f=>{const b=f.ub||{};return !!(b.batt!==""&&b.batt!=null||b.repair||b.box||b.never||b.icloud)};
function usedMatch(p,f,wh){const b=f.ub;return App.unitsOf(p.id,{wh}).some(u=>{const a=u.attrs||{};
  return (b.batt===""||b.batt==null||num(u.batteryHealth)>=num(b.batt))&&(!b.repair||a.repair===b.repair)&&(!b.box||(a.kitList||[]).includes("Коробка"))&&(!b.never||a.simlock==="Neverlock")&&(!b.icloud||a.icloud==="Отвязан")})}
function usedRange(p){if(!p.trackSerial)return "";const us=App.unitsOf(p.id).filter(u=>u.batteryHealth!=null&&u.batteryHealth!==""&&(u.condition||"")!=="Новый");if(!us.length)return "";
  const b=us.map(u=>num(u.batteryHealth)),mn=Math.min(...b),mx=Math.max(...b),rep=us.filter(u=>(u.attrs||{}).repair==="Был").length;
  return "АКБ "+(mn===mx?mn:mn+"–"+mx)+"%"+(rep?" · с ремонтом: "+rep:"")}
const facet=(list,fn)=>{const m=new Map();list.forEach(p=>{const k=fn(p);if(k)m.set(k,(m.get(k)||0)+1)});return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0],"ru",{numeric:true}))};
function catChips(){
  const f=App.ui.sf,base=stockBase("cat"),cnt=id=>base.filter(p=>App.inCat(p,id)).length,none=base.filter(p=>!p.categoryId).length;
  const cur=App.cat(f.cat),root=cur?(cur.parentId?App.cat(cur.parentId):cur):null,kids=root?App.catChildren(root.id):[];
  const chip=(id,label,n,on)=>`<button class="chip ${on?"on":""}" data-act="sfCat" data-id="${esc(id)}">${esc(label)}<b>${n}</b></button>`;
  return `<div class="chips">${chip("","Все",base.length,!f.cat)}${App.catChildren("").map(c=>chip(c.id,c.name,cnt(c.id),root&&root.id===c.id)).join("")}
    ${none?chip("__none","Без категории",none,f.cat==="__none"):""}${App.can("settings")?'<button class="chip add" data-act="catForm">+ категория</button>':""}</div>
    ${root?`<div class="chips sub"><span class="subl">${esc(root.name)}:</span>${chip(root.id,"все",cnt(root.id),f.cat===root.id)}${kids.map(k=>chip(k.id,k.name,cnt(k.id),f.cat===k.id)).join("")}
    ${App.can("settings")?`<button class="chip add" data-act="subCatNew" data-id="${esc(root.id)}">+ подкатегория</button>`:""}</div>`:""}`;
}
const secSum=(...a)=>a.filter(Boolean).join(", ");
function fsec(key,title,summary,body){const open=!!(App.ui.sf.sec||{})[key];
  return `<div class="fsec ${open?"open":""}"><button class="fsh" data-act="sfSec" data-id="${key}" aria-expanded="${open}"><span class="ft">${title}</span><span class="fsum">${esc(summary||"")}</span><span class="car"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${open?180:0}deg);transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg></span></button>${open?`<div class="fsb">${body}</div>`:""}</div>`}
VIEWS.stock={
  ownSearch:true,
  actions:()=>(App.can("stock")?'<button class="btn" data-act="catalogNew">Из каталога Apple</button>':"")+`<button class="btn" data-act="tagsFromPick">${App.ui.tagPick.size?"Ценники ("+App.ui.tagPick.size+")":"Ценники"}</button>`+(App.can("io")?'<button class="btn" data-act="exportDlg" data-id="products">Экспорт</button><button class="btn" data-act="importDlg">Импорт</button>':"")+(App.can("stock")?'<button class="btn pri" data-act="newProduct">+ Товар</button>':""),
  render(){
    const u=App.ui,f=u.sf,showCost=App.can("cost");
    const qty=p=>u.stockWh?App.qtyIn(p,u.stockWh):App.qtyTotal(p);
    const list=stockBase("");
    let whs=App.whs().filter(w=>list.some(p=>App.qtyIn(p,w.id)));if(!whs.length)whs=App.whs().slice(0,1);
    const col=App.coll,cmp={name:(a,b)=>col(a.name,b.name),new:(a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")),
      qty:(a,b)=>qty(b)-qty(a),price_asc:(a,b)=>num(a.price)-num(b.price),price_desc:(a,b)=>num(b.price)-num(a.price),markup:(a,b)=>(num(b.price)-num(b.cost))-(num(a.price)-num(a.cost))}[f.sort]||((a,b)=>0);
    const gkey={cat:p=>App.catName(p),brand:brandOf,model:p=>p.model||"Без модели",none:()=>""}[f.group]||(()=>"");
    const gk=new Map(list.map(p=>[p,String(gkey(p))]));
    list.sort((a,b)=>col(gk.get(a),gk.get(b))||cmp(a,b)||col(a.name,b.name));
    const totCost=list.reduce((a,p)=>a+num(p.cost)*Math.max(0,qty(p)),0),totPrice=list.reduce((a,p)=>a+num(p.price)*Math.max(0,qty(p)),0),totQty=list.reduce((a,p)=>a+Math.max(0,qty(p)),0);
    const shown=list.slice(0,u.stockLimit||300);App.ui.stockShown=shown.map(p=>p.id);
    const cols=3+(showCost?2:1);
    // фасеты
    const fb=facet(stockBase("brand"),brandOf),fc=facet(stockBase("cond"),p=>p.condition),fm=facet(stockBase("mem"),p=>p.memory),fcol=facet(stockBase("color"),p=>p.color);
    const chipset=(kind,arr,sel)=>arr.map(([v,n])=>`<button class="chip ${sel.includes(v)?"on":""}" data-act="sfToggle" data-id="${esc(kind+"|"+v)}">${esc(v)}<b>${n}</b></button>`).join("");
    const active=[...f.brands.map(v=>["brands",v,v]),...f.conds.map(v=>["conds",v,v]),...f.mems.map(v=>["mems",v,v]),...f.colors.map(v=>["colors",v,v]),
      ...(f.avail!=="all"?[["avail","",AVAIL.find(a=>a[0]===f.avail)[1]]]:[]),...(f.track?[["track","",f.track==="ser"?"Поштучный учёт":"Без поштучного учёта"]]:[]),
      ...(f.chan?[["chan","",{site:"На сайте",avito:"На Авито",none:"Нигде не выставлен"}[f.chan]]]:[]),...(f.pmin!==""||f.pmax!==""?[["price","","Цена "+(f.pmin!==""?"от "+num(f.pmin):"")+(f.pmax!==""?" до "+num(f.pmax):"")]]:[]),
      ...(f.arch?[["arch","","Архив"]]:[]),...(ubOn(f)?[["ub","","Б/у параметры"]]:[])];
    // строки с группировкой
    const mob=isNarrow();let rows="",g=null;
    shown.forEach(p=>{const k=gkey(p);
      if(f.group!=="none"&&k!==g&&mob){g=k;const inG=list.filter(x=>gkey(x)===k);rows+=`<div class="mgrow"><b>${esc(k)}</b><span>${inG.length} поз. · ${inG.reduce((a,x)=>a+Math.max(0,qty(x)),0)} шт</span></div>`}
      if(mob){const q=qty(p),mk=num(p.price)-num(p.cost);
        rows+=`<div class="pcard rowlink" data-act="openProduct" data-id="${esc(p.id)}"><input type="checkbox" class="pck" data-act="tagPick" data-id="${esc(p.id)}" aria-label="Ценник" ${App.ui.tagPick.has(p.id)?"checked":""}>
          <div class="pci"><b>${esc(p.name)}</b><div class="chips">${App.apprPill?App.apprPill(p):""}${p.condition&&p.condition!=="Новый"?`<span class="pill">${esc(p.condition)}</span>`:""}${p.trackSerial?'<span class="pill info">'+App.codeLbl(p)+'</span>':""}${p.onSite?'<span class="pill info">Сайт</span>':""}${p.onAvito?'<span class="pill info">Авито</span>':""}</div>
          <span class="sub">${esc([f.group!=="cat"?App.catName(p):"",p.brand,p.sku?"арт. "+p.sku:""].filter(Boolean).join(" · "))}</span>
</div>
          <div class="pcr"><b>${money(p.price)}</b><span>${qtyCell(q,p)} шт</span>${showCost?`<small>закупка ${money(p.cost)}</small>`:""}</div></div>`;return}
      if(f.group!=="none"&&k!==g){g=k;const inG=list.filter(x=>gkey(x)===k);
        rows+=`<tr class="grow"><td colspan="${cols}"><b>${esc(k)}</b><span>${inG.length} поз. · ${inG.reduce((a,x)=>a+Math.max(0,qty(x)),0)} шт${showCost?" · "+money(inG.reduce((a,x)=>a+num(x.cost)*Math.max(0,qty(x)),0)):""}</span></td></tr>`}
      const mk=num(p.price)-num(p.cost);
      rows+=`<tr class="rowlink" data-act="openProduct" data-id="${esc(p.id)}">
      <td class="tagsel"><input type="checkbox" data-act="tagPick" data-id="${esc(p.id)}" aria-label="Ценник" ${App.ui.tagPick.has(p.id)?"checked":""}></td>
      <td><b>${esc(p.name)}</b>${App.apprPill?App.apprPill(p," "):""}${p.condition&&p.condition!=="Новый"?` <span class="pill">${esc(p.condition)}</span>`:""}${p.trackSerial?' <span class="pill info">'+App.codeLbl(p)+'</span>':""}${p.onSite?' <span class="pill info">Сайт</span>':""}${p.onAvito?' <span class="pill info">Авито</span>':""}
        <span class="sub">${esc([f.group!=="cat"?App.catName(p):"",f.group!=="brand"&&p.brand?p.brand:"",p.sku?"арт. "+p.sku:"",p.barcode?"ШК "+p.barcode:"",usedRange(p)].filter(Boolean).join(" · "))}</span></td>
      ${u.stockWh?`<td class="n">${qtyCell(App.qtyIn(p,u.stockWh),p)}</td>`:`<td class="n">${qtyCell(App.qtyTotal(p),p)}</td>`}
      ${showCost?`<td class="n">${money(p.cost)}</td>`:""}<td class="n"><b>${money(p.price)}</b></td></tr>`});
    const curCat=App.cat(f.cat),catLabel=f.cat==="__none"?"Без категории":curCat?App.catName({categoryId:curCat.id}):"";
    const nOn=(ubOn(f)?1:0)+(f.cat?1:0)+f.brands.length+(f.avail!=="all"?1:0)+f.conds.length+f.mems.length+f.colors.length+(f.track?1:0)+(f.chan?1:0)+(f.pmin!==""||f.pmax!==""?1:0)+(f.arch?1:0);
    const allOpen=["cat","brand","avail","used","params"].every(k=>(f.sec||{})[k]);
    const filtersBody=()=>`
        ${fsec("cat","Категории",catLabel||"все",catChips())}
        ${fb.length>1||f.brands.length?fsec("brand","Бренды",f.brands.join(", ")||"все",`<div class="chips">${chipset("brands",fb,f.brands)}</div>`):""}
        ${fsec("avail","Наличие",AVAIL.find(a=>a[0]===f.avail)[1],`<div class="seg wrap">${AVAIL.map(([v,l])=>`<button class="${f.avail===v?"on":""}" data-act="sfSet" data-id="avail|${v}">${l}</button>`).join("")}</div>`)}
        ${S.units.some(x=>x.status==="in_stock"&&x.condition&&x.condition!=="Новый")||S.categories.some(c=>c.isUsed)||ubOn(f)?fsec("used","Б/у",secSum(f.ub.batt!==""&&f.ub.batt!=null?"АКБ от "+f.ub.batt+"%":"",f.ub.repair?(f.ub.repair==="Был"?"был ремонт":"без ремонта"):"",f.ub.box?"с коробкой":"",f.ub.never?"Neverlock":"",f.ub.icloud?"iCloud отвязан":"")||"любые",
          `<div class="row-f fmore"><input type="number" min="0" max="100" placeholder="АКБ от, %" value="${esc(f.ub.batt||"")}" data-ub="batt" aria-label="АКБ от">
          <select data-ub="repair" aria-label="Ремонт"><option value="">Ремонт: любой</option><option value="Не было"${f.ub.repair==="Не было"?" selected":""}>Без ремонта</option><option value="Был"${f.ub.repair==="Был"?" selected":""}>Был ремонт</option></select>
          <label class="chk"><input type="checkbox" data-ub="box" ${f.ub.box?"checked":""}> С коробкой</label><label class="chk"><input type="checkbox" data-ub="never" ${f.ub.never?"checked":""}> Neverlock</label><label class="chk"><input type="checkbox" data-ub="icloud" ${f.ub.icloud?"checked":""}> iCloud отвязан</label></div>`):""}
        ${fsec("params","Параметры",secSum(f.conds.join(", "),f.mems.join(", "),f.colors.join(", "),f.track?(f.track==="ser"?"поштучно":"без поштучного"):"",f.chan?{site:"на сайте",avito:"на Авито",none:"нигде"}[f.chan]:"",f.pmin!==""||f.pmax!==""?"цена "+(f.pmin||0)+"–"+(f.pmax||"∞"):"",f.arch?"архив":"")||"любые",
          `${fc.length>1||f.conds.length?`<div class="frow"><span class="fl">Состояние</span><div class="chips">${chipset("conds",fc,f.conds)}</div></div>`:""}
          ${fm.length?`<div class="frow"><span class="fl">Память</span><div class="chips">${chipset("mems",fm,f.mems)}</div></div>`:""}
          ${fcol.length?`<div class="frow"><span class="fl">Цвет</span><div class="chips">${chipset("colors",fcol,f.colors)}</div></div>`:""}
          <div class="frow"><span class="fl">Ещё</span><div class="row-f fmore">
            <select data-sf="track" aria-label="Учёт"><option value="">Любой учёт</option><option value="ser"${f.track==="ser"?" selected":""}>Поштучно (IMEI / S/N)</option><option value="qty"${f.track==="qty"?" selected":""}>Без IMEI</option></select>
            <select data-sf="chan" aria-label="Каналы"><option value="">Любые каналы</option><option value="site"${f.chan==="site"?" selected":""}>На сайте</option><option value="avito"${f.chan==="avito"?" selected":""}>На Авито</option><option value="none"${f.chan==="none"?" selected":""}>Нигде не выставлен</option></select>
            <input type="number" min="0" placeholder="Цена от" value="${esc(f.pmin)}" data-sf="pmin" aria-label="Цена от"><input type="number" min="0" placeholder="до" value="${esc(f.pmax)}" data-sf="pmax" aria-label="Цена до">
            <label class="chk"><input type="checkbox" data-sf="arch" ${f.arch?"checked":""}> Архив</label></div></div>`)}
    `;
    const pOpen=!!(f.sec||{}).panel;
    return `<div class="smain" data-nodirty>
      <div class="row-f stop">
        <input id="stockQ" type="search" placeholder="Название, штрихкод, IMEI" value="${esc(u.stockQ)}" data-filter="stockQ" aria-label="Поиск товара">
        ${App.sel("stockWh",[["","Все склады"],...App.whOpts()],u.stockWh,'data-filter-sel="stockWh" aria-label="Склад"')}
        <select data-sf="sort" aria-label="Сортировка">${SORTS.map(([v,l])=>`<option value="${v}"${f.sort===v?" selected":""}>${l}</option>`).join("")}</select>
        <select data-sf="group" aria-label="Группировка">${GROUPS.map(([v,l])=>`<option value="${v}"${f.group===v?" selected":""}>${l}</option>`).join("")}</select>
      </div>
      <div class="fpanel ${pOpen?"open":"closed"}">
        <div class="fhead"><button class="fsh fmain" data-act="sfSec" data-id="panel" aria-expanded="${pOpen}"><span class="ft">Фильтры</span>${nOn?`<span class="pill dark">${nOn}</span>`:""}<span class="fsum">${esc(nOn?active.map(a=>a[2]).concat(f.cat?[catLabel]:[]).join(", "):"не выбраны")}</span><span class="car"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${pOpen?180:0}deg);transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg></span><span class="totbtn">${pOpen?"Свернуть":"Развернуть"}</span></button>${pOpen?`<button class="btn sm ghost" data-act="sfSecAll">${allOpen?"Свернуть все":"Развернуть все"}</button>`:""}</div>
        ${pOpen?filtersBody():""}
      </div>
      ${active.length?`<div class="chips activef">${active.map(([k,v,l])=>`<button class="chip on" data-act="sfDrop" data-id="${esc(k+"|"+v)}">${esc(l)} ${App.ico("x","sm")}</button>`).join("")}<button class="btn sm ghost" data-act="sfReset">Сбросить всё</button></div>`:""}
      ${(()=>{const open=!!(f.sec||{}).totals;return `<div class="totbox ${open?"open":""}"><button class="fsh" data-act="sfSec" data-id="totals" aria-expanded="${open}"><span class="ft">Итоги</span><span class="fsum">${list.length} поз. · ${totQty} шт · в рознице ${money(totPrice)}</span><span class="car"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${open?180:0}deg);transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg></span><span class="totbtn">${open?"Свернуть":"Развернуть"}</span></button>${open?`<div class="totbody"><div class="tiles"><div class="tile"><span>Позиций</span><b>${list.length}</b><small>${totQty} шт</small></div>${showCost?`<div class="tile"><span>В закупке</span><b>${money(totCost)}</b></div>`:""}<div class="tile"><span>В рознице</span><b>${money(totPrice)}</b></div></div></div>`:""}</div>`})()}
      ${mob?`<section class="card mlist"><label class="chk"><input type="checkbox" data-act="tagPickAll" ${shown.length&&shown.every(p=>App.ui.tagPick.has(p.id))?"checked":""}> выбрать все для ценников</label>${rows||`<div class="empty">${S.products.length?"Ничего не найдено — измените фильтры":"Товаров пока нет. Начните с «Приёмки»"}</div>`}
        ${list.length>shown.length?`<div class="acts" style="justify-content:center"><button class="btn" data-act="moreStock">Показать ещё (${list.length-shown.length})</button></div>`:""}</section>`:`
      <section class="card"><div class="tbl-wrap"><table><thead><tr><th class="tagsel"><input type="checkbox" data-act="tagPickAll" aria-label="Выбрать все для ценников" ${shown.length&&shown.every(p=>App.ui.tagPick.has(p.id))?"checked":""}></th><th>Товар</th>${u.stockWh?"<th class=\"n\">Остаток</th>":'<th class="n">Остаток</th>'}${showCost?'<th class="n">Закупка</th>':""}<th class="n">Цена</th></tr></thead><tbody>
      ${rows||`<tr><td colspan="${cols}" class="empty">${S.products.length?"Ничего не найдено — измените фильтры":"Товаров пока нет. Начните с «Приёмки» или «Из каталога Apple»"}</td></tr>`}
      </tbody></table></div>${list.length>shown.length?`<div class="acts" style="justify-content:center;margin-top:10px"><button class="btn" data-act="moreStock">Показать ещё (${list.length-shown.length})</button></div>`:""}</section>`}
    </div>`;
  }
};
ACT.sfCat=id=>{App.ui.sf.cat=id;sfSave();App.render()};
ACT.sfSec=k=>{const f=App.ui.sf;f.sec=Object.assign({},f.sec);f.sec[k]=!f.sec[k];sfSave();App.render()};
ACT.sfSecAll=()=>{const f=App.ui.sf,v=!["cat","brand","avail","used","params"].every(k=>(f.sec||{})[k]);f.sec=Object.assign({},f.sec,{cat:v,brand:v,avail:v,used:v,params:v});sfSave();App.render()};
ACT.sfToggle=v=>{const [k,val]=v.split(/\|(.*)/s),a=App.ui.sf[k];const i=a.indexOf(val);i>=0?a.splice(i,1):a.push(val);sfSave();App.render()};
ACT.sfSet=v=>{const [k,val]=v.split("|");App.ui.sf[k]=val;sfSave();App.render()};
ACT.sfDrop=v=>{const [k,val]=v.split(/\|(.*)/s),f=App.ui.sf;
  if(Array.isArray(f[k]))f[k]=f[k].filter(x=>x!==val);else if(k==="avail")f.avail="all";else if(k==="price"){f.pmin="";f.pmax=""}else if(k==="arch")f.arch=false;else if(k==="ub")f.ub=SF0().ub;else f[k]="";sfSave();App.render()};
ACT.sfReset=()=>{const keep={sort:App.ui.sf.sort,group:App.ui.sf.group,sec:App.ui.sf.sec};App.ui.sf=Object.assign(SF0(),keep);App.ui.stockQ="";sfSave();App.render()};
ACT.subCatNew=parent=>{ACT.catForm("");setTimeout(()=>{const s=document.getElementById("kParent");if(s)s.value=parent},0)};
let sfT=0,wasMob=isNarrow();
window.addEventListener("resize",()=>{const m=isNarrow();if(m!==wasMob){wasMob=m;if(App.ui.view==="stock")App.render()}});
document.addEventListener("input",e=>{const t=e.target;if(t.dataset&&t.dataset.ub){const b=App.ui.sf.ub;b[t.dataset.ub]=t.type==="checkbox"?t.checked:t.value;sfSave();clearTimeout(sfT);sfT=setTimeout(()=>App.render(),t.type==="number"?400:0);return}
  if(!t.dataset||!t.dataset.sf)return;const k=t.dataset.sf;App.ui.sf[k]=t.type==="checkbox"?t.checked:t.value;sfSave();
  clearTimeout(sfT);sfT=setTimeout(()=>App.render(),k==="pmin"||k==="pmax"?400:0)});
document.addEventListener("change",e=>{const t=e.target;if(t.dataset&&(t.dataset.sf||t.dataset.ub)&&(t.tagName==="SELECT"||t.type==="checkbox"))t.dispatchEvent(new Event("input",{bubbles:true}))});
function qtyCell(q,p){return App.isLow(p)?`<span class="pill bad">${q}</span>`:q<=0?'<span class="pill mute">0</span>':`<b>${q}</b>`}
/* карточка склада: его товары, поиск и действия */
/* содержимое склада: итоги, действия, поиск и список товаров (и в карточке, и на странице «Склад») */
function whBody(id,{noActs=false}={}){
  const w=App.byId("warehouses",id);if(!w)return '<div class="empty">Склад не найден</div>';
  const cost=App.can("cost"),st=App.can("stock");
  const ps=S.products.filter(p=>App.qtyIn(p,id)!==0).sort((a,b)=>App.catName(a).localeCompare(App.catName(b))||String(a.name).localeCompare(b.name));
  const qn=ps.reduce((a,p)=>a+Math.max(0,App.qtyIn(p,id)),0);
  const sumC=ps.reduce((a,p)=>a+Math.max(0,App.qtyIn(p,id))*num(p.cost),0),sumP=ps.reduce((a,p)=>a+Math.max(0,App.qtyIn(p,id))*num(p.price),0);
  return `<div class="tiles"><div class="tile"><span>Штук</span><b>${qn}</b><small>${ps.length} поз.</small></div>${cost?`<div class="tile"><span>В закупке</span><b>${money(sumC)}</b></div>`:""}<div class="tile"><span>В рознице</span><b>${money(sumP)}</b></div></div>
    ${st&&!noActs?`<div class="row-f whacts"><button class="btn pri sm" data-act="whDoc" data-id="in|${esc(id)}">+ Приход</button><button class="btn sm" data-act="whDoc" data-id="transfer|${esc(id)}">Переместить</button><button class="btn sm" data-act="whDoc" data-id="writeoff|${esc(id)}">Списать</button><button class="btn sm" data-act="whDoc" data-id="inventory|${esc(id)}">Инвентаризация</button><button class="btn sm" data-act="printWh" data-id="${esc(id)}">Печать остатков</button></div>`:""}
    <input type="search" class="whQ" placeholder="Найти товар на этом складе" autocomplete="off" data-nodirty aria-label="Поиск по складу" style="width:100%;margin:12px 0 8px">
    <div class="whlist">${ps.map(p=>{const q=App.qtyIn(p,id),units=p.trackSerial?App.unitsOf(p.id,{wh:id}):[];
      return `<div class="whr" data-s="${esc([p.name,p.brand,p.sku,p.barcode,App.catName(p),...units.map(App.unitCode)].join(" ").toLowerCase())}">
        <button type="button" class="whr-main" data-act="openProduct" data-id="${esc(p.id)}"><b>${esc(p.name)}${p.trackSerial?` <span class="pill info">${App.codeLbl(p)}</span>`:""}</b><small>${esc(App.catName(p))}${units.length?" · "+units.slice(0,3).map(u=>esc(App.unitCode(u))).join(", ")+(units.length>3?" и ещё "+(units.length-3):""):""}</small></button>
        <span class="whr-q ${q<0?"bad":""}">${q} шт</span><span class="whr-p">${money(p.price)}</span>
        ${st?`<span class="whr-a"><button class="btn sm ghost" data-act="whDoc" data-id="transfer|${esc(id)}|${esc(p.id)}" title="Переместить на другой склад">${App.ico("swap","sm")}</button><button class="btn sm ghost danger" data-act="whDoc" data-id="writeoff|${esc(id)}|${esc(p.id)}" title="Списать">−</button></span>`:""}</div>`}).join("")||'<div class="empty">На складе пока нет товаров. Добавьте их приходом или перемещением.</div>'}
      <div class="empty whNone" hidden>Ничего не найдено</div></div>`;
}
function whSearchBind(root){root=root||document;root.querySelectorAll(".whQ").forEach(q=>{const box=q.parentElement;
  q.addEventListener("input",()=>{const t=q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);let n=0;
    box.querySelectorAll(".whr").forEach(r=>{const ok=t.every(x=>r.dataset.s.includes(x));r.hidden=!ok;if(ok)n++});const e=box.querySelector(".whNone");if(e)e.hidden=!!n||!box.querySelector(".whr")})})}
const whLabel=w=>{const pt=w.pointId?App.byId("points",w.pointId):null,role=pt&&pt.cashWh===w.id?"склад кассы":pt&&pt.serviceWh===w.id?"склад сервиса":"";return (pt?pt.name:"общий склад")+(role?" · "+role:"")+(w.active===false?" · отключён":"")};
/* карточка склада (из карточки товара) */
ACT.whOpen=id=>{
  const draw=()=>{
    const w=App.byId("warehouses",id);if(!w)return App.closeModal();
    App.redrawModal(App.head(esc(w.name),`<span class="pill ${w.active===false?"mute":"info"}">${esc(whLabel(w))}</span>${App.can("settings")?`<button class="btn sm" data-act="whForm" data-id="${esc(id)}">Изменить</button>`:""}`)+whBody(id)+`
      <div class="acts"><button class="btn" data-act="whStock" data-id="${esc(id)}">Открыть в «Товарах»</button><button class="btn" data-act="close">Закрыть</button></div>`);
    whSearchBind(document.getElementById("modal"));
  };
  App.openModal("",{wide:true,refresh:draw});draw();
};
/* документ со склада: тип|склад|товар */
ACT.whDoc=arg=>{let [type,wh,pid]=arg.split("|");if(!App.byId("warehouses",wh))wh=App.cashWh();const p=pid?App.byId("products",pid):null;App.closeModal();
  ACT.newDoc(type,p?{productId:p.id,name:p.name,qty:p.trackSerial?0:1,cost:num(p.cost),newUnits:[],unitIds:[],foundCodes:[]}:null);
  if(!D)return;
  if(type==="in"||type==="inventory")D.whTo=wh;
  else if(type==="transfer"){D.whFrom=wh;const cash=App.cashWh();D.whTo=cash&&cash!==wh?cash:((App.whs().find(x=>x.id!==wh)||{}).id||wh)}
  else{D.whFrom=wh;D.whTo=wh}
  docEditor()};
ACT.whBoxT=()=>{App.ui.whOpenBox=!App.ui.whOpenBox;App.render()};
ACT.whStock=id=>{App.closeModal();App.ui.stockWh=id;location.hash="stock";App.render()};
ACT.moreStock=()=>{App.ui.stockLimit=(App.ui.stockLimit||300)+300;App.render()};

/* ---------- карточка товара ---------- */
ACT.newProduct=()=>productForm(null);
ACT.openProduct=id=>productForm(id);
/* карточка товара для продавца: без полей редактирования — цена, где лежит, характеристики, действия */
function productView(p){const pt=App.point(),mine=new Set(App.whs().filter(w=>pt&&w.pointId===pt.id).map(w=>w.id));
  const here=App.whs().filter(w=>mine.has(w.id)).reduce((a,w)=>a+App.qtyIn(p,w.id),0),tot=App.qtyTotal(p);
  const attrs=[["Модель",p.model],["Память",p.memory],["Цвет",p.color],["Состояние",p.condition],["Бренд",p.brand],...Object.entries(p.attrs||{}),["Гарантия",num(p.warrantyMonths)?p.warrantyMonths+" мес.":""],["Артикул",p.sku],["Штрихкод",p.barcode]].filter(([,v])=>v);
  const units=p.trackSerial?S.units.filter(u=>u.productId===p.id&&u.status==="in_stock"):[];
  App.openModal(App.head(esc(p.name),App.apprPill?App.apprPill(p):"")+`
    <div class="pview"><div class="pv-price"><b>${money(p.price)}</b><span class="pill ${here?"ok":"bad"}">${here?"здесь "+here+" шт":"здесь нет"}</span>${tot>here?`<span class="muted">всего ${tot} шт</span>`:""}</div>
    <div class="pstock">${App.whs().filter(w=>App.qtyIn(p,w.id)).map(w=>`<span class="chip ${mine.has(w.id)?"on":""}">${esc(w.name)} <b>${App.qtyIn(p,w.id)}</b></span>`).join("")||'<span class="muted">Нет ни на одном складе</span>'}</div>
    ${attrs.length?`<dl class="rdl">${attrs.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`:""}
    ${units.length?`<h3 class="sub-h">Экземпляры в наличии</h3><div class="list-mini">${units.slice(0,20).map(u=>`<button data-act="openUnit" data-id="${esc(u.id)}"><span>${esc(App.unitCode(u))}<small>${esc(App.whName(u.whId))}${u.batteryHealth!=null&&u.batteryHealth!==""?" · АКБ "+u.batteryHealth+"%":""}${u.condition?" · "+esc(u.condition):""}</small></span><b class="num">${money(App.unitPrice?App.unitPrice(u,p):p.price)}</b></button>`).join("")}</div>`:""}
    ${p.description?`<p class="muted">${esc(p.description)}</p>`:""}</div>
    <div class="acts"><button class="btn" data-act="tagOne" data-id="${esc(p.id)}">Ценник</button>${App.can("sale")&&here&&p.approval!=="pending_create"?`<button class="btn pri" data-act="pvSell" data-id="${esc(p.id)}">Добавить в чек</button>`:""}</div>`)}
ACT.pvSell=id=>{App.closeModal();location.hash="pos";setTimeout(()=>ACT.posAdd(id),150)};
ACT.unitAll=()=>{App.ui.unitAll=!App.ui.unitAll;if(App.ui.prodOpen)productForm(App.ui.prodOpen)};
function productForm(id){
  const p=id?App.byId("products",id):{condition:"Новый",onSite:true,onAvito:false,minQty:0,categoryId:(App.catChildren("")[0]||{}).id||""};
  if(!p)return;App.ui.prodOpen=id||"";
  const edit=App.can("stock"),price=App.can("price"),cost=App.can("cost"),st=App.settings();
  if(id&&!edit)return productView(p);
  const moves=id?App.sortDesc(S.movements.filter(m=>m.productId===id),"at").slice(0,15):[];
  const units=id&&p.trackSerial?App.sortDesc(S.units.filter(u=>u.productId===id&&(App.ui.unitAll||u.status==="in_stock")),"createdAt"):[];
  const attrs=Object.entries(p.attrs||{}).filter(([k,v])=>v);
  App.openModal(App.head(id?esc(p.name):"Новый товар",(id&&p.archived?'<span class="pill mute">архив</span>':"")+(id&&App.apprPill?App.apprPill(p):""))+(id&&App.apprPanel?App.apprPanel(p):"")+`
  ${id?`<div class="pstock"><b>Остаток: ${App.qtyTotal(p)} шт</b>${App.whs().map(w=>{const q=App.qtyIn(p,w.id);return `<button type="button" class="chip ${q?"":"off"}" data-act="whOpen" data-id="${esc(w.id)}" title="Открыть склад">${esc(w.name)} <b>${q}</b></button>`}).join("")}</div>`:""}
  ${id&&p.onSite&&App.can("settings")?`<div class="row-f" style="margin:8px 0 0"><button type="button" class="btn sm" data-act="sitePreview" data-id="${esc(id)}">Как уйдёт на сайт</button></div>`:""}
  ${id&&App.can("cost")&&App.offersFor?(()=>{const of=App.offersFor(p).filter(o=>o.price>0).slice(0,5);return of.length?`<div class="offers"><span class="muted">Цены поставщиков:</span> ${of.map((o,i)=>`<button type="button" class="pill ${i?"":"ok"}" data-act="spOpen" data-id="${o.id}">${esc((App.byId("suppliers",o.supplierId)||{}).name||"")} — ${money(o.price)}</button>`).join(" ")}</div>`:""})():""}
  <div class="form">
    ${App.fld("pName","Название",`<textarea id="pName" rows="2" class="namearea" placeholder="iPhone 15 Pro 256 ГБ, натуральный титан" ${edit?"":"disabled"}>${esc(p.name||"")}</textarea>`,"full")}
    ${App.fld("pCat","Категория",App.sel("pCat",App.catOpts(),p.categoryId||"",edit?"":"disabled"))}
    ${App.fld("pCond","Состояние",App.sel("pCond",App.CONDS,p.condition,edit?"":"disabled"))}
    ${App.fld("pModel","Модель",App.inp("pModel",p.model,"text","iPhone 15 Pro",edit?"":"disabled"))}
    ${App.fld("pMem","Память",App.inp("pMem",p.memory,"text","256 ГБ",edit?"":"disabled"))}
    ${App.fld("pColor","Цвет",App.inp("pColor",p.color,"text","натуральный титан",edit?"":"disabled"))}
    ${App.fld("pBrand","Бренд",App.inp("pBrand",p.brand,"text","Apple",(edit?"":"disabled ")+'list="brandList"')+`<datalist id="brandList">${[...new Set(["Apple",...S.products.map(x=>x.brand).filter(Boolean)])].sort().map(b=>`<option value="${esc(b)}">`).join("")}</datalist>`)}
    ${App.fld("pBar","Штрихкод",App.inp("pBar",p.barcode,"text","отсканируйте",edit?"":"disabled"))}
    <div class="fld full">${App.chk("pTrack","Поштучный учёт — каждый экземпляр отдельно (IMEI у телефонов, серийный номер у остальной техники)",p.trackSerial).replace("<input",edit?"<input":"<input disabled")}</div>
    ${p.trackSerial?"":App.fld("pSerial",(App.isPhone(p)?"IMEI":"Серийный номер")+" (если товар один)",App.inp("pSerial",p.serial,"text","",edit?"":"disabled"))}
    ${attrs.length?`<div class="fld full"><label>Параметры</label><div class="chips">${attrs.map(([k,v])=>`<span class="pill">${esc(k)}: ${esc(v)}</span>`).join("")}</div></div>`:""}
    ${cost?App.fld("pCost","Закупка, ₽",App.inp("pCost",p.cost||"","number","",price?"":"disabled")):""}
    ${App.fld("pPrice","Цена продажи, ₽",App.inp("pPrice",p.price||"","number","",price?"":"disabled"))}
    <div class="fld full"><span class="hint" id="pMk"></span></div>
    ${!id&&edit&&!p.trackSerial?App.fld("pQty","Начальный остаток (без поштучного учёта)",App.inp("pQty","","number","0"))+App.fld("pWh","На склад",App.sel("pWh",App.whs().map(w=>[w.id,w.name]),App.cashWh())):""}
    <div class="fld full"><label>Где продаём</label><div class="chips">${App.chk("pSite","Сайт",p.onSite)}${App.chk("pOnAvito","Авито",p.onAvito)}</div></div>
  </div>
  <details class="more pmore" ${p.diagnostics||p.kit||p.note||num(p.oldPrice)||(p.batteryHealth!=null&&p.batteryHealth!=="")||num(p.avitoPrice)?"open":""}><summary>Дополнительно: артикул, гарантия, б/у, Авито, описание</summary><div class="form">
    ${App.fld("pSku","Артикул",App.inp("pSku",p.sku,"text","",edit?"":"disabled"))}
    ${App.fld("pOld","Старая цена, ₽ (для ценника со скидкой)",App.inp("pOld",p.oldPrice||"","number","пусто — без скидки",price?"":"disabled"))}
    ${App.fld("pMin","Минимальный остаток (всего)",App.inp("pMin",p.minQty||0,"number","",edit?"":"disabled"))}
    ${App.fld("pWarr","Гарантия, мес. (0 = по умолчанию)",App.inp("pWarr",p.warrantyMonths||"","number","",edit?"":"disabled"))}
    ${App.fld("pBatt","Ёмкость АКБ, %",App.inp("pBatt",p.batteryHealth==null?"":p.batteryHealth,"number","для б/у устройств",edit?"":"disabled"))}
    ${App.fld("pAvito","Цена на Авито, ₽",App.inp("pAvito",p.avitoPrice,"number","как розничная",price?"":"disabled"))}
    ${App.fld("pDiag","Результат диагностики",App.inp("pDiag",p.diagnostics,"text","Всё исправно, замен не было",edit?"":"disabled"),"full")}
    ${App.fld("pKit","Комплектация",App.inp("pKit",p.kit,"text","Коробка, кабель",edit?"":"disabled"),"full")}
    ${App.fld("pNote","Описание / заметка",App.area("pNote",p.note||""),"full")}
  </div></details>
  ${id&&p.trackSerial?`<section><div class="card-h"><h3 class="sub-h">Экземпляры (${App.unitsOf(id).length} в наличии)</h3><label class="chk"><input type="checkbox" data-act="unitAll" ${App.ui.unitAll?"checked":""}> показать проданные и списанные</label></div>
    <div class="tbl-wrap"><table><thead><tr><th>${App.isPhone(p)?"IMEI":"Серийный номер"}</th><th>Состояние</th><th class="n">АКБ</th><th class="n">Цена</th>${cost?'<th class="n">Закупка</th>':""}<th>Где</th></tr></thead><tbody>
    ${units.map(u=>`<tr class="rowlink" data-act="openUnit" data-id="${esc(u.id)}"><td><b>${esc(App.unitCode(u))}</b>${u.imei2?'<span class="sub">IMEI 2 '+esc(u.imei2)+"</span>":""}${u.imei&&u.serialNo?'<span class="sub">SN '+esc(u.serialNo)+"</span>":""}</td><td>${esc(u.condition||"")}<div class="chips usum">${App.usedChips(u.attrs)}</div></td>
      <td class="n">${u.batteryHealth!=null&&u.batteryHealth!==""?u.batteryHealth+"%":"—"}</td><td class="n">${money(App.unitPrice(u,p))}</td>${cost?`<td class="n">${money(u.cost)}</td>`:""}<td>${App.unitSt(u)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Нет экземпляров. Оформите приход и отсканируйте IMEI</td></tr>`}
    </tbody></table></div></section>`:""}
  ${id?`<section><h3 class="sub-h">Движение</h3><div class="tbl-wrap"><table><tbody>${moves.map(m=>`<tr><td>${App.dtt(m.at)}</td><td>${esc(App.MOVE[m.type]||m.type)}</td><td>${esc(App.whName(m.whId))}</td><td class="n"><span class="pill ${num(m.qty)>0?"ok":"mute"}">${num(m.qty)>0?"+":""}${num(m.qty)}</span></td><td>${esc(m.ref)}${m.note?'<span class="sub">'+esc(m.note)+"</span>":""}</td></tr>`).join("")||'<tr><td class="empty">Движений нет</td></tr>'}</tbody></table></div></section>`:""}
  ${id&&App.prodHist?App.prodHist(p):""}
  <div class="acts">
    ${id&&App.prodDelBtn?App.prodDelBtn(p,moves):id&&App.can("del")?`<button class="btn danger" data-act="delProduct" data-id="${esc(id)}">${moves.length?(p.archived?"Вернуть из архива":"В архив"):"Удалить"}</button>`:""}
    ${id?`<button class="btn" data-act="tagOne" data-id="${esc(id)}">Ценник</button>`:""}
    ${id&&App.can("stock")?`<button class="btn" data-act="quickDoc" data-id="in|${esc(id)}">Приход</button><button class="btn" data-act="quickDoc" data-id="transfer|${esc(id)}">Переместить</button><button class="btn" data-act="quickDoc" data-id="writeoff|${esc(id)}">Списать</button>`:""}
    ${edit||price?`<button class="btn pri" data-act="saveProduct" data-id="${esc(id||"")}">Сохранить</button>`:""}
  </div>`,{wide:true});
  const mk=()=>{const h=$("#pMk");if(!h||!cost)return;const c=num(App.val("pCost")),pr=num(App.val("pPrice"));if(!c||!pr){h.textContent="";return}
    const d=pr-c;
    h.textContent="Наценка "+money(d)+" ("+Math.round(d/c*100)+"%)"+(d<0?" · ниже закупки":"");h.className="hint "+(d<0?"bad":"ok")};
  ["pCost","pPrice","pCat"].forEach(i=>{const el=document.getElementById(i);if(el)el.addEventListener("input",mk)});mk();
}
ACT.saveProduct=async(id,btn)=>{
  const V=App.val;if(!V("pName"))return App.toast("Укажите название");
  const old=id?App.byId("products",id):null;
  const n=v=>v===""?null:num(v);
  const data={name:V("pName").replace(/\s*\n\s*/g," "),category_id:V("pCat")||null,condition:V("pCond"),brand:V("pBrand")||null,sku:V("pSku")||null,barcode:V("pBar")||null,serial:V("pSerial")||null,
    track_serial:App.checked("pTrack"),price:num(V("pPrice")),min_qty:num(V("pMin")),warranty_months:num(V("pWarr")),battery_health:n(V("pBatt")),diagnostics:V("pDiag")||null,kit:V("pKit")||null,model:V("pModel")||null,memory:V("pMem")||null,color:V("pColor")||null,
    avito_price:n(V("pAvito")),old_price:n(V("pOld")),on_site:App.checked("pSite"),on_avito:App.checked("pOnAvito"),description:V("pNote")||null};
  if(data.battery_health!=null&&(data.battery_health<0||data.battery_health>100))return App.toast("Ёмкость АКБ — от 0 до 100%");
  if(App.can("cost")&&document.getElementById("pCost"))data.cost=num(V("pCost"));
  if(old&&old.trackSerial&&!data.track_serial&&S.units.some(u=>u.productId===id))return App.toast("У товара есть экземпляры с IMEI — учёт по серийным номерам отключить нельзя");
  if(old&&!old.trackSerial&&data.track_serial&&App.qtyTotal(old)>0)return App.toast("Сначала спишите или продайте остаток без IMEI, потом включите учёт по серийным номерам");
  if(!document.getElementById("pSerial"))delete data.serial;
  if(!App.can("price")){delete data.price;delete data.avito_price;delete data.old_price}
  if(data.old_price!=null&&data.old_price<=num(data.price))data.old_price=null;
  if(btn.disabled)return;btn.disabled=true;
  try{
    if(id){await App.api.update("products",id,data);App.closeModal();App.toast("Сохранено")}
    else{
      const p=await App.api.insert("products",data);const q=num(V("pQty"));
      if(q>0)await App.api.doc({type:"in",wh_to:V("pWh"),note:"Начальный остаток"},[{product_id:p.id,qty:q,cost:num(data.cost)}],true);
      await App.api.audit("Новый товар",data.name,"");
      App.closeModal();App.toast("Товар добавлен");
    }
  }catch(e){btn.disabled=false;App.toast(e.message)}
};
ACT.delProduct=async(id,el)=>{
  const p=App.byId("products",id),hasMoves=S.movements.some(m=>m.productId===id)||App.qtyTotal(p)>0;
  try{
    if(!hasMoves){if(!App.confirm2(el,"Удалить навсегда? Нажмите ещё раз"))return;
      try{await App.api.remove("products",id)}catch(e){if(/подтвержден/i.test(e.message||""))throw e;await App.api.update("products",id,{is_archived:true});App.closeModal();return App.toast("У товара есть история, он отправлен в архив")}
      App.closeModal();return App.toast("Товар удалён")}
    if(!p.archived&&App.qtyTotal(p)>0)return App.toast("В архив можно отправить только товар с нулевым остатком. Сначала спишите или переместите");
    await App.api.update("products",id,{is_archived:!p.archived});App.closeModal();App.toast(p.archived?"Товар возвращён":"Товар в архиве");
  }catch(e){App.toast(e.message)}
};

/* ======================= СКЛАДСКИЕ ДОКУМЕНТЫ ======================= */
TITLES.docs="Склад";
App.ui.docType="";App.ui.docQ="";App.ui.docStatus="";
VIEWS.docs={
  ownSearch:true,
  after(){const sel=document.getElementById("docWh");if(sel)sel.addEventListener("change",()=>{App.ui.docWh=sel.value;App.ui.whOpenBox=true;App.render()});whSearchBind(document.querySelector(".whbox"))},
  actions:()=>App.can("stock")?Object.entries(App.DOCT).map(([k,d])=>`<button class="btn ${k==="in"?"pri":""}" data-act="whDoc" data-id="${k}|${esc(App.ui.docWh||App.cashWh()||"")}">+ ${d.one}</button>`).join(""):"",
  render(){
    const u=App.ui,q=u.docQ.toLowerCase();
    const list=App.sortDesc(S.docs.filter(d=>(!u.docType||d.type===u.docType)&&(!u.docStatus||d.status===u.docStatus)&&(!q||[d.num,d.note,(App.byId("suppliers",d.supplierId)||{}).name,(d.lines||[]).map(l=>l.name).join(" ")].join(" ").toLowerCase().includes(q))));
    const moves=App.sortDesc(S.movements,"at").slice(0,40);
    const whAll=App.whs(true);if(!App.byId("warehouses",u.docWh))u.docWh=App.cashWh()||(whAll[0]||{}).id||"";
    const cw=App.byId("warehouses",u.docWh);
    const whBox=`<section class="card whbox"><div class="whtop"><div class="fld grow"><label for="docWh">Склад</label>${App.sel("docWh",whAll.map(w=>[w.id,w.name+(w.pointId?"":" (общий)")+(w.active===false?" — отключён":"")]),u.docWh,'data-nodirty')}</div>
      ${App.can("settings")&&cw?`<button class="btn" data-act="whForm" data-id="${esc(cw.id)}">Изменить</button>`:""}${App.can("settings")?'<button class="btn pri" data-act="whForm">+ Склад</button>':""}</div>
      ${cw?(()=>{const open=!!u.whOpenBox,ps=S.products.filter(p=>App.qtyIn(p,cw.id)>0),qn=ps.reduce((a,p)=>a+App.qtyIn(p,cw.id),0);
        return `<button type="button" class="fsh whsum" data-act="whBoxT" aria-expanded="${open}"><span class="ft">Остатки</span><span class="fsum">${qn} шт · ${ps.length} поз. · в рознице ${money(ps.reduce((a,p)=>a+App.qtyIn(p,cw.id)*num(p.price),0))}</span><span class="car"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${open?180:0}deg);transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg></span><span class="totbtn">${open?"Свернуть":"Развернуть"}</span></button>${open?whBody(cw.id,{noActs:true}):""}`})():'<div class="empty">Складов пока нет — создайте первый</div>'}</section>`;
    return `${whBox}<div class="chips"><button class="chip ${!u.docType?"on":""}" data-act="docType" data-id="">Все<b>${S.docs.length}</b></button>${Object.entries(App.DOCT).filter(([k])=>u.docType===k||S.docs.some(x=>x.type===k)).map(([k,d])=>`<button class="chip ${u.docType===k?"on":""}" data-act="docType" data-id="${k}">${d.label}<b>${S.docs.filter(x=>x.type===k).length}</b></button>`).join("")}</div>
    <div class="row-f"><input id="docQ" type="search" placeholder="№, поставщик, товар" value="${esc(u.docQ)}" data-filter="docQ" aria-label="Поиск документа" style="flex:1 1 260px">${App.sel("docStatus",[["","Любой статус"],["draft","Черновики"],["posted","Проведённые"],["cancelled","Отменённые"]],u.docStatus,'data-filter-sel="docStatus" aria-label="Статус"')}</div>
    <section class="card"><div class="tbl-wrap"><table><thead><tr><th>Документ</th><th>Дата</th><th>Склад</th><th>Основание</th><th class="n">Строк</th><th class="n">Кол-во</th>${App.can("cost")?'<th class="n">Сумма</th>':""}<th>Статус</th></tr></thead><tbody>
    ${list.map(d=>{const D=App.DOCT[d.type];const qty=(d.lines||[]).reduce((a,l)=>a+num(d.type==="inventory"?(num(l.counted)-num(l.expected)):l.qty),0);
      const sum=(d.lines||[]).reduce((a,l)=>a+num(l.cost)*num(d.type==="inventory"?(num(l.counted)-num(l.expected)):l.qty),0);
      return `<tr class="rowlink" data-act="openDoc" data-id="${esc(d.id)}"><td><span class="pill ${D.cls}">${D.one}</span> <b>${esc(d.num)}</b></td><td>${App.dtt(d.createdAt)}<span class="sub">${esc(App.nameOf(d.by))}</span></td>
      <td>${d.type==="transfer"?esc(App.whName(d.whFrom))+" → "+esc(App.whName(d.whTo)):esc(App.whName(d.whTo||d.whFrom))}</td><td>${esc((App.byId("suppliers",d.supplierId)||{}).name||d.reason||d.note||"")}</td>
      <td class="n">${(d.lines||[]).length}</td><td class="n">${d.type==="inventory"?(qty>0?"+":"")+qty:qty}</td>${App.can("cost")?`<td class="n">${money(sum)}</td>`:""}<td>${statusDoc(d)}</td></tr>`}).join("")||'<tr><td colspan="8" class="empty">Документов нет. Начните с прихода товара</td></tr>'}
    </tbody></table></div></section>
    <section class="card"><div class="card-h"><h2>Последние движения</h2></div><div class="tbl-wrap"><table><thead><tr><th>Когда</th><th>Товар</th><th>Операция</th><th>Склад</th><th class="n">Кол-во</th><th>Основание</th><th>Кто</th></tr></thead><tbody>
    ${moves.map(m=>`<tr><td>${App.dtt(m.at)}</td><td>${esc(m.productName)}</td><td>${esc(App.MOVE[m.type]||m.type)}</td><td>${esc(App.whName(m.whId))}</td><td class="n"><span class="pill ${num(m.qty)>0?"ok":"mute"}">${num(m.qty)>0?"+":""}${num(m.qty)}</span></td><td>${esc(m.ref)}${m.note?'<span class="sub">'+esc(m.note)+"</span>":""}</td><td>${esc(App.nameOf(m.by))}</td></tr>`).join("")||'<tr><td colspan="7" class="empty">Движений нет</td></tr>'}
    </tbody></table></div></section>`;
  }
};
const statusDoc=d=>d.status==="posted"?'<span class="pill ok">проведён</span>':d.status==="cancelled"?'<span class="pill bad">отменён</span>':'<span class="pill mute">черновик</span>';
ACT.docType=k=>{App.ui.docType=k;App.render()};

/* ---------- редактор документа ---------- */
let D=null; // текущий черновик в окне
App.docSet=fn=>{if(D){fn(D);docEditor()}};
ACT.newDoc=(type,prefill)=>{
  if(!App.can("stock"))return App.toast("Нет права работать со складом");
  const wh=App.cashWh(),whs=App.whs();
  if(!wh)return App.toast("Сначала создайте склад в «Настройки → Точки и склады»");
  D={id:null,type,num:"(новый)",status:"draft",whFrom:type==="transfer"?((whs.find(w=>w.id!==wh)||{}).id||wh):wh,whTo:type==="transfer"?wh:wh,
    supplierId:"",reason:type==="writeoff"?App.WRITEOFF_REASONS[0]:"",note:"",lines:[],catId:""};
  if(type==="inventory")D.whTo=wh;
  if(prefill&&prefill.productId)D.lines.push(prefill);
  docEditor();
};
ACT.quickDoc=arg=>{const [type,pid]=arg.split("|"),p=App.byId("products",pid);App.closeModal();
  ACT.newDoc(type,{productId:pid,name:p.name,qty:p.trackSerial?0:1,cost:num(p.cost),newUnits:[],unitIds:[],foundCodes:[]});
  if(type!=="in"){const w=App.whs().find(w=>App.qtyIn(p,w.id)>0);if(w){D.whFrom=w.id;D.whTo=type==="transfer"?(App.whs().find(x=>x.id!==w.id)||w).id:w.id}docEditor()}};
ACT.openDoc=id=>{const d=App.byId("docs",id);if(!d)return;D=App.clean(d);docEditor()};
function docWh(){return D.type==="transfer"||D.type==="writeoff"||D.type==="supret"?D.whFrom:D.whTo}
function docEditor(){
  const T=App.DOCT[D.type],ro=D.status!=="draft",cost=App.can("cost"),inv=D.type==="inventory";
  const whSel=(id,label,v)=>App.fld(id,label,App.sel(id,App.whOpts(),v,(ro?"disabled ":"")+'data-d="'+(id==="dFrom"?"whFrom":"whTo")+'"'));
  let headF="";
  if(D.type==="in")headF=whSel("dTo","На склад",D.whTo)+App.fld("dSup","Поставщик",App.sel("dSup",[["","—"],...S.suppliers.map(s=>[s.id,s.name])],D.supplierId,(ro?"disabled ":"")+'data-d="supplierId"'))+App.fld("dInvNo","Накладная поставщика",App.inp("dInvNo",D.invoice||"","text","№ и дата",(ro?"disabled ":"")+'data-d="invoice"'));
  if(D.type==="transfer")headF=whSel("dFrom","Откуда",D.whFrom)+whSel("dTo","Куда",D.whTo);
  if(D.type==="writeoff")headF=whSel("dFrom","Со склада",D.whFrom)+App.fld("dReason","Причина",App.sel("dReason",App.WRITEOFF_REASONS,D.reason,(ro?"disabled ":"")+'data-d="reason"'));
  if(D.type==="supret")headF=whSel("dFrom","Со склада",D.whFrom)+App.fld("dSup","Поставщик",App.sel("dSup",[["","—"],...S.suppliers.map(s=>[s.id,s.name])],D.supplierId,(ro?"disabled ":"")+'data-d="supplierId"'));
  if(inv)headF=whSel("dTo","Склад",D.whTo)+App.fld("dCat","Категория (необязательно)",App.sel("dCat",[["","Все товары"],...App.catOpts(false)],D.catId||"",(ro?"disabled ":"")+'data-d="catId"'));
  const wh=docWh();
  let sumQ=0,sumC=0,plusC=0,minusC=0;
  const rows=D.lines.map((l,k)=>{const p=App.byId("products",l.productId);const have=p?App.qtyIn(p,wh):0;
    if(p&&p.trackSerial){const R=serialRow(l,k,p,{ro,cost,inv,wh});sumQ+=R.q;sumC+=R.c;if(R.c>0)plusC+=R.c;else minusC+=R.c;return R.html}
    if(inv){const diff=num(l.counted)-num(l.expected);sumQ+=diff;const c=diff*num(l.cost);if(c>0)plusC+=c;else minusC+=c;
      return `<tr class="${l.counted===""||l.counted==null?"":diff?"diffrow":""}"><td>${esc(l.name)}${p&&p.serial?'<span class="sub">'+App.codeLbl(p)+" "+esc(p.serial)+"</span>":""}</td><td class="n">${num(l.expected)}</td>
      <td class="n"><input type="number" min="0" id="lc${k}" data-line="${k}" data-lf="counted" value="${l.counted==null?"":esc(l.counted)}" placeholder="?" ${ro?"disabled":""} aria-label="Фактически"></td>
      <td class="n">${l.counted===""||l.counted==null?'<span class="muted">не посчитан</span>':diff?`<span class="pill ${diff>0?"ok":"bad"}">${diff>0?"+":""}${diff}</span>`:'<span class="pill">0</span>'}</td>${cost?`<td class="n">${money(diff*num(l.cost))}</td>`:""}</tr>`}
    sumQ+=num(l.qty);sumC+=num(l.qty)*num(l.cost);
    const short=!ro&&D.type!=="in"&&num(l.qty)>have;
    return `<tr><td>${esc(l.name)}${short?`<span class="sub bad">на складе только ${have}</span>`:""}</td>${D.type!=="in"?`<td class="n">${have}</td>`:""}
      <td class="n"><input type="number" min="1" id="lq${k}" data-line="${k}" data-lf="qty" value="${num(l.qty)}" ${ro?"disabled":""} aria-label="Количество"></td>
      ${cost?`<td class="n">${D.type==="in"?`<input type="number" min="0" id="lk${k}" data-line="${k}" data-lf="cost" value="${num(l.cost)}" ${ro?"disabled":""} aria-label="Закупка">`:money(l.cost)}</td><td class="n">${money(num(l.qty)*num(l.cost))}</td>`:""}
      <td class="n">${ro?"":`<button class="btn sm ghost danger" data-act="docDelLine" data-id="${k}" aria-label="Убрать">${App.ico("x","sm")}</button>`}</td></tr>`}).join("");
  const thead=inv?`<th>Товар</th><th class="n">По учёту</th><th class="n">Факт</th><th class="n">Разница</th>${cost?'<th class="n">Сумма</th>':""}`
    :`<th>Товар</th>${D.type!=="in"?'<th class="n">Есть</th>':""}<th class="n">Кол-во</th>${cost?`<th class="n">${D.type==="in"?"Закупка":"Себест."}</th><th class="n">Сумма</th>`:""}<th></th>`;
  const html=App.head(T.one+" "+esc(D.num),statusDoc(D))+`
    <div class="form">${headF}${App.fld("dNote","Комментарий",App.inp("dNote",D.note||"","text","",(ro?"disabled ":"")+'data-d="note"'),"full")}</div>
    ${!ro?`<div class="row-f">${inv?`<button class="btn" data-act="invFill">Заполнить по учёту</button><button class="btn" data-act="invZero">Непосчитанные = 0</button>`:""}<div class="fld grow"><label for="dQ">${inv?"Скан или поиск: +1 к факту":"Добавить товар (поиск или сканер)"}</label><input id="dQ" type="search" autocomplete="off" data-live="1" placeholder="Название, артикул, штрихкод, IMEI"><div class="pick" id="dPick" hidden></div></div></div>`:""}
    <div class="tbl-wrap"><table class="cart"><thead><tr>${thead}</tr></thead><tbody>${rows||`<tr><td colspan="6" class="empty">${inv?"Нажмите «Заполнить по учёту» или сканируйте товары":"Добавьте строки"}</td></tr>`}</tbody></table></div>
    <div class="sumlines">${inv?`<span>Строк</span><span>${D.lines.length}</span><span>Излишки</span><span>${cost?money(plusC):""}</span><span>Недостача</span><span>${cost?money(minusC):""}</span><span>Итог в шт.</span><span>${sumQ>0?"+":""}${sumQ}</span>`:`<span>Всего, шт.</span><span>${sumQ}</span>${cost?`<span>Сумма</span><span>${money(sumC)}</span>`:""}`}</div>
    ${D.postedAt?`<p class="muted">Проведён ${App.dtt(D.postedAt)}${D.cancelledAt?" · отменён "+App.dtt(D.cancelledAt):""}</p>`:""}
    <div class="acts">
      ${D.id?`<button class="btn" data-act="printStockDoc" data-id="${esc(D.id)}">Печать</button>`:""}
      ${D.id&&D.status==="draft"?`<button class="btn danger" data-act="docDelete">Удалить черновик</button>`:""}
      ${D.status==="posted"&&App.can("docCancel")?`<button class="btn danger" data-act="docCancel">Отменить проведение</button>`:""}
      ${!ro?`<button class="btn" data-act="docSave">Сохранить черновик</button>${App.can("docPost")?`<button class="btn pri" data-act="docPost">Провести</button>`:""}`:""}
    </div>`;
  if($("#scrim").hidden){App.openModal(html,{wide:true})}
  else{const m=$("#modal"),f=document.activeElement&&document.activeElement.id,sc=m.parentElement.scrollTop;m.className="modal wide";m.innerHTML=html;App.modalRefresh=null;
    if(f){const el=document.getElementById(f);if(el)el.focus()}m.parentElement.scrollTop=sc}
  bindDoc();
}
function bindDoc(){
  document.querySelectorAll("#modal [data-d]").forEach(el=>el.addEventListener("change",()=>{D[el.dataset.d]=el.value;if(["whFrom","whTo","catId"].includes(el.dataset.d)){if(D.type==="inventory"&&D.lines.length&&el.dataset.d!=="catId"){D.lines=[];App.toast("Склад изменён: строки очищены")}docEditor()}}));
  document.querySelectorAll("#modal [data-d]").forEach(el=>{if(el.tagName==="INPUT")el.addEventListener("input",()=>D[el.dataset.d]=el.value)});
  document.querySelectorAll("#modal [data-line]").forEach(el=>el.addEventListener("change",()=>{const l=D.lines[+el.dataset.line];l[el.dataset.lf]=el.dataset.lf==="counted"&&el.value===""?"":num(el.value);docEditor()}));
  document.querySelectorAll("#modal [data-uscan]").forEach(el=>el.addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();const v=el.value;el.value="";
    if(lineScan(+el.dataset.uscan,v)){docEditor();setTimeout(()=>{const x=document.querySelector(`#modal [data-uscan="${el.dataset.uscan}"]`);if(x)x.focus()},0)}}));
  document.querySelectorAll("#modal [data-unf]").forEach(el=>el.addEventListener("change",()=>{const [k,j,f]=el.dataset.unf.split("|");const u=D.lines[+k].newUnits[+j];if(u)u[f]=el.value}));
  document.querySelectorAll("#modal [data-upick]").forEach(el=>el.addEventListener("change",()=>{const [k,id]=el.dataset.upick.split("|");const l=D.lines[+k];
    l.unitIds=el.checked?[...new Set([...(l.unitIds||[]),id])]:(l.unitIds||[]).filter(x=>x!==id);docEditor()}));
  if(D.status==="draft")App.productPicker("dQ","dPick",{wh:docWh,inStock:false,showCost:App.can("cost"),onPick:(p,u)=>{
    if(p.trackSerial){pickSerial(p,u);return}
    const ex=D.lines.find(l=>l.productId===p.id);
    if(D.type==="inventory"){if(ex)ex.counted=num(ex.counted)+1;else D.lines.push({productId:p.id,name:p.name,expected:App.qtyIn(p,D.whTo),counted:1,cost:num(p.cost)})}
    else if(ex)ex.qty=num(ex.qty)+1;else D.lines.push({productId:p.id,name:p.name,qty:1,cost:num(p.cost)});
    docEditor();setTimeout(()=>{const q=document.getElementById("dQ");if(q)q.focus()},0)}});
}
ACT.docDelLine=k=>{D.lines.splice(+k,1);docEditor()};
ACT.docUnitDel=v=>{const [k,j]=v.split("|").map(Number),l=D.lines[k];if(!l)return;if(D.type==="in")l.newUnits.splice(j,1);else if(D.type==="inventory")l.foundCodes.splice(j,1);docEditor()};

/* ---------- строки с серийным учётом ---------- */
function serialRow(l,k,p,{ro,cost,inv,wh}){
  l.newUnits=l.newUnits||[];l.unitIds=l.unitIds||[];l.foundCodes=l.foundCodes||[];
  const scan=ro?"":`<input class="uscan" data-uscan="${k}" placeholder="Сканируйте ${App.codeName(p)} и нажмите Enter" autocomplete="off" aria-label="${App.codeName(p)}">`;
  const tag='<span class="pill info">'+App.codeLbl(p)+'</span> ';
  if(inv){
    const inWh=App.unitsOf(p.id,{wh:D.whTo}),found=l.foundCodes,exp=ro?num(l.expected):inWh.length,cnt=found.length,diff=cnt-exp,c=diff*num(l.cost);
    const missing=ro?[]:inWh.filter(u=>!found.some(x=>[u.imei,u.imei2,u.serialNo].some(y=>y&&y.toLowerCase()===String(x).toLowerCase())));
    return {q:diff,c,html:`<tr class="${diff?"diffrow":""}"><td>${tag}${esc(l.name)}</td><td class="n">${exp}</td><td class="n"><b>${cnt}</b></td>
      <td class="n">${diff?`<span class="pill ${diff>0?"ok":"bad"}">${diff>0?"+":""}${diff}</span>`:'<span class="pill">0</span>'}</td>${cost?`<td class="n">${money(c)}</td>`:""}</tr>
      <tr class="subrow"><td colspan="${cost?5:4}">${scan}<div class="chips">${found.map((x,j)=>`<span class="pill ok">${esc(x)}${ro?"":` <button class="x" data-act="docUnitDel" data-id="${k}|${j}" aria-label="Убрать">${App.ico("x","sm")}</button>`}</span>`).join("")}</div>
      ${missing.length?`<div class="sub bad" style="margin-top:4px">Не найдены (будут списаны как недостача): ${missing.map(u=>esc(App.unitCode(u))).join(", ")}</div>`:""}</td></tr>`};
  }
  if(D.type==="in"){
    const n=l.newUnits.length,c=n*num(l.cost);
    return {q:n,c,html:`<tr><td>${tag}${esc(l.name)}</td><td class="n"><b>${n}</b></td>
      ${cost?`<td class="n"><input type="number" min="0" id="lk${k}" data-line="${k}" data-lf="cost" value="${num(l.cost)}" ${ro?"disabled":""} aria-label="Закупка"></td><td class="n">${money(c)}</td>`:""}
      <td class="n">${ro?"":`<button class="btn sm ghost danger" data-act="docDelLine" data-id="${k}" aria-label="Убрать">${App.ico("x","sm")}</button>`}</td></tr>
      <tr class="subrow"><td colspan="${cost?5:3}">${scan}
      ${n?`<table class="units"><thead><tr><th>${App.codeLbl(p)}</th><th>Состояние</th><th>АКБ, %</th>${App.can("price")?"<th>Цена экз., ₽</th>":""}<th></th></tr></thead><tbody>
      ${l.newUnits.map((u,j)=>`<tr><td><b>${esc(u.imei||u.serial_no)}</b>${u.warn?`<span class="sub warn">${esc(u.warn)}</span>`:""}</td>
        <td>${ro?esc(u.condition||""):`<select data-unf="${k}|${j}|condition" aria-label="Состояние">${App.CONDS.map(x=>`<option${(u.condition||p.condition)===x?" selected":""}>${x}</option>`).join("")}</select>`}</td>
        <td><input type="number" min="0" max="100" value="${esc(u.battery_health||"")}" data-unf="${k}|${j}|battery_health" ${ro?"disabled":""} aria-label="АКБ" style="width:70px"></td>
        ${App.can("price")?`<td><input type="number" min="0" value="${esc(u.price||"")}" data-unf="${k}|${j}|price" ${ro?"disabled":""} placeholder="${num(p.price)}" aria-label="Цена экземпляра" style="width:100px"></td>`:""}
        <td class="n">${ro?"":`<button class="btn sm ghost" data-act="docUnitDel" data-id="${k}|${j}" aria-label="Убрать">${App.ico("x","sm")}</button>`}</td></tr>`).join("")}</tbody></table>`:'<div class="muted">Отсканируйте каждый экземпляр — количество посчитается само</div>'}</td></tr>`};
  }
  // перемещение, списание, возврат поставщику
  const avail=ro?[]:App.unitsOf(p.id,{wh:D.whFrom}),sel=l.unitIds,n=sel.length,c=n*num(l.cost);
  const shown=ro?sel.map(id=>App.byId("units",id)).filter(Boolean):avail.concat(sel.map(id=>App.byId("units",id)).filter(u=>u&&!avail.includes(u)));
  return {q:n,c,html:`<tr><td>${tag}${esc(l.name)}</td><td class="n">${ro?"":avail.length}</td><td class="n"><b>${n}</b></td>
    ${cost?`<td class="n">${money(l.cost)}</td><td class="n">${money(c)}</td>`:""}<td class="n">${ro?"":`<button class="btn sm ghost danger" data-act="docDelLine" data-id="${k}" aria-label="Убрать">${App.ico("x","sm")}</button>`}</td></tr>
    <tr class="subrow"><td colspan="${cost?6:4}">${scan}<div class="chips">${shown.map(u=>{const bad=!ro&&!avail.includes(u);
      return `<label class="chk ${bad?"bad":""}"><input type="checkbox" data-upick="${k}|${esc(u.id)}" ${sel.includes(u.id)?"checked":""} ${ro?"disabled":""}> ${esc(App.unitLabel(u))}${bad?" — нет на складе":""}</label>`}).join("")||'<span class="muted">Нет экземпляров на складе «'+esc(App.whName(D.whFrom))+'»</span>'}</div></td></tr>`};
}
function lineScan(k,raw){
  const l=D.lines[k],p=l&&App.byId("products",l.productId);if(!p)return false;
  const pc=App.parseCode(raw,App.isPhone(p));if(!pc)return false;const code=pc.imei||pc.serial_no;
  const u=App.findUnit(code);
  if(D.type==="in"){
    if(D.lines.some(x=>(x.newUnits||[]).some(n=>(n.imei||n.serial_no)===code))){App.toast("Этот код уже есть в документе");return false}
    if(u&&["in_stock","reserved","in_repair"].includes(u.status)){App.toast(App.codeLbl(p)+" "+code+" уже числится на складе: «"+(App.byId("products",u.productId)||{}).name+"»");return false}
    if(u)App.toast("Этот экземпляр уже был в базе ("+(App.UNIT_ST[u.status]||[u.status])[0].toLowerCase()+") — вернётся на склад");
    else if(pc.warn)App.toast(pc.warn);
    l.newUnits.push({imei:pc.imei||"",serial_no:pc.serial_no||"",condition:p.condition,battery_health:"",price:"",warn:pc.warn||""});return true;
  }
  if(D.type==="inventory"){
    if(l.foundCodes.some(x=>x.toLowerCase()===code.toLowerCase())){App.toast("Уже отсканирован");return false}
    if(!u){App.toast(App.codeLbl(p)+" "+code+" не числится в базе — оформите приход");return false}
    if(u.productId!==p.id){App.toast("Это «"+(App.byId("products",u.productId)||{}).name+"»");return false}
    if(u.status!=="in_stock"){App.toast("Числится как «"+(App.UNIT_ST[u.status]||[u.status])[0]+"»");return false}
    l.foundCodes.push(App.unitCode(u));return true;
  }
  if(!u){App.toast(App.codeLbl(p)+" "+code+" не найден");return false}
  if(u.productId!==p.id){App.toast("Это «"+(App.byId("products",u.productId)||{}).name+"»");return false}
  if(u.status!=="in_stock"||u.whId!==D.whFrom){App.toast("Этого экземпляра нет на складе «"+App.whName(D.whFrom)+"»");return false}
  if(!l.unitIds.includes(u.id))l.unitIds.push(u.id);return true;
}
function pickSerial(p,u){
  let k=D.lines.findIndex(l=>l.productId===p.id);
  if(k<0){D.lines.push({productId:p.id,name:p.name,qty:0,cost:num(p.cost),expected:D.type==="inventory"?App.unitsOf(p.id,{wh:D.whTo}).length:0,counted:"",newUnits:[],unitIds:[],foundCodes:[]});k=D.lines.length-1}
  if(u)lineScan(k,App.unitCode(u));
  docEditor();setTimeout(()=>{const x=document.querySelector(`#modal [data-uscan="${k}"]`);if(x&&!u)x.focus();else{const q=document.getElementById("dQ");if(q)q.focus()}},0);
}
ACT.invFill=()=>{
  const ex=new Set(D.lines.map(l=>l.productId));
  S.products.filter(p=>!p.archived&&App.inCat(p,D.catId)&&(App.qtyIn(p,D.whTo)!==0)&&!ex.has(p.id)).sort((a,b)=>String(a.name).localeCompare(b.name))
    .forEach(p=>D.lines.push({productId:p.id,name:p.name,expected:App.qtyIn(p,D.whTo),counted:"",cost:num(p.cost),foundCodes:[],newUnits:[],unitIds:[]}));
  D.lines.forEach(l=>{const p=App.byId("products",l.productId);if(p)l.expected=p.trackSerial?App.unitsOf(p.id,{wh:D.whTo}).length:App.qtyIn(p,D.whTo)});
  docEditor();
};
ACT.invZero=()=>{D.lines.forEach(l=>{const p=App.byId("products",l.productId);if(!(p&&p.trackSerial)&&(l.counted===""||l.counted==null))l.counted=0});docEditor()};
function docHead(){return{type:D.type,wh_from:D.whFrom||null,wh_to:D.whTo||null,supplier_id:D.supplierId||null,invoice:D.invoice||null,reason:D.reason||null,category_id:D.catId||null,note:D.note||null}}
function docLines(){return D.lines.map(l=>{const p=App.byId("products",l.productId),ser=!!(p&&p.trackSerial);
  const extra={new_units:ser&&D.type==="in"?(l.newUnits||[]).map(cleanUnit):[],unit_ids:ser?(l.unitIds||[]):[],found_codes:ser&&D.type==="inventory"?(l.foundCodes||[]):[]};
  if(D.type==="inventory")return Object.assign({product_id:l.productId,expected:num(l.expected),counted:ser?(l.foundCodes||[]).length:(l.counted===""||l.counted==null?null:num(l.counted)),cost:num(l.cost)},extra);
  return Object.assign({product_id:l.productId,qty:ser?(D.type==="in"?(l.newUnits||[]).length:(l.unitIds||[]).length):num(l.qty),cost:num(l.cost)},extra)})}
const cleanUnit=u=>{const o={};["imei","imei2","serial_no","condition","battery_health","price","kit","diagnostics"].forEach(k=>{if(u[k]!==""&&u[k]!=null)o[k]=String(u[k]).trim()});return o};
async function persistDraft(){
  if(!D.id){const d=await App.api.doc(docHead(),docLines(),false);D.id=d.id;D.num=d.num;return}
  await App.api.update("stock_docs",D.id,docHead());
  await App.api.remove("stock_doc_lines",D.id,"doc_id");
  await App.api.insertMany("stock_doc_lines",docLines().map(l=>Object.assign({doc_id:D.id},l)));
}
function docCheck(){
  if(!D.lines.length)return "Добавьте хотя бы одну строку";
  if(D.type==="transfer"&&D.whFrom===D.whTo)return "Склады отправления и назначения совпадают";
  for(const l of D.lines){const p=App.byId("products",l.productId);if(!p||!p.trackSerial)continue;
    if(D.type==="in"&&!(l.newUnits||[]).length)return "Отсканируйте "+App.codeName(p)+" для «"+p.name+"»";
    if(["transfer","writeoff","supret"].includes(D.type)&&!(l.unitIds||[]).length)return "Отметьте экземпляры ("+App.codeLbl(p)+") для «"+p.name+"»"}
  if(D.type!=="inventory"&&D.lines.some(l=>{const p=App.byId("products",l.productId);return !(p&&p.trackSerial)&&num(l.qty)<=0}))return "Количество должно быть больше нуля";
  return "";
}
ACT.docSave=async(_,btn)=>{
  const e=docCheck();if(e)return App.toast(e);if(btn.disabled)return;btn.disabled=true;
  try{await persistDraft();App.toast("Черновик "+D.num+" сохранён");App.closeModal()}catch(x){btn.disabled=false;App.toast(x.message)}
};
ACT.docPost=async(_,btn)=>{
  const e=docCheck();if(e)return App.toast(e);
  if(D.type==="inventory"&&D.lines.some(l=>{const p=App.byId("products",l.productId);return !(p&&p.trackSerial)&&(l.counted===""||l.counted==null)}))return App.toast("Не все строки посчитаны. Введите факт или нажмите «Непосчитанные = 0»");
  if(btn.disabled)return;btn.disabled=true;
  try{
    await persistDraft();
    await App.api.rpc("post_doc",{p_doc:D.id},["stock_docs","stock","stock_movements","products","audit_log","units"]);
    App.toast("Документ "+D.num+" проведён");App.closeModal();
  }catch(x){btn.disabled=false;App.toast(x.message+(D.id?". Документ сохранён как черновик":""))}
};
ACT.docCancel=async(_,el)=>{
  if(!App.confirm2(el,"Откатить все движения? Нажмите ещё раз"))return;
  try{await App.api.rpc("cancel_doc",{p_doc:D.id},["stock_docs","stock","stock_movements","products","audit_log","units"]);App.toast("Проведение отменено");App.closeModal()}
  catch(x){App.toast("Нельзя отменить: "+x.message+". Часть товара уже продана или перемещена")}
};
ACT.docDelete=async(_,el)=>{if(!App.confirm2(el,"Удалить черновик? Нажмите ещё раз"))return;try{await App.api.remove("stock_docs",D.id);App.closeModal();App.toast("Черновик удалён")}catch(x){App.toast(x.message)}};
})();
