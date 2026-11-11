// API для сайта. Все запросы — с заголовком X-Api-Key (ключ из CRM «Настройки → Сайт»); вызывайте только с сервера сайта.
//   GET  /site-api/catalog      — товары: ?q= &category= &in_stock=1 &type=product|used_unit &sort=price|-price|name &page= &per_page= (до 200)
//   GET  /site-api/product      — один товар: ?slug= | ?sku= | ?id=
//   GET  /site-api/categories   — дерево категорий с количеством товаров в наличии
//   POST /site-api/order        — заказ с сайта (простой формат или формат WooCommerce), товар резервируется в CRM
//   GET  /site-api/order-status — статус заказа для покупателя: ?num=С-…&phone=последние 4 цифры
//   GET  /site-api/repair-status — статус ремонта: ?num=Р-…&phone=последние 4 цифры
//   GET  /site-api/repair-quote  — смета ремонта по ссылке из сообщения клиенту: ?num=Р-…&t=токен
//   POST /site-api/repair-decide — решение клиента по смете: {num, t, decision:"yes"|"no", comment}
//   POST /site-api/woo-order    — веб-хук WooCommerce (подпись X-WC-Webhook-Signature)
//   GET  /site-api/feed         — весь каталог одним списком (совместимость)
import { fieldsOf, shape, slugOf } from "./shape.ts";
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<any>;

export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-api-key, x-wc-webhook-signature, x-wc-webhook-topic" };
const json = (b: unknown, s = 200, cache = false) => new Response(JSON.stringify(b), { status: s,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...(cache ? { "Cache-Control": "public, max-age=60" } : {}) } });

