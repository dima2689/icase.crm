/* iCase CRM v3 · приложение на телефоне: установка, работа без сети, сканер камерой, нижняя панель */
"use strict";
(function(){
const {S,$,esc,ACT}=App;

/* ---------- установка (PWA) ---------- */
App.standalone=()=>window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
App.isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
let deferred=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;App.schedule&&App.schedule()});
window.addEventListener("appinstalled",()=>{deferred=null;App.toast("Приложение установлено");App.schedule()});
if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"||location.hostname==="127.0.0.1")){
  window.addEventListener("load",()=>{navigator.serviceWorker.register("sw.js").then(reg=>{
    reg.addEventListener("updatefound",()=>{const w=reg.installing;if(!w)return;w.addEventListener("statechange",()=>{
      if(w.state==="installed"&&navigator.serviceWorker.controller)App.banner("Вышло обновление приложения — оно применится при следующем открытии","")})});
  }).catch(()=>{})});
}
const dismissed=()=>{try{return localStorage.getItem("icase_install_hide")==="1"}catch(e){return false}};
App.installCard=()=>{if(App.standalone()||dismissed()||!window.matchMedia("(max-width:760px), (pointer:coarse)").matches)return "";
  if(!deferred&&!App.isIOS())return "";
  return `<div class="card installcard"><img src="icons/icon-192.png" alt="" width="44" height="44"><div><b>iCase на главный экран</b><p class="muted">Открывается как приложение, сканирует штрихкоды и IMEI камерой.</p></div>
    <div class="acts"><button class="btn sm ghost" data-act="installHide">Не сейчас</button><button class="btn sm pri" data-act="appInstall">Установить</button></div></div>`};
ACT.installHide=()=>{try{localStorage.setItem("icase_install_hide","1")}catch(e){}App.render()};
ACT.appInstall=async()=>{
  if(deferred){deferred.prompt();const r=await deferred.userChoice.catch(()=>null);deferred=null;if(r&&r.outcome==="accepted")App.toast("Устанавливаем…");App.render();return}
  if(App.standalone())return App.toast("Приложение уже установлено");
  App.openModal(App.head("Установка на телефон")+(App.isIOS()?
    `<ol class="steps"><li>Откройте CRM в <b>Safari</b> (в других браузерах iPhone установка недоступна).</li><li>Нажмите <b>«Поделиться»</b> — квадрат со стрелкой вверх внизу экрана.</li><li>Выберите <b>«На экран „Домой“»</b> и нажмите <b>«Добавить»</b>.</li></ol>`:
    `<ol class="steps"><li>Откройте CRM в <b>Chrome</b>.</li><li>Нажмите меню <b>⋮</b> справа вверху.</li><li>Выберите <b>«Установить приложение»</b> или «Добавить на главный экран».</li></ol>`)
    +`<p class="muted">Вход и данные те же, что в CRM на компьютере. Обновления приходят сами.</p><div class="acts"><button class="btn pri" data-act="close">Понятно</button></div>`)};
const dash=App.VIEWS.dashboard;if(dash){const r0=dash.render.bind(dash);dash.render=function(){return App.installCard()+r0()}}

/* ---------- нет сети ---------- */
let offShown=false;
function netState(){if(!navigator.onLine){offShown=true;App.banner("Нет интернета. Данные на экране могут быть устаревшими, сохранение не выполнится — дождитесь связи.","warn")}
  else if(offShown){offShown=false;App.banner("");if(App.me.role&&App.reload)App.reload(App.COLS).then(()=>App.toast("Связь восстановлена, данные обновлены")).catch(()=>{})}}
window.addEventListener("online",netState);window.addEventListener("offline",netState);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&!navigator.onLine)netState()});

