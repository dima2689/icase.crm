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
/* закупочные цены закрыты в базе: читаем разрешённые колонки, а себестоимость — функциями costs_* (если есть право) */
const SECURED=["products","units","sale_items","stock_doc_lines","repair_parts"];
let COLSEL=null;
async function loadCols(){if(COLSEL)return COLSEL;try{const {data,error}=await sb.rpc("api_cols",{p_tables:SECURED});COLSEL=!error&&data&&Object.keys(data).length?data:{}}catch(e){COLSEL={}}return COLSEL}
const sel=t=>(COLSEL&&COLSEL[t])||"*";
const secured=()=>!!(COLSEL&&Object.keys(COLSEL).length);
async function allRpc(fn){const out=[];for(let from=0;from<200000;from+=1000){const {data,error}=await sb.rpc(fn).range(from,from+999);if(error)throw err(error,fn);out.push(...data);if(data.length<1000)break}return out}
async function applyCosts(cols){if(!secured()||!App.can("cost"))return;
  const need=c=>cols.includes(c);
  try{
    if(need("products")){const m=new Map((await allRpc("costs_products")).map(r=>[r.id,r]));S.products.forEach(p=>{const r=m.get(p.id);if(r){p.cost=num(r.cost);p.lastCost=num(r.last_cost)}})}
    if(need("units")){const m=new Map((await allRpc("costs_units")).map(r=>[r.id,num(r.cost)]));S.units.forEach(u=>{if(m.has(u.id))u.cost=m.get(u.id)})}
    if(need("sales")||need("returns")){const m=new Map((await allRpc("costs_sale_items")).map(r=>[r.id,num(r.cost)]));
      S.sales.forEach(s=>(s.items||[]).forEach(i=>{if(m.has(i.line))i.cost=m.get(i.line)}));S.returns.forEach(r=>(r.items||[]).forEach(i=>{if(m.has(i.line))i.cost=m.get(i.line)}))}
    if(need("docs")){const m=new Map((await allRpc("costs_doc_lines")).map(r=>[r.id,num(r.cost)]));S.docs.forEach(d=>d.lines.forEach(l=>{if(m.has(l.id))l.cost=m.get(l.id)}))}
    if(need("repairs")){const m=new Map((await allRpc("costs_repair_parts")).map(r=>[r.id,num(r.cost)]));S.repairs.forEach(r=>(r.parts||[]).forEach(p=>{if(m.has(p.id))p.cost=m.get(p.id)}))}
  }catch(e){console.warn("costs",e)}}
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
    deviceWarrantyMonths:r.device_warranty_months,repairWarrantyDays:r.repair_warranty_days,requireShift:r.require_shift,approvals:r.approvals||{},storageDays:r.storage_days,deadDays:r.dead_days,receiptFooter:r.receipt_footer||"",finConfig:r.fin_config||{},loyalty:r.loyalty||{},evotor:r.evotor||{},legalName:r.legal_name||"",ogrnip:r.ogrnip||"",siteUrl:r.site_url||"",reviewUrl:r.review_url||"",receiptAck:r.receipt_ack||"",docConfig:r.doc_config||{},siteSync:!!r.site_sync,siteOrders:!!r.site_orders,siteWarehouses:r.site_warehouses||[],siteNewStatus:r.site_new_status||"draft",siteReserveWh:r.site_reserve_wh||"",siteLastSync:r.site_last_sync||"",siteLastError:r.site_last_error||"",siteFields:r.site_fields||null,siteMode:r.site_mode||"custom",siteHookUrl:r.site_hook_url||"",tagTemplates:Array.isArray(r.tag_templates)?r.tag_templates:[]}),
  points:r=>({id:r.id,name:r.name,address:r.address||"",phone:r.phone||"",patentNo:r.patent_no||"",evotorStoreId:r.evotor_store_id||"",cashWh:r.cash_wh,serviceWh:r.service_wh,order:r.sort,active:r.is_active}),
  warehouses:r=>({id:r.id,name:r.name,kind:r.kind||"",address:r.address||"",pointId:r.point_id,order:r.sort,active:r.is_active}),
  categories:r=>({id:r.id,name:r.name,parentId:r.parent_id||"",isDevice:r.is_device,isUsed:!!r.is_used}),
  suppliers:r=>({id:r.id,name:r.name,inn:r.inn||"",contact:r.contact||"",phone:r.phone||"",note:r.note||"",priceUpdatedAt:r.price_updated_at||""}),
  sprices:r=>({id:r.id,supplierId:r.supplier_id,name:r.name,sku:r.sku||"",brand:r.brand||"",price:num(r.price),stock:r.stock||"",note:r.note||"",productId:r.product_id||"",updatedAt:r.updated_at,
    _s:[r.name,r.sku,r.brand,r.note].join(" ").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/g," ")}),
  services:r=>({id:r.id,name:r.name,group:r.grp||"",price:num(r.price)}),
  customers:r=>({id:r.id,name:r.name,phone:App.fmtPhone(r.phone),phone2:r.phone2?App.fmtPhone(r.phone2):"",email:r.email||"",birthday:r.birthday||"",source:r.source||"",
    discount:num(r.discount),tags:r.tags||[],blacklisted:r.blacklisted,blackReason:r.black_reason||"",note:r.note||"",mergedInto:r.merged_into,createdAt:r.created_at}),
  products:r=>({id:r.id,name:r.name,categoryId:r.category_id||"",brand:r.brand||"",condition:r.condition,sku:r.sku||"",barcode:r.barcode||"",serial:r.serial||"",
    cost:num(r.cost),lastCost:num(r.last_cost),price:num(r.price),oldPrice:r.old_price==null?null:num(r.old_price),minQty:r.min_qty,warrantyMonths:r.warranty_months,batteryHealth:r.battery_health,diagnostics:r.diagnostics||"",
    kit:r.kit||"",trackSerial:!!r.track_serial,attrs:r.attrs||{},catalogId:r.catalog_id||"",model:r.model||"",memory:r.memory||"",color:r.color||"",avitoPrice:r.avito_price==null?"":num(r.avito_price),ownership:r.ownership,onSite:r.on_site,onAvito:r.on_avito,archived:r.is_archived,note:r.description||"",approval:r.approval||"",approvalBy:r.approval_by||"",approvalAt:r.approval_at||"",approvalNote:r.approval_note||"",
    createdAt:r.created_at,stock:{}}),
  sales:r=>({id:r.id,num:r.num,pointId:r.point_id,whId:r.warehouse_id,shiftId:r.shift_id,customerId:r.customer_id,channel:r.channel,subtotal:num(r.subtotal),discount:num(r.discount),
    tradeIn:r.tradein_device?{device:r.tradein_device,amount:num(r.tradein_amount),imei:r.tradein_imei||""}:null,total:num(r.total),status:r.status,by:r.staff_id,createdAt:r.created_at,
    items:(r.sale_items||[]).sort((a,b)=>a.id-b.id).map(i=>({line:i.id,productId:i.product_id,name:i.name,kind:i.kind||"",serial:i.serial||"",qty:i.qty,price:num(i.price),disc:num(i.line_discount),cost:num(i.cost),warranty:i.warranty_months,model:i.model||"",memory:i.memory||"",color:i.color||"",condition:i.condition||"",battery:i.battery_health,kit:i.kit||"",unitId:i.unit_id||""})),
    payments:(r.sale_payments||[]).map(p=>({method:p.method,amount:num(p.amount)}))}),
  returns:r=>({id:r.id,num:r.num,saleId:r.sale_id,customerId:r.customer_id,amount:num(r.amount),method:r.method,reason:r.reason,note:r.note||"",whId:r.warehouse_id,defect:r.is_defect,
    shiftId:r.shift_id,by:r.staff_id,createdAt:r.created_at,
    items:(r.return_items||[]).map(i=>({line:i.sale_item_id,qty:i.qty,productId:i.sale_items&&i.sale_items.product_id,name:i.sale_items&&i.sale_items.name,price:num(i.sale_items&&i.sale_items.price),cost:num(i.sale_items&&i.sale_items.cost)}))}),
  docs:r=>({id:r.id,num:r.num,type:r.type,poId:r.po_id||"",status:r.status,whFrom:r.wh_from||"",whTo:r.wh_to||"",supplierId:r.supplier_id||"",invoice:r.invoice||"",reason:r.reason||"",catId:r.category_id||"",note:r.note||"",
    by:r.created_by,createdAt:r.created_at,postedAt:r.posted_at,cancelledAt:r.cancelled_at,
    lines:(r.stock_doc_lines||[]).sort((a,b)=>a.id-b.id).map(l=>({id:l.id,productId:l.product_id,name:(App.byId("products",l.product_id)||{}).name||"Товар",qty:l.qty,expected:l.expected,counted:l.counted==null?"":l.counted,cost:num(l.cost),newUnits:l.new_units||[],unitIds:l.unit_ids||[],foundCodes:l.found_codes||[],unitLog:l.unit_log||[]}))}),
  units:r=>({id:r.id,productId:r.product_id,imei:r.imei||"",imei2:r.imei2||"",serialNo:r.serial_no||"",partNo:r.part_no||"",whId:r.warehouse_id||"",status:r.status,condition:r.condition||"",batteryHealth:r.battery_health,
    diagnostics:r.diagnostics||"",kit:r.kit||"",cost:num(r.cost),price:r.price==null?"":num(r.price),note:r.note||"",saleItemId:r.sale_item_id,lastRef:r.last_ref||"",attrs:r.attrs||{},createdAt:r.created_at,updatedAt:r.updated_at,onSite:r.on_site!==false,wooId:r.woo_id||null,originRef:r.origin_ref||""}),
  models:r=>({id:r.id,family:r.family,name:r.name,year:r.year,memories:r.memories||[],colors:r.colors||[],options:r.options||{},order:r.sort,active:r.is_active}),
  movements:r=>({id:r.id,productId:r.product_id,productName:(App.byId("products",r.product_id)||{}).name||"Товар",whId:r.warehouse_id,qty:r.qty,type:r.type,ref:r.ref||"",note:r.note||"",by:r.staff_id,at:r.created_at}),
  shifts:r=>({id:r.id,num:r.num,pointId:r.point_id,status:r.status,openedAt:r.opened_at,openedBy:r.opened_by,openCash:num(r.open_cash),closedAt:r.closed_at,closedBy:r.closed_by,
    countedCash:num(r.counted_cash),expectedCash:num(r.expected_cash),diff:num(r.diff),closeNote:r.close_note||""}),
  cashops:r=>({id:r.id,shiftId:r.shift_id,pointId:r.point_id,type:r.type,method:r.method,amount:num(r.amount),ref:r.ref||"",note:r.note||"",by:r.staff_id,at:r.created_at}),
  staff:r=>({id:r.id,fullName:r.full_name,role:r.role,pointId:r.point_id,phone:r.phone||"",active:r.is_active,email:r.email||"",mustChange:!!r.must_change_password,lastSeen:r.last_seen_at||"",blockedAt:r.blocked_at||""}),
  staffreq:r=>({id:r.id,email:r.email||"",fullName:r.full_name||"",at:r.created_at}),
  siteorders:r=>({id:r.id,wooId:r.woo_id,num:r.num,status:r.status,wooStatus:r.woo_status||"",customerId:r.customer_id||"",name:r.name||"",phone:r.phone||"",email:r.email||"",address:r.address||"",delivery:r.delivery||"",payment:r.payment||"",paid:!!r.paid,total:num(r.total),note:r.note||"",problems:r.problems||"",saleId:r.sale_id||"",createdAt:r.created_at,
    items:(r.items||[]).map(i=>({productId:i.product_id||"",unitId:i.unit_id||"",name:i.name||"",sku:i.sku||"",qty:num(i.qty),price:num(i.price),from:i.from||[],problem:i.problem||""}))}),
  finaccounts:r=>({id:r.id,name:r.name,kind:r.kind,pointId:r.point_id||"",opening:num(r.opening),noncash:!!r.noncash,active:r.is_active!==false,sort:r.sort||0,createdAt:r.created_at}),
  fincats:r=>({id:r.id,name:r.name,kind:r.kind,inPnl:r.in_pnl!==false,active:r.is_active!==false,sort:r.sort||0}),
  finops:r=>({id:r.id,num:r.num,date:r.op_date,kind:r.kind,accountId:r.account_id,toAccountId:r.to_account_id||"",amount:num(r.amount),catId:r.category_id||"",debtId:r.debt_id||"",planId:r.plan_id||"",
    counterparty:r.counterparty||"",note:r.note||"",cashOpIds:r.cash_op_ids||[],by:r.staff_id,createdAt:r.created_at,cancelledAt:r.cancelled_at||"",payee:r.payee_staff||"",pointId:r.point_id||"",channel:r.channel||""}),
  debts:r=>({id:r.id,num:r.num,direction:r.direction,kind:r.kind,counterparty:r.counterparty||"",supplierId:r.supplier_id||"",customerId:r.customer_id||"",saleId:r.sale_id||"",docId:r.doc_id||"",
    amount:num(r.amount),dueDate:r.due_date||"",note:r.note||"",status:r.status,createdAt:r.created_at,closedAt:r.closed_at||""}),
  finplans:r=>({id:r.id,name:r.name,kind:r.kind,amount:num(r.amount),catId:r.category_id||"",accountId:r.account_id||"",counterparty:r.counterparty||"",period:r.period,nextDate:r.next_date,note:r.note||"",active:r.is_active!==false}),
  repairs:r=>({id:r.id,num:r.num,pointId:r.point_id||"",customerId:r.customer_id,device:r.device,imei:r.imei||"",problem:r.problem||"",kit:r.kit||"",appearance:r.appearance||"",devicePass:r.device_pass||"",
    status:r.status,master:r.master||"",masterId:r.master_id||"",diagnosis:r.diagnosis||"",estimate:num(r.estimate),approved:r.approved,approvedSum:r.approved_sum==null?null:num(r.approved_sum),finalPrice:num(r.final_price),
    dueDate:r.due_date||"",readyAt:r.ready_at||"",closedAt:r.closed_at||"",warrantyDays:num(r.warranty_days),warrantyOf:r.warranty_of||"",cancelReason:r.cancel_reason||"",source:r.source||"",diagFee:num(r.diag_fee),saleId:r.sale_id||"",unitId:r.unit_id||"",
    by:r.created_by,createdAt:r.created_at,checklist:r.checklist||{},modelId:r.model_id||"",approveToken:r.approve_token||"",clientDecision:r.client_decision||null,
    photos:(r.repair_photos||[]).map(x=>({id:x.id,path:x.path,kind:x.kind,by:x.created_by,at:x.created_at})).sort((a,b)=>String(a.at).localeCompare(b.at)),
    partReqs:(r.repair_part_requests||[]).map(x=>({id:x.id,productId:x.product_id||"",name:x.name,qty:num(x.qty)||1,status:x.status,note:x.note||"",at:x.created_at,arrivedAt:x.arrived_at||""})).sort((a,b)=>String(a.at).localeCompare(b.at)),
    services:(r.repair_services||[]).map(x=>({id:x.id,serviceId:x.service_id||"",name:x.name,price:num(x.price),qty:num(x.qty)||1})).sort((a,b)=>a.id-b.id),
    parts:(r.repair_parts||[]).map(x=>({id:x.id,productId:x.product_id,whId:x.warehouse_id,name:x.name,qty:num(x.qty),price:num(x.price),cost:num(x.cost),returned:!!x.returned})).sort((a,b)=>a.id-b.id),
    history:(r.repair_history||[]).map(h=>({id:h.id,status:h.status,note:h.note||"",by:h.staff_id,at:h.created_at})).sort((a,b)=>String(a.at).localeCompare(b.at))}),
  porders:r=>({id:r.id,num:r.num,supplierId:r.supplier_id||"",whId:r.wh_id||"",status:r.status,expectedDate:r.expected_date||"",note:r.note||"",by:r.created_by,createdAt:r.created_at,
    lines:(r.purchase_order_lines||[]).sort((a,b)=>a.id-b.id).map(l=>({id:l.id,productId:l.product_id,qty:num(l.qty),cost:num(l.cost),received:num(l.received)}))}),
  payrules:r=>({id:r.staff_id,staffId:r.staff_id,base:num(r.base_month),perShift:num(r.per_shift),pctSales:num(r.pct_sales),pctProfit:num(r.pct_profit),pctWorks:num(r.pct_works),note:r.note||""}),
  unitcosts:r=>({id:r.id,unitId:r.unit_id,kind:r.kind,productId:r.product_id||"",whId:r.warehouse_id||"",name:r.name,qty:num(r.qty),amount:num(r.amount),note:r.note||"",by:r.staff_id,at:r.created_at}),
  waitlist:r=>({id:r.id,customerId:r.customer_id||"",productId:r.product_id||"",request:r.request,qty:num(r.qty)||1,maxPrice:r.max_price==null?"":num(r.max_price),pointId:r.point_id||"",status:r.status,note:r.note||"",by:r.created_by,createdAt:r.created_at,readyAt:r.ready_at||"",closedAt:r.closed_at||""}),
  lostdemand:r=>({id:r.id,request:r.request,productId:r.product_id||"",qty:num(r.qty)||1,reason:r.reason||"",pointId:r.point_id||"",by:r.staff_id,createdAt:r.created_at}),
  tasks:r=>({id:r.id,title:r.title,note:r.note||"",dueDate:r.due_date||"",assignee:r.assignee||"",pointId:r.point_id||"",customerId:r.customer_id||"",refType:r.ref_type||"",refId:r.ref_id||"",autoKey:r.auto_key||"",status:r.status,by:r.created_by,createdAt:r.created_at,doneAt:r.done_at||"",doneBy:r.done_by||""}),
  bonusops:r=>({id:r.id,customerId:r.customer_id,saleId:r.sale_id||"",kind:r.kind,amount:num(r.amount),note:r.note||"",by:r.staff_id,at:r.created_at}),
  preorders:r=>({id:r.id,num:r.num,pointId:r.point_id||"",customerId:r.customer_id,productId:r.product_id,unitId:r.unit_id||"",price:num(r.price),status:r.status,dueDate:r.due_date||"",note:r.note||"",
    saleId:r.sale_id||"",by:r.created_by,createdAt:r.created_at,arrivedAt:r.arrived_at,closedAt:r.closed_at,cancelReason:r.cancel_reason||""}),
  deals:r=>({id:r.id,num:r.num,kind:r.kind,customerId:r.customer_id,pointId:r.point_id||"",productId:r.product_id||"",unitId:r.unit_id||"",device:r.device,imei:r.imei||"",amount:num(r.amount),price:r.price==null?null:num(r.price),
    termDays:r.term_days,payMethod:r.pay_method||"",person:r.person||{},status:r.status,saleId:r.sale_id||"",debtId:r.debt_id||"",note:r.note||"",by:r.created_by,createdAt:r.created_at,closedAt:r.closed_at||""}),
  evotor:r=>({id:r.id,storeId:r.store_id,pointId:r.point_id||"",deviceId:r.device_id||"",type:r.doc_type,number:r.number||"",at:r.closed_at,total:num(r.total),payments:r.payments||{},items:r.items||[],
    saleId:r.sale_id||"",returnId:r.return_id||"",status:r.status,note:r.note||""}),
  log:r=>({id:r.id,at:r.created_at,by:r.staff_id,action:r.action,ref:r.ref||"",details:r.details||"",entity:r.entity||"",entityId:r.entity_id||""})
};
/* что загружать для каждого раздела */
const L={
  settings:async()=>(await all("settings")).map(M.settings),
  points:async()=>(await all("points")).map(M.points),
  warehouses:async()=>(await all("warehouses")).map(M.warehouses),
  categories:async()=>(await all("categories")).map(M.categories),
  suppliers:async()=>(await all("suppliers")).map(M.suppliers),
  services:async()=>(await all("services")).map(M.services),
  svcprices:async()=>(await all("service_prices")).map(r=>({id:r.id,serviceId:r.service_id,modelId:r.model_id,price:num(r.price),partId:r.part_product_id||""})),
  customers:async()=>(await all("customers")).map(M.customers),
  products:async()=>{const [ps,st]=await Promise.all([all("products",sel("products")),all("stock")]);const list=ps.map(M.products);const by=Object.fromEntries(list.map(p=>[p.id,p]));
    st.forEach(s=>{const p=by[s.product_id];if(p)p.stock[s.warehouse_id]=s.qty});return list},
  sales:async()=>(await all("sales","*,sale_items("+sel("sale_items")+"),sale_payments(*)",r=>r.order("created_at",{ascending:false}))).map(M.sales),
  returns:async()=>(await all("returns","*,return_items(*,sale_items(product_id,name,price"+(secured()?"":",cost")+"))")).map(M.returns),
  docs:async()=>(await all("stock_docs","*,stock_doc_lines("+sel("stock_doc_lines")+")")).map(M.docs),
  movements:async()=>(await q(sb.from("stock_movements").select("*").order("created_at",{ascending:false}).limit(1000),"movements")).map(M.movements),
  shifts:async()=>(await all("shifts")).map(M.shifts),
  cashops:async()=>(await all("cash_ops","*",r=>r.order("created_at",{ascending:false}))).map(M.cashops),
  staff:async()=>(await all("staff")).map(M.staff),
  staffreq:async()=>(await all("staff_requests")).map(M.staffreq),
  units:async()=>(await all("units",sel("units"))).map(M.units),
  models:async()=>(await all("apple_models","*",r=>r.order("sort"))).map(M.models),
  siteorders:async()=>(await all("site_orders","*",r=>r.order("created_at",{ascending:false}))).map(M.siteorders),
  sprices:async()=>App.can("cost")?(await all("supplier_prices")).map(M.sprices):[],
  finaccounts:async()=>App.can("finance")?(await all("fin_accounts")).map(M.finaccounts):[],
  fincats:async()=>App.can("finance")?(await all("fin_categories")).map(M.fincats):[],
  finops:async()=>App.can("finance")?(await all("fin_ops")).map(M.finops):[],
  debts:async()=>App.can("finance")?(await all("debts")).map(M.debts):[],
  finplans:async()=>App.can("finance")?(await all("fin_plans")).map(M.finplans):[],
  repairs:async()=>(await all("repairs","*,repair_services(*),repair_parts("+sel("repair_parts")+"),repair_history(*),repair_photos(*),repair_part_requests(*)",r=>r.order("created_at",{ascending:false}))).map(M.repairs),
  porders:async()=>App.can("stock")?(await all("purchase_orders","*,purchase_order_lines(*)",r=>r.order("created_at",{ascending:false}))).map(M.porders):[],
  payrules:async()=>(await all("pay_rules")).map(M.payrules),
  unitcosts:async()=>App.can("cost")||App.me.role==="master"?(await all("unit_costs")).map(M.unitcosts):[],
  waitlist:async()=>(await all("waitlist","*",r=>r.order("created_at",{ascending:false}))).map(M.waitlist),
  lostdemand:async()=>(await q(sb.from("lost_demand").select("*").order("created_at",{ascending:false}).limit(3000),"lost_demand")).map(M.lostdemand),
  tasks:async()=>(await all("tasks","*",r=>r.order("created_at",{ascending:false}))).map(M.tasks),
  bonusops:async()=>(await all("bonus_ops")).map(M.bonusops),
  preorders:async()=>(await all("preorders","*",r=>r.order("created_at",{ascending:false}))).map(M.preorders),
  deals:async()=>(await all("buy_deals","*",r=>r.order("created_at",{ascending:false}))).map(M.deals),
  evotor:async()=>App.can("sale")||App.can("reports")?(await q(sb.from("evotor_receipts").select("id,store_id,point_id,device_id,doc_type,number,closed_at,total,payments,items,sale_id,return_id,status,note").order("closed_at",{ascending:false}).limit(5000),"evotor")).map(M.evotor):[],
  log:async()=>(await q(sb.from("audit_log").select("*").order("created_at",{ascending:false}).limit(500),"log")).map(M.log)
};
/* таблица базы → разделы, которые нужно перечитать */
const T={settings:["settings"],points:["points"],warehouses:["warehouses"],categories:["categories"],suppliers:["suppliers"],services:["services"],
  customers:["customers"],products:["products"],stock:["products"],stock_movements:["movements"],stock_docs:["docs"],stock_doc_lines:["docs"],
  sales:["sales"],sale_items:["sales"],sale_payments:["sales"],returns:["returns"],return_items:["returns"],shifts:["shifts"],cash_ops:["cashops"],
  staff:["staff"],staff_requests:["staffreq"],audit_log:["log"],units:["units"],apple_models:["models"],site_orders:["siteorders"],supplier_prices:["sprices"],
  fin_accounts:["finaccounts"],fin_categories:["fincats"],fin_ops:["finops"],debts:["debts"],fin_plans:["finplans"],
  repairs:["repairs"],repair_services:["repairs"],repair_parts:["repairs"],repair_history:["repairs"],repair_photos:["repairs"],repair_part_requests:["repairs"],service_prices:["svcprices"],
  purchase_orders:["porders"],purchase_order_lines:["porders"],pay_rules:["payrules"],
  unit_costs:["unitcosts"],waitlist:["waitlist"],lost_demand:["lostdemand"],tasks:["tasks"],bonus_ops:["bonusops"],buy_deals:["deals"],preorders:["preorders"],evotor_receipts:["evotor"]};

