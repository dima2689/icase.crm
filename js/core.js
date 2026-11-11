/* iCase CRM v3 · ядро: справочники, права, утилиты, расчёты (данные — в Supabase, см. db.js) */
"use strict";
const App = window.App = {ACT:{}, VIEWS:{}, TITLES:{}};

/* ---------- справочные значения ---------- */
App.RSTAT = [
  ["new","Принят","mute"],["diag","Диагностика","info"],["approve","Согласование","warn"],
  ["work","В работе",""],["parts","Ждёт запчасть","warn"],["ready","Готов к выдаче","ok"],
  ["done","Выдан","dark"],["cancel","Отказ","bad"]
];
App.RS = Object.fromEntries(App.RSTAT.map(s=>[s[0],{label:s[1],cls:s[2]}]));
App.ACTIVE = ["new","diag","approve","work","parts","ready"];
App.PAY = {cash:"Наличные", card:"Карта", sbp:"QR (СБП)", transfer:"Перевод"};
App.PAYALL = Object.assign({}, App.PAY, {debt:"В долг", prepaid:"Предоплата"});
App.CONDS = ["Новый","Б/у отличное","Б/у хорошее","Б/у среднее","Восстановленный","На запчасти"];
App.SOURCES = ["Магазин","Сайт","Авито","Рекомендация","Соцсети","Другое"];
App.DOCT = {
  in:{label:"Приход", one:"Приход", cls:"ok"},
  transfer:{label:"Перемещения", one:"Перемещение", cls:"info"},
  writeoff:{label:"Списания", one:"Списание", cls:"bad"},
  inventory:{label:"Инвентаризации", one:"Инвентаризация", cls:"warn"},
  supret:{label:"Возвраты поставщику", one:"Возврат поставщику", cls:"mute"}
};
App.MOVE = {in:"Приход", sale:"Продажа", return:"Возврат от клиента", repair:"В ремонт", repair_back:"Возврат из ремонта",
  writeoff:"Списание", transfer_out:"Перемещение (расход)", transfer_in:"Перемещение (приход)", inventory:"Инвентаризация",
  tradein:"Trade-in", supret:"Возврат поставщику", cancel:"Отмена документа", import:"Импорт"};
App.WRITEOFF_REASONS = ["Брак","Повреждён","Недостача","Для себя / демо","Истёк срок / устарел","Другое"];
App.RETURN_REASONS = ["Не подошёл","Брак","Передумал","Ошибка продавца","Гарантийный случай","Другое"];
App.CASHOP = {sale:"Продажа", refund:"Возврат", repair:"Оплата ремонта", prepay:"Предоплата ремонта", cashin:"Внесение", cashout:"Изъятие"};
App.ROLES = {owner:"Владелец", manager:"Управляющий", seller:"Продавец", master:"Мастер", storekeeper:"Кладовщик"};
const PERMS = {
  sale:["owner","manager","seller"], ret:["owner","manager","seller"], shift:["owner","manager","seller"],
  cashout:["owner","manager"], belowCost:["owner","manager"],
  repair:["owner","manager","seller","master"], repairWork:["owner","manager","master"],
  stock:["owner","manager","storekeeper"], docPost:["owner","manager","storekeeper"], docCancel:["owner","manager"],
  price:["owner","manager","storekeeper"], cost:["owner","manager","storekeeper"],
  settings:["owner","manager"], staff:["owner"], del:["owner","manager"], reports:["owner","manager"],
  io:["owner","manager"], clients:["owner","manager","seller","master"], log:["owner","manager"], allPoints:["owner","manager"], finance:["owner","manager"]
};
App.can = a => a==="receive"?(PERMS.stock.includes(App.me.role)||(App.me.role==="seller"&&(App.settings().approvals||{}).sellerReceive!==false)):(PERMS[a]||[]).includes(App.me.role);

App.DEFAULTS = {shopName:"iCase", city:"", address:"", phone:"", inn:"", deviceWarrantyMonths:0,
  repairWarrantyDays:90, requireShift:true, storageDays:30, deadDays:60, receiptFooter:"Спасибо за покупку!",legalName:"",ogrnip:"",siteUrl:"",reviewUrl:"",
  receiptAck:"Устройство осмотрено, проверено, претензий к внешнему виду и комплектации не имею."};

/* ---------- состояние ---------- */
App.COLS = ["settings","points","warehouses","categories","suppliers","services","products","customers","sales","returns","docs","movements","shifts","cashops","staff","staffreq","log","repairs","units","models","siteorders","sprices","finaccounts","fincats","finops","debts","finplans","porders","payrules","unitcosts","waitlist","lostdemand","tasks","bonusops","deals","evotor","preorders","svcprices"];
const S = App.S = {}; App.COLS.forEach(c=>S[c]=[]);
App.ui = {view:"dashboard"};
App.me = {id:null, role:null, pointId:null, name:"", email:""};