/* ---------- сканер камерой ---------- */
const FORMATS=["ean_13","ean_8","upc_a","upc_e","code_128","code_39","code_93","itf","codabar","qr_code","data_matrix"];
let zxingP=null;
function loadZXing(){if(window.ZXing)return Promise.resolve(window.ZXing);if(zxingP)return zxingP;
  zxingP=new Promise((ok,no)=>{const s=document.createElement("script");s.src="js/vendor/zxing.min.js";s.onload=()=>ok(window.ZXing);s.onerror=()=>{zxingP=null;no(new Error("Не загрузился модуль сканера"))};document.head.appendChild(s)});return zxingP}
/* распознаватель: встроенный BarcodeDetector (Android/Chrome), иначе ZXing (iPhone и прочие) */
App.makeDecoder=async()=>{
  if("BarcodeDetector" in window){try{const sup=await window.BarcodeDetector.getSupportedFormats();const f=FORMATS.filter(x=>sup.includes(x));
    if(f.includes("ean_13")||f.includes("code_128")){const d=new window.BarcodeDetector({formats:f});return {kind:"native",decode:async src=>{const r=await d.detect(src);return r.length?r[0].rawValue:null}}}}catch(e){}}
  const Z=await loadZXing();const hints=new Map();const F=Z.BarcodeFormat;
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.CODE_93,F.ITF,F.CODABAR,F.QR_CODE,F.DATA_MATRIX]);
  hints.set(Z.DecodeHintType.TRY_HARDER,true);
  const reader=new Z.MultiFormatReader();reader.setHints(hints);
  return {kind:"zxing",decode:async canvas=>{try{const lum=new Z.HTMLCanvasElementLuminanceSource(canvas);const bmp=new Z.BinaryBitmap(new Z.HybridBinarizer(lum));
    return reader.decode(bmp).getText()}catch(e){return null}finally{reader.reset()}}}};

/* куда отдать код: поле сканирования на экране, иначе — поиск по базе */
const SCAN_SEL=".uscan,[data-rscan],[data-uscan],#dpCode,#dpPart,#rImei,#dlCode,#posTiI,#uImei,#posQ,#rcvQ,#poQ,#ppQ,#wQ,#lQ,#repQ,#mQ";
let lastFocus=null;
document.addEventListener("focusin",e=>{const t=e.target;if(t.matches&&t.matches("input")&&t.matches(SCAN_SEL))lastFocus=desc(t)});
function desc(el){return el.id?"#"+el.id:el.dataset.rscan!=null?`[data-rscan="${el.dataset.rscan}"]`:el.dataset.uscan!=null?`[data-uscan="${el.dataset.uscan}"]`:null}
const vis=el=>el&&el.offsetParent!==null&&!el.disabled&&!el.readOnly;
function target(){
  const modalOpen=!$("#scrim").hidden,root=modalOpen?$("#modal"):$("#view");
  if(lastFocus){const el=root.querySelector(lastFocus);if(vis(el))return el}
  return [...root.querySelectorAll(SCAN_SEL)].find(vis)||null}
function feed(el,code){el.focus({preventScroll:true});el.value=code;el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true}))}
/* поиск кода по всей базе: экземпляр, товар, ремонт, продажа */
App.lookupCode=code=>{const c=String(code||"").trim();if(!c)return false;const lc=c.toLowerCase();
  const u=App.findUnit&&App.findUnit(c);if(u){ACT.openUnit(u.id);return true}
  const p=App.findByCode(c);if(p){ACT.openProduct(p.id);return true}
  const r=S.repairs.find(x=>String(x.num||"").toLowerCase()===lc||(x.imei&&String(x.imei).trim().toLowerCase()===lc));if(r){ACT.openRepair(r.id);return true}
  const s=S.sales.find(x=>String(x.num||"").toLowerCase()===lc);if(s&&ACT.openSale){ACT.openSale(s.id);return true}
  const g=$("#gsearch");if(g){g.value=c;g.dispatchEvent(new Event("input",{bubbles:true}));g.focus()}
  App.toast("Код «"+c+"» в базе не найден");return false};

