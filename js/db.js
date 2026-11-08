/* iCase CRM v3 · работа с базой Supabase: вход, загрузка, обновления в реальном времени, запись */
"use strict";
(function(){
const {S,num}=App;
const cfg=window.ICASE_CONFIG||{};
const sb=App.sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});

/* ---------- ошибки ---------- */
function err(e,ctx){
  const m=(e&&(e.message||e.error_description||e.details))||String(e||"Ошибка");
  if(/JWT|session|not authenticated/i.test(m))return new Error("Сессия истекла, войдите снова");
  if(/row-level security|permission denied/i.test(m))return new Error("Нет прав на это действие"+(ctx?" ("+ctx+")":""));
  if(/duplicate key.*customers_phone/i.test(m))return new Error("Клиент с таким телефоном уже есть");
  if(/duplicate key.*(sku|barcode|serial)/i.test(m))return new Error("Товар с таким артикулом, штрихкодом или IMEI уже есть");
  if(/duplicate key.*one_open_shift/i.test(m))return new Error("На этой точке уже открыта смена");
  if(/Failed to fetch|NetworkError|network/i.test(m))return new Error("Нет связи с базой. Проверьте интернет");
  return new Error(m);
}
async function q(promise,ctx){const {data,error}=await promise;if(error)throw err(error,ctx);return data}
/* выборка всех строк с постраничной загрузкой (у Supabase лимит 1000 строк на запрос) */
async function all(table,select="*",mod){
  const out=[];const step=1000;
  for(let from=0;from<50000;from+=step){
    let r=sb.from(table).select(select).range(from,from+step-1);
    if(mod)r=mod(r);
    const rows=await q(r,table);out.push(...rows);if(rows.length<step)break;
  }
  return out;
}