/* ---------- утилиты ---------- */
const $ = App.$ = s=>document.querySelector(s);
const esc = App.esc = v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = App.num = v=>{if(typeof v==="number")return isFinite(v)?v:0;const n=Number(String(v==null?"":v).replace(/\s/g,"").replace(",","."));return isFinite(n)?n:0};
const _nf=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0});
const money = App.money = n=>_nf.format(Math.round(num(n))||0)+" ₽";
App.uid = p=>p+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
App.nowISO = ()=>new Date().toISOString();
/* даты: форматтеры создаются один раз, разбор ISO-строк кэшируется */
const _df=new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"2-digit"}),_dtf=new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const _tsC=new Map();
App.ts = v=>{if(v==null||v==="")return NaN;if(typeof v==="number")return v;if(v instanceof Date)return +v;let t=_tsC.get(v);if(t===undefined){t=Date.parse(v);if(_tsC.size>200000)_tsC.clear();_tsC.set(v,t)}return t};
const _fmt=(f,iso)=>{if(!iso)return "—";const t=App.ts(iso);return isNaN(t)?"—":f.format(t)};
App.dt = iso=>_fmt(_df,iso);
App.dtt = iso=>_fmt(_dtf,iso).replace(", ",",\u00a0");
/* склонение: plural(5,"чек","чека","чеков") */
App.plural=(n,a,b,c)=>{n=Math.abs(Math.trunc(n))%100;const k=n%10;return n>10&&n<20?c:k===1?a:k>=2&&k<=4?b:c};
App.nw=(n,a,b,c)=>n+" "+App.plural(n,a,b,c);
App.phoneKey = p=>String(p||"").replace(/\D/g,"").slice(-10);
App.fmtPhone = p=>{const k=App.phoneKey(p);return k.length===10?"+7 "+k.slice(0,3)+" "+k.slice(3,6)+"-"+k.slice(6,8)+"-"+k.slice(8):(p||"")};
/* индексы по id: строятся лениво и сбрасываются, когда коллекция заменена или изменилась её длина */
const _ix=new WeakMap();
App.idx = (arr,key="id")=>{let e=_ix.get(arr);if(!e)_ix.set(arr,e={});let m=e[key];
  if(!m||m.n!==arr.length){m=e[key]={n:arr.length,map:new Map()};const f=typeof key==="function"?key:x=>x[key];for(const x of arr){const k=f(x);if(k!=null&&k!==""&&!m.map.has(k))m.map.set(k,x)}}return m.map};
/* группировка по ключу: живёт в пределах одной синхронной задачи (отрисовки, обработчика), потом сбрасывается */
let _gen=0,_genQ=false;const _gx=new WeakMap();
App.grp = (arr,key)=>{if(!_genQ){_genQ=true;queueMicrotask(()=>{_gen++;_genQ=false})}
  let e=_gx.get(arr);if(!e||e.g!==_gen||e.n!==arr.length)_gx.set(arr,e={g:_gen,n:arr.length,m:{}});let m=e.m[key];
  if(!m){m=e.m[key]=new Map();for(const x of arr){const k=x[key];if(k==null||k==="")continue;let l=m.get(k);if(!l)m.set(k,l=[]);l.push(x)}}return m};
App.grpOf = (arr,key,val)=>App.grp(arr,key).get(val)||[];
App.byId = (col,id)=>{if(!id)return undefined;const a=S[col];if(!a)return undefined;const x=App.idx(a).get(id);return x&&x.id===id?x:a.find(y=>y.id===id)};
const _coll=new Intl.Collator("ru",{numeric:true});App.coll=(a,b)=>_coll.compare(String(a==null?"":a),String(b==null?"":b));
App.sortDesc = (arr,f="createdAt")=>arr.slice().sort((a,b)=>String(b[f]||"").localeCompare(String(a[f]||"")));
App.val = id=>{const el=document.getElementById(id);return el?String(el.value).trim():""};
App.checked = id=>{const el=document.getElementById(id);return !!(el&&el.checked)};
App.clean = o=>JSON.parse(JSON.stringify(o));
App.days = (a,b=new Date())=>Math.floor((new Date(b)-new Date(a))/864e5);
App.sameDay = (a,b)=>{a=new Date(a);b=new Date(b);return a.toDateString()===b.toDateString()};
App.ensureLocal = (col,obj)=>{if(!App.byId(col,obj.id))S[col].push(Object.assign({},obj))};

App.settings = ()=>Object.assign({},App.DEFAULTS,S.settings[0]||{});
App.nameOf = id=>{if(!id)return "Не указан";const s=App.byId("staff",id);return s?s.fullName:(id===App.me.id?App.me.name||"Вы":"Сотрудник")};