export async function hmacBase64(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let s = ""; for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

/** Простой формат заказа своего сайта → формат, который понимает CRM (как у WooCommerce). */
export function normalizeOrder(o: any) {
  if (o && Array.isArray(o.line_items)) return o; // уже формат WooCommerce
  const c = o.customer || {};
  const [first, ...rest] = String(c.name || "").trim().split(/\s+/);
  const items = (o.items || []).map((i: any, k: number) => ({ id: k + 1, sku: i.sku || "", product_id: 0, quantity: Number(i.qty || i.quantity || 1),
    total: String(Number(i.price || 0) * Number(i.qty || i.quantity || 1)), name: i.name || i.sku || "Товар" }));
  const total = o.total != null ? Number(o.total) : items.reduce((a: number, i: any) => a + Number(i.total), 0);
  // id заказа на сайте: число или строка; для строки берём устойчивый числовой хэш
  let id = Number(o.id);
  if (!Number.isSafeInteger(id) || id <= 0) { let h = 0; for (const ch of String(o.id || o.number || Date.now())) h = (h * 31 + ch.charCodeAt(0)) % 9007199254740; id = h || Date.now(); }
  return {
    id, number: String(o.number || o.id || id), status: o.paid ? "processing" : (o.status || "pending"),
    billing: { first_name: first || "", last_name: rest.join(" "), phone: c.phone || "", email: c.email || "" },
    shipping: { city: o.city || "", address_1: o.address || "" }, shipping_lines: o.delivery ? [{ method_title: o.delivery }] : [],
    payment_method_title: o.payment || "", customer_note: o.comment || "", total: String(total), line_items: items,
  };
}

export async function handle(req: Request, rpc: Rpc): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  const cfg = await rpc("site_config");
  if (!cfg.api_key) return json({ error: "Обмен с сайтом не настроен: создайте ключ в CRM (Настройки → Сайт)" }, 503);
  const apiKey = req.headers.get("x-api-key") || url.searchParams.get("key") || "";
  const authed = safeEq(apiKey, cfg.api_key);
  const f = fieldsOf(cfg);
  const P = url.searchParams;

  // ---------- каталог ----------
  if (req.method === "GET" && ["catalog", "product", "categories", "feed"].includes(route || "")) {
    if (!authed) return json({ error: "Неверный ключ" }, 401);
    const items = (await rpc("site_feed", { p_ids: null }) as any[]).filter((i) => i.visible).map((i) => shape(i, f));
    if (route === "feed") return json({ updated_at: new Date().toISOString(), count: items.length, items }, 200, true);
    if (route === "product") {
      const it = items.find((i: any) => (P.get("slug") && i.slug === P.get("slug")) || (P.get("sku") && i.sku === P.get("sku")) || (P.get("id") && i.id === P.get("id")));
      return it ? json(it, 200, true) : json({ error: "Товар не найден или снят с продажи" }, 404);
    }
    if (route === "categories") {
      const tree: Record<string, { name: string; count: number; children: Record<string, number> }> = {};
      for (const i of items as any[]) {
        const [top, sub] = (i.category || ["Без категории"]) as string[];
        const t = (tree[top] ||= { name: top, count: 0, children: {} });
        if (i.in_stock) { t.count++; if (sub) t.children[sub] = (t.children[sub] || 0) + 1; }
        else if (sub && !(sub in t.children)) t.children[sub] = 0;
      }
      return json(Object.values(tree).map((t) => ({ name: t.name, slug: slugOf(t.name, ""), count: t.count,
        children: Object.entries(t.children).map(([name, count]) => ({ name, slug: slugOf(name, ""), count })) })), 200, true);
    }
    // catalog
    let list = items as any[];
    const q = norm(P.get("q")); if (q) { const w = q.split(" "); list = list.filter((i) => w.every((x) => norm([i.name, i.sku, ...(i.specs || []).map((s: any) => s.value)].join(" ")).includes(x))); }
    const cat = P.get("category"); if (cat) { const c = norm(cat); list = list.filter((i) => (i.category || []).some((x: string) => norm(x) === c || slugOf(x, "") === cat)); }
    if (P.get("in_stock") === "1") list = list.filter((i) => i.in_stock);
    const type = P.get("type"); if (type) list = list.filter((i) => i.type === type);
    const sort = P.get("sort") || "";
    if (sort === "price") list.sort((a, b) => a.price - b.price); else if (sort === "-price") list.sort((a, b) => b.price - a.price);
    else if (sort === "name") list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else list.sort((a, b) => Number(b.in_stock) - Number(a.in_stock));
    const per = Math.min(200, Math.max(1, Number(P.get("per_page")) || 50)), page = Math.max(1, Number(P.get("page")) || 1);
    return json({ total: list.length, page, per_page: per, items: list.slice((page - 1) * per, page * per) }, 200, true);
  }

  // ---------- статус заказа ----------
  if (req.method === "GET" && route === "order-status") {
    if (!authed) return json({ error: "Неверный ключ" }, 401);
    const r = await rpc("site_order_public", { p_num: P.get("num") || "", p_phone4: P.get("phone") || "" });
    return r ? json(r) : json({ error: "Заказ не найден" }, 404);
  }

  // ---------- статус ремонта ----------
  if (req.method === "GET" && route === "repair-status") {
    if (!authed) return json({ error: "Неверный ключ" }, 401);
    const r = await rpc("repair_public", { p_num: P.get("num") || "", p_phone4: P.get("phone") || "" });
    if (!r) return json({ error: "Ремонт не найден — проверьте номер квитанции и последние 4 цифры телефона" }, 404);
    const L: Record<string, string> = { new: "Принят", diag: "Диагностика", approve: "Ждём вашего согласия", work: "В работе", parts: "Ждём запчасть", ready: "Готов — можно забирать", done: "Выдан", cancel: "Отказ от ремонта" };
    return json({ ...r, status_label: L[r.status] || r.status, history: (r.history || []).map((h: any) => ({ ...h, label: L[h.status] || h.status })) });
  }

  // ---------- согласование ремонта клиентом по ссылке ----------
  if (req.method === "GET" && route === "repair-quote") {
    if (!authed) return json({ error: "Неверный ключ" }, 401);
    const r = await rpc("repair_quote", { p_num: P.get("num") || "", p_token: P.get("t") || "" });
    return r ? json(r) : json({ error: "Ссылка недействительна" }, 404);
  }
  if (req.method === "POST" && route === "repair-decide") {
    if (!authed) return json({ error: "Неверный ключ" }, 401);
    let b: any; try { b = await req.json(); } catch { return json({ error: "Ожидается JSON" }, 400); }
    if (!["yes", "no"].includes(b?.decision)) return json({ error: "decision: yes или no" }, 400);
    try {
      const r = await rpc("repair_client_decide", { p_num: String(b.num || ""), p_token: String(b.t || ""), p_decision: b.decision, p_comment: String(b.comment || "").slice(0, 500) });
      return json({ ok: true, ...r });
    } catch (e) { return json({ error: (e as Error).message || "Не удалось сохранить решение" }, 409); }
  }

  // ---------- заказы ----------
  if ((route === "woo-order" || route === "order") && req.method === "POST") {
    const raw = await req.text();
    if (route === "woo-order") {
      if (/^webhook_id=\d+/.test(raw)) return json({ ok: true, ping: true });
      const sig = req.headers.get("x-wc-webhook-signature") || "";
      if (!sig || !safeEq(sig, await hmacBase64(cfg.api_key, raw))) return json({ error: "Неверная подпись вебхука" }, 401);
    } else if (!authed) return json({ error: "Неверный ключ" }, 401);
    if (!cfg.orders) return json({ ok: false, error: "Приём заказов выключен в CRM" }, 409);
    let order: any;
    try { order = JSON.parse(raw); } catch { return json({ error: "Ожидается JSON заказа" }, 400); }
    if (!order || (!order.id && !order.number)) return json({ error: "В заказе нет id или number" }, 400);
    if (route === "order") {
      order = normalizeOrder(order);
      if (!order.line_items.length) return json({ error: "В заказе нет товаров (items)" }, 400);
      if (String(order.billing.phone).replace(/\D/g, "").length < 10) return json({ error: "Нужен телефон покупателя (customer.phone)" }, 400);
    }
    const id = await rpc("site_order_upsert", { p: order });
    const st = id ? await rpc("site_order_public", { p_num: "С-" + order.number, p_phone4: String(order.billing?.phone || "") }) : null;
    return json({ ok: true, crm_order: id, num: st ? st.num : null, status: st ? st.status : null });
  }
  return json({ error: "Неизвестный адрес. Доступно: GET catalog, product, categories, order-status, repair-status, repair-quote, feed; POST order, woo-order, repair-decide" }, 404);
}
