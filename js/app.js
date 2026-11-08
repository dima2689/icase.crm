/* iCase CRM v3 · запуск */
"use strict";
(function(){
App.start().catch(e=>{console.error(e);App.showLogin();const el=document.getElementById("lgErr");if(el)el.textContent="Не удалось подключиться к базе: "+(e.message||e)});
})();
