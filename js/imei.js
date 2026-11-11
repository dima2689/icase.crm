/* iCase CRM v3 · база IMEI: что за устройство по IMEI, серийному номеру или артикулу коробки */
"use strict";
(function(){
const {S,$,esc,ACT}=App;

/* артикул Apple с коробки: MTUV3ZD/A или 1PMTUV3ZD/A (так он лежит в штрихкоде) */
App.isPartNo=v=>/^(1P)?[A-Z][A-Z0-9]{4}[A-Z]{1,2}\/[A-Z]$/i.test(String(v||"").replace(/\s/g,""));
App.normPart=v=>String(v||"").replace(/\s/g,"").toUpperCase().replace(/^1P/,"");
App.luhnOk=v=>{const s=String(v||"");if(!/^\d{15}$/.test(s))return false;let t=0;for(let i=0;i<15;i++){let d=+s[i];if(i%2){d*=2;if(d>9)d-=9}t+=d}return t%10===0};
const looks=v=>{const c=String(v||"").replace(/\s/g,"").toUpperCase();return /^\d{14,15}$/.test(c)||App.isPartNo(c)||(/^[A-Z0-9]{10,13}$/.test(c)&&/\d/.test(c)&&/[A-Z]/.test(c))};
App.looksLikeDeviceCode=looks;

const cache=new Map();
App.deviceLookup=async code=>{const c=String(code||"").replace(/\s/g,"").toUpperCase();if(!looks(c))return null;
  if(cache.has(c))return cache.get(c);
  try{const r=await App.api.rpc("device_lookup",{p_code:c});cache.set(c,r||null);if(cache.size>300)cache.delete(cache.keys().next().value);return r||null}
  catch(e){console.warn("device_lookup",e);return null}};
App.deviceLookupForget=()=>cache.clear();
/* после прихода/продажи экземпляров ответы устаревают (выученные модели, статус экземпляра) */
const rl=App.reload;App.reload=function(cols){if(!cols||[].concat(cols).some(c=>c==="units"||c==="products"))cache.clear();return rl.apply(this,arguments)};

/* значение памяти/цвета считаем надёжным: по артикулу коробки — сразу, по IMEI — когда так было хотя бы в 3 приёмках из 3 и чаще 90% */
App.devSure=(info,field)=>{const b=info&&info.learned&&info.learned.best&&info.learned.best[field];if(!b)return null;
  if(info.kind==="part")return b.value;return b.n>=3&&b.n/b.of>=0.9?b.value:null};
App.devGuess=(info,field)=>{const b=info&&info.learned&&info.learned.best&&info.learned.best[field];return b?b.value:null};
/* название для свободных полей (ремонт, выкуп, trade-in) */
App.devName=(info)=>{if(!info)return "";
  const base=info.model?info.model.name:info.ref?(/^apple$/i.test(info.ref.brand)?info.ref.model:info.ref.brand+" "+info.ref.model):(info.learned&&info.learned.name)||"";
  if(!base)return "";const mem=App.devSure(info,"memory"),col=App.devSure(info,"color");return [base,mem,col].filter(Boolean).join(", ")};
const ST={in_stock:"на складе",reserved:"в резерве",sold:"продан",in_repair:"в ремонте",written_off:"списан",returned_supplier:"возвращён поставщику"};
/* строка-подсказка под полем */
App.devHint=(info,{compact=false}={})=>{if(!info)return "";const out=[];
  if(info.kind==="imei"&&info.valid===false)out.push(`<span class="pill bad">Контрольная цифра IMEI не сходится — проверьте ввод</span>`);
  const nm=info.model?info.model.name:info.ref?(/^apple$/i.test(info.ref.brand)?info.ref.model:info.ref.brand+" "+info.ref.model):"";
  if(nm){const meta=[info.ref&&info.ref.model_no,info.ref&&info.ref.year].filter(Boolean).join(" · ");
    const src=info.kind==="part"?"по артикулу коробки":info.learned&&info.learned.hits&&!info.ref?"по прошлым приёмкам":"по IMEI";
    out.push(`<span class="pill ok">${esc(nm)}</span>${meta?` <span class="muted">${esc(meta)}</span>`:""} <span class="muted">· ${src}</span>`)}
  else if(info.kind==="imei")out.push(`<span class="muted">Модель по IMEI не найдена в справочнике — выберите вручную, CRM запомнит</span>`);
  if(!compact&&info.learned){const g=["memory","color"].map(f=>App.devSure(info,f)?null:App.devGuess(info,f)).filter(Boolean);
    if(g.length)out.push(`<span class="muted">Чаще всего с этим кодом: ${esc(g.join(", "))}</span>`)}
  if(info.unit){const bad=["in_stock","reserved","in_repair"].includes(info.unit.status);
    out.push(`<span class="pill ${bad?"bad":"warn"}">Уже в базе: ${esc(info.unit.name)} · ${esc(ST[info.unit.status]||info.unit.status)}</span> <button type="button" class="btn sm ghost" data-act="openUnit" data-id="${esc(info.unit.id)}">История</button>`)}
  return out.length?`<div class="devhint">${out.join(" ")}</div>`:""};

/* ---------- свободные поля: ремонт, выкуп/комиссия, trade-in на кассе ---------- */
const PAIRS={rImei:"rDevice",dlCode:"dlDev",posTiI:"posTi"};
const timers={};
function hintBox(el){let h=document.getElementById(el.id+"_dh");if(!h){h=document.createElement("div");h.id=el.id+"_dh";h.className="devhint-wrap";(el.closest(".fld")||el.parentNode).appendChild(h)}return h}
async function assist(el){const v=el.value.trim(),box=hintBox(el);if(!looks(v)){box.innerHTML="";return}
  const info=await App.deviceLookup(v);if(el.value.trim()!==v)return;
  box.innerHTML=App.devHint(info,{compact:true});
  const target=document.getElementById(PAIRS[el.id]);const name=App.devName(info);
  if(target&&name&&(!target.value.trim()||target.dataset.auto==="1")){target.value=name;target.dataset.auto="1";target.dispatchEvent(new Event("input",{bubbles:true}))}}
document.addEventListener("input",e=>{const t=e.target;if(!t||!t.id)return;
  if(PAIRS[t.id]){clearTimeout(timers[t.id]);timers[t.id]=setTimeout(()=>assist(t),250);return}
  if(Object.values(PAIRS).includes(t.id)&&e.isTrusted)delete t.dataset.auto});

/* ---------- настройки → каталог Apple: состояние базы IMEI и проверка кода ---------- */
let stats=null,statsP=null,probe=null;
function loadStats(){if(statsP)return;statsP=App.api.rpc("tac_stats",{}).then(r=>{stats=r||{};App.schedule()}).catch(()=>{stats={err:1};App.schedule()})}
const ct=App.catalogTab;if(ct)App.catalogTab=function(){loadStats();const n=x=>(+x||0).toLocaleString("ru-RU");
  return `<div class="card imeicard"><h3 class="sub-h">База IMEI</h3>
    <p class="muted">IMEI, серийный номер или артикул с коробки (MTUV3ZD/A) определяют модель при приёмке, ремонте, выкупе и trade-in.
    Память и цвет CRM узнаёт сама: каждый принятый экземпляр запоминается, и следующий с тем же кодом заполнится автоматически.</p>
    ${stats?(stats.err?'<p class="muted">Статистика недоступна</p>':`<div class="kpis sm"><div><b>${n(stats.tac)}</b><span>моделей в справочнике IMEI (Apple — ${n(stats.apple)})</span></div><div><b>${n(stats.learned)}</b><span>кодов выучено на приёмках</span></div><div><b>${n(stats.parts)}</b><span>артикулов коробок</span></div></div>`):'<p class="muted">Загрузка…</p>'}
    <div class="row-f"><div class="fld grow"><label for="imeiProbe">Проверить код</label><input id="imeiProbe" class="mono" autocomplete="off" placeholder="IMEI, серийный номер или артикул" value="${esc(probe&&probe.q||"")}"></div><button class="btn" data-act="imeiProbe">Проверить</button></div>
    <div id="imeiProbeOut">${probe&&probe.info?App.devHint(probe.info):probe&&probe.q?'<p class="muted">Ничего не найдено</p>':""}</div></div>`+ct.apply(this,arguments)};
ACT.imeiProbe=async()=>{const q=App.val("imeiProbe");if(!q)return;const info=await App.deviceLookup(q);probe={q,info};
  const o=$("#imeiProbeOut");if(o)o.innerHTML=info?App.devHint(info):'<p class="muted">Не похоже на IMEI, серийный номер или артикул</p>'};
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target&&e.target.id==="imeiProbe"){e.preventDefault();ACT.imeiProbe()}});
})();
