/* iCase CRM v3 · проверка заполнения форм: обязательные поля, телефоны, email, IMEI, суммы, даты.
   Правила привязаны к кнопке сохранения (data-act). Перед её действием поля проверяются; ошибки показываются
   под полем, курсор встаёт в первое неверное поле, действие не выполняется. Скрытые поля не проверяются. */
"use strict";
(function(){
const {esc}=App;
const digits=v=>String(v||"").replace(/\D/g,"");
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const num=v=>Number(String(v).replace(",",".").replace(/\s/g,""));

/* проверки: возвращают текст ошибки или "" (пустое значение проверяет только req) */
const T={
  phone:v=>{const d=digits(v);return (d.length===10||(d.length===11&&/^[78]/.test(d)))?"":"Телефон: 10 цифр, например +7 900 123-45-67"},
  email:v=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)?"":"Email в виде name@example.ru",
  imei:v=>{const d=v.replace(/\s/g,"");if(!/^\d{15}$/.test(d))return "IMEI — 15 цифр";return App.luhnOk&&!App.luhnOk(d)?"IMEI с ошибкой: не сходится контрольная цифра":""},
  imeiSn:v=>{const d=v.replace(/\s/g,"");if(/^\d+$/.test(d))return T.imei(d);return /^[A-Za-z0-9]{8,14}$/.test(d)?"":"Серийный номер: 8–14 латинских букв и цифр"},
  money:v=>{const n=num(v);return !isFinite(n)?"Введите число":n<0?"Не может быть меньше нуля":n>1e8?"Слишком большая сумма":""},
  pos:v=>{const n=num(v);return !isFinite(n)?"Введите число":n<=0?"Должно быть больше нуля":n>1e8?"Слишком большая сумма":""},
  signed:v=>{const n=num(v);return !isFinite(n)?"Введите число":Math.abs(n)>1e8?"Слишком большая сумма":""},
  int:v=>{const n=num(v);return !Number.isInteger(n)?"Целое число":n<0?"Не может быть меньше нуля":n>100000?"Слишком большое число":""},
  posint:v=>{const n=num(v);return !Number.isInteger(n)||n<1?"Целое число от 1":n>100000?"Слишком большое число":""},
  nonzero:v=>{const n=num(v);return !Number.isInteger(n)||n===0?"Целое число, не ноль (минус — списать)":""},
  pct:v=>{const n=num(v);return !isFinite(n)||n<0||n>100?"От 0 до 100 %":""},
  batt:v=>/^\d{1,3}$/.test(v)&&+v<=100?"":"Ёмкость АКБ — целое число от 0 до 100",
  date:v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(new Date(v))?"":"Неверная дата",
  future:v=>T.date(v)||(v<today()?"Дата уже прошла":""),
  past:v=>T.date(v)||(v>today()?"Дата ещё не наступила":v<"1900-01-01"?"Проверьте год":""),
  year:v=>{const n=num(v);return Number.isInteger(n)&&n>=2000&&n<=new Date().getFullYear()+2?"":"Год от 2000 до "+(new Date().getFullYear()+2)},
  name2:v=>v.trim().split(/\s+/).length>=2?"":"Фамилия и имя полностью — нужно для договора",
  passport:v=>digits(v).length===10?"":"Серия и номер паспорта: 10 цифр, например 4510 123456",
  inn:v=>[10,12].includes(digits(v).length)&&digits(v)===v.replace(/\s/g,"")?"":"ИНН: 10 или 12 цифр",
  pass8:v=>v.length>=8?"":"Пароль — не меньше 8 символов",
};
const LEN={text:200,textarea:2000,tel:20,email:120};

/* правила форм: кнопка → поле → "req тип" */
const R=App.FORM_RULES={
  saveRepair:{rPhone:"req phone",rImei:"imeiSn",rDevice:"req",rProblem:"req",rEst:"money",rDue:"future",rPre:"money"},
  pzSave:{pzPhone:"req phone",pzPrice:"req pos",pzDue:"future",pzDep:"money"},
  taskSave:{tkT:"req",tkD:"future",tkPh:"phone"},
  lostSave:{lReq:"req",lQty:"posint"},
  dealSave:{dlPhone:"req phone",dlName:"req name2",dlDoc:"req passport",dlIssD:"past",dlBirth:"past",dlDev:"req",dlCode:"req imeiSn",dlBatt:"batt",dlAmt:"req pos",dlPrice:"money",dlTerm:"posint"},
  debtCreate:{dnCp:"req",dnAmt:"req pos",dnDue:"date"},
  finOpSave:{foAmt:"req pos",foDate:"req date",foAcc:"req",foTo:"req"},
  accSave:{acName:"req",acOpen:"signed"},
  fcatSave:{ctName:"req"},
  catSave:{kName:"req"},
  pointSave:{ptName:"req",ptPhone:"phone"},
  whSave:{wName:"req",wOrder:"int"},
  svcSave:{vName:"req",vPrice:"req money"},
  supSave:{uName:"req",uInn:"inn",uPhone:"phone"},
  rcvSupSave:{nsName:"req",nsPhone:"phone"},
  rcvNewItemSave:{niName:"req",niCost:"money",niPrice:"money",niQty:"posint"},
  saveClient:{cName:"req",cPhone:"phone",cPhone2:"phone",cEmail:"email",cBirth:"past",cDisc:"pct"},
  waitSave:{wPhone:"req phone",wReq:"req",wQty:"posint",wMax:"money"},
  cashMoveOk:{cmSum:"req pos",cmNote:"req"},
  openShiftOk:{shCash:"req money"},
  closeShiftOk:{csCash:"req money"},
  modelSave:{mName:"req",mYear:"year",mSort:"int"},
  cpCreate:{cpPrice:"money",cpWarr:"int"},
  pcAdd:{pcName:"req",pcPrice:"req money",pcQty:"posint",pcCost:"money",pcWar:"int"},
  staffCreate:{snName:"req",snEmail:"req email",snPhone:"phone",snPass:"req pass8"},
  planSave:{plName:"req",plAmt:"req pos",plDate:"req date",plAcc:"req"},
  rqSave:{rqQty:"posint"},
  repPayOk:{rpAmt:"req pos"},
  pzPayGo:{ppAmt:"req pos"},
  repCancelOk:{rcWhy:"req",rcFee:"money"},
  repIssueOk:{riFinal:"req money"},
  returnOk:{rAmount:"money"},
  saveProduct:{pName:"req",pSerial:"imeiSn",pCost:"money",pPrice:"money",pQty:"int",pWarr:"int",pMin:"int",pBatt:"batt"},
  saveUnit:{uImei:"imei",uImei2:"imei",uSn:"imeiSn",uBatt:"batt",uPrice:"money"},
  poSave:{poSup:"req",poDate:"date"},
  bonusAdj:{baAmt:"req nonzero",baNote:"req"},
  profSave:{prName:"req",prPhone:"phone"},
  profPass:{prOld:"req",prNew:"req pass8",prNew2:"req"},
  profEmail:{prEmail:"req email"},
  saveSettings:{sName:"req",sPhone:"phone",sInn:"inn",sWarr:"int",sRw:"int",sStore:"int",sDead:"int"},
  posPay:{posPhone:"phone"},
  prodReqGo:{prdNote:"req"},
};

function holder(el){return el.closest(".fld")||el.parentElement}
function setErr(el,msg){const h=holder(el);let m=h.querySelector(":scope > .ferr");
  el.classList.toggle("inv",!!msg);el.setAttribute("aria-invalid",msg?"true":"false");
  if(!msg){if(m)m.remove();return}
  if(!m){m=document.createElement("small");m.className="ferr";m.id=(el.id||"f")+"_err";h.appendChild(m);el.setAttribute("aria-describedby",m.id)}
  m.textContent=msg}
function visible(el){return !!(el&&el.offsetParent)&&!el.disabled}
function check(el,spec){
  const v=el.type==="checkbox"?(el.checked?"1":""):String(el.value||"").trim();
  const parts=spec.split(/\s+/),req=parts.includes("req");
  if(!v)return req?(el.tagName==="SELECT"?"Выберите значение":"Заполните поле"):"";
  for(const p of parts){if(p==="req")continue;const f=T[p];const e=f&&f(v);if(e)return e}
  const max=+el.getAttribute("maxlength")||0;if(max&&v.length>max)return "Не больше "+max+" символов";
  return ""}
/* проверить форму кнопки act; вернуть true, если всё верно */
App.validateFor=act=>{const rules=R[act];if(!rules)return true;let first=null,n=0;
  for(const [id,spec] of Object.entries(rules)){const el=document.getElementById(id);if(!visible(el))continue;
    const e=check(el,spec);setErr(el,e);if(e){n++;if(!first)first=el}}
  if(first){first.focus();try{first.scrollIntoView({block:"center",behavior:"smooth"})}catch(e){}
    App.toast(n>1?"Проверьте выделенные поля: "+n:"Проверьте поле: "+((holder(first).querySelector("label")||{}).textContent||"").replace(/\s*\*$/,""));return false}
  return true};

/* разметка: звёздочка у обязательных, ограничения ввода, подсказки клавиатуры на телефоне */
function decorate(root){
  const acts=new Set([...root.querySelectorAll("[data-act]")].map(b=>b.dataset.act));
  for(const a of acts){const rules=R[a];if(!rules)continue;
    for(const [id,spec] of Object.entries(rules)){const el=document.getElementById(id);if(!el||el.dataset.vdone)continue;el.dataset.vdone="1";el.dataset.vrule=spec;
      const ps=spec.split(/\s+/);
      if(ps.includes("req")){const l=document.querySelector('label[for="'+id+'"]');if(l&&!l.querySelector(".reqm"))l.insertAdjacentHTML("beforeend",' <span class="reqm" aria-hidden="true">*</span>');el.setAttribute("aria-required","true")}
      if(ps.includes("phone")){el.setAttribute("inputmode","tel");el.setAttribute("autocomplete","tel")}
      if(ps.includes("email")){el.setAttribute("inputmode","email");el.setAttribute("autocomplete","email")}
      if(ps.some(p=>["imei","passport","inn"].includes(p)))el.setAttribute("inputmode","numeric");
      if(ps.some(p=>["money","pos","int","posint","pct","batt"].includes(p))){if(!el.hasAttribute("min"))el.setAttribute("min",ps.includes("posint")?"1":"0")}
      if(ps.includes("pct")||ps.includes("batt"))el.setAttribute("max","100");
      if(ps.some(p=>["int","posint","batt","nonzero"].includes(p))){el.setAttribute("step","1");el.setAttribute("inputmode","numeric")}
    }}
  root.querySelectorAll("input,textarea").forEach(el=>{if(el.hasAttribute("maxlength"))return;const m=LEN[el.tagName==="TEXTAREA"?"textarea":el.type];if(m)el.setAttribute("maxlength",m)});
}
let rq=0;const mo=new MutationObserver(()=>{if(rq)return;rq=requestAnimationFrame(()=>{rq=0;const m=document.getElementById("modal"),v=document.getElementById("view");if(m)decorate(m);if(v)decorate(v)})});
document.addEventListener("DOMContentLoaded",()=>{["modal","view"].forEach(id=>{const el=document.getElementById(id);if(el)mo.observe(el,{childList:true,subtree:true})})});
/* при вводе ошибка поля снимается, при уходе из поля — проверяется заново */
document.addEventListener("input",e=>{const t=e.target;if(t&&t.classList&&t.classList.contains("inv"))setErr(t,"")},true);
document.addEventListener("focusout",e=>{const t=e.target;if(!t||!t.dataset||!t.dataset.vrule)return;const v=String(t.value||"").trim();
  if(!v&&!t.classList.contains("inv"))return;setErr(t,check(t,t.dataset.vrule))},true);
})();