App.reload = async function(cols){
  cols=[...new Set(cols)].filter(c=>L[c]&&!(App.wsSkip&&App.wsSkip(c)));
  await loadCols();
  const res=await Promise.allSettled(cols.map(c=>L[c]()));
  res.forEach((r,i)=>{if(r.status==="fulfilled")S[cols[i]]=r.value;else console.warn(cols[i],r.reason)});
  await applyCosts(cols);
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
  async reset(email){const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw new Error(/rate limit/i.test(error.message)?"Слишком много писем — подождите несколько минут или попросите владельца прислать ссылку для входа":error.message)},
  async setPassword(pw){const {error}=await sb.auth.updateUser({password:pw});if(error)throw new Error(/different|same/i.test(error.message)?"Новый пароль должен отличаться от старого":/weak|short|least/i.test(error.message)?"Слишком простой пароль: минимум 8 символов":error.message);try{await sb.rpc("staff_password_changed")}catch(e){}},
  async checkPassword(pw){const {error}=await sb.auth.signInWithPassword({email:App.me.email,password:pw});if(error)throw new Error("Текущий пароль неверный")},
  async setEmail(email){const {error}=await sb.auth.updateUser({email},{emailRedirectTo:location.origin+location.pathname});if(error)throw new Error(/registered|exists/i.test(error.message)?"Этот email уже занят":error.message)},
  async signOutAll(){await sb.auth.signOut({scope:"global"});location.reload()},
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
  App.me.role=st.role;App.me.pointId=st.point_id;App.me.name=st.full_name;App.me.phone=st.phone||"";
  if(st.must_change_password){App.showLogin("newpass",{forced:true});return}
  sb.rpc("staff_touch").then(()=>{},()=>{});
  try{const saved=localStorage.getItem("icase_point");if(saved)App.ui.pointId=saved}catch(e){}
  if(App.pickWs)App.pickWs();
  await App.reload(Object.keys(L));
  App.banner("");subscribe();App.route();
};
App.claimOwner = async name=>{await q(sb.rpc("claim_owner",{p_name:name}),"claim_owner");location.reload()};
App.requestAccess = async name=>{await q(sb.from("staff_requests").upsert({id:App.me.id,email:App.me.email,full_name:name}),"staff_requests")};