/* ---------- преобразование строк базы в объекты интерфейса ---------- */
const M={
  settings:r=>({id:"main",shopName:r.shop_name,city:r.city||"",address:r.address||"",phone:r.phone||"",inn:r.inn||"",
    deviceWarrantyMonths:r.device_warranty_months,repairWarrantyDays:r.repair_warranty_days,requireShift:r.require_shift,storageDays:r.storage_days,deadDays:r.dead_days,receiptFooter:r.receipt_footer||"",legalName:r.legal_name||"",ogrnip:r.ogrnip||"",siteUrl:r.site_url||"",reviewUrl:r.review_url||"",receiptAck:r.receipt_ack||"",docConfig:r.doc_config||{},tagTemplates:Array.isArray(r.tag_templates)?r.tag_templates:[]}),
  points:r=>({id:r.id,name:r.name,address:r.address||"",phone:r.phone||"",patentNo:r.patent_no||"",evotorStoreId:r.evotor_store_id||"",cashWh:r.cash_wh,serviceWh:r.service_wh,order:r.sort,active:r.is_active}),
  warehouses:r=>({id:r.id,name:r.name,kind:r.kind||"",address:r.address||"",pointId:r.point_id,order:r.sort,active:r.is_active}),
  categories:r=>({id:r.id,name:r.name,parentId:r.parent_id||"",isDevice:r.is_device,isUsed:!!r.is_used}),
  suppliers:r=>({id:r.id,name:r.name,inn:r.inn||"",contact:r.contact||"",phone:r.phone||"",note:r.note||""}),
  services:r=>({id:r.id,name:r.name,group:r.grp||"",price:num(r.price)}),
  customers:r=>({id:r.id,name:r.name,phone:App.fmtPhone(r.phone),phone2:r.phone2?App.fmtPhone(r.phone2):"",email:r.email||"",birthday:r.birthday||"",source:r.source||"",
    discount:num(r.discount),tags:r.tags||[],blacklisted:r.blacklisted,blackReason:r.black_reason||"",note:r.note||"",mergedInto:r.merged_into,createdAt:r.created_at}),
  products:r=>({id:r.id,name:r.name,categoryId:r.category_id||"",brand:r.brand||"",condition:r.condition,sku:r.sku||"",barcode:r.barcode||"",serial:r.serial||"",
    cost:num(r.cost),lastCost:num(r.last_cost),price:num(r.price),minQty:r.min_qty,warrantyMonths:r.warranty_months,batteryHealth:r.battery_health,diagnostics:r.diagnostics||"",
    kit:r.kit||"",trackSerial:!!r.track_serial,attrs:r.attrs||{},catalogId:r.catalog_id||"",model:r.model||"",memory:r.memory||"",color:r.color||"",avitoPrice:r.avito_price==null?"":num(r.avito_price),ownership:r.ownership,onSite:r.on_site,onAvito:r.on_avito,archived:r.is_archived,note:r.description||"",
    createdAt:r.created_at,stock:{}}),
  sales:r=>({id:r.id,num:r.num,pointId:r.point_id,whId:r.warehouse_id,shiftId:r.shift_id,customerId:r.customer_id,channel:r.channel,subtotal:num(r.subtotal),discount:num(r.discount),
    tradeIn:r.tradein_device?{device:r.tradein_device,amount:num(r.tradein_amount),imei:r.tradein_imei||""}:null,total:num(r.total),status:r.status,by:r.staff_id,createdAt:r.created_at,
    items:(r.sale_items||[]).sort((a,b)=>a.id-b.id).map(i=>({line:i.id,productId:i.product_id,name:i.name,kind:i.kind||"",serial:i.serial||"",qty:i.qty,price:num(i.price),disc:num(i.line_discount),cost:num(i.cost),warranty:i.warranty_months,model:i.model||"",memory:i.memory||"",color:i.color||"",condition:i.condition||"",battery:i.battery_health,kit:i.kit||"",unitId:i.unit_id||""})),
    payments:(r.sale_payments||[]).map(p=>({method:p.method,amount:num(p.amount)}))}),
  returns:r=>({id:r.id,num:r.num,saleId:r.sale_id,customerId:r.customer_id,amount:num(r.amount),method:r.method,reason:r.reason,note:r.note||"",whId:r.warehouse_id,defect:r.is_defect,
    shiftId:r.shift_id,by:r.staff_id,createdAt:r.created_at,
    items:(r.return_items||[]).map(i=>({line:i.sale_item_id,qty:i.qty,productId:i.sale_items&&i.sale_items.product_id,name:i.sale_items&&i.sale_items.name,price:num(i.sale_items&&i.sale_items.price),cost:num(i.sale_items&&i.sale_items.cost)}))}),
  docs:r=>({id:r.id,num:r.num,type:r.type,status:r.status,whFrom:r.wh_from||"",whTo:r.wh_to||"",supplierId:r.supplier_id||"",invoice:r.invoice||"",reason:r.reason||"",catId:r.category_id||"",note:r.note||"",
    by:r.created_by,createdAt:r.created_at,postedAt:r.posted_at,cancelledAt:r.cancelled_at,
    lines:(r.stock_doc_lines||[]).sort((a,b)=>a.id-b.id).map(l=>({productId:l.product_id,name:(App.byId("products",l.product_id)||{}).name||"Товар",qty:l.qty,expected:l.expected,counted:l.counted==null?"":l.counted,cost:num(l.cost),newUnits:l.new_units||[],unitIds:l.unit_ids||[],foundCodes:l.found_codes||[],unitLog:l.unit_log||[]}))}),
  units:r=>({id:r.id,productId:r.product_id,imei:r.imei||"",imei2:r.imei2||"",serialNo:r.serial_no||"",whId:r.warehouse_id||"",status:r.status,condition:r.condition||"",batteryHealth:r.battery_health,
    diagnostics:r.diagnostics||"",kit:r.kit||"",cost:num(r.cost),price:r.price==null?"":num(r.price),note:r.note||"",saleItemId:r.sale_item_id,lastRef:r.last_ref||"",attrs:r.attrs||{},createdAt:r.created_at,updatedAt:r.updated_at}),
  models:r=>({id:r.id,family:r.family,name:r.name,year:r.year,memories:r.memories||[],colors:r.colors||[],options:r.options||{},order:r.sort,active:r.is_active}),
  movements:r=>({id:r.id,productId:r.product_id,productName:(App.byId("products",r.product_id)||{}).name||"Товар",whId:r.warehouse_id,qty:r.qty,type:r.type,ref:r.ref||"",note:r.note||"",by:r.staff_id,at:r.created_at}),
  shifts:r=>({id:r.id,num:r.num,pointId:r.point_id,status:r.status,openedAt:r.opened_at,openedBy:r.opened_by,openCash:num(r.open_cash),closedAt:r.closed_at,closedBy:r.closed_by,
    countedCash:num(r.counted_cash),expectedCash:num(r.expected_cash),diff:num(r.diff),closeNote:r.close_note||""}),
  cashops:r=>({id:r.id,shiftId:r.shift_id,pointId:r.point_id,type:r.type,method:r.method,amount:num(r.amount),ref:r.ref||"",note:r.note||"",by:r.staff_id,at:r.created_at}),
  staff:r=>({id:r.id,fullName:r.full_name,role:r.role,pointId:r.point_id,phone:r.phone||"",active:r.is_active}),
  staffreq:r=>({id:r.id,email:r.email||"",fullName:r.full_name||"",at:r.created_at}),
  log:r=>({id:r.id,at:r.created_at,by:r.staff_id,action:r.action,ref:r.ref||"",details:r.details||""})
};
/* что загружать для каждого раздела */
const L={
  settings:async()=>(await all("settings")).map(M.settings),
  points:async()=>(await all("points")).map(M.points),
  warehouses:async()=>(await all("warehouses")).map(M.warehouses),
  categories:async()=>(await all("categories")).map(M.categories),
  suppliers:async()=>(await all("suppliers")).map(M.suppliers),
  services:async()=>(await all("services")).map(M.services),
  customers:async()=>(await all("customers")).map(M.customers),
  products:async()=>{const [ps,st]=await Promise.all([all("products"),all("stock")]);const list=ps.map(M.products);const by=Object.fromEntries(list.map(p=>[p.id,p]));
    st.forEach(s=>{const p=by[s.product_id];if(p)p.stock[s.warehouse_id]=s.qty});return list},
  sales:async()=>(await all("sales","*,sale_items(*),sale_payments(*)",r=>r.order("created_at",{ascending:false}))).map(M.sales),
  returns:async()=>(await all("returns","*,return_items(*,sale_items(product_id,name,price,cost))")).map(M.returns),
  docs:async()=>(await all("stock_docs","*,stock_doc_lines(*)")).map(M.docs),
  movements:async()=>(await q(sb.from("stock_movements").select("*").order("created_at",{ascending:false}).limit(1000),"movements")).map(M.movements),
  shifts:async()=>(await all("shifts")).map(M.shifts),
  cashops:async()=>(await all("cash_ops","*",r=>r.order("created_at",{ascending:false}))).map(M.cashops),
  staff:async()=>(await all("staff")).map(M.staff),
  staffreq:async()=>(await all("staff_requests")).map(M.staffreq),
  units:async()=>(await all("units")).map(M.units),
  models:async()=>(await all("apple_models","*",r=>r.order("sort"))).map(M.models),
  log:async()=>(await q(sb.from("audit_log").select("*").order("created_at",{ascending:false}).limit(500),"log")).map(M.log)
};
/* таблица базы → разделы, которые нужно перечитать */
const T={settings:["settings"],points:["points"],warehouses:["warehouses"],categories:["categories"],suppliers:["suppliers"],services:["services"],
  customers:["customers"],products:["products"],stock:["products"],stock_movements:["movements"],stock_docs:["docs"],stock_doc_lines:["docs"],
  sales:["sales"],sale_items:["sales"],sale_payments:["sales"],returns:["returns"],return_items:["returns"],shifts:["shifts"],cash_ops:["cashops"],
  staff:["staff"],staff_requests:["staffreq"],audit_log:["log"],units:["units"],apple_models:["models"]};

