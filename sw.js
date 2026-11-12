/* iCase CRM · service worker: оболочка приложения открывается без сети; данные базы не кэшируются */
const VER="icase-v13";
const SHELL=["./", "index.html", "styles.css", "manifest.webmanifest", "manifest-pos.webmanifest", "manifest-service.webmanifest", "icons/pos-192.png", "icons/service-192.png", "icons/icon-192.png", "icons/apple-touch-icon.png", "js/vendor/supabase.js", "js/config.js", "js/core.js", "js/db.js", "js/ui.js", "js/serial.js", "js/vendor/qrcode.js", "js/vendor/jsbarcode.min.js", "js/vendor/zxing.min.js", "js/print.js", "js/pos.js", "js/stock.js", "js/receive.js", "js/clients.js", "js/reports.js", "js/settings.js", "js/site.js", "js/suppliers.js", "js/printui.js", "js/finance.js", "js/finlinks.js", "js/analytics.js", "js/repairs.js", "js/purchase.js", "js/payroll.js", "js/docs.js", "js/links.js", "js/stage4.js", "js/evotor.js", "js/imei.js", "js/approval.js", "js/preorder.js", "js/repair2.js", "js/workspace.js", "js/mobile.js", "js/app.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VER).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VER).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);
  /* шрифты — из кэша */
  if(u.host==="fonts.googleapis.com"||u.host==="fonts.gstatic.com"){e.respondWith(caches.open(VER).then(c=>c.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==="opaque")c.put(r,res.clone());return res}))));return}
  if(u.origin!==self.location.origin)return; /* Supabase и прочее — только сеть */
  /* свои файлы: сначала сеть (всегда свежая версия), без сети — кэш */
  e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(VER).then(c=>c.put(r,cp))}return res})
    .catch(()=>caches.match(r,{ignoreSearch:true}).then(hit=>hit||(r.mode==="navigate"?caches.match("index.html"):Response.error()))));
});
