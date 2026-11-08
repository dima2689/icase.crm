// Локальная проверка обмена: настоящая база (локальный Postgres со схемой CRM) + поддельный WooCommerce.
// Запуск: deno run -A supabase/functions/tests/local_test.ts   (нужен psql и база ts на /tmp:5499)
import { preview, syncRun, testConnection, wooClient } from "../site-sync/sync.ts";
import { handle, hmacBase64 } from "../site-api/handler.ts";

const DB = ["-h", "/tmp", "-p", "5499", "-U", "postgres", "-d", Deno.env.get("TDB") || "ts", "-tAq", "-v", "ON_ERROR_STOP=1"];
async function sql(q: string) {
  const out = await new Deno.Command("psql", { args: [...DB, "-c", q] }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
}
const lit = (v: unknown, t: string) => v === null || v === undefined ? `null::${t}` :
  t.endsWith("[]") ? `'{${(v as unknown[]).join(",")}}'::${t}` : `'${(typeof v === "string" ? v : JSON.stringify(v)).replace(/'/g, "''")}'::${t}`;
const SIG: Record<string, Record<string, string>> = {
  site_config: {}, site_jobs_take: { p_limit: "int" }, site_jobs_finish: { p_done: "bigint[]", p_failed: "jsonb" },
  site_feed: { p_ids: "uuid[]" }, site_set_woo: { p_kind: "text", p_id: "uuid", p_woo: "bigint" }, site_sync_log: { p_error: "text" },
  site_order_upsert: { p: "jsonb" }, site_check_cron: { p_token: "text" },
};
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v, SIG[fn][k])}`).join(", ");
  const r = await sql(`select to_jsonb(${fn}(${a}))`);
  return r ? JSON.parse(r) : null;
};

// ---- поддельный WooCommerce ----
const woo = { products: [] as any[], cats: [] as any[], orders: {} as Record<string, string>, calls: [] as string[], nextId: 1000 };
woo.products.push({ id: 555, sku: "CASE1", name: "Чехол (уже на сайте)", regular_price: "1000", stock_quantity: 0, status: "publish" });
const srv = Deno.serve({ port: 8899, onListen() {} }, async (req) => {
  const u = new URL(req.url); const path = u.pathname.replace("/wp-json/wc/v3/", "");
  woo.calls.push(req.method + " " + path + u.search);
  if (req.headers.get("authorization") !== "Basic " + btoa("ck_test:cs_test")) return new Response(JSON.stringify({ message: "auth" }), { status: 401 });
  const body = req.method === "GET" ? null : await req.json();
  const J = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  if (path === "products" && req.method === "GET") return J(woo.products.filter((p) => p.sku === u.searchParams.get("sku")));
  if (path === "products/attributes" && req.method === "GET") return J([{ id: 5, name: "Память" }, { id: 6, name: "Цвет" }]);
  if (path === "products/categories" && req.method === "GET") return J(woo.cats.filter((c) => c.name.toLowerCase().includes((u.searchParams.get("search") || "").toLowerCase())));
  if (path === "products/categories" && req.method === "POST") { const c = { id: woo.nextId++, name: body.name, parent: body.parent }; woo.cats.push(c); return J(c); }
  if (path === "products/batch") {
    const create = (body.create || []).map((b: any) => {
      if (woo.products.some((p) => p.sku === b.sku)) return { id: 0, error: { code: "product_invalid_sku", message: "SKU уже есть" } };
      const p = { id: woo.nextId++, ...b }; woo.products.push(p); return p;
    });
    const update = (body.update || []).map((b: any) => { const p = woo.products.find((x) => x.id === b.id); if (!p) return { id: b.id, error: { code: "x", message: "нет" } }; Object.assign(p, b); return p; });
    return J({ create, update });
  }
  const m = path.match(/^orders\/(\d+)$/); if (m && req.method === "PUT") { woo.orders[m[1]] = body.status; return J({ id: +m[1], status: body.status }); }
  return new Response(JSON.stringify({ message: "not found " + path }), { status: 404 });
});

let fails = 0;
const ok = (c: unknown, m: string) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };

// подготовка: ключи, выгрузка включена
await sql(`select site_api_key(); select site_set_credentials('http://127.0.0.1:8899','ck_test','cs_test'); update settings set site_sync=true, site_orders=true, site_new_status='publish'`);
const makeWoo = (cfg: any) => wooClient(cfg.url, cfg.woo_key, cfg.woo_secret);

// 1) первый прогон: всё уходит на сайт
await sql(`select site_resync()`);
let r = await syncRun(rpc, makeWoo);
console.log("  прогон 1:", JSON.stringify(r));
const bySku = (s: string) => woo.products.find((p) => p.sku === s);
ok(bySku("CASE1")?.id === 555 && bySku("CASE1")?.stock_quantity === 5 && bySku("CASE1")?.regular_price === "990", "существующий чехол связан по SKU, цена 990 и остаток 5 (3 шт на «Сервисе» не считаются)");
ok(await sql(`select woo_id from products where sku='CASE1'`) === "555", "woo_id записан в CRM");
ok(bySku("IP16")?.stock_quantity === 2 && bySku("IP16")?.status === "publish", "новый iPhone создан, остаток 2");
const u1 = bySku("U-353000000000013");
ok(u1 && u1.stock_quantity === 1 && /АКБ 88%/.test(u1.name) && /Ёмкость АКБ/.test(u1.description), "б/у экземпляр создан отдельной карточкой с АКБ и описанием");
ok(woo.cats.some((c) => c.name === "Б/у техника") && woo.cats.some((c) => c.name === "Смартфоны"), "категории созданы на сайте");
ok(await sql(`select count(*) from integration_jobs where target='woocommerce' and status='pending'`) === "0", "очередь пуста");

// 2) продажа в магазине → остаток на сайте уменьшается, б/у прячется
await sql(`insert into shifts(point_id) select id from points limit 1`);
await sql(`select create_sale((select id from warehouses where name='Зал'),null,jsonb_build_array(jsonb_build_object('product_id',(select id from products where sku='CASE1'),'qty',1,'price',990),jsonb_build_object('product_id',(select product_id from units where imei='353000000000013'),'unit_id',(select id from units where imei='353000000000013'),'qty',1,'price',39000)),'[{"method":"card","amount":39990}]'::jsonb)`);
r = await syncRun(rpc, makeWoo);
console.log("  прогон 2:", JSON.stringify(r));
ok(bySku("CASE1")?.stock_quantity === 4, "после продажи в магазине на сайте чехлов 4");
ok(bySku("U-353000000000013")?.status === "draft" && bySku("U-353000000000013")?.stock_quantity === 0, "проданный б/у спрятан с сайта");

// 3) цена меняется в CRM → на сайте тоже
await sql(`update products set price=1190 where sku='CASE1'`);
await syncRun(rpc, makeWoo);
ok(bySku("CASE1")?.regular_price === "1190", "новая цена ушла на сайт");

// 3б) атрибуты и выбор полей
const ip16 = bySku("IP16");
ok(ip16.attributes.some((x: any) => x.id === 5) && ip16.attributes.some((x: any) => x.name === "Состояние"), "«Память» ушла глобальным атрибутом сайта (для фильтров), «Состояние» — обычным");
await sql(`update settings set site_fields = jsonb_set(site_fields,'{update,price}','false')`);
await sql(`update products set price=1999 where sku='CASE1'`);
await syncRun(rpc, makeWoo);
ok(bySku("CASE1")?.regular_price === "1190", "выключили «цену при обновлении» — цена на сайте не меняется");
await sql(`update settings set site_fields = jsonb_set(jsonb_set(site_fields,'{update,price}','true'),'{update,name}','true')`);
await sql(`update products set name='Чехол прозрачный' where sku='CASE1'`);
await syncRun(rpc, makeWoo);
ok(bySku("CASE1")?.regular_price === "1999" && bySku("CASE1")?.name === "Чехол прозрачный", "включили «название при обновлении» — ушли и цена, и новое название");
await sql(`update settings set site_fields = jsonb_set(site_fields,'{attrs,memory}','false')`);
const pv = await preview(rpc, await sql(`select id from products where sku='IP16'`));
ok(pv.items[0].create.attributes.every((x: any) => x.id !== 5 && x.name !== "Память"), "предпросмотр: выключенная «Память» не передаётся");
ok((await testConnection(wooClient("http://127.0.0.1:8899", "ck_test", "cs_test"))).ok, "проверка подключения проходит");
let bad = false; try { await testConnection(wooClient("http://127.0.0.1:8899", "ck_x", "cs_x")); } catch { bad = true; }
ok(bad, "с неверными ключами проверка подключения сообщает об ошибке");
await sql(`update products set price=1190, name='Чехол' where sku='CASE1'; update settings set site_fields = jsonb_set(site_fields,'{update,name}','false')`);
await syncRun(rpc, makeWoo);

// 4) заказ с сайта через вебхук (с подписью)
const key = (await rpc("site_config")).api_key;
const order = { id: 7001, number: "7001", status: "processing", total: "2380", billing: { first_name: "Тест", phone: "+79001112233" },
  line_items: [{ id: 1, product_id: 555, sku: "CASE1", quantity: 2, total: "2380", name: "Чехол" }] };
const raw = JSON.stringify(order);
let res = await handle(new Request("http://x/functions/v1/site-api/woo-order", { method: "POST", body: raw, headers: { "x-wc-webhook-signature": "wrong" } }), rpc);
ok(res.status === 401, "вебхук с неверной подписью отклонён");
res = await handle(new Request("http://x/functions/v1/site-api/woo-order", { method: "POST", body: "webhook_id=12" }), rpc);
ok(res.status === 200, "проверочный пинг WooCommerce принят");
res = await handle(new Request("http://x/functions/v1/site-api/woo-order", { method: "POST", body: raw, headers: { "x-wc-webhook-signature": await hmacBase64(key, raw) } }), rpc);
ok(res.status === 200 && (await res.json()).crm_order, "заказ принят");
ok(await sql(`select status||':'||coalesce(problems,'') from site_orders where woo_id=7001`) === "new:", "заказ в CRM без проблем");
ok(await sql(`select qty from stock s join warehouses w on w.id=s.warehouse_id join products p on p.id=s.product_id where w.name='Резерв · сайт' and p.sku='CASE1'`) === "2", "2 чехла в резерве");
await syncRun(rpc, makeWoo);
ok(bySku("CASE1")?.stock_quantity === 2, "на сайте чехлов 2 (2 зарезервированы)");

// 5) отмена в CRM → резерв снят, статус ушёл на сайт
await sql(`select site_order_release((select id from site_orders where woo_id=7001),'тест')`);
await syncRun(rpc, makeWoo);
ok(woo.orders["7001"] === "cancelled", "статус «отменён» отправлен на сайт");
ok(bySku("CASE1")?.stock_quantity === 4, "остаток на сайте вернулся");

// 6) фид
res = await handle(new Request("http://x/functions/v1/site-api/feed"), rpc);
ok(res.status === 401, "фид без ключа закрыт");
res = await handle(new Request("http://x/functions/v1/site-api/feed?key=" + key), rpc);
const feed = await res.json();
ok(res.status === 200 && feed.items.some((i: any) => i.sku === "CASE1"), "фид с ключом отдаёт каталог");
ok(!JSON.stringify(feed).includes("cost"), "в фиде нет закупочных цен");

// 7) выключенная выгрузка не трогает сайт
await sql(`update settings set site_sync=false; update products set price=1290 where sku='CASE1'`);
r = await syncRun(rpc, makeWoo);
ok((r as any).skipped && bySku("CASE1")?.regular_price === "1190", "при выключенной выгрузке сайт не меняется, задание ждёт");

await srv.shutdown();
console.log(fails ? `ОШИБОК: ${fails}` : "ВСЁ ПРОШЛО");
Deno.exit(fails ? 1 : 0);
