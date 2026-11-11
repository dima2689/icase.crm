/* iCase CRM v3 · Печатные формы всех документов: единый шаблон A4 (шапка магазина, реквизиты, таблица, итоги, подписи)
   Возврат · гарантийный талон · документы склада · X/Z-отчёт · кассовые ордера · акт сверки долга · заказ с сайта ·
   карточка клиента · расчётный лист · прайс работ · остатки склада · любая таблица отчёта */
"use strict";
(function(){
const {S,esc,num,ACT}=App;
const rub=v=>(Math.round(num(v)*100)/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})+" ₽";
const qn=v=>num(v).toLocaleString("ru-RU");
const D=iso=>iso?App.dt(iso):"";
const CSS=`@page{size:A4;margin:12mm 12mm 14mm}*{box-sizing:border-box}body{margin:0;font:10pt/1.4 Arial,Helvetica,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hd{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:7px;margin-bottom:10px}.hd .sh{font:700 16pt Arial}.hd .rq{font-size:8pt;color:#555;max-width:360px}
.hd .r{text-align:right}.hd .r b{display:block;font-size:12.5pt}.hd .r span{font-size:9pt;color:#333}
.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 18px;margin:8px 0 10px}.meta div{display:flex;gap:6px;border-bottom:1px dotted #ccc;padding:2px 0}.meta span{color:#666;flex:0 0 auto}.meta b{font-weight:600}
table.t{width:100%;border-collapse:collapse;margin:6px 0}table.t th,table.t td{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}table.t th{background:#f0f0f0;font-size:8.5pt}
table.t .n{text-align:right;white-space:nowrap}table.t tr.f td{font-weight:700;background:#fafafa}table.t small{display:block;color:#666;font-size:8pt}
h3{font-size:10.5pt;margin:12px 0 4px}.note{font-size:8.8pt;margin:6px 0;color:#222}.words{margin:4px 0 8px;font-size:9.5pt}
.sg{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 40px;margin-top:26px}.sg div{border-top:1px solid #111;padding-top:3px;font-size:8.5pt;color:#444}
.tot{display:flex;justify-content:flex-end;gap:18px;font-size:11pt;margin:4px 0}.tot b{min-width:120px;text-align:right}
.cut{border-top:1px dashed #888;margin:16px 0}.big{font:700 14pt Arial;margin:4px 0}.muted{color:#666}
@media screen{body{background:#e5e5e5}.page{background:#fff;max-width:210mm;margin:8mm auto;padding:12mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}}`;
/* шапка магазина и документа */
function head(title,numTxt,date,pointId){const st=App.settings(),pt=pointId?App.byId("points",pointId):null;
  const rq=[st.legalName,st.inn?"ИНН "+st.inn:"",st.ogrnip?"ОГРНИП "+st.ogrnip:"",[st.city,pt&&pt.address||st.address].filter(Boolean).join(", "),pt&&pt.phone||st.phone].filter(Boolean).join(" · ");
  return `<div class="hd"><div><div class="sh">${esc(st.shopName||"iCase")}</div><div class="rq">${esc(rq)}</div></div><div class="r"><b>${esc(title)}</b><span>${numTxt?"№ "+esc(numTxt)+" ":""}${date?"от "+esc(date):""}</span></div></div>`}
const meta=rows=>`<div class="meta">${rows.filter(r=>r&&r[1]!==""&&r[1]!=null).map(([k,v])=>`<div><span>${esc(k)}:</span><b>${esc(v)}</b></div>`).join("")}</div>`;
/* таблица: cols=[[заголовок,"n"?]], rows=[[...ячейки (строки уже экранированы через cell)]] */
const cell=v=>v&&typeof v==="object"&&"html" in v?v.html:esc(v==null?"":v);
function table(cols,rows,foot){return `<table class="t"><thead><tr>${cols.map(([h,c])=>`<th class="${c||""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>
  ${rows.map(r=>`<tr>${r.map((v,i)=>`<td class="${(cols[i]||[])[1]||""}">${cell(v)}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${cols.length}" class="muted">Нет строк</td></tr>`}
  ${foot?`<tr class="f">${foot.map((v,i)=>`<td class="${(cols[i]||[])[1]||""}">${cell(v)}</td>`).join("")}</tr>`:""}</tbody></table>`}
const signs=list=>`<div class="sg">${list.map(s=>`<div>${esc(s)}</div>`).join("")}</div>`;
const page=(title,body)=>`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="page">${body}</div></body></html>`;
App.docPage=page;App.docHead=head;App.docTable=table;App.docMeta=meta;
const print=(title,body)=>App.printHtml(page(title,body));
const words=v=>App.rubWords?`<div class="words">Сумма прописью: ${esc(App.rubWords(Math.abs(num(v))))}</div>`:"";
const who=id=>App.nameOf(id)||"";

/* ---------- возврат ---------- */
ACT.printReturn=id=>{const r=App.byId("returns",id);if(!r)return;const s=App.byId("sales",r.saleId)||{},c=App.cust(r.customerId)||{};
  print("Возврат "+r.num,head("Акт возврата товара",r.num,D(r.createdAt),s.pointId)
    +meta([["Покупатель",[c.name,c.phone].filter(Boolean).join(", ")],["Продажа",s.num?s.num+" от "+D(s.createdAt):""],["Причина",r.reason||""],["Брак",r.defect?"да":"нет"],["Способ возврата денег",App.payLabel(r.method)],["Принял",who(r.by)]])
    +table([["№"],["Товар"],["Кол-во","n"],["Цена","n"]],(r.items||[]).map((i,k)=>[k+1,i.name,qn(i.qty),rub(i.price)]),["","Возвращено покупателю","",rub(r.amount)])
    +words(r.amount)+(r.note?`<p class="note">${esc(r.note)}</p>`:"")
    +`<p class="note">Покупатель вернул товар, продавец вернул деньги в сумме ${esc(rub(r.amount))}. Стороны претензий друг к другу не имеют.</p>`
    +signs(["Покупатель: подпись / ФИО","Продавец: подпись / "+who(r.by)]))};

/* ---------- гарантийный талон (на устройства с IMEI/серийным номером и всё с гарантией) ---------- */
ACT.printWarranty=id=>{const s=App.byId("sales",id);if(!s)return;const c=App.cust(s.customerId)||{},st=App.settings();
  const items=(s.items||[]).filter(i=>num(i.warranty)>0||i.serial);
  if(!items.length)return App.toast("В чеке нет товаров с гарантией");
  const till=m=>{const d=new Date(s.createdAt);d.setMonth(d.getMonth()+num(m));return App.dt(d.toISOString())};
  print("Гарантийный талон "+s.num,head("Гарантийный талон",s.num,D(s.createdAt),s.pointId)
    +meta([["Покупатель",[c.name,c.phone].filter(Boolean).join(", ")||"—"],["Продавец",who(s.by)],["Чек",s.num]])
    +table([["№"],["Товар"],["IMEI / серийный номер"],["Гарантия"],["Действует до"]],items.map((i,k)=>[k+1,{html:esc(i.name)+(i.condition?`<small>${esc(i.condition)}</small>`:"")},i.serial||"—",num(i.warranty)?num(i.warranty)+" мес.":"по закону",num(i.warranty)?till(i.warranty):"—"]))
    +`<h3>Условия гарантии</h3><p class="note">Гарантия действует при предъявлении этого талона или чека. Гарантийный ремонт выполняется в сервисе магазина. Гарантия не распространяется на механические повреждения, следы влаги и окисления, повреждения от неправильной зарядки, вскрытие или ремонт третьими лицами, а также на расходные материалы и аксессуары с естественным износом. Срок гарантийного ремонта — до 45 дней. Права потребителя по Закону «О защите прав потребителей» сохраняются.</p>
    ${st.receiptFooter?`<p class="note">${esc(st.receiptFooter)}</p>`:""}`
    +signs(["Товар получил, с условиями согласен: подпись покупателя","Продавец: подпись / "+who(s.by)+" · М.П."]))};

/* ---------- документы склада ---------- */
ACT.printStockDoc=id=>{const d=App.byId("docs",id);if(!d)return App.toast("Сохраните документ, чтобы распечатать");
  const T=App.DOCT[d.type]||{one:"Документ"},cost=App.can("cost"),sup=(App.byId("suppliers",d.supplierId)||{}).name||"";
  const title={in:"Приходная накладная",transfer:"Накладная на перемещение",writeoff:"Акт списания",inventory:"Инвентаризационная опись",supret:"Накладная на возврат поставщику"}[d.type]||T.one;
  const ser=l=>[...(l.newUnits||[]).map(u=>u.imei||u.serial_no),...(l.unitIds||[]).map(x=>{const u=App.byId("units",x);return u?App.unitCode(u):""}),...(l.foundCodes||[])].filter(Boolean);
  const nm=l=>{const c=ser(l);return {html:esc(l.name)+(c.length?`<small>${esc(c.join(", "))}</small>`:"")}};
  let tbl;
  if(d.type==="inventory"){let sp=0,sm=0;const rows=d.lines.map((l,k)=>{const f=l.counted===""?null:num(l.counted),df=f==null?0:f-num(l.expected),s=df*num(l.cost);if(s>0)sp+=s;else sm+=s;
      return [k+1,nm(l),qn(l.expected),f==null?"не посчитан":qn(f),df?(df>0?"+":"")+df:"0",...(cost?[rub(s)]:[])]});
    tbl=table([["№"],["Товар"],["По учёту","n"],["Факт","n"],["Разница","n"],...(cost?[["Сумма","n"]]:[])],rows)+(cost?`<div class="tot"><span>Излишки</span><b>${rub(sp)}</b></div><div class="tot"><span>Недостача</span><b>${rub(sm)}</b></div>`:"")}
  else{const sq=d.lines.reduce((a,l)=>a+num(l.qty),0),sc=d.lines.reduce((a,l)=>a+num(l.qty)*num(l.cost),0);
    tbl=table([["№"],["Товар"],["Кол-во","n"],...(cost?[[d.type==="in"?"Цена закупки":"Себестоимость","n"],["Сумма","n"]]:[])],d.lines.map((l,k)=>[k+1,nm(l),qn(l.qty),...(cost?[rub(l.cost),rub(num(l.qty)*num(l.cost))]:[])]),["","Итого",qn(sq),...(cost?["",rub(sc)]:[])])+(cost?words(sc):"")}
  const status=d.status==="posted"?"проведён "+D(d.postedAt):d.status==="cancelled"?"отменён":"черновик";
  print(title+" "+d.num,head(title,d.num,D(d.createdAt),(App.byId("warehouses",d.whTo||d.whFrom)||{}).pointId)
    +meta([["Откуда",d.whFrom?App.whName(d.whFrom):""],["Куда",d.whTo?App.whName(d.whTo):""],["Поставщик",sup],["Накладная поставщика",d.invoice],["Причина",d.reason],["Статус",status],["Составил",who(d.by)],["Комментарий",d.note]])
    +tbl+signs(d.type==="transfer"?["Сдал: подпись / ФИО","Принял: подпись / ФИО"]:d.type==="inventory"?["Материально ответственное лицо","Проверил"]:d.type==="writeoff"?["Составил: подпись / ФИО","Утвердил: подпись / ФИО"]:["Сдал (поставщик)","Принял: подпись / ФИО"]))};

/* ---------- X/Z-отчёт смены ---------- */
ACT.printShift=id=>{const sh=id?App.byId("shifts",id):App.openShift();if(!sh)return;const t=App.shiftTotals(sh),pt=App.byId("points",sh.pointId)||{};
  const z=sh.status==="closed";
  print((z?"Z-отчёт ":"X-отчёт ")+sh.num,head(z?"Z-отчёт · закрытие смены":"X-отчёт · без закрытия смены",sh.num,D(sh.openedAt),sh.pointId)
    +meta([["Точка",pt.name||""],["Открыта",App.dtt(sh.openedAt)+" · "+who(sh.openedBy)],["Закрыта",z?App.dtt(sh.closedAt)+" · "+who(sh.closedBy):"смена открыта"],["Чеков продажи",t.count]])
    +table([["Показатель"],["Сумма","n"]],[["Продажи",rub(t.sales)],["Возвраты",rub(-t.refunds)],["Ремонт (оплаты и предоплаты)",rub(t.repairs)],...Object.entries(App.PAY).map(([m,l])=>["  в т.ч. "+l,rub(t.byMethod[m]||0)])])
    +`<h3>Наличные</h3>`+table([["Показатель"],["Сумма","n"]],[["На начало смены",rub(sh.openCash)],["Внесения",rub(t.cashin)],["Изъятия",rub(-t.cashout)],["Должно быть в кассе",rub(t.expectedCash)],
      ...(z?[["Пересчитано",rub(sh.countedCash)],["Расхождение",rub(sh.diff)]]:[])])
    +(sh.closeNote?`<p class="note">Комментарий: ${esc(sh.closeNote)}</p>`:"")+signs(["Кассир: подпись / ФИО","Проверил: подпись / ФИО"]))};

/* ---------- приходный / расходный кассовый ордер по операции финансов ---------- */
ACT.printFinOp=id=>{const o=S.finops.find(x=>x.id===id);if(!o)return;const acc=S.finaccounts.find(a=>a.id===o.accountId)||{},to=S.finaccounts.find(a=>a.id===o.toAccountId)||{},cat=S.fincats.find(c=>c.id===o.catId)||{};
  const title=o.kind==="in"?"Приходный ордер":o.kind==="out"?"Расходный ордер":"Внутреннее перемещение денег";
  const one=()=>head(title,o.num,D(o.date))
    +meta([[o.kind==="in"?"Принято от":"Выдано",o.payee?who(o.payee):o.counterparty||""],["Основание",cat.name||(o.debtId?"Оплата долга":"")],[o.kind==="transfer"?"Откуда":"Счёт",acc.name||""],["Куда",o.kind==="transfer"?to.name||"":""],["Комментарий",o.note],["Оформил",who(o.by)]])
    +`<div class="big">Сумма: ${esc(rub(o.amount))}</div>`+words(o.amount)+(o.cancelledAt?`<p class="note"><b>Операция отменена ${esc(App.dtt(o.cancelledAt))}</b></p>`:"")
    +signs(o.kind==="out"?["Выдал: подпись / ФИО","Получил: подпись / ФИО"]:o.kind==="in"?["Принял: подпись / ФИО","Сдал: подпись / ФИО"]:["Сдал","Принял"]);
  print(title+" "+o.num,one()+`<div class="cut"></div>`+one())};

/* ---------- акт сверки по долгу ---------- */
ACT.printDebt=id=>{const d=S.debts.find(x=>x.id===id);if(!d)return;const ops=S.finops.filter(o=>o.debtId===id&&!o.cancelledAt).sort((a,b)=>String(a.date).localeCompare(b.date));
  const left=App.debtLeft(d),inc=d.direction==="in";
  let bal=num(d.amount);const rows=[[D(d.createdAt),"Долг "+(d.note?"· "+d.note:""),rub(d.amount),"",rub(bal)]];
  ops.forEach(o=>{bal-=num(o.amount);rows.push([D(o.date),"Оплата "+o.num+(o.note?" · "+o.note:""),"",rub(o.amount),rub(bal)])});
  print("Акт сверки "+d.num,head("Акт сверки взаиморасчётов",d.num,App.dt(new Date().toISOString()))
    +meta([["Контрагент",d.counterparty],["Кто должен",inc?"контрагент — нам":"мы — контрагенту"],["Срок оплаты",d.dueDate?D(d.dueDate):"не указан"],["Статус",d.status==="closed"?"погашен":d.status==="cancelled"?"отменён":"не погашен"]])
    +table([["Дата"],["Операция"],["Начислено","n"],["Оплачено","n"],["Остаток","n"]],rows,["","Итого",rub(d.amount),rub(num(d.amount)-left),rub(left)])
    +`<p class="note">По состоянию на ${esc(App.dt(new Date().toISOString()))} задолженность ${inc?esc(d.counterparty)+" перед "+esc(App.settings().shopName||"нами"):esc(App.settings().shopName||"нашей")+" перед "+esc(d.counterparty)} составляет <b>${esc(rub(left))}</b>.</p>`+words(left)
    +signs(["От "+(App.settings().shopName||"магазина")+": подпись / ФИО","От контрагента: подпись / ФИО"]))};

/* ---------- заказ с сайта: бланк сборки и выдачи ---------- */
ACT.printSO=id=>{const o=S.siteorders.find(x=>x.id===id);if(!o)return;
  print("Заказ "+o.num,head("Заказ с сайта",o.num,D(o.createdAt))
    +meta([["Покупатель",o.name],["Телефон",o.phone],["Email",o.email],["Доставка",o.delivery],["Адрес",o.address],["Оплата",(o.payment||"")+(o.paid?" · оплачен":" · не оплачен")],["Комментарий",o.note]])
    +table([["№"],["Товар"],["Артикул"],["Откуда взять"],["Кол-во","n"],["Цена","n"],["Сумма","n"]],(o.items||[]).map((i,k)=>[k+1,i.name,i.sku,(i.from||[]).map(f=>f.unit?(()=>{const u=App.byId("units",f.unit);return u?App.unitCode(u):""})():App.whName(f.wh)+(f.qty>1?" ×"+f.qty:"")).filter(Boolean).join(", ")||"—",qn(i.qty),rub(i.price),rub(num(i.qty)*num(i.price))]),["","Итого","","","","",rub(o.total)])
    +words(o.total)+signs(["Собрал: подпись / ФИО","Заказ получил, претензий нет: подпись покупателя"]))};

/* ---------- карточка клиента: история покупок и ремонтов ---------- */
ACT.printClient=id=>{const c=App.cust(id);if(!c)return;const sales=App.sortDesc(S.sales.filter(s=>s.customerId===id)),reps=App.sortDesc(S.repairs.filter(r=>r.customerId===id));
  const sum=sales.reduce((a,s)=>a+num(s.total),0);
  print("Клиент "+c.name,head("Карточка клиента","",App.dt(new Date().toISOString()))
    +meta([["Клиент",c.name],["Телефон",c.phone],["Email",c.email],["Скидка",num(c.discount)?num(c.discount)+"%":""],["Покупок",sales.length+" на "+rub(sum)],["Ремонтов",reps.length]])
    +`<h3>Покупки</h3>`+table([["Дата"],["Чек"],["Товары"],["Сумма","n"]],sales.map(s=>[D(s.createdAt),s.num,(s.items||[]).map(i=>i.name+(i.qty>1?" ×"+i.qty:"")).join(", "),rub(s.total)]),["","","Итого",rub(sum)])
    +(reps.length?`<h3>Ремонты</h3>`+table([["Дата"],["Квитанция"],["Устройство"],["Статус"],["Сумма","n"]],reps.map(r=>[D(r.createdAt),r.num,r.device,(App.RS[r.status]||{}).label||r.status,rub(App.repairTotal(r))])):""))};

/* ---------- расчётный лист ---------- */
ACT.printPayslip=id=>{const s=App.byId("staff",id);if(!s||!App.payCalc)return;const m=App.ui.payM,c=App.payCalc(s,m),r=c.r;
  const pays=S.finops.filter(o=>!o.cancelledAt&&o.kind==="out"&&o.payee===id&&String(o.date).slice(0,7)===m);
  print("Расчётный лист "+s.fullName,head("Расчётный лист","",m.split("-").reverse().join("."))
    +meta([["Сотрудник",s.fullName],["Месяц",m.split("-").reverse().join(".")],["Смен",c.shifts],["Продаж",c.nSales+" на "+rub(c.rev)],["Выданных ремонтов",c.nRep+(c.nRep?", работы "+rub(c.works):"")]])
    +table([["Начисление"],["Расчёт"],["Сумма","n"]],[["Оклад","за месяц",rub(c.parts.base)],["За смены",c.shifts+" × "+rub(r.perShift),rub(c.parts.shifts)],["% от продаж",num(r.pctSales)+"% от "+rub(c.rev),rub(c.parts.sales)],
      ["% от прибыли",num(r.pctProfit)+"% от "+rub(Math.max(0,c.profit)),rub(c.parts.profit)],["% от работ",num(r.pctWorks)+"% от "+rub(c.works),rub(c.parts.works)]].filter(x=>x[2]!==rub(0)),["Начислено","",rub(c.total)])
    +(pays.length?`<h3>Выплаты</h3>`+table([["Дата"],["Документ"],["Сумма","n"]],pays.map(o=>[D(o.date),o.num,rub(o.amount)]),["","Выплачено",rub(c.paid)]):"")
    +`<div class="tot"><span>${c.left>=0?"К выплате":"Переплата"}</span><b>${rub(Math.abs(c.left))}</b></div>`+signs(["Ознакомлен: подпись сотрудника","Руководитель: подпись"]))};

/* ---------- прайс работ ---------- */
ACT.printServices=()=>{const list=S.services.filter(s=>s.active!==false).sort((a,b)=>String(a.group||a.grp||"").localeCompare(String(b.group||b.grp||""))||String(a.name).localeCompare(b.name));
  const groups={};list.forEach(s=>{const g=s.group||s.grp||"Услуги";(groups[g]=groups[g]||[]).push(s)});
  print("Прайс работ",head("Прайс-лист на работы и услуги","",App.dt(new Date().toISOString()))
    +Object.entries(groups).map(([g,l])=>`<h3>${esc(g)}</h3>`+table([["Работа"],["Цена","n"]],l.map(s=>[s.name,num(s.price)?"от "+rub(s.price):"бесплатно"]))).join("")
    +`<p class="note">Окончательная стоимость определяется после диагностики и согласовывается с клиентом. Цены указаны без стоимости запчастей, если не оговорено иное.</p>`)};

/* ---------- остатки склада ---------- */
ACT.printWh=id=>{const w=App.byId("warehouses",id);if(!w)return;const cost=App.can("cost");
  const ps=S.products.filter(p=>App.qtyIn(p,id)>0).sort((a,b)=>App.catName(a).localeCompare(App.catName(b))||String(a.name).localeCompare(b.name));
  const sq=ps.reduce((a,p)=>a+App.qtyIn(p,id),0),sc=ps.reduce((a,p)=>a+App.qtyIn(p,id)*num(p.cost),0),sp=ps.reduce((a,p)=>a+App.qtyIn(p,id)*num(p.price),0);
  print("Остатки "+w.name,head("Остатки на складе","",App.dtt(new Date().toISOString()))+meta([["Склад",w.name],["Позиций",ps.length],["Штук",sq]])
    +table([["№"],["Товар"],["Категория"],["Артикул"],["Кол-во","n"],...(cost?[["Закупка","n"]]:[]),["Цена","n"],["Факт","n"]],
      ps.map((p,k)=>{const units=p.trackSerial&&App.unitsOf?App.unitsOf(p.id,{wh:id}).map(App.unitCode):[];return [k+1,{html:esc(p.name)+(units.length?`<small>${esc(units.join(", "))}</small>`:"")},App.catName(p),p.sku||p.barcode||"",qn(App.qtyIn(p,id)),...(cost?[rub(p.cost)]:[]),rub(p.price),""]}),
      ["","Итого","","",qn(sq),...(cost?[rub(sc)]:[]),rub(sp),""])+signs(["Остатки проверил: подпись / ФИО","Дата проверки"]))};

/* ---------- любая таблица на экране (отчёты, аналитика, списки) ---------- */
App.printTable=function(title,tableEl,extra){if(!tableEl)return App.toast("Нет таблицы для печати");
  const t=tableEl.cloneNode(true);t.className="t";t.querySelectorAll("button,input,select").forEach(e=>{const s=document.createElement("span");s.textContent=e.value!=null&&e.tagName!=="BUTTON"?e.value:e.textContent;e.replaceWith(s)});
  print(title,head(title,"",App.dtt(new Date().toISOString()))+(extra||"")+t.outerHTML)};
/* svg с цветами из темы: переменные CSS во фрейме печати не действуют — переносим вычисленные цвета */
function svgInline(sv){const c=sv.cloneNode(true),src=[sv,...sv.querySelectorAll("*")],dst=[c,...c.querySelectorAll("*")];
  src.forEach((e,i)=>{const cs=getComputedStyle(e),d=dst[i];["fill","stroke","stroke-width","opacity","font-size","font-weight","stroke-dasharray"].forEach(k=>{const v=cs.getPropertyValue(k);if(v)d.style.setProperty(k,v)})});
  c.setAttribute("width","100%");c.style.maxHeight="90mm";return c.outerHTML}
/* печать текущего экрана раздела: все таблицы и плитки */
ACT.printView=()=>{const v=document.getElementById("view");if(!v)return;const title=App.TITLES[App.ui.view]||"Отчёт";
  const tiles=[...v.querySelectorAll(".tile")].slice(0,12).map(t=>{const a=t.querySelector("span"),b=t.querySelector("b");return a&&b?[a.textContent.trim(),b.textContent.trim()]:null}).filter(Boolean);
  const tabs=[...v.querySelectorAll(".tab.on,.chip.on,.seg .on")].map(e=>e.textContent.trim()).filter(Boolean).join(" · ");
  const tbls=[...v.querySelectorAll("table")].map(t=>{const c=t.cloneNode(true);c.className="t";c.querySelectorAll("button,input,select").forEach(e=>{const s=document.createElement("span");s.textContent=e.tagName==="BUTTON"?e.textContent:e.value;e.replaceWith(s)});
    const h=t.closest("section")&&t.closest("section").querySelector("h2");return (h?`<h3>${esc(h.textContent.trim())}</h3>`:"")+c.outerHTML}).join("");
  const svgs=tbls?"":[...v.querySelectorAll("section.card")].slice(0,8).map(s=>{const h=s.querySelector("h2");const sv=s.querySelector("svg");return (h?`<h3>${esc(h.textContent.trim())}</h3>`:"")+(sv?svgInline(sv):`<div class="note" style="white-space:pre-line">${esc((h?s.innerText.replace(h.innerText,""):s.innerText).replace(/\n{2,}/g,"\n").trim().slice(0,1500))}</div>`)}).join("");
  print(title,head(title,"",App.dtt(new Date().toISOString()))+(tabs?meta([["Раздел",tabs]]):"")+(tiles.length?meta(tiles):"")+(tbls||svgs||'<p class="muted">Нет данных для печати</p>'))};
})();