App.reload = async function(cols){
  cols=[...new Set(cols)].filter(c=>L[c]);
  const res=await Promise.allSettled(cols.map(c=>L[c]()));
  res.forEach((r,i)=>{if(r.status==="fulfilled")S[cols[i]]=r.value;else console.warn(cols[i],r.reason)});
  // названия товаров в документах и движениях
  if(cols.includes("returns")||cols.includes("sales"))S.returns.forEach(r=>r.saleNum=(App.byId("sales",r.saleId)||{}).num||"");
  if(cols.includes("products")){S.movements.forEach(m=>{const p=App.byId("products",m.productId);if(p)m.productName=p.name});S.docs.forEach(d=>d.lines.forEach(l=>{const p=App.byId("products",l.productId);if(p)l.name=p.name}))}
  App.schedule();
  const bad=res.find(r=>r.status==="rejected");if(bad)App.banner("Часть данных не загрузилась: "+bad.reason.message,"err");
};
let pend=new Set(),pt=0;
function queueReload(cols){cols.forEach(c=>pend.add(c));clearTimeout(pt);pt=setTimeout(()=>{const c=[...pend];pend.clear();App.reload(c)},350)}
App.refresh = (...tables)=>queueReload(tables.flatMap(t=>T[t]||[t]));

let channel=null;
function subscribe(){
  if(channel)sb.removeChannel(channel);
  channel=sb.channel("icase-all").on("postgres_changes",{event:"*",schema:"public"},p=>{const c=T[p.table];if(c)queueReload(c)})
    .subscribe(st=>{if(st==="CHANNEL_ERROR"||st==="TIMED_OUT")App.banner("Обновления в реальном времени недоступны, данные обновятся после ваших действий","warn")});
}