let cam=null;
function beep(){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const a=cam&&cam.audio||(cam&&(cam.audio=new A()));if(!a)return;
  const o=a.createOscillator(),g=a.createGain();o.frequency.value=1400;g.gain.value=.08;o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+.08)}catch(e){}}
/* opts: {onCode(code)→true чтобы продолжать, title} */
App.scan=async(opts={})=>{
  if(cam)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){App.toast("Камера недоступна в этом браузере");return}
  const box=document.createElement("div");box.className="camscrim";box.innerHTML=`<div class="cam">
    <video playsinline muted autoplay></video><div class="camframe"><i></i></div>
    <div class="camtop"><b>${esc(opts.title||"Наведите на штрихкод, IMEI или QR")}</b><button class="btn ghost" data-cam="close" aria-label="Закрыть">✕</button></div>
    <div class="camlast" hidden></div>
    <div class="camtype" hidden><input type="text" inputmode="text" autocomplete="off" placeholder="Код, IMEI или серийный номер" aria-label="Код вручную"><button class="btn pri" data-cam="ok">OK</button></div>
    <div class="cambot"><button class="btn" data-cam="torch" hidden>Фонарик</button><button class="btn" data-cam="flip">Сменить камеру</button><button class="btn" data-cam="type">Ввести вручную</button></div></div>`;
  document.body.appendChild(box);
  cam={box,stream:null,facing:"environment",timer:0,last:"",lastAt:0,opts,busy:false};
  box.addEventListener("click",e=>{const b=e.target.closest("[data-cam]");if(!b)return;const k=b.dataset.cam;
    if(k==="close")return App.scanStop();
    if(k==="flip"){cam.facing=cam.facing==="environment"?"user":"environment";return start()}
    if(k==="torch"){const t=cam.stream&&cam.stream.getVideoTracks()[0];cam.torch=!cam.torch;t&&t.applyConstraints({advanced:[{torch:cam.torch}]}).catch(()=>{});b.classList.toggle("on",cam.torch);return}
    if(k==="type"){const f=box.querySelector(".camtype");f.hidden=!f.hidden;if(!f.hidden)f.querySelector("input").focus();return}
    if(k==="ok"){const i=box.querySelector(".camtype input"),v=i.value.trim();i.value="";if(v)got(v,true)}});
  box.querySelector(".camtype input").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();box.querySelector('[data-cam="ok"]').click()}});
  const video=box.querySelector("video"),canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
  let dec;try{dec=await App.makeDecoder()}catch(e){App.scanStop();App.toast(e.message);return}
  async function start(){
    if(cam.stream)cam.stream.getTracks().forEach(t=>t.stop());
    let st;try{st=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:cam.facing},width:{ideal:1280},height:{ideal:720}}})}
    catch(e){App.scanStop();App.toast(e.name==="NotAllowedError"?"Нет доступа к камере — разрешите его в настройках браузера":"Камера не запустилась: "+(e.message||e.name));return}
    if(!cam){st.getTracks().forEach(t=>t.stop());return}
    cam.stream=st;video.srcObject=st;await video.play().catch(()=>{});
    const t=cam.stream.getVideoTracks()[0],caps=t.getCapabilities?t.getCapabilities():{};box.querySelector('[data-cam="torch"]').hidden=!caps.torch}
  function got(code,manual){
    const now=Date.now();if(!manual&&code===cam.last&&now-cam.lastAt<2500)return;cam.last=code;cam.lastAt=now;
    if(navigator.vibrate)navigator.vibrate(60);beep();
    const more=opts.onCode?opts.onCode(code):false;
    const l=box.querySelector(".camlast");l.hidden=false;l.textContent="✓ "+code;
    if(!more)App.scanStop()}
  async function tick(){if(!cam)return;
    if(!cam.busy&&video.readyState>=2&&video.videoWidth){cam.busy=true;
      try{let code;
        if(dec.kind==="native")code=await dec.decode(video);
        else{/* центральная полоса кадра — быстрее и точнее для линейных кодов */
          const vw=video.videoWidth,vh=video.videoHeight,w=Math.min(vw,960),h=Math.round(w*vh/vw);canvas.width=w;canvas.height=h;ctx.drawImage(video,0,0,w,h);code=await dec.decode(canvas)}
        if(code&&cam)got(String(code).trim())}catch(e){}
      if(cam)cam.busy=false}
    if(cam)cam.timer=setTimeout(tick,dec.kind==="native"?120:200)}
  await start();if(cam)tick();
};
App.scanStop=()=>{if(!cam)return;clearTimeout(cam.timer);if(cam.stream)cam.stream.getTracks().forEach(t=>t.stop());try{cam.audio&&cam.audio.close()}catch(e){}cam.box.remove();cam=null};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&cam){e.stopImmediatePropagation();App.scanStop()}},true);