/* ---------- запись ---------- */
const snake=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined));
App.api = {
  // автозадачи: повторно с тем же auto_key не создаются
  tasksAuto:async rows=>{if(!rows.length)return;await q(sb.from("tasks").upsert(rows,{onConflict:"auto_key",ignoreDuplicates:true}),"tasks");App.refresh("tasks")},
  upsertRule:async row=>{await q(sb.from("pay_rules").upsert(row,{onConflict:"staff_id"}).select(),"pay_rules");App.refresh("pay_rules")},
  insert:async(table,row)=>{const d=await q(sb.from(table).insert(snake(row)).select(sel(table)).single(),table);App.refresh(table);return d},
  insertMany:async(table,rows)=>{if(!rows.length)return[];const d=await q(sb.from(table).insert(rows.map(snake)).select(sel(table)),table);App.refresh(table);return d},
  update:async(table,id,patch,key="id")=>{const d=await q(sb.from(table).update(snake(patch)).eq(key,id).select(SECURED.includes(table)?"id":"*"),table);if(!d.length)throw new Error("Нет прав на изменение или запись не найдена");App.refresh(table);return d[0]},
  remove:async(table,id,key="id")=>{await q(sb.from(table).delete().eq(key,id),table);App.refresh(table)},
  invoke:async(fn,body)=>{const {data,error}=await sb.functions.invoke(fn,{body:body||{}});if(error){let m=error.message;try{const j=await error.context.json();m=j.error||m}catch(e){}throw new Error(m)}return data},
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
