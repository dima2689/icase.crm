/* iCase CRM v3 · Аналитика: продажи по товарам, категориям, клиентам, времени, сотрудникам и складу; прогноз выручки и спроса */
"use strict";
(function(){
const {S,$,esc,num,money,ACT,VIEWS,TITLES}=App;
TITLES.analytics="Аналитика";
const LS=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||"null");localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};
Object.assign(App.ui,{anTab:"over",anPer:"30",anPoint:"",anQ:"",anSort:"rev",anCat:"",anAbc:"",anSc:{chk:0,avg:0,mar:0},anCmp:false,anFrom:"",anTo:"",anPlan:LS("icase_plan")||0});
const DAY=864e5;
const d0=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
const dk=d=>{const x=new Date(d);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")};
const mk=d=>{const x=new Date(d);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")};
const MON=["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
const WD=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const wd=d=>(new Date(d).getDay()+6)%7;
const pct=(v,dig=0)=>(isFinite(v)?(v*100).toFixed(dig).replace(".",","):"—")+"%";
const sgn=v=>v>0?"+":v<0?"−":"";
const delta=(c,p)=>p?(c-p)/Math.abs(p):c?1:0;
const dTag=(c,p,inv)=>{if(!p)return "";const d=delta(c,p),good=inv?d<0:d>0;return `<span class="dlt ${Math.abs(d)<0.005?"":good?"up":"down"}">${sgn(d)}${pct(Math.abs(d))}</span>`};
const short=v=>{const a=Math.abs(v);return a>=1e6?(v/1e6).toFixed(1).replace(".",",")+" млн":a>=1e4?Math.round(v/1e3)+" тыс":Math.round(v).toLocaleString("ru-RU")};
const saleVal=s=>num(s.total)+num(s.tradeIn&&s.tradeIn.amount);
const plural=(n,a,b,c)=>{const x=n%10,y=n%100;return x===1&&y!==11?a:x>=2&&x<=4&&(y<12||y>14)?b:c};

/* ---------- период ---------- */
const PERS=[["7","7 дней"],["30","30 дней"],["90","90 дней"],["180","Полгода"],["365","Год"],["month","Этот месяц"],["prev","Прошлый месяц"],["all","Всё время"],["custom","Свой период"]];
function range(p){
  const t=d0(Date.now()),tom=new Date(+t+DAY);
  if(p==="month")return [new Date(t.getFullYear(),t.getMonth(),1),tom];
  if(p==="prev")return [new Date(t.getFullYear(),t.getMonth()-1,1),new Date(t.getFullYear(),t.getMonth(),1)];
  if(p==="custom"){const a=App.ui.anFrom?d0(App.ui.anFrom+"T12:00"):new Date(+tom-30*DAY),b=App.ui.anTo?new Date(+d0(App.ui.anTo+"T12:00")+DAY):tom;return a<b?[a,b]:[new Date(+b-DAY),b]}
  if(p==="all"){const f=S.sales.reduce((m,s)=>Math.min(m,+new Date(s.createdAt)),+t);return [d0(f),tom]}
  return [new Date(+tom-num(p)*DAY),tom];
}

/* ---------- факты: строки продаж и возвратов ---------- */
let cache={key:null,lines:null};
const sameRefs=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>x===b[i]);
const dataRefs=()=>[S.sales,S.returns,S.products,S.categories];
function catOf(p){if(!p)return{top:"Услуги и прочее",sub:"Услуги и прочее"};const c=App.byId("categories",p.categoryId);if(!c)return{top:"Без категории",sub:"Без категории"};
  const par=c.parentId?App.byId("categories",c.parentId):null;return{top:par?par.name:c.name,sub:c.name}}
function allLines(){
  const key=dataRefs();
  if(sameRefs(cache.key,key))return cache.lines;
  const L=[];const fac={};
  for(const s of S.sales){
    const its=s.items||[],net=its.reduce((a,i)=>a+num(i.qty)*num(i.price)-num(i.disc),0),f=net>0?Math.max(0,(net-num(s.discount))/net):0;fac[s.id]=f;
    const t=new Date(s.createdAt);
    for(const i of its){const p=i.productId?App.byId("products",i.productId):null,c=catOf(p),rev=(num(i.qty)*num(i.price)-num(i.disc))*f;
      L.push({t,day:dk(t),sale:s.id,pid:i.productId||"",name:i.name,top:c.top,sub:c.sub,brand:(p&&p.brand)||"—",cond:/б\/у/i.test((p&&p.condition)||i.condition||"")?"Б/у":p?"Новый":"—",
        kind:i.productId?"goods":(i.kind||"service"),qty:num(i.qty),rev,cost:num(i.cost)*num(i.qty),by:s.by,point:s.pointId,cust:s.customerId||"",channel:s.channel||"store",price:num(i.price),ret:false})}
  }
  for(const r of S.returns){const s=App.byId("sales",r.saleId)||{},f=fac[r.saleId]==null?1:fac[r.saleId],t=new Date(r.createdAt),its=r.items||[];
    // распределяем фактически возвращённую сумму по позициям пропорционально цене
    const base=its.reduce((a,i)=>a+num(i.qty)*num(i.price)*f,0),k=base>0&&num(r.amount)>0?num(r.amount)/base:1;
    for(const i of its){const p=i.productId?App.byId("products",i.productId):null,c=catOf(p);
      L.push({t,day:dk(t),sale:r.saleId,pid:i.productId||"",name:i.name||"",top:c.top,sub:c.sub,brand:(p&&p.brand)||"—",cond:/б\/у/i.test((p&&p.condition)||"")?"Б/у":p?"Новый":"—",
        kind:i.productId?"goods":"service",qty:-num(i.qty),rev:-num(i.qty)*num(i.price)*f*k,cost:-num(i.qty)*num(i.cost),by:s.by,point:s.pointId,cust:s.customerId||"",channel:s.channel||"store",price:num(i.price),ret:true})}
    if(!its.length&&num(r.amount)>0)L.push({t,day:dk(t),sale:r.saleId,pid:"",name:"Возврат",top:"Услуги и прочее",sub:"Услуги и прочее",brand:"—",cond:"—",kind:"service",qty:0,rev:-num(r.amount),cost:0,by:s.by,point:s.pointId,cust:s.customerId||"",channel:s.channel||"store",price:0,ret:true})}
  cache={key,lines:L};return L;
}
const linesIn=(from,to,pt)=>allLines().filter(l=>l.t>=from&&l.t<to&&(!pt||l.point===pt));
function agg(lines,keyFn){const m=new Map();
  for(const l of lines){const k=keyFn(l);if(k==null)continue;let a=m.get(k);if(!a){a={key:k,qty:0,rev:0,cost:0,ret:0,retRev:0,sales:new Set()};m.set(k,a)}
    a.qty+=l.qty;a.rev+=l.rev;a.cost+=l.cost;if(l.ret){a.ret+=-l.qty;a.retRev+=-l.rev}else a.sales.add(l.sale)}
  return [...m.values()].map(a=>Object.assign(a,{profit:a.rev-a.cost,margin:a.rev>0?(a.rev-a.cost)/a.rev:0,checks:a.sales.size}))}
function kpi(from,to,pt){
  const L=linesIn(from,to,pt),sales=S.sales.filter(s=>{const t=new Date(s.createdAt);return t>=from&&t<to&&(!pt||s.pointId===pt)});
  const rev=L.reduce((a,l)=>a+l.rev,0),cost=L.reduce((a,l)=>a+l.cost,0),gross=L.filter(l=>!l.ret).reduce((a,l)=>a+l.rev,0),retRev=-L.filter(l=>l.ret).reduce((a,l)=>a+l.rev,0);
  const items=L.filter(l=>!l.ret).reduce((a,l)=>a+l.qty,0),custs=new Set(sales.map(s=>s.customerId).filter(Boolean));
  const first=firstBuy();let newC=0;custs.forEach(c=>{const f=first[c];if(f&&f>=from&&f<to)newC++});
  const reps=S.repairs.filter(r=>r.status==="done"&&r.closedAt&&new Date(r.closedAt)>=from&&new Date(r.closedAt)<to&&(!pt||r.pointId===pt));
  const repRev=reps.reduce((a,r)=>a+num(r.finalPrice),0),repProfit=reps.reduce((a,r)=>a+num(r.finalPrice)-App.repairPartsCost(r),0);
  const n=sales.length;
  return{rev,cost,profit:rev-cost,margin:rev>0?(rev-cost)/rev:0,checks:n,avg:n?gross/n:0,ipc:n?items/n:0,custs:custs.size,newC,retC:custs.size-newC,
    anon:n?sales.filter(s=>!s.customerId).length/n:0,retRate:gross?retRev/gross:0,retRev,repRev,repProfit,days:Math.max(1,Math.round((to-from)/DAY)),L,sales};
}
let fbCache={k:null,v:null};
function firstBuy(){const k=S.sales;if(fbCache.k===k)return fbCache.v;const f={};
  for(const s of S.sales)if(s.customerId){const t=new Date(s.createdAt);if(!f[s.customerId]||t<f[s.customerId])f[s.customerId]=t}fbCache={k,v:f};return f}

/* ---------- графики (SVG, один оттенок; подсказки при наведении) ---------- */
function chart(o){
  // o: {labels:[], series:[{name, values:[], kind:"line"|"bar"|"dash"|"ghost"}], h, fmt, band:[[lo,hi]...]}
  const nar=window.innerWidth<700,W=nar?380:(o.w||760),H=nar?Math.round((o.h||220)*.85):(o.h||220),pl=54,pr=12,pt=14,pb=28,n=o.labels.length;if(!n)return '<div class="empty">Нет данных</div>';
  const vals=o.series.flatMap(s=>s.values.filter(v=>v!=null)).concat((o.band||[]).flat().filter(v=>v!=null));
  let max=Math.max(1,...vals),min=Math.min(0,...vals);const step=niceStep((max-min)/4);max=Math.ceil(max/step)*step;min=Math.floor(min/step)*step;
  const iw=W-pl-pr,ih=H-pt-pb,bw=iw/n,x=i=>pl+bw*i+bw/2,y=v=>pt+ih-(v-min)/(max-min)*ih;
  let g="";for(let v=min;v<=max+1e-9;v+=step)g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" class="cg"/><text x="${pl-6}" y="${y(v)+4}" class="ca" text-anchor="end">${short(v)}</text>`;
  const every=Math.max(1,Math.ceil(n/(nar?Math.min(6,o.maxLabels||6):(o.maxLabels||10))));
  const xl=o.labels.map((l,i)=>i%every===0?`<text x="${x(i)}" y="${H-8}" class="ca" text-anchor="middle">${esc(l)}</text>`:"").join("");
  const bars=o.series.filter(s=>s.kind==="bar"||s.kind==="ghost"),bwid=Math.max(2,Math.min(28,bw*.62)/Math.max(1,bars.length));
  const xw=i=>x(i)-bwid*bars.length/2+bwid*(bars.length-1)+bwid/2; // усы — по центру последнего столбика (прогноза)
  let band="";if(o.band&&o.whisk){band=o.band.map((b,i)=>b?`<line x1="${xw(i)}" x2="${xw(i)}" y1="${y(b[0])}" y2="${y(b[1])}" class="cwh"/><line x1="${xw(i)-5}" x2="${xw(i)+5}" y1="${y(b[0])}" y2="${y(b[0])}" class="cwh"/><line x1="${xw(i)-5}" x2="${xw(i)+5}" y1="${y(b[1])}" y2="${y(b[1])}" class="cwh"/>`:"").join("")}else if(o.band){const pts=o.band.map((b,i)=>b?[x(i),y(b[0]),y(b[1])]:null).filter(Boolean);if(pts.length>1)band=`<path class="cband" d="M${pts.map(p=>p[0]+","+p[2]).join("L")}L${pts.slice().reverse().map(p=>p[0]+","+p[1]).join("L")}Z"/>`}
  let marks="";
  bars.forEach((s,k)=>s.values.forEach((v,i)=>{if(v==null)return;const x0=x(i)-bwid*bars.length/2+bwid*k+1,y0=y(Math.max(v,0)),hh=Math.abs(y(v)-y(0));
    marks+=`<rect x="${x0}" y="${y0}" width="${Math.max(1,bwid-2)}" height="${Math.max(0,hh)}" rx="${Math.min(4,bwid/3)}" class="${s.kind==="ghost"?"cbar ghost":"cbar"}"/>`}));
  o.series.filter(s=>s.kind==="line"||s.kind==="dash"||s.kind==="thin").forEach(s=>{let d="",pen=false;s.values.forEach((v,i)=>{if(v==null){pen=false;return}d+=(pen?"L":"M")+x(i)+","+y(v);pen=true});
    marks+=`<path d="${d}" class="cl ${s.kind}"/>`;if(s.kind==="line"&&n<=40)s.values.forEach((v,i)=>{if(v!=null)marks+=`<circle cx="${x(i)}" cy="${y(v)}" r="2.5" class="cdot"/>`})});
  const fmt=o.fmt||money;
  const hits=o.labels.map((l,i)=>`<rect x="${pl+bw*i}" y="${pt}" width="${bw}" height="${ih}" class="chit"><title>${esc(o.tips?o.tips[i]:l)}\n${o.series.map(s=>s.values[i]==null?"":s.name+": "+fmt(s.values[i])).filter(Boolean).join("\n")}</title></rect>`).join("");
  const leg=o.series.length>1?`<div class="cleg">${o.series.map(s=>`<span><i class="lk ${s.kind}"></i>${esc(s.name)}</span>`).join("")}${o.band?`<span><i class="lk ${o.whisk?"whisk":"band"}"></i>вероятный диапазон</span>`:""}</div>`:"";
  return `<div class="chart">${leg}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(o.title||"График")}">${g}${band}${marks}${xl}<line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}" class="cz"/>${hits}</svg></div>`;
}
function niceStep(r){if(r<=0)return 1;const e=Math.pow(10,Math.floor(Math.log10(r))),f=r/e;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*e}
function hbars(rows,fmt=money){const max=Math.max(1,...rows.map(r=>Math.abs(r[1])));
  return rows.length?`<div class="hbars">${rows.map(([l,v,sub,act])=>`<div class="hb${act?" link":""}"${act?` data-act="${act[0]}" data-id="${esc(act[1])}"`:""}><span class="hb-l">${esc(l)}${sub?`<small>${sub}</small>`:""}</span><span class="hb-t"><i style="width:${Math.max(1,Math.abs(v)/max*100)}%"></i></span><b>${fmt(v)}</b></div>`).join("")}</div>`:'<div class="empty sm">Нет данных</div>'}
function heat(m,rowL,colL,fmt){const max=Math.max(1,...m.flat());
  return `<div class="heat" style="grid-template-columns:34px repeat(${colL.length},minmax(0,1fr))"><span></span>${colL.map(c=>`<span class="hh">${c}</span>`).join("")}
    ${m.map((r,i)=>`<span class="hr">${rowL[i]}</span>${r.map((v,j)=>`<span class="hc" style="--a:${v?0.12+0.88*v/max:0}" title="${rowL[i]}, ${colL[j]}:00 — ${fmt(v)}"></span>`).join("")}`).join("")}</div>`}

/* ---------- прогноз выручки ---------- */
function daily(pt){const m={};for(const l of allLines())if(!pt||l.point===pt)m[l.day]=(m[l.day]||0)+l.rev;
  const S2=S.repairs.filter(r=>r.status==="done"&&r.closedAt&&(!pt||r.pointId===pt));for(const r of S2){const k=dk(r.closedAt);m[k]=(m[k]||0)+num(r.finalPrice)}return m}
function regress(ys){const n=ys.length;if(n<2)return{a:ys[0]||0,b:0};const mx=(n-1)/2,my=ys.reduce((a,v)=>a+v,0)/n;let sxy=0,sxx=0;ys.forEach((v,i)=>{sxy+=(i-mx)*(v-my);sxx+=(i-mx)*(i-mx)});const b=sxx?sxy/sxx:0;return{a:my-b*mx,b}}
let fcCache={k:null,v:null};
App.anForecast=function(pt){const ck=[...dataRefs(),S.repairs,pt||"",dk(Date.now())];if(sameRefs(fcCache.k,ck))return fcCache.v;const v=forecast(pt);fcCache={k:ck,v};return v};
function forecast(pt){
  const m=daily(pt),keys=Object.keys(m).sort();if(!keys.length)return null;
  const today=d0(Date.now()),start=d0(keys[0]+"T12:00"),hist=Math.round((today-start)/DAY);
  const val=d=>m[dk(d)]||0;
  // профиль дней недели за последние 8 недель (нужно хотя бы 3 недели истории)
  const wdF=[1,1,1,1,1,1,1];if(hist>=21){const s=[0,0,0,0,0,0,0],c=[0,0,0,0,0,0,0];for(let i=1;i<=Math.min(56,hist);i++){const d=new Date(+today-i*DAY);s[wd(d)]+=val(d);c[wd(d)]++}
    const av=s.reduce((a,v)=>a+v,0)/Math.max(1,c.reduce((a,v)=>a+v,0));if(av>0)for(let k=0;k<7;k++)wdF[k]=c[k]?Math.max(.2,(s[k]/c[k])/av):1}
  // недельные суммы (последние до 26 полных недель) → тренд
  const weeks=[];for(let w=Math.min(26,Math.floor(hist/7));w>=1;w--){let s=0;for(let i=0;i<7;i++)s+=val(new Date(+today-(w*7-i)*DAY));weeks.push(s)}
  // тренд: регрессия по логарифму недельной выручки (рост в процентах, а не в рублях)
  const meanW=weeks.length?weeks.reduce((a,v)=>a+v,0)/weeks.length:0,floorW=Math.max(1,meanW*.05);
  const lw=weeks.map(v=>Math.log(Math.max(v,floorW))),rg=regress(lw);
  let gMonth=weeks.length>=4&&meanW>0?Math.exp(rg.b*4.345)-1:0;gMonth=Math.max(-.3,Math.min(.5,gMonth));
  const resid=lw.map((v,i)=>v-(rg.a+rg.b*i)),rel=weeks.length>2?Math.min(.6,Math.sqrt(resid.reduce((a,v)=>a+v*v,0)/(weeks.length-2))):.3;
  // текущий уровень: средний день за 28 дней без учёта дня недели
  const L=Math.min(28,Math.max(1,hist));let lv=0;for(let i=1;i<=L;i++){const d=new Date(+today-i*DAY);lv+=val(d)/wdF[wd(d)]}lv/=L;
  lv*=Math.pow(1+gMonth,(L/2)/30.4); // среднее за 4 недели отстаёт от «сегодня» на половину окна
  // сезонность по месяцам — только когда есть больше года истории
  const byM={};keys.forEach(k=>{const x=k.slice(0,7);byM[x]=(byM[x]||0)+m[k]});
  let sea=()=>1,seasonal=false;
  if(hist>=395){const idx={},full=[];for(let k=1;k<=12;k++){const d=new Date(today.getFullYear(),today.getMonth()-k,1);full.push([d.getMonth(),(byM[mk(d)]||0)/new Date(d.getFullYear(),d.getMonth()+1,0).getDate()])}
    const avg=full.reduce((a,x)=>a+x[1],0)/12;if(avg>0){full.forEach(([mo,v])=>idx[mo]=Math.max(.4,Math.min(2.5,v/avg)));const cur=idx[today.getMonth()]||1;
      sea=d=>1+((idx[d.getMonth()]||1)/cur-1)*.6;seasonal=true}}
  const fc=d=>{const k=(d-today)/DAY;return Math.max(0,lv*Math.pow(1+gMonth,k/30.4)*wdF[wd(d)]*sea(d))};
  const monthStart=new Date(today.getFullYear(),today.getMonth(),1),monthEnd=new Date(today.getFullYear(),today.getMonth()+1,1);
  let mtd=0;for(let d=new Date(monthStart);d<=today;d=new Date(+d+DAY))mtd+=val(d);
  // остаток сегодняшнего дня + следующие дни месяца
  let rest=Math.max(0,fc(today)-val(today));for(let d=new Date(+today+DAY);d<monthEnd;d=new Date(+d+DAY))rest+=fc(d);
  const relM=rel/Math.sqrt(4.35),z=1.28;
  const months=[];for(let k=1;k<=3;k++){const a=new Date(today.getFullYear(),today.getMonth()+k,1),b=new Date(today.getFullYear(),today.getMonth()+k+1,1);let s=0;for(let d=a;d<b;d=new Date(+d+DAY))s+=fc(d);
    const e=z*relM*Math.sqrt(k)+Math.abs(gMonth)*.5*(k-1)/3;months.push({key:mk(a),label:MON[a.getMonth()]+" "+a.getFullYear(),v:s,lo:Math.max(0,s*(1-e)),hi:s*(1+e)})}
  const curLo=mtd+Math.max(0,rest*(1-z*relM)),curHi=mtd+rest*(1+z*relM);
  return{hist,start,wdF,gMonth,lv,mtd,rest,monthEnd:mtd+rest,curLo,curHi,seasonal,months,byM,weeks,rel,fc,val,today,quality:hist>=90?"хорошая":hist>=28?"средняя":"низкая"};
};

/* ---------- экран ---------- */
const TABS=[["over","Обзор"],["fc","Прогноз"],["prod","Товары"],["cat","Категории"],["cust","Клиенты"],["time","Время"],["team","Сотрудники и точки"],["stock","Склад"]];
VIEWS.analytics={
  ownSearch:true,
  actions:()=>`<button class="btn" data-act="anExport">Скачать таблицу товаров</button>`,
  render(){
    const u=App.ui,t=u.anTab,pts=App.points(true);
    const per=t==="fc"||t==="stock"?"":App.sel("anPer",PERS,u.anPer,'data-filter-sel="anPer" aria-label="Период"');
    const pt=pts.length>1&&t!=="stock"?App.sel("anPoint",[["","Все точки"],...pts.map(p=>[p.id,p.name])],u.anPoint,'data-filter-sel="anPoint" aria-label="Точка"'):"";
    return `<div class="tabs">${TABS.map(([k,l])=>`<button class="tab ${t===k?"on":""}" data-act="anTab" data-id="${k}">${l}</button>`).join("")}</div>
      ${per||pt?`<div class="anbar">${per}${per&&u.anPer==="custom"?App.inp("anFrom",u.anFrom||"","date","",'data-filter-sel="anFrom" aria-label="С"')+App.inp("anTo",u.anTo||"","date","",'data-filter-sel="anTo" aria-label="По"'):""}${pt}${per?`<span class="muted">${perText()}</span>`:""}</div>`:""}
      <div class="an" data-nodirty>${S.sales.length?({over,fc,prod,cat,cust,time,team,stock})[t]():`<section class="card"><div class="empty">Продаж пока нет — аналитика появится после первых продаж.</div></section>`}</div>`;
  }
};
ACT.anTab=k=>{App.ui.anTab=k;App.render()};
function perText(){const [f,t]=range(App.ui.anPer);return `${f.toLocaleDateString("ru-RU")} — ${new Date(+t-DAY).toLocaleDateString("ru-RU")}, сравнение с таким же периодом до него`}
const prevRange=(f,t)=>[new Date(+f-(t-f)),f];

/* --- обзор --- */
function over(){
  const u=App.ui,[f,t]=range(u.anPer),[pf,ptt]=prevRange(f,t),pt=u.anPoint,c=kpi(f,t,pt),p=kpi(pf,ptt,pt);
  if(!c.checks&&!c.L.length)return emptyPer();
  const tile=(l,v,d,small)=>`<div class="tile"><span>${l}</span><b>${v}</b><small>${d||""}${small?" "+small:""}</small></div>`;
  const days=c.days,byDay=days<=92;
  const lab=[],vals=[],ma=[];
  const prevV=[];
  if(byDay){const m={},pm={};c.L.forEach(l=>m[l.day]=(m[l.day]||0)+l.rev);p.L.forEach(l=>pm[l.day]=(pm[l.day]||0)+l.rev);const sh=t-f;
    for(let d=new Date(f);d<t;d=new Date(+d+DAY)){lab.push(d.getDate()+" "+MON[d.getMonth()]);vals.push(m[dk(d)]||0);prevV.push(pm[dk(new Date(+d-sh))]||0)}
    vals.forEach((v,i)=>{const a=vals.slice(Math.max(0,i-6),i+1);ma.push(i>=6?a.reduce((x,y)=>x+y,0)/a.length:null)})}
  else{const m={};c.L.forEach(l=>{const k=mk(l.t);m[k]=(m[k]||0)+l.rev});for(let d=new Date(f.getFullYear(),f.getMonth(),1);d<t;d=new Date(d.getFullYear(),d.getMonth()+1,1)){lab.push(MON[d.getMonth()]+" "+String(d.getFullYear()).slice(2));vals.push(m[mk(d)]||0)}}
  const topP=agg(c.L,l=>l.pid||"svc:"+l.name).sort((a,b)=>b.rev-a.rev).slice(0,7);
  const topC=agg(c.L,l=>l.top).sort((a,b)=>b.rev-a.rev);
  const pays={};c.sales.forEach(s=>(s.payments||[]).forEach(x=>pays[x.method]=(pays[x.method]||0)+num(x.amount)));
  return `<div class="tiles t4">
      ${tile("Выручка",money(c.rev),dTag(c.rev,p.rev),c.repRev?`· ремонт ${money(c.repRev)}`:"")}
      ${App.can("cost")?tile("Валовая прибыль",money(c.profit),dTag(c.profit,p.profit),"· маржа "+pct(c.margin)):""}
      ${tile("Чеков",c.checks.toLocaleString("ru-RU"),dTag(c.checks,p.checks),"· "+(c.checks/days).toFixed(1).replace(".",",")+" в день")}
      ${tile("Средний чек",money(c.avg),dTag(c.avg,p.avg),"· "+c.ipc.toFixed(1).replace(".",",")+" товара в чеке")}
      ${tile("Покупатели",c.custs,dTag(c.custs,p.custs),"· новых "+c.newC+" · повторных "+c.retC)}
      ${tile("Без контакта",pct(c.anon),"","чеков без телефона")}
      ${tile("Возвраты",c.retRate>0&&c.retRate<.001?"<0,1%":pct(c.retRate,1),c.retRev>0.5?dTag(c.retRate,p.retRate,true):"",c.retRev>0.5?"· "+money(c.retRev):"возвратов не было")}
      ${tile("Выручка в день",money(c.rev/days),dTag(c.rev/days,p.rev/p.days))}
    </div>
    <section class="card"><div class="card-h"><h2>Выручка ${byDay?"по дням":"по месяцам"}</h2></div>
      ${chart({labels:lab,series:[{name:"Выручка",values:vals,kind:"bar"},...(byDay&&days>=14?[{name:"Среднее за 7 дней",values:ma,kind:"line"}]:[]),...(byDay&&p.rev&&u.anCmp?[{name:"Прошлый период",values:prevV,kind:"dash"}]:[])],maxLabels:byDay?10:12})}
      ${byDay&&p.rev?`<label class="chk sm"><input type="checkbox" data-filter-sel="anCmp" ${u.anCmp?"checked":""}> Показать прошлый период пунктиром</label>`:""}</section>
    <section class="card"><div class="card-h"><h2>Что важно</h2></div><ul class="insights">${insights(c,p,f,t).map(x=>`<li class="${x[0]}">${x[1]}</li>`).join("")}</ul></section>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Лучшие товары</h2><button class="btn sm" data-act="anTab" data-id="prod">Все</button></div>${hbars(topP.map(a=>[a.key.startsWith("svc:")?a.key.slice(4):(App.byId("products",a.key)||{}).name||"Товар",a.rev,`${a.key.startsWith("svc:")?"услуга":esc(catOf(App.byId("products",a.key)).sub)} · ${a.qty} шт${App.can("cost")?" · маржа "+pct(a.margin):""}`,a.key.startsWith("svc:")||!App.byId("products",a.key)?null:["openProduct",a.key]]))}</section>
      <section class="card"><div class="card-h"><h2>Категории</h2><button class="btn sm" data-act="anTab" data-id="cat">Подробно</button></div>${hbars(topC.map(a=>[a.key,a.rev,pct(c.rev?a.rev/c.rev:0)+" выручки"]))}
        <h3 class="sub-h">Способы оплаты</h3>${hbars(Object.entries(pays).sort((a,b)=>b[1]-a[1]).map(([m,v])=>[App.payLabel(m),v]))}</section>
    </div>`;
}
function insights(c,p,f,t){
  const out=[],cost=App.can("cost");
  if(p.rev){const d=delta(c.rev,p.rev);out.push([d>=0?"good":"bad",`Выручка ${d>=0?"выросла":"снизилась"} на <b>${pct(Math.abs(d))}</b> к предыдущему периоду (${money(p.rev)} → ${money(c.rev)}).`]);
    const da=delta(c.avg,p.avg),dc=delta(c.checks,p.checks);
    if(Math.abs(da)>.05||Math.abs(dc)>.05)out.push(["info",`Главная причина — ${Math.abs(dc)>=Math.abs(da)?`число чеков (${sgn(dc)}${pct(Math.abs(dc))})`:`средний чек (${sgn(da)}${pct(Math.abs(da))})`}.`])}
  const fc=App.anForecast(App.ui.anPoint);if(fc)out.push(["info",`Прогноз на этот месяц: <b>${money(fc.monthEnd)}</b>, уже есть ${money(fc.mtd)}. Тренд: ${sgn(fc.gMonth)}${pct(Math.abs(fc.gMonth))} в месяц.`]);
  const w=Array(7).fill(0),wc=Array(7).fill(0);for(let d=new Date(f);d<t;d=new Date(+d+DAY))wc[wd(d)]++;c.L.forEach(l=>w[wd(l.t)]+=l.rev);
  const avgW=w.map((v,i)=>wc[i]?v/wc[i]:0),best=avgW.indexOf(Math.max(...avgW)),worst=avgW.indexOf(Math.min(...avgW.map((v,i)=>wc[i]?v:Infinity)));
  if(c.checks>=10&&avgW[worst]>0)out.push(["info",`Лучший день — <b>${WD[best].toLowerCase()}</b> (в среднем ${money(avgW[best])}), слабее всего — ${WD[worst].toLowerCase()} (${money(avgW[worst])}).`]);
  const pr=prodStats(90,App.ui.anPoint);const soon=pr.filter(r=>r.rate>0&&r.cover<10&&r.stock>=0&&!r.p.archived).length,dead=pr.filter(r=>r.stock>0&&r.idle>=num(App.settings().deadDays||60));
  if(soon)out.push(["warn",`<b>${soon}</b> ${plural(soon,"товар закончится","товара закончатся","товаров закончатся")} в ближайшие 10 дней при текущих продажах — см. «Товары», колонка «Хватит на».`]);
  if(dead.length&&cost)out.push(["warn",`В товарах без продаж ${App.settings().deadDays||60}+ дней заморожено <b>${money(dead.reduce((a,r)=>a+r.stock*r.costU,0))}</b> (${dead.length} поз.).`]);
  const fb=firstBuy(),rep=c.sales.filter(s=>s.customerId&&fb[s.customerId]<f),repRev=rep.reduce((a,s)=>a+saleVal(s),0),tot=c.sales.reduce((a,s)=>a+saleVal(s),0);
  if(tot)out.push(["info",`Повторные покупатели дают <b>${pct(repRev/tot)}</b> выручки. ${c.anon>.4?`У ${pct(c.anon)} чеков нет телефона покупателя — их невозможно вернуть рассылкой.`:""}`]);
  if(cost&&c.margin&&p.margin&&Math.abs(c.margin-p.margin)>.02)out.push([c.margin>p.margin?"good":"bad",`Маржа ${c.margin>p.margin?"выросла":"упала"}: ${pct(p.margin)} → ${pct(c.margin)}.`]);
  if(c.retRate>.05)out.push(["bad",`Возвраты ${pct(c.retRate,1)} выручки — выше обычного, проверьте товары с возвратами.`]);
  return out.length?out:[["info","Пока мало данных для выводов."]];
}

const emptyPer=()=>`<section class="card"><div class="empty">За выбранный период${App.ui.anPoint?" на этой точке":""} продаж нет. Выберите другой период${App.ui.anPoint?" или точку":""}.</div></section>`;
/* --- прогноз --- */
function fc(){
  const u=App.ui,F=App.anForecast(u.anPoint);
  if(!F||F.hist<7)return `<section class="card"><div class="empty">Для прогноза нужна история продаж хотя бы за неделю${u.anPoint?" на этой точке":""}.${F?` Сейчас — ${F.hist+1} ${plural(F.hist+1,"день","дня","дней")}, выручка за месяц ${money(F.mtd)}.`:""}<br>Чем длиннее история, тем точнее прогноз: с 3 месяцев учитывается тренд, с года — сезонность.</div></section>`;
  const k90v=k90(u.anPoint,F),cost=App.can("cost");
  // месяцы: 12 назад + 3 вперёд
  const lab=[],act=[],fut=[],band=[];const now=F.today;
  for(let k=-11;k<=3;k++){const d=new Date(now.getFullYear(),now.getMonth()+k,1),key=mk(d);lab.push(MON[d.getMonth()]+" "+String(d.getFullYear()).slice(2));
    if(k<0){act.push(F.byM[key]||0);fut.push(null);band.push(null)}else if(k===0){act.push(F.mtd);fut.push(F.monthEnd);band.push([F.curLo,F.curHi])}
    else{const m=F.months[k-1];act.push(null);fut.push(m.v);band.push([m.lo,m.hi])}}
  const fl=lab.findIndex((_,i)=>act[i]>0);const sl=Math.max(0,Math.min(fl<0?11:fl,11));
  // дни: 30 назад + 30 вперёд
  const dl=[],da=[],df=[];for(let i=-29;i<=30;i++){const d=new Date(+now+i*DAY);dl.push(d.getDate()+" "+MON[d.getMonth()]);da.push(i<=0?F.val(d):null);df.push(i>=0?F.fc(d):null)}
  const sc=u.anSc,base=F.months[0].v,scRev=base*(1+sc.chk/100)*(1+sc.avg/100),mar=Math.max(0,k90v.margin+sc.mar/100);
  const lm=new Date(now.getFullYear(),now.getMonth()-1,1),pm=new Date(now.getFullYear(),now.getMonth()-2,1),lmv=F.byM[mk(lm)]||0,pmv=F.byM[mk(pm)]||0;
  const ly=F.byM[mk(new Date(now.getFullYear()-1,now.getMonth(),1))];
  const plan=num(u.anPlan),daysLeft=Math.round((new Date(now.getFullYear(),now.getMonth()+1,1)-now)/DAY)-1;
  return `<div class="tiles t4">
      <div class="tile"><span>Прогноз на ${MON[now.getMonth()]}</span><b>${money(F.monthEnd)}</b><small>уже ${money(F.mtd)} · ещё ≈ ${money(F.rest)}</small></div>
      ${F.months.map(m=>`<div class="tile"><span>${m.label}</span><b>${money(m.v)}</b><small>от ${short(m.lo)} до ${short(m.hi)} ₽</small></div>`).join("")}
    </div>
    <div class="tiles t4">
      <div class="tile"><span>Темп роста</span><b class="${F.gMonth>=0?"okc":"badc"}">${sgn(F.gMonth)}${pct(Math.abs(F.gMonth),1)}</b><small>в месяц, по тренду ${F.weeks.length} недель</small></div>
      <div class="tile"><span>Прошлый месяц к позапрошлому</span><b>${pmv?`${sgn(lmv-pmv)}${pct(Math.abs(delta(lmv,pmv)))}`:"—"}</b><small>${money(lmv)} против ${money(pmv)}</small></div>
      <div class="tile"><span>К прошлому году</span><b>${ly?`${sgn(F.monthEnd-ly)}${pct(Math.abs(delta(F.monthEnd,ly)))}`:"—"}</b><small>${ly?"прогноз месяца против "+money(ly):"истории меньше года"}</small></div>
      ${cost?`<div class="tile"><span>Прибыль в следующем месяце</span><b>${money(base*k90v.margin)}</b><small>при марже ${pct(k90v.margin)} (90 дней)</small></div>`:""}
    </div>
    <section class="card"><div class="card-h"><h2>Выручка по месяцам и прогноз</h2></div>
      ${chart({labels:lab.slice(sl),series:[{name:"Факт",values:act.slice(sl),kind:"bar"},{name:"Прогноз",values:fut.slice(sl),kind:"ghost"}],band:band.slice(sl),whisk:true,maxLabels:15})}</section>
    <section class="card"><div class="card-h"><h2>Ближайшие 30 дней</h2></div>
      ${chart({labels:dl,series:[{name:"Факт",values:da,kind:"line"},{name:"Прогноз",values:df,kind:"dash"}],maxLabels:12})}
      <p class="muted">Прогноз учитывает средний день за последние 4 недели, разницу между днями недели (${WD.map((w,i)=>w+" "+Math.round(F.wdF[i]*100)+"%").join(", ")}) и тренд. ${F.seasonal?"Учтена сезонность по прошлому году. ":""}Надёжность: <b>${F.quality}</b> — история ${F.hist} ${plural(F.hist,"день","дня","дней")}${F.hist<90?"; станет точнее, когда наберётся 3 месяца":""}.</p></section>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Что если…</h2></div>
        <p class="muted">Двигайте ползунки — увидите, как изменится следующий месяц (${F.months[0].label}).</p>
        ${slider("chk","Чеков больше / меньше",sc.chk,-30,50)}${slider("avg","Средний чек",sc.avg,-30,50)}${cost?slider("mar","Маржа, п.п.",sc.mar,-10,10,"п.п."):""}
        <div class="pl tot"><span>Выручка</span><b id="scRev">${money(scRev)}</b></div>${cost?`<div class="pl tot"><span>Валовая прибыль</span><b id="scPr">${money(scRev*mar)}</b></div>`:""}
        <p class="muted">Средний чек сейчас ${money(k90v.avg)}, чеков в день ${(k90v.checks/90).toFixed(1).replace(".",",")}. Например, +1 аксессуар к каждому 5-му телефону поднимает средний чек; рассылка повторным покупателям — число чеков.</p></section>
      <section class="card"><div class="card-h"><h2>План на месяц</h2></div>
        ${App.fld("anPlanI","Цель по выручке, ₽",App.inp("anPlanI",plan||"","number",String(Math.round(F.monthEnd/1e4)*1e4)))}
        ${plan?`<div class="prog"><i style="width:${Math.min(100,F.mtd/plan*100)}%"></i><i class="fc" style="width:${Math.min(100,F.monthEnd/plan*100)}%"></i></div>
          <div class="pl"><span>Выполнено</span><b>${money(F.mtd)} · ${pct(F.mtd/plan)}</b></div>
          <div class="pl"><span>По прогнозу к концу месяца</span><b class="${F.monthEnd>=plan?"okc":"badc"}">${money(F.monthEnd)} · ${pct(F.monthEnd/plan)}</b></div>
          <div class="pl"><span>Нужно в день до конца месяца</span><b>${daysLeft>0?money(Math.max(0,plan-F.mtd)/daysLeft):"—"}</b></div>
          <div class="pl"><span>Сейчас в среднем в день</span><b>${money(F.lv)}</b></div>
          <p class="muted">${F.monthEnd>=plan?"План выполняется по текущему темпу.":`Не хватает ≈ ${money(plan-F.monthEnd)}: это ≈ ${Math.ceil((plan-F.monthEnd)/Math.max(1,k90v.avg))} чеков по ${money(k90v.avg)}.`}</p>`:'<p class="muted">Укажите цель — покажу, сколько нужно продавать в день, чтобы её выполнить.</p>'}</section>
    </div>`;
}
let k90c={k:null,v:null};
function k90(pt,F){const key=[...dataRefs(),pt||""];if(sameRefs(k90c.k,key))return k90c.v;const v=kpi(new Date(+F.today-89*DAY),new Date(+F.today+DAY),pt);k90c={k:key,v};return v}
const slider=(k,l,v,min,max,u="%")=>`<div class="sld"><label for="sc_${k}">${l}: <b id="scv_${k}">${v>0?"+":""}${v} ${u}</b></label><input id="sc_${k}" type="range" min="${min}" max="${max}" step="1" value="${v}" data-sc="${k}"></div>`;
document.addEventListener("input",e=>{const t=e.target;
  if(t.dataset&&t.dataset.sc){const sc=App.ui.anSc;sc[t.dataset.sc]=num(t.value);const l=$("#scv_"+t.dataset.sc);if(l)l.textContent=(sc[t.dataset.sc]>0?"+":"")+sc[t.dataset.sc]+" "+(t.dataset.sc==="mar"?"п.п.":"%");
    const F=App.anForecast(App.ui.anPoint);if(!F)return;const k=k90(App.ui.anPoint,F);
    const r=F.months[0].v*(1+sc.chk/100)*(1+sc.avg/100);const a=$("#scRev");if(a)a.textContent=money(r);const b=$("#scPr");if(b)b.textContent=money(r*Math.max(0,k.margin+sc.mar/100))}
});
document.addEventListener("change",e=>{const t=e.target;if(t.id==="anPlanI"){App.ui.anPlan=Math.max(0,num(t.value));LS("icase_plan",App.ui.anPlan);App.render()}});

/* --- товары: спрос, ABC/XYZ, запас, что заказать --- */
let psCache={k:null,v:null};
function prodStats(days,pt){
  const k=[...dataRefs(),S.units,S.warehouses,days,pt||""];if(sameRefs(psCache.k,k))return psCache.v;
  const to=new Date(+d0(Date.now())+DAY),from=new Date(+to-days*DAY);
  const per={},last={};
  for(const l of allLines()){if(!l.pid||(pt&&l.point!==pt))continue;
    if(!l.ret&&(!last[l.pid]||l.t>last[l.pid]))last[l.pid]=l.t;
    if(l.t>=from&&l.t<to)(per[l.pid]||(per[l.pid]=[])).push(l)}
  const ptWh=pt?App.whs(true).filter(w=>w.pointId===pt).map(w=>w.id):null;
  const rows=S.products.filter(p=>!p.archived||per[p.id]).map(p=>{
    const L=per[p.id]||[],born=p.createdAt?new Date(p.createdAt):from,start=new Date(Math.max(+from,+born)),eff=Math.max(7,Math.min(days,(to-start)/DAY));
    const qty=L.reduce((a,l)=>a+l.qty,0),rev=L.reduce((a,l)=>a+l.rev,0),cost=L.reduce((a,l)=>a+l.cost,0);
    // тренд: вторая половина «живого» периода против первой
    const mid=new Date(+to-eff/2*DAY);let q1=0,q2=0;L.forEach(l=>{if(l.t<mid)q1+=l.qty;else q2+=l.qty});
    const tr=q1>0?q2/q1:q2>0?2:1,tf=qty>=5?Math.sqrt(Math.max(.5,Math.min(2,tr))):1;
    // стабильность: недельные продажи только за время, пока товар есть в базе
    const wk=Math.max(1,Math.floor(eff/7)),w=Array(wk).fill(0);L.forEach(l=>{const i=Math.floor((to-l.t)/DAY/7);if(i<wk)w[i]+=l.qty});
    const mean=w.reduce((s,v)=>s+v,0)/wk,sd=Math.sqrt(w.reduce((s,v)=>s+(v-mean)*(v-mean),0)/wk),cv=mean>0?sd/mean:9;
    const rate=Math.max(0,qty)/eff,r2=rate*tf;
    const stock=ptWh?ptWh.reduce((s,id)=>s+num((p.stock||{})[id]),0):App.qtyTotal(p);
    const cover=r2>0?Math.max(0,stock)/r2:Infinity,need=r2>0?Math.max(0,Math.ceil(r2*37-Math.max(0,stock))):0;
    const ref=last[p.id]||(p.createdAt?new Date(p.createdAt):null),idle=ref?Math.max(0,Math.round((Date.now()-ref)/DAY)):0;
    return{p,qty,rev,cost,profit:rev-cost,margin:rev>0?(rev-cost)/rev:0,rate,trend:tr,stock,cover,f30:Math.round(r2*30),need,
      xyz:qty<=0?"—":wk<4?"—":cv<.5?"X":cv<1?"Y":"Z",idle,last:last[p.id]||null,costU:num(p.cost),cat:catOf(p)}});
  const abc=(key,field)=>{const s=rows.filter(r=>r[field]>0).sort((a,b)=>b[field]-a[field]),tot=s.reduce((a,r)=>a+r[field],0);let c=0;s.forEach(r=>{c+=r[field];r[key]=c/tot<=.8||c===r[field]?"A":c/tot<=.95?"B":"C"});rows.forEach(r=>{if(!r[key])r[key]="—"})};
  abc("abc","rev");abc("abcP","profit");
  rows.forEach(r=>{const dd=num(App.settings().deadDays||60);
    r.tip=r.rate>0&&r.cover<14?["bad",r.stock<=0?"Нет в наличии — заказать "+r.need+" шт":`Закончится через ${Math.max(0,Math.round(r.cover))} дн. — заказать ${r.need} шт`]
      :r.stock>0&&r.idle>=dd?["warn",`Не продаётся ${r.idle} дн. — снизить цену или распродать`]
      :r.rate>0&&r.cover>120?["warn","Запас больше чем на 4 месяца — не заказывать"]
      :r.abc==="A"&&r.margin>.3?["good","Лидер с хорошей маржой — держать в наличии"]
      :r.rev>0&&r.margin<.1&&App.can("cost")?["warn","Низкая маржа — проверить цену"]
      :r.trend>=1.5&&r.qty>=3?["good","Спрос растёт"]:r.trend<=.5&&r.qty>=3?["warn","Спрос падает"]:["",""]});
  psCache={k,v:rows};return rows;
}
function prod(){
  const u=App.ui,[f,t]=range(u.anPer),days=Math.max(7,Math.round((t-f)/DAY)),cost=App.can("cost");
  let rows=prodStats(days,u.anPoint);const q=u.anQ.trim().toLowerCase();
  rows=rows.filter(r=>(r.qty||r.stock>0)&&(!u.anCat||r.cat.top===u.anCat||r.cat.sub===u.anCat)&&(!u.anAbc||(u.anAbc==="buy"?r.tip[0]==="bad":u.anAbc==="dead"?r.tip[1].startsWith("Не продаётся"):r.abc===u.anAbc))&&(!q||r.p.name.toLowerCase().includes(q)));
  const sorts={rev:(a,b)=>b.rev-a.rev,profit:(a,b)=>b.profit-a.profit,qty:(a,b)=>b.qty-a.qty,margin:(a,b)=>b.margin-a.margin,cover:(a,b)=>a.cover-b.cover,trend:(a,b)=>b.trend-a.trend,idle:(a,b)=>b.idle-a.idle};
  rows.sort(sorts[u.anSort]||sorts.rev);
  const cats=[...new Set(S.products.map(p=>catOf(p).top))].sort();
  const cnt=k=>prodStats(days,u.anPoint).filter(r=>r.abc===k).length;
  return `<div class="cfilt an4"><input id="anQ" type="search" placeholder="Найти товар" value="${esc(u.anQ)}" data-filter="anQ" aria-label="Поиск">
      ${App.sel("anCat",[["","Все категории"],...cats.map(c=>[c,c])],u.anCat,'data-filter-sel="anCat" aria-label="Категория"')}
      ${App.sel("anAbc",[["","Все товары"],["A","Группа A — дают 80% выручки ("+cnt("A")+")"],["B","Группа B ("+cnt("B")+")"],["C","Группа C ("+cnt("C")+")"],["buy","Пора заказать"],["dead","Не продаются"]],u.anAbc,'data-filter-sel="anAbc" aria-label="Группа"')}
      ${App.sel("anSort",[["rev","По выручке"],...(cost?[["profit","По прибыли"],["margin","По марже"]]:[]),["qty","По количеству"],["cover","Скоро закончатся"],["trend","Растущий спрос"],["idle","Дольше без продаж"]],u.anSort,'data-filter-sel="anSort" aria-label="Сортировка"')}</div>
    <section class="card"><div class="tbl-wrap"><table class="antbl"><thead><tr><th>Товар</th><th class="n">Продано</th><th class="n">Выручка</th>${cost?'<th class="n">Прибыль</th><th class="n">Маржа</th>':""}<th title="ABC по выручке / по прибыли · XYZ — стабильность спроса">ABC·XYZ</th><th class="n">Тренд</th><th class="n">Остаток</th><th class="n">Хватит на</th><th class="n">Спрос 30 дн.</th><th>Совет</th></tr></thead><tbody>
      ${rows.slice(0,400).map(r=>`<tr class="rowlink" data-act="openProduct" data-id="${esc(r.p.id)}"><td><b>${esc(r.p.name)}</b><span class="sub">${esc(r.cat.sub)}${r.last?" · последняя продажа "+App.dt(r.last):" · продаж не было"}</span></td>
        <td class="n">${r.qty}</td><td class="n">${money(r.rev)}</td>${cost?`<td class="n">${money(r.profit)}</td><td class="n">${r.rev?pct(r.margin):"—"}</td>`:""}
        <td><span class="abc ${r.abc}">${r.abc}</span>${cost?`<span class="abc s ${r.abcP}">${r.abcP}</span>`:""}<span class="xyz">${r.xyz}</span></td>
        <td class="n">${r.qty>=5?`<span class="dlt ${r.trend>1.1?"up":r.trend<.9?"down":""}">${r.trend>1.05?"↑":r.trend<.95?"↓":"→"} ${pct(Math.abs(r.trend-1))}</span>`:"—"}</td>
        <td class="n">${r.stock}</td><td class="n ${r.cover<14?"badc":""}">${r.stock<=0&&r.rate>0?"нет":isFinite(r.cover)?Math.round(r.cover)+" дн.":"—"}</td><td class="n">${r.f30||"—"}</td>
        <td><span class="tip ${r.tip[0]}">${esc(r.tip[1])}</span></td></tr>`).join("")||`<tr><td colspan="11" class="empty">Нет товаров</td></tr>`}
    </tbody></table></div></section>
    <p class="muted"><b>ABC</b>: A — товары, которые вместе дают 80% выручки, B — следующие 15%, C — остальные${cost?" (вторая буква — то же по прибыли)":""}. <b>XYZ</b>: X — продаётся ровно каждую неделю, Y — с колебаниями, Z — редко и непредсказуемо. «Хватит на» — сколько дней продержится остаток при текущем спросе с учётом тренда; «Заказать» — чтобы хватило на 30 дней плюс неделя на поставку.</p>`;
}
ACT.anExport=()=>{const [f,t]=range(App.ui.anPer),days=Math.max(7,Math.round((t-f)/DAY)),cost=App.can("cost");
  const rows=[["Товар","Категория","Продано, шт","Выручка",...(cost?["Прибыль","Маржа, %"]:[]),"ABC","ABC по прибыли","XYZ","Тренд, %","Остаток","Хватит на, дней","Спрос 30 дней","Заказать","Совет"],
    ...prodStats(days,App.ui.anPoint).filter(r=>r.qty||r.stock>0).sort((a,b)=>b.rev-a.rev).map(r=>[r.p.name,r.cat.sub,r.qty,Math.round(r.rev),...(cost?[Math.round(r.profit),Math.round(r.margin*100)]:[]),r.abc,r.abcP,r.xyz,Math.round((r.trend-1)*100),r.stock,isFinite(r.cover)?Math.round(r.cover):"",r.f30,r.need,r.tip[1]])];
  App.download(`icase-analytics-${new Date().toISOString().slice(0,10)}.csv`,App.toCSV(rows))};

/* --- категории, бренды, состояние, цены --- */
function cat(){
  const u=App.ui,[f,t]=range(u.anPer),[pf,ptt]=prevRange(f,t),L=linesIn(f,t,u.anPoint),P=linesIn(pf,ptt,u.anPoint),cost=App.can("cost");
  const tot=L.reduce((a,l)=>a+l.rev,0);if(!L.length)return emptyPer();
  const ti=S.sales.filter(s=>s.tradeIn&&new Date(s.createdAt)>=f&&new Date(s.createdAt)<t&&(!u.anPoint||s.pointId===u.anPoint)).reduce((a,s)=>({n:a.n+1,sum:a.sum+num(s.tradeIn.amount)}),{n:0,sum:0});
  const table=(title,fn)=>{const cur=agg(L,fn).sort((a,b)=>b.rev-a.rev),pm=Object.fromEntries(agg(P,fn).map(a=>[a.key,a.rev]));
    return `<section class="card"><div class="card-h"><h2>${title}</h2></div><div class="tbl-wrap"><table><thead><tr><th></th><th class="n">Выручка</th><th class="n">Доля</th><th class="n">К прошлому</th>${cost?'<th class="n">Прибыль</th><th class="n">Маржа</th>':""}<th class="n">Шт</th></tr></thead><tbody>
      ${cur.map(a=>`<tr><td><b>${esc(a.key)}</b></td><td class="n">${money(a.rev)}</td><td class="n"><span class="share"><i style="width:${tot?a.rev/tot*100:0}%"></i></span>${pct(tot?a.rev/tot:0)}</td><td class="n">${dTag(a.rev,pm[a.key]||0)||"—"}</td>${cost?`<td class="n">${money(a.profit)}</td><td class="n">${pct(a.margin)}</td>`:""}<td class="n">${a.qty}</td></tr>`).join("")||'<tr><td colspan="7" class="empty">Нет данных</td></tr>'}
    </tbody></table></div></section>`};
  const band=l=>{const p=l.price;return p<1000?"до 1 000 ₽":p<5000?"1–5 тыс":p<20000?"5–20 тыс":p<50000?"20–50 тыс":"от 50 тыс"};
  const BO=["до 1 000 ₽","1–5 тыс","5–20 тыс","20–50 тыс","от 50 тыс"];
  const bands=agg(L,band).sort((a,b)=>BO.indexOf(a.key)-BO.indexOf(b.key));
  // «прицепные» продажи: в чеках с устройством — есть ли аксессуар или услуга
  const bySale={};L.filter(l=>!l.ret).forEach(l=>{(bySale[l.sale]||(bySale[l.sale]=[])).push(l)});
  const devs=Object.values(bySale).filter(ls=>ls.some(l=>{const p=App.byId("products",l.pid);return p&&App.isDevice&&App.isDevice(p)}));
  const attach=devs.filter(ls=>ls.some(l=>{const p=l.pid?App.byId("products",l.pid):null;return !p||!(App.isDevice&&App.isDevice(p))})).length;
  return `<div class="tiles t4"><div class="tile"><span>Чеков с устройством</span><b>${devs.length}</b></div><div class="tile"><span>Из них с аксессуаром или услугой</span><b>${devs.length?pct(attach/devs.length):"—"}</b><small>чем выше, тем больше средний чек</small></div>
      <div class="tile"><span>Услуги</span><b>${money(L.filter(l=>l.kind==="service").reduce((a,l)=>a+l.rev,0))}</b></div><div class="tile"><span>Б/у техника</span><b>${money(L.filter(l=>l.cond==="Б/у").reduce((a,l)=>a+l.rev,0))}</b>${ti.n?`<small>trade-in: ${ti.n} шт на ${money(ti.sum)}</small>`:""}</div></div>
    <div class="fgrid">${table("Категории",l=>l.top)}${table("Подкатегории",l=>l.sub)}</div>
    <div class="fgrid">${table("Бренды",l=>l.brand)}${table("Новое и б/у",l=>l.kind==="service"?"Услуги":l.cond)}</div>
    <section class="card"><div class="card-h"><h2>Ценовые сегменты</h2></div>${hbars(bands.map(a=>[a.key,a.rev,`${a.qty} шт${cost?" · маржа "+pct(a.margin):""}`]))}</section>`;
}

/* --- клиенты --- */
function cust(){
  const u=App.ui,[f,t]=range(u.anPer),c=kpi(f,t,u.anPoint),fb=firstBuy();
  const by=custStats();
  const SEG={"Чемпионы":"часто и недавно — ваша опора","Лояльные":"покупают регулярно","Новые":"первая покупка за 30 дней — пригласите снова","Перспективные":"вторая покупка — закрепите","Под угрозой ухода":"давно не было — напомните о себе","Ушедшие":"больше полугода без покупок","Обычные":""};
  const segs={};Object.entries(by).forEach(([id,a])=>{const k=segOf(a);(segs[k]||(segs[k]={n:0,sum:0,ids:[]})).n++;segs[k].sum+=a.sum;segs[k].ids.push(id)});
  const cs=c.sales.filter(s=>s.customerId),cur={};cs.forEach(s=>{const a=cur[s.customerId]||(cur[s.customerId]={n:0,sum:0});a.n++;a.sum+=saleVal(s)});
  const top=Object.entries(cur).sort((a,b)=>b[1].sum-a[1].sum).slice(0,10);
  const repeaters=Object.values(by).filter(a=>a.n>=2).length,total=Object.keys(by).length;
  const avgId=cs.length?cs.reduce((a,s)=>a+saleVal(s),0)/cs.length:0,an=c.sales.filter(s=>!s.customerId),avgAn=an.length?an.reduce((a,s)=>a+saleVal(s),0)/an.length:0;
  const src={};cs.forEach(s=>{const k=(App.cust(s.customerId)||{}).source||"Не указан";src[k]=(src[k]||0)+saleVal(s)});
  const ltv=total?Object.values(by).reduce((a,x)=>a+x.sum,0)/total:0;
  // новые клиенты по месяцам
  const nm={};Object.values(fb).forEach(d=>{const k=mk(d);nm[k]=(nm[k]||0)+1});const ml=[],mv=[];const n0=new Date();for(let k=-11;k<=0;k++){const d=new Date(n0.getFullYear(),n0.getMonth()+k,1);ml.push(MON[d.getMonth()]);mv.push(nm[mk(d)]||0)}
  return `<div class="tiles t4">
      <div class="tile"><span>Покупателей за период</span><b>${c.custs}</b><small>новых ${c.newC} · вернулись ${c.retC}</small></div>
      <div class="tile"><span>Покупают повторно</span><b>${total?pct(repeaters/total):"—"}</b><small>${repeaters} из ${total} за всё время</small></div>
      <div class="tile"><span>Средний чек</span><b>${money(avgId)}</b><small>с телефоном · без телефона ${money(avgAn)}</small></div>
      <div class="tile"><span>Ценность клиента</span><b>${money(ltv)}</b><small>в среднем за всё время</small></div></div>
    <section class="card"><div class="card-h"><h2>Сегменты клиентов</h2><span class="muted">по давности, частоте и сумме покупок</span></div>
      <div class="segs">${["Чемпионы","Лояльные","Перспективные","Новые","Под угрозой ухода","Ушедшие","Обычные"].filter(k=>segs[k]).map(k=>`<button class="seg-c" data-act="anSeg" data-id="${esc(k)}"><b>${esc(k)}</b><span>${segs[k].n} ${plural(segs[k].n,"клиент","клиента","клиентов")} · ${money(segs[k].sum)}</span><small>${SEG[k]}</small></button>`).join("")||'<div class="empty">Клиентов с телефоном пока нет</div>'}</div></section>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Лучшие покупатели за период</h2></div>${hbars(top.map(([id,a])=>{const cc=App.cust(id)||{};return [cc.name||cc.phone||"Клиент",a.sum,`${a.n} ${plural(a.n,"покупка","покупки","покупок")}${cc.phone?" · "+esc(cc.phone):""}`,["openClient",id]]}))}</section>
      <section class="card"><div class="card-h"><h2>Новые клиенты по месяцам</h2></div>${chart({labels:ml,series:[{name:"Новых клиентов",values:mv,kind:"bar"}],w:420,h:200,fmt:v=>String(Math.round(v))})}
        <h3 class="sub-h">Откуда клиенты (выручка)</h3>${hbars(Object.entries(src).sort((a,b)=>b[1]-a[1]))}</section>
    </div>`;
  }
/* сегменты: давность, частота и сумма покупок (возвраты вычитаются) */
let csCache={k:null,v:null};
function custStats(){const k=[S.sales,S.returns,S.customers];if(sameRefs(csCache.k,k))return csCache.v;const by={};
  for(const s of S.sales){if(!s.customerId)continue;const c=App.cust(s.customerId);if(c&&c.mergedInto)continue;const a=by[s.customerId]||(by[s.customerId]={n:0,sum:0,last:0});a.n++;a.sum+=saleVal(s);a.last=Math.max(a.last,+new Date(s.createdAt))}
  for(const r of S.returns){const s=App.byId("sales",r.saleId);const id=r.customerId||(s&&s.customerId);if(id&&by[id])by[id].sum-=num(r.amount)}
  csCache={k,v:by};return by}
const segOf=a=>{const r=(Date.now()-a.last)/DAY;return a.n>=3&&r<=30?"Чемпионы":a.n>=3&&r<=90?"Лояльные":a.n===1&&r<=30?"Новые":a.n===2&&r<=60?"Перспективные":a.n>=2&&r<=180?"Под угрозой ухода":r>180||(a.n===1&&r>90)?"Ушедшие":"Обычные"};
const segList=k=>Object.entries(custStats()).filter(([,a])=>segOf(a)===k).sort((a,b)=>b[1].sum-a[1].sum);
ACT.anSeg=k=>{const list=segList(k);
  App.openModal(App.head(esc(k)+" · "+list.length)+`<div class="flist">${list.slice(0,300).map(([id,a])=>{const c=App.cust(id)||{};return `<button class="frow" data-act="openClient" data-id="${esc(id)}"><span class="fic">${esc((c.name||"?").slice(0,1))}</span><span class="cnm"><b>${esc(c.name||"Клиент")}</b><small>${esc(c.phone||"")} · ${a.n} ${plural(a.n,"покупка","покупки","покупок")} · последняя ${App.dt(new Date(a.last).toISOString())}</small></span><span class="csum">${money(a.sum)}</span></button>`}).join("")}</div>
    ${list.length>300?`<p class="muted">Показаны первые 300 из ${list.length} — полный список в файле.</p>`:""}
    <div class="acts"><button class="btn" data-act="anSegCsv" data-id="${esc(k)}">Скачать список с телефонами</button></div>`,{wide:true})};
ACT.anSegCsv=k=>{const rows=[["Имя","Телефон","Покупок","Сумма","Последняя покупка","Сегмент"],...segList(k).map(([id,a])=>{const c=App.cust(id)||{};return [c.name,c.phone,a.n,Math.round(a.sum),new Date(a.last).toLocaleDateString("ru-RU"),k]})];
  App.download(`icase-clients-${k}.csv`,App.toCSV(rows));App.api.audit("Экспорт","Клиенты: "+k,rows.length-1+" шт")};

/* --- время --- */
function time(){
  const u=App.ui,[f,t]=range(u.anPer),c=kpi(f,t,u.anPoint);if(!c.sales.length)return emptyPer();
  const m=Array.from({length:7},()=>Array(14).fill(0)),hr=Array(24).fill(0),wv=Array(7).fill(0),wc=Array(7).fill(0);
  for(let d=new Date(f);d<t;d=new Date(+d+DAY))wc[wd(d)]++;
  c.sales.forEach(s=>{const d=new Date(s.createdAt),h=d.getHours();hr[h]++;if(h>=8&&h<22)m[wd(d)][h-8]++});
  c.L.forEach(l=>wv[wd(l.t)]+=l.rev);
  const hrs=hr.map((v,i)=>[i,v]).filter(([i])=>i>=8&&i<22);
  const peak=hrs.reduce((a,b)=>b[1]>a[1]?b:a,[0,0]);
  return `<div class="fgrid">
      <section class="card"><div class="card-h"><h2>Выручка по дням недели</h2><span class="muted">в среднем за день</span></div>${chart({labels:WD,series:[{name:"Выручка в среднем",values:wv.map((v,i)=>wc[i]?v/wc[i]:0),kind:"bar"}],w:420,h:220})}</section>
      <section class="card"><div class="card-h"><h2>Чеки по часам</h2><span class="muted">пик — ${peak[0]}:00</span></div>${chart({labels:hrs.map(([i])=>String(i)),series:[{name:"Чеков",values:hrs.map(([,v])=>v),kind:"bar"}],w:420,h:220,fmt:v=>String(Math.round(v)),maxLabels:14})}</section>
    </div>
    <section class="card"><div class="card-h"><h2>Когда покупают</h2><span class="muted">число чеков: день недели × час</span></div>${heat(m,WD,Array.from({length:14},(_,i)=>String(i+8)),v=>v+" "+plural(v,"чек","чека","чеков"))}
      <p class="muted">Тёмные клетки — самое загруженное время: в эти часы нужны все продавцы на месте. Светлые — время для приёмки, ценников и обзвона клиентов.</p></section>`;
}

/* --- сотрудники и точки --- */
function team(){
  const u=App.ui,[f,t]=range(u.anPer),c=kpi(f,t,u.anPoint),cost=App.can("cost");
  const row=(lines,sales)=>{const rev=lines.reduce((a,l)=>a+l.rev,0),cst=lines.reduce((a,l)=>a+l.cost,0),items=lines.filter(l=>!l.ret).reduce((a,l)=>a+l.qty,0),ret=-lines.filter(l=>l.ret).reduce((a,l)=>a+l.rev,0);
    const svc=lines.filter(l=>l.kind==="service"&&!l.ret).reduce((a,l)=>a+l.rev,0);
    const disc=sales.reduce((a,s)=>a+num(s.discount)+(s.items||[]).reduce((b,i)=>b+num(i.disc),0),0),list=sales.reduce((a,s)=>a+(s.items||[]).reduce((b,i)=>b+num(i.qty)*num(i.price),0),0);
    return{disc,discP:list?disc/list:0,rev,profit:rev-cst,margin:rev?(rev-cst)/rev:0,n:sales.length,avg:sales.length?sales.reduce((a,s)=>a+saleVal(s),0)/sales.length:0,ipc:sales.length?items/sales.length:0,ret,svc,cust:sales.length?sales.filter(s=>s.customerId).length/sales.length:0}};
  const tbl=(title,groups,label)=>`<section class="card"><div class="card-h"><h2>${title}</h2></div><div class="tbl-wrap"><table><thead><tr><th></th><th class="n">Выручка</th><th class="n">Чеков</th><th class="n">Средний чек</th><th class="n">Товаров в чеке</th>${cost?'<th class="n">Маржа</th>':""}<th class="n">Услуги</th><th class="n">Скидки</th><th class="n">С телефоном</th><th class="n">Возвраты</th></tr></thead><tbody>
    ${groups.map(([k,r])=>`<tr><td><b>${esc(label(k))}</b></td><td class="n">${money(r.rev)}</td><td class="n">${r.n}</td><td class="n">${money(r.avg)}</td><td class="n">${r.ipc.toFixed(1).replace(".",",")}</td>${cost?`<td class="n">${pct(r.margin)}</td>`:""}<td class="n">${money(r.svc)}</td><td class="n">${r.disc>0.5?money(r.disc)+`<span class="sub">${pct(r.discP,1)}</span>`:"—"}</td><td class="n">${pct(r.cust)}</td><td class="n">${r.ret>0.5?money(r.ret):"—"}</td></tr>`).join("")||'<tr><td colspan="10" class="empty">Нет данных</td></tr>'}</tbody></table></div></section>`;
  if(!c.sales.length)return emptyPer();
  const keys=(fn)=>[...new Set(c.sales.map(fn))];
  const staff=keys(s=>s.by||"").map(k=>[k,row(c.L.filter(l=>(l.by||"")===k),c.sales.filter(s=>(s.by||"")===k))]).sort((a,b)=>b[1].rev-a[1].rev);
  const pts=keys(s=>s.pointId||"").map(k=>[k,row(c.L.filter(l=>(l.point||"")===k),c.sales.filter(s=>(s.pointId||"")===k))]).sort((a,b)=>b[1].rev-a[1].rev);
  const ch=keys(s=>s.channel||"store").map(k=>[k,row(c.L.filter(l=>l.channel===k),c.sales.filter(s=>(s.channel||"store")===k))]);
  return tbl("Сотрудники",staff,k=>App.nameOf(k)||"—")+tbl("Точки",pts,k=>(App.byId("points",k)||{}).name||"Без точки")+tbl("Каналы продаж",ch,k=>({store:"Магазин",site:"Сайт",avito:"Авито"})[k]||k)+
    `<p class="muted">«Товаров в чеке» и «Услуги» показывают, кто лучше допродаёт. «Скидки» — сколько скидок дал сотрудник и какую долю от цен по прайсу. «С телефоном» — доля чеков, где продавец записал телефон покупателя.</p>`;
}

/* --- склад --- */
function stock(){
  const rows=prodStats(90),cost=App.can("cost"),dd=num(App.settings().deadDays||60);
  const inSt=rows.filter(r=>r.stock>0),val=inSt.reduce((a,r)=>a+r.stock*r.costU,0),retail=inSt.reduce((a,r)=>a+r.stock*num(r.p.price),0);
  const cogsDay=rows.reduce((a,r)=>a+r.cost,0)/90,turn=cogsDay>0?val/cogsDay:Infinity;
  const dead=inSt.filter(r=>r.idle>=dd).sort((a,b)=>b.stock*b.costU-a.stock*a.costU),soon=rows.filter(r=>r.rate>0&&r.cover<14).sort((a,b)=>a.cover-b.cover),over=inSt.filter(r=>r.rate>0&&r.cover>120);
  const units=S.units.filter(u=>u.status==="in_stock"),age=u=>Math.round((Date.now()-new Date(u.createdAt||Date.now()))/DAY);
  const ub=[["до 15 дней",0,15],["15–30 дней",15,30],["30–60 дней",30,60],["60–90 дней",60,90],["больше 90 дней",90,1e9]].map(([l,a,b])=>{const us=units.filter(u=>age(u)>=a&&age(u)<b);return [l,us.reduce((s,u)=>s+num(u.cost),0),us.length+" шт"]});
  const list=(arr,fn)=>arr.length?`<div class="flist">${arr.slice(0,12).map(r=>`<button class="frow nofic" data-act="openProduct" data-id="${esc(r.p.id)}"><span class="cnm"><b>${esc(r.p.name)}</b><small>${fn(r)}</small></span><span class="csum">${r.stock} шт</span></button>`).join("")}</div>`:'<div class="empty sm">Нет</div>';
  return `<div class="tiles t4">
      ${cost?`<div class="tile"><span>Товар на складе по закупке</span><b>${money(val)}</b><small>в рознице ${money(retail)}</small></div><div class="tile"><span>Заложенная наценка</span><b>${money(retail-val)}</b><small>если продать всё по текущим ценам</small></div>`:""}
      <div class="tile"><span>Оборачиваемость</span><b>${isFinite(turn)?Math.round(turn)+" дн.":"—"}</b><small>за сколько дней продаётся весь склад</small></div>
      <div class="tile"><span>Не продаётся ${dd}+ дней</span><b class="${dead.length?"badc":""}">${dead.length} поз.</b><small>${cost?"заморожено "+money(dead.reduce((a,r)=>a+r.stock*r.costU,0)):""}</small></div></div>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Скоро закончатся</h2><button class="btn sm" data-act="anBuy">Список к заказу</button></div>${list(soon,r=>`${r.stock<=0?"нет в наличии":"хватит на "+Math.round(r.cover)+" дн."} · продаётся ${(r.rate*7).toFixed(1).replace(".",",")} в неделю · заказать ${r.need} шт`)}</section>
      <section class="card"><div class="card-h"><h2>Залежались</h2></div>${list(dead,r=>`без продаж ${r.idle} дн.${cost?" · заморожено "+money(r.stock*r.costU):""}`)}</section>
    </div>
    <div class="fgrid">
      <section class="card"><div class="card-h"><h2>Слишком большой запас</h2></div>${list(over,r=>`хватит на ${Math.round(r.cover)} дн. при спросе ${(r.rate*30).toFixed(1).replace(".",",")} в месяц`)}</section>
      <section class="card"><div class="card-h"><h2>Возраст устройств на складе</h2><span class="muted">по IMEI / S/N</span></div>${hbars(ub,cost?money:v=>"")}</section>
    </div>`;
}
ACT.anBuy=()=>{const rows=prodStats(90).filter(r=>r.rate>0&&r.cover<14).sort((a,b)=>a.cover-b.cover);
  App.openModal(App.head("Что заказать")+`<div class="tbl-wrap"><table><thead><tr><th>Товар</th><th class="n">Остаток</th><th class="n">В неделю</th><th class="n">Заказать</th><th>Лучшая цена поставщика</th></tr></thead><tbody>
    ${rows.map(r=>{const o=(App.offersFor?App.offersFor(r.p):[]).filter(x=>x.price>0)[0];return `<tr><td>${esc(r.p.name)}</td><td class="n">${r.stock}</td><td class="n">${(r.rate*7).toFixed(1).replace(".",",")}</td><td class="n"><b>${r.need}</b></td><td>${o?money(o.price)+" · "+esc((App.byId("suppliers",o.supplierId)||{}).name||""):"—"}</td></tr>`}).join("")}</tbody></table></div>
    <p class="muted">Количество — чтобы хватило на 30 дней плюс неделя на поставку.</p>
    <div class="acts"><button class="btn" data-act="anBuyCsv">Скачать</button>${App.poFromNeeds&&App.can("stock")&&rows.length?'<button class="btn pri" data-act="anBuyPo">Создать заказы поставщикам</button>':""}</div>`,{wide:true})};
ACT.anBuyPo=(_,btn)=>{btn.disabled=true;App.poFromNeeds(prodStats(90).filter(r=>r.rate>0&&r.cover<14)).catch(e=>{btn.disabled=false;App.toast(e.message)})};
ACT.anBuyCsv=()=>{const rows=prodStats(90).filter(r=>r.rate>0&&r.cover<14);App.download("icase-zakaz.csv",App.toCSV([["Товар","Артикул","Остаток","Продаётся в неделю","Заказать"],...rows.map(r=>[r.p.name,r.p.sku,r.stock,(r.rate*7).toFixed(1),r.need])]))};
})();