/* универсальная кнопка «Скан»: в поле на экране, а если поля нет — поиск по базе */
ACT.camScan=()=>{const el=target();
  if(el){const multi=el.matches(".uscan,[data-rscan],[data-uscan],#rcvQ,#dpCode");const key=desc(el);
    return App.scan({title:multi?"Сканируйте подряд — каждый код добавится":"Наведите на штрихкод или IMEI",onCode:code=>{
      const cur=(key&&(($("#scrim").hidden?$("#view"):$("#modal")).querySelector(key)))||target();if(!cur){App.lookupCode(code);return false}
      feed(cur,code);return multi}})}
  App.scan({onCode:code=>{App.lookupCode(code);return false}})};

/* ---------- нижняя панель на телефоне ---------- */
const TABS=[["pos","Касса"],["repairs","Ремонт"],["__scan","Скан"],["tasks","Задачи"],["__more","Ещё"]];
const ICON=v=>{if(v==="__scan")return '<path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/>';
  if(v==="__more")return '<path d="M4 6h16M4 12h16M4 18h16"/>';const n=App.NAV.find(x=>x[0]===v);return n?n[2]:""};
function drawTabs(){let bar=document.getElementById("tabbar");const app=document.querySelector(".app");if(!app||app.hidden||!App.me.role){if(bar)bar.hidden=true;return}
  if(!bar){bar=document.createElement("nav");bar.id="tabbar";bar.className="tabbar";bar.setAttribute("aria-label","Быстрые разделы");app.appendChild(bar)}
  bar.hidden=false;const v=App.ui.view;
  const items=(App.wsTabs?App.wsTabs():TABS).filter(([k])=>k.startsWith("__")||App.navAllowed(k));
  const due=App.tasksDue?App.tasksDue():0,reps=S.repairs.filter(r=>App.ACTIVE&&App.ACTIVE.includes(r.status)).length;
  const html=items.map(([k,l])=>{const badge=k==="tasks"&&due?`<em>${due}</em>`:k==="repairs"&&reps?`<em>${reps}</em>`:"";
    if(k==="__scan")return `<button type="button" class="tb scan" data-act="camScan"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON(k)}</svg></span>${l}</button>`;
    if(k==="__more")return `<button type="button" class="tb" data-act="menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${ICON(k)}</svg>${l}</button>`;
    return `<a class="tb${v===k?" on":""}" href="#${k}"${v===k?' aria-current="page"':""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON(k)}</svg>${l}${badge}</a>`}).join("");
  if(bar.innerHTML!==html)bar.innerHTML=html}
const r0=App.render;App.render=function(){const out=r0.apply(this,arguments);drawTabs();return out};

/* ярлыки с иконки приложения: #scan открывает сканер после входа */
let scanOnStart=location.hash==="#scan";
if(scanOnStart)history.replaceState(null,"",location.pathname+location.search+"#dashboard");
const rt=App.route;App.route=function(){const out=rt.apply(this,arguments);if(scanOnStart&&App.me.role){scanOnStart=false;setTimeout(()=>ACT.camScan(),300)}return out};
})();