/* ---------- вход ---------- */
App.auth = {
  async signIn(email,password){const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw new Error(/Invalid login/i.test(error.message)?"Неверный email или пароль":/confirm/i.test(error.message)?"Подтвердите email по ссылке из письма":error.message)},
  async signUp(email,password,name){const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:name}}});if(error)throw new Error(/registered/i.test(error.message)?"Этот email уже зарегистрирован":error.message);return data},
  async signOut(){await sb.auth.signOut();location.reload()},
  async reset(email){const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw new Error(error.message)}
};
App.start = async function(){
  const {data}=await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev,sess)=>{if(ev==="SIGNED_OUT")location.reload();if(ev==="PASSWORD_RECOVERY")App.showLogin("newpass")});
  if(!data.session){App.showLogin();return}
  await App.enter(data.session.user);
};
App.enter = async function(user){
  App.me.id=user.id;App.me.email=user.email;App.me.name=(user.user_metadata&&user.user_metadata.full_name)||user.email;
  App.showApp();App.banner("Загружаем данные…");
  const st=await q(sb.from("staff").select("*").eq("id",user.id).maybeSingle(),"staff");
  if(!st||st.is_active===false){
    const exists=await q(sb.rpc("staff_exists"),"staff_exists");
    App.showPending(!exists,st&&st.is_active===false);return;
  }
  App.me.role=st.role;App.me.pointId=st.point_id;App.me.name=st.full_name;
  try{const saved=localStorage.getItem("icase_point");if(saved)App.ui.pointId=saved}catch(e){}
  await App.reload(Object.keys(L));
  App.banner("");subscribe();App.route();
};
App.claimOwner = async name=>{await q(sb.rpc("claim_owner",{p_name:name}),"claim_owner");location.reload()};
App.requestAccess = async name=>{await q(sb.from("staff_requests").upsert({id:App.me.id,email:App.me.email,full_name:name}),"staff_requests")};

/* ---------- запись ---------- */
const snake=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined));
App.api = {
  insert:async(table,row)=>{const d=await q(sb.from(table).insert(snake(row)).select().single(),table);App.refresh(table);return d},
  insertMany:async(table,rows)=>{if(!rows.length)return[];const d=await q(sb.from(table).insert(rows.map(snake)).select(),table);App.refresh(table);return d},
  update:async(table,id,patch,key="id")=>{const d=await q(sb.from(table).update(snake(patch)).eq(key,id).select(),table);if(!d.length)throw new Error("Нет прав на изменение или запись не найдена");App.refresh(table);return d[0]},
  remove:async(table,id,key="id")=>{await q(sb.from(table).delete().eq(key,id),table);App.refresh(table)},
  rpc:async(fn,args,refresh=[])=>{const d=await q(sb.rpc(fn,args),fn);App.refresh(...refresh);return d},
  audit:async(action,ref,details)=>{try{await sb.from("audit_log").insert({staff_id:App.me.id,action,ref:ref||"",details:details||""});App.refresh("audit_log")}catch(e){}},
  /* найти или создать клиента по телефону */
  customer:async(phone,name,source)=>{
    const k=App.phoneKey(phone);if(!k&&!name)return null;
    const c=App.findCustomerByPhone(phone);
    if(c){if(name&&(!c.name||c.name==="Без имени"))await App.api.update("customers",c.id,{name});return c.id}
    const d=await App.api.insert("customers",{name:name||"Без имени",phone:k.length===10?k:null,source:source||"Магазин"});
    App.ensureLocal("customers",M.customers(d));return d.id;
  },
  /* складской документ: создать (черновик) с позициями и при необходимости провести */
  doc:async(head,lines,post)=>{
    const d=await q(sb.from("stock_docs").insert(snake(head)).select().single(),"stock_docs");
    if(lines.length)await q(sb.from("stock_doc_lines").insert(lines.map(l=>snake(Object.assign({doc_id:d.id},l)))),"stock_doc_lines");
    if(post)await q(sb.rpc("post_doc",{p_doc:d.id}),"post_doc");
    App.refresh("stock_docs","stock","stock_movements","products","audit_log");return d;
  }
};
App.mapRow = M;
})();