/* ---------- точки и склады ---------- */
App.points = (all=false)=>S.points.filter(p=>all||p.active!==false).sort((a,b)=>num(a.order)-num(b.order)||String(a.name).localeCompare(b.name));
App.myPoints = ()=>App.can("allPoints")?App.points():App.points().filter(p=>p.id===App.me.pointId);
App.point = ()=>{
  const list=App.myPoints();let id=App.ui.pointId;
  if(!list.some(p=>p.id===id)){id=(list.find(p=>p.id===App.me.pointId)||list[0]||{}).id||null;App.ui.pointId=id}
  return App.byId("points",id)||null;
};
App.whs = (all=false)=>S.warehouses.filter(w=>all||w.active!==false).sort((a,b)=>num(a.order)-num(b.order)||String(a.name).localeCompare(b.name));
App.whName = id=>{const w=App.byId("warehouses",id);return w?w.name:"—"};
App.pointName = id=>{const p=App.byId("points",id);return p?p.name:"—"};
App.cashWh = ()=>{const p=App.point();if(p&&p.cashWh&&App.byId("warehouses",p.cashWh))return p.cashWh;
  const w=p&&App.whs().find(w=>w.pointId===p.id);return w?w.id:(App.whs()[0]||{}).id};
App.serviceWh = ()=>{const p=App.point();return (p&&p.serviceWh&&App.byId("warehouses",p.serviceWh))?p.serviceWh:App.cashWh()};
App.cat = id=>App.byId("categories",id);
App.catName = p=>{const c=App.cat(p&&p.categoryId);if(!c)return "Без категории";const par=App.cat(c.parentId);return par?par.name+" / "+c.name:c.name};
App.isDevice = p=>{const c=App.cat(p.categoryId);if(!c)return false;if(c.isDevice)return true;const par=App.cat(c.parentId);return !!(par&&par.isDevice)};
App.catChildren = id=>S.categories.filter(c=>(c.parentId||"")===(id||"")).sort((a,b)=>String(a.name).localeCompare(b.name));
App.inCat = (p,catId)=>{if(!catId)return true;if(p.categoryId===catId)return true;const c=App.cat(p.categoryId);return !!(c&&c.parentId===catId)};

/* ---------- остатки ---------- */
App.qtyIn = (p,wh)=>p&&p.stock?num(p.stock[wh]):0;
App.qtyTotal = p=>p&&p.stock?Object.values(p.stock).reduce((a,v)=>a+num(v),0):0;
App.isLow = p=>!p.archived&&num(p.minQty)>0&&App.qtyTotal(p)<=num(p.minQty);
App.whereElse = (p,except)=>App.whs().filter(w=>w.id!==except&&App.qtyIn(p,w.id)>0).map(w=>w.name+": "+App.qtyIn(p,w.id)).join(", ");
App.findByCode = code=>{const c=String(code||"").trim().toLowerCase();if(!c)return null;
  const u=App.findUnit?App.findUnit(c):null;if(u){const p=App.byId("products",u.productId);if(p)return p}
  return S.products.find(p=>!p.archived&&[p.barcode,p.sku,p.serial].some(x=>x&&String(x).toLowerCase()===c))||null};
App.searchProducts = (q,{wh=null,inStock=false,limit=10}={})=>{
  const s=String(q||"").trim().toLowerCase();if(!s)return [];
  const words=s.split(/\s+/);
  return S.products.filter(p=>!p.archived&&(!inStock||(wh?App.qtyIn(p,wh):App.qtyTotal(p))>0)&&
    words.every(w=>[p.name,p.sku,p.barcode,p.serial,p.brand,App.catName(p),App.unitCodes?App.unitCodes(p.id):""].join(" ").toLowerCase().includes(w))).slice(0,limit);
};

/* ---------- клиенты ---------- */
App.findCustomerByPhone = phone=>{const k=App.phoneKey(phone);return k.length===10?S.customers.find(x=>App.phoneKey(x.phone)===k&&!x.mergedInto):null};
App.cust = id=>App.byId("customers",id);

/* ---------- касса ---------- */
App.openShift = (pointId)=>{const pid=pointId||(App.point()||{}).id;return S.shifts.find(s=>s.status==="open"&&s.pointId===pid)||null};
App.shiftTotals = function(sh){
  const ops=S.cashops.filter(o=>o.shiftId===sh.id);
  const t={ops,byMethod:{},byPay:{},sales:0,refunds:0,repairs:0,cashin:0,cashout:0,payouts:0,count:0};
  Object.keys(App.PAY).forEach(m=>{t.byMethod[m]=0;t.byPay[m]=0});
  ops.forEach(o=>{const a=num(o.amount);t.byMethod[o.method]=(t.byMethod[o.method]||0)+a;
    if(["sale","refund","repair","prepay"].includes(o.type))t.byPay[o.method]=(t.byPay[o.method]||0)+a;
    if((o.type==="cashin"||o.type==="cashout")&&o.method&&o.method!=="cash"){t.payouts+=-a;return}
    if(o.type==="sale"){t.sales+=a;t.count++}else if(o.type==="refund")t.refunds+=-a;else if(o.type==="prepay"&&/^ПЗ-/.test(o.ref))t.preorders=(t.preorders||0)+a;else if(o.type==="repair"||o.type==="prepay")t.repairs+=a;
    else if(o.type==="cashin")t.cashin+=a;else if(o.type==="cashout")t.cashout+=-a});
  t.expectedCash=num(sh.openCash)+num(t.byMethod.cash);
  return t;
};

