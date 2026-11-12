/* iCase CRM · перенос данных из МоегоСклада (JSON API): склады, группы, товары и модификации, остатки, контрагенты.
   В МоёмСкладе ничего не меняется. Токен вводится здесь, уходит только в нашу функцию moysklad и нигде не хранится. */
(()=>{
"use strict";
const {S,$,esc,ACT}=App;
const NOTE="Перенос из МойСклад";
let MS=null;            // результат проверки токена
let SESS=null;          // что уже перенесено в этом окне — повторный запуск после сбоя ничего не задвоит
const fresh0=()=>({wh:{},cats:null,prod:{},whDone:new Set(),phones:null,emails:new Set(),sups:null});
const tok=()=>($("#msTok")?.value||"").trim();
const call=(body)=>App.api.invoke("moysklad",Object.assign({token:MS?.token||tok()},body));
const testDb=()=>!!(window.ICASE_CONFIG&&window.ICASE_CONFIG.testDb);

ACT.msDlg=()=>{
  if(!App.can("io"))return App.toast("Перенос доступен владельцу и управляющему");
  MS=null;SESS=fresh0();
  App.openModal(App.head("Перенос из МоегоСклада")+`
  <p class="muted">Заберём склады, группы, товары с модификациями и ценами, остатки и контрагентов. В МоёмСкладе ничего не изменится. Можно запускать повторно — существующие товары (по артикулу или штрихкоду) обновятся, а не задвоятся.</p>
  <div class="form">${App.fld("msTok","Токен МоегоСклада",App.inp("msTok","","password","токен доступа к JSON API",'autocomplete="off"'))}</div>
  <p class="muted sm">Токен создаёт администратор МоегоСклада в настройках аккаунта, раздел с токенами доступа. Не пересылайте его в мессенджерах — вставьте только сюда; после переноса токен можно удалить в МоёмСкладе.</p>
  <div class="acts"><button class="btn pri" data-act="msCheck">Проверить</button></div>
  <div id="msStep"></div>`,{wide:true});
};

ACT.msCheck=async(_,btn)=>{
  if(!tok())return App.toast("Вставьте токен");
  btn.disabled=true;btn.textContent="Проверяем…";
  try{const r=await App.api.invoke("moysklad",{token:tok(),action:"check"});MS=Object.assign(r,{token:tok()});step2()}
  catch(e){App.toast(e.message)}
  finally{btn.disabled=false;btn.textContent="Проверить"}
};

function step2(){
  const c=MS.counts,whs=App.whs();
  const again=S.docs.some(d=>String(d.note||"").startsWith(NOTE)&&d.status==="posted");
  const pts=MS.priceTypes.length?MS.priceTypes:["Цена продажи"];
  const whOpt=s=>{const same=whs.find(w=>w.name.toLowerCase()===s.name.toLowerCase());
    return App.sel("msWh_"+s.id,[["new","Создать склад «"+s.name+"»"],["skip","Не переносить"],...whs.map(w=>[w.id,"→ "+w.name])],same?same.id:(s.archived?"skip":"new"))};
  $("#msStep").innerHTML=`
  <h3 class="sub-h">Аккаунт${MS.user?" · "+esc(MS.user):""}</h3>
  <div class="tiles">${[["Склады",c.store],["Группы",c.folder],["Товары",c.product],["Модификации",c.variant],["Контрагенты",c.counterparty]].map(([l,n])=>`<div class="tile"><span>${l}</span><b>${n}</b></div>`).join("")}</div>
  <h3 class="sub-h">Что переносить</h3>
  <div class="form">
    ${App.chk("msGoods","Группы, товары и модификации",true)}
    ${App.chk("msStock",again?"<span>Остатки — <b>уже переносились</b>, второй раз удвоят количество</span>":"<span>Остатки (документом прихода на каждый склад)</span>",!again)}
    ${App.chk("msParties",testDb()?"<span>Контрагенты — <b>не на тестовой базе</b>: клиентов (персональные данные) переносим только на сервер в РФ</span>":"<span>Контрагенты → клиенты и поставщики</span>",!testDb())}
    ${App.chk("msArch","Архивные товары и контрагенты не переносить",true)}
    ${App.fld("msPrice","Цена в CRM — из вида цены",App.sel("msPrice",pts,pts.includes("Цена продажи")?"Цена продажи":pts[0]))}
    ${App.fld("msSerial","Товары с серийным учётом (IMEI)",App.sel("msSerial",[["units","С учётом по IMEI — экземпляры внести приёмкой"],["qty","Без IMEI — перенести количество"]],"units"))}
    ${App.chk("msLegal","Юрлица и ИП — поставщики, частные лица — клиенты",true)}
  </div>
  ${MS.stores.length?`<h3 class="sub-h">Склады МоегоСклада → склады CRM</h3><div class="form">${MS.stores.map(s=>App.fld("msWh_"+s.id,esc(s.name)+(s.archived?" (архив)":""),whOpt(s))).join("")}</div>`:""}
  <div class="acts"><button class="btn pri" data-act="msRun">Перенести</button></div>
  <div id="msLog" class="mslog"></div>`;
  if(testDb()){const p=$("#msParties");p.checked=false;p.disabled=true}
}

const log=t=>{const el=$("#msLog");if(el){el.insertAdjacentHTML("beforeend",`<div>${esc(t)}</div>`);el.scrollTop=el.scrollHeight}};
const chunks=(a,n)=>{const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o};
async function all(kind,label){const out=[];let off=0;
  while(off!=null){const r=await call({action:"page",kind,offset:off});out.push(...r.rows);off=r.next;if(label)log(`${label}: ${out.length} из ${r.size}`)}
  return out}

ACT.msRun=async(_,btn)=>{
  if(btn.disabled||!MS)return;
  const opt={goods:$("#msGoods").checked,stock:$("#msStock").checked,parties:$("#msParties").checked&&!testDb(),arch:$("#msArch").checked,
    price:App.val("msPrice"),serialQty:App.val("msSerial")==="qty",legal:$("#msLegal").checked};
  if(!opt.goods&&!opt.stock&&!opt.parties)return App.toast("Выберите, что переносить");
  btn.disabled=true;btn.textContent="Переносим… не закрывайте окно";
  const R={wh:0,cat:0,created:0,updated:0,stockLines:0,serialLeft:[],cust:0,sup:0,skipped:0};
  try{
    /* 1. склады */
    const whMap={},whLabel={};
    for(const s of MS.stores){const v=App.val("msWh_"+s.id);if(v==="skip"||!v)continue;
      if(v==="new"){if(SESS.wh[s.id]){whMap[s.id]=SESS.wh[s.id];whLabel[whMap[s.id]]=s.name;continue}
        const ex=S.warehouses.find(w=>w.name.toLowerCase()===s.name.toLowerCase());
        whMap[s.id]=SESS.wh[s.id]=ex?ex.id:(await App.api.insert("warehouses",{name:s.name,kind:"Склад",address:s.address||null})).id;whLabel[whMap[s.id]]=s.name;if(!ex)R.wh++}
      else whMap[s.id]=v;whLabel[whMap[s.id]]=whLabel[whMap[s.id]]||s.name}
    if(R.wh)log("Создано складов: "+R.wh);

    /* 2. группы → категории (с вложенностью) */
    const prodByMs=SESS.prod;      // id товара/модификации в МоёмСкладе → id товара CRM
    let products=[];
    if(opt.goods||opt.stock){
      const folders=await all("folder","Группы");
      const catKey=(name,parent)=>(parent||"")+"|"+name.toLowerCase();
      const cats=SESS.cats=SESS.cats||new Map(S.categories.map(c=>[catKey(c.name,c.parentId),c.id]));
      const byPath=new Map();   // «Телефоны/Apple» → id категории
      const ensure=async full=>{if(!full)return null;if(byPath.has(full))return byPath.get(full);
        const parts=full.split("/"),name=parts.pop(),parent=parts.length?await ensure(parts.join("/")):null,k=catKey(name,parent);
        if(!cats.has(k)){const c=await App.api.insert("categories",{name,parent_id:parent});cats.set(k,c.id);R.cat++}
        byPath.set(full,cats.get(k));return cats.get(k)};
      const catOf={};
      for(const f of folders.sort((a,b)=>a.path.split("/").length-b.path.split("/").length)){if(opt.arch&&f.archived)continue;
        catOf[f.id]=opt.goods?await ensure((f.path?f.path+"/":"")+f.name):null}
      if(R.cat)log("Создано категорий: "+R.cat);

      /* 3. товары и модификации */
      products=await all("product","Товары");
      const variants=await all("variant","Модификации");
      const stock=opt.stock?await all("stock","Остатки"):[];
      const hasStock=new Set(stock.filter(s=>Object.values(s.by).some(q=>q>0)).map(s=>s.id));
      const pById=Object.fromEntries(products.map(p=>[p.id,p]));
      const price=pr=>pr[opt.price]??Object.values(pr)[0]??0;
      const items=[];
      for(const p of products){if(opt.arch&&p.archived)continue;
        if(p.variants>0&&!hasStock.has(p.id))continue;           // у товара с модификациями остатки обычно на модификациях
        items.push({ms:p.id,name:p.name,sku:p.article||p.code,alt:p.code,barcode:p.barcodes[0]||null,price:price(p.prices),cost:p.buy,
          cat:catOf[p.folder]||null,min:p.min,serial:p.serial,descr:p.descr,model:null,memory:null,color:null})}
      for(const v of variants){const b=pById[v.product];if(!b||(opt.arch&&(v.archived||b.archived)))continue;
        const ch=Object.entries(v.chars),pick=re=>(ch.find(([k])=>re.test(k))||[])[1]||null;
        items.push({ms:v.id,name:v.name||b.name,sku:v.code||null,alt:null,barcode:v.barcodes[0]||null,price:price(v.prices)||price(b.prices),cost:v.buy||b.buy,
          cat:catOf[b.folder]||null,min:0,serial:b.serial,descr:b.descr,model:b.name,memory:pick(/памят|объ[её]м|ёмкост|емкост/i),color:pick(/цвет/i)})}
      // в CRM артикул и штрихкод уникальны — повторы внутри МоегоСклада разводим
      const used={sku:new Set(),barcode:new Set()};
      for(const it of items){
        if(it.sku&&used.sku.has(it.sku.toLowerCase()))it.sku=it.alt&&!used.sku.has(it.alt.toLowerCase())?it.alt:null;
        if(it.sku)used.sku.add(it.sku.toLowerCase());
        if(it.barcode&&used.barcode.has(it.barcode))it.barcode=null;if(it.barcode)used.barcode.add(it.barcode)}
      const live=S.products.filter(p=>!p.archived);
      const fresh=[];
      for(const it of items){
        const ex=prodByMs[it.ms]?{id:prodByMs[it.ms]}:live.find(p=>(it.sku&&String(p.sku).toLowerCase()===it.sku.toLowerCase())||(it.barcode&&p.barcode===it.barcode));
        const data={name:it.name,category_id:it.cat,price:it.price,min_qty:it.min||0,model:it.model,memory:it.memory,color:it.color,
          sku:it.sku||null,barcode:it.barcode||null,description:it.descr||null};
        if(App.can("cost"))data.cost=it.cost;
        if(!opt.goods){if(ex)prodByMs[it.ms]=ex.id;continue}
        if(ex){Object.keys(data).forEach(k=>{if(data[k]==null||data[k]==="")delete data[k]});
          await App.api.update("products",ex.id,data);prodByMs[it.ms]=ex.id;R.updated++}
        else{data.track_serial=it.serial&&!opt.serialQty;fresh.push({it,data})}
      }
      for(const part of chunks(fresh,300)){const ins=await App.api.insertMany("products",part.map(x=>x.data));
        ins.forEach((p,i)=>{prodByMs[part[i].it.ms]=p.id;R.created++});log("Товары записаны: "+R.created+" из "+fresh.length)}
      if(R.updated)log("Обновлено товаров: "+R.updated);

      /* 4. остатки — документ прихода на каждый склад */
      if(opt.stock){
        const serialById=Object.fromEntries(items.map(it=>[it.ms,it]));
        const byWh={};
        for(const s of stock)for(const [store,q] of Object.entries(s.by)){
          const wh=whMap[store],pid=prodByMs[s.id],it=serialById[s.id];if(!wh||!pid||!(q>0)||SESS.whDone.has(wh))continue;
          const qty=Math.floor(q);
          const isSerial=it&&it.serial&&!opt.serialQty&&(S.products.find(p=>p.id===pid)?.trackSerial??true);
          if(isSerial){R.serialLeft.push(`${it.name} — ${qty} шт. (${MS.stores.find(x=>x.id===store)?.name||""})`);continue}
          (byWh[wh]=byWh[wh]||[]).push({product_id:pid,qty,cost:App.can("cost")?(it?.cost||0):0})}
        for(const [wh,lines] of Object.entries(byWh)){
          await App.api.doc({type:"in",wh_to:wh,note:NOTE},lines,true);SESS.whDone.add(wh);R.stockLines+=lines.length;
          log(`Остатки на «${whLabel[wh]||App.whName(wh)}»: ${lines.length} позиций`)}
      }
    }

    /* 5. контрагенты */
    if(opt.parties){
      const parties=await all("counterparty","Контрагенты");
      SESS.phones=SESS.phones||new Set(S.customers.map(c=>App.phoneKey(c.phone)).filter(Boolean));
      S.customers.forEach(c=>c.email&&SESS.emails.add(c.email.toLowerCase()));
      SESS.sups=SESS.sups||S.suppliers.map(s=>({inn:s.inn,name:s.name.toLowerCase()}));
      // дубли внутри выгрузки — по локальным копиям; в SESS попадает только то, что реально записалось
      const phones=new Set(SESS.phones),emails=new Set(SESS.emails),sups=SESS.sups.slice();
      const cust=[],sup=[];
      for(const p of parties){if((opt.arch&&p.archived)||!p.name||/^розничн(ый|ая) покупател/i.test(p.name)){R.skipped++;continue}
        const note=[p.note,p.tags.length?"Группы: "+p.tags.join(", "):""].filter(Boolean).join("\n")||null;
        if(opt.legal&&p.type!=="individual"){
          if(sups.some(s=>(p.inn&&s.inn===p.inn)||s.name===p.name.toLowerCase())){R.skipped++;continue}
          const key={inn:p.inn,name:p.name.toLowerCase()};sups.push(key);
          sup.push({row:{name:p.name,inn:p.inn||null,phone:p.phone||null,contact:p.email||null,note},key});continue}
        let k=App.phoneKey(p.phone);if(k.length!==10)k="";
        const em=(p.email||"").toLowerCase();
        if(!k&&!em){R.skipped++;continue}
        if((k&&phones.has(k))||(!k&&emails.has(em))){R.skipped++;continue}
        if(k)phones.add(k);if(em)emails.add(em);
        cust.push({row:{name:p.name,phone:k||null,email:p.email||null,note,source:"МойСклад"},k,em})}
      for(const part of chunks(sup,300)){await App.api.insertMany("suppliers",part.map(x=>x.row));part.forEach(x=>SESS.sups.push(x.key));R.sup+=part.length}
      for(const part of chunks(cust,500)){await App.api.insertMany("customers",part.map(x=>x.row));
        part.forEach(x=>{if(x.k)SESS.phones.add(x.k);if(x.em)SESS.emails.add(x.em)});R.cust+=part.length;log("Клиенты: "+R.cust+" из "+cust.length)}
    }

    const sum=`складов ${R.wh}, категорий ${R.cat}, товаров создано ${R.created}, обновлено ${R.updated}, позиций остатков ${R.stockLines}, клиентов ${R.cust}, поставщиков ${R.sup}`;
    await App.api.audit("Импорт","МойСклад",sum);
    await App.reload(["warehouses","categories","products","customers","suppliers","docs","movements","units"]);
    btn.textContent="Готово";$("#msLog").scrollIntoView({block:"end",behavior:"smooth"});
    $("#msLog").insertAdjacentHTML("beforeend",`<div class="ok"><b>Готово:</b> ${esc(sum)}${R.skipped?", пропущено контрагентов "+R.skipped+" (дубли, без телефона и почты, архив)":""}.</div>`+
      (R.serialLeft.length?`<div class="warn"><b>Товары с IMEI — внесите экземпляры приёмкой или инвентаризацией</b> (МойСклад не отдаёт серийные номера остатков):<br>${R.serialLeft.slice(0,50).map(esc).join("<br>")}${R.serialLeft.length>50?"<br>… и ещё "+(R.serialLeft.length-50):""}</div>`:""));
    App.toast("Перенос завершён");
  }catch(e){
    btn.disabled=false;btn.textContent="Продолжить перенос";
    log("Остановлено: "+e.message+". Уже перенесённое не задвоится — можно нажать ещё раз.");
    App.toast("Перенос остановлен: "+e.message);
  }
};
})();