/* ---------- деньги ---------- */
App.saleCost = s=>(s.items||[]).reduce((a,i)=>a+num(i.cost)*num(i.qty),0);
App.saleProfit = s=>num(s.total)+num(s.tradeIn&&s.tradeIn.amount)-App.saleCost(s);
App.returnedQty = (saleId,productId,line)=>App.grpOf(S.returns,"saleId",saleId).reduce((a,r)=>a+(r.items||[]).filter(i=>i.line===line).reduce((b,i)=>b+num(i.qty),0),0);
App.repairPartsCost = r=>(r.parts||[]).filter(p=>!p.returned).reduce((a,p)=>a+num(p.cost)*num(p.qty),0);
App.repairPartsSum = r=>(r.parts||[]).filter(p=>!p.returned).reduce((a,p)=>a+num(p.price)*num(p.qty),0);
App.repairWorksSum = r=>(r.services||[]).reduce((a,s)=>a+num(s.price)*num(s.qty||1),0);
App.repairTotal = r=>r.status==="done"||r.status==="cancel"?num(r.finalPrice):(App.repairWorksSum(r)+App.repairPartsSum(r))||num(r.approvedSum)||num(r.estimate);
App.repairPaid = r=>S.cashops.filter(o=>o.ref===r.num&&(o.type==="prepay"||o.type==="repair"||o.type==="refund")).reduce((a,o)=>a+num(o.amount),0);
App.isLate = r=>App.ACTIVE.includes(r.status)&&r.status!=="ready"&&r.dueDate&&new Date(r.dueDate)<new Date(new Date().toDateString());
App.isStored = r=>r.status==="ready"&&r.readyAt&&App.days(r.readyAt)>App.settings().storageDays;

/* выручка за период; pointId — только по точке */
App.periodStats = function(from,to,pointId){
  const f0=+from,t0=+to,inP=d=>{const t=App.ts(d);return t>=f0&&t<t0};
  const inPt=x=>!pointId||x.pointId===pointId;
  const sales=S.sales.filter(s=>inP(s.createdAt)&&inPt(s));
  const rets=S.returns.filter(r=>inP(r.createdAt)&&inPt(App.byId("sales",r.saleId)||{}));
  const reps=S.repairs.filter(r=>(r.status==="done"||r.status==="cancel")&&r.closedAt&&inP(r.closedAt)&&inPt(r));
  const saleRev=sales.reduce((a,s)=>a+num(s.total),0);
  const saleProfit=sales.reduce((a,s)=>a+App.saleProfit(s),0);
  const retSum=rets.reduce((a,r)=>a+num(r.amount),0);
  const retProfit=rets.reduce((a,r)=>a+num(r.amount)-(r.items||[]).reduce((b,i)=>b+num(i.cost)*num(i.qty),0),0);
  const repRev=reps.reduce((a,r)=>a+num(r.finalPrice),0);
  const repProfit=reps.reduce((a,r)=>a+num(r.finalPrice)-App.repairPartsCost(r),0);
  return{sales,rets,reps,saleRev,retSum,repRev,rev:saleRev-retSum+repRev,profit:saleProfit-retProfit+repProfit,
    avg:sales.length?saleRev/sales.length:0,count:sales.length};
};

/* ---------- CSV ---------- */
App.toCSV = rows=>"﻿"+rows.map(r=>r.map(v=>{const s=String(v==null?"":v);return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(";")).join("\r\n");
App.parseCSV = function(text){
  text=String(text).replace(/^﻿/,"");
  const first=text.split(/\r?\n/)[0]||"";
  const tabs=(first.match(/\t/g)||[]).length,semi=(first.match(/;/g)||[]).length,comma=(first.match(/,/g)||[]).length;
  const d=tabs&&tabs>=semi&&tabs>=comma?"\t":semi>=comma&&semi?";":comma?",":(tabs?"\t":";");
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;else if(ch===d){row.push(f);f=""}
    else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(f);f="";if(row.some(x=>x.trim()))rows.push(row);row=[]}
    else f+=ch}
  row.push(f);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
};
App.download = function(filename,text){
  const blob=new Blob([text],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);App.toast("Файл "+filename+" сохранён");
};
