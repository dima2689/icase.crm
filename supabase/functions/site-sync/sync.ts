// iCase CRM → WooCommerce: выгрузка цен, остатков, новых товаров и б/у экземпляров.
// Чистая логика без привязки к Supabase — rpc и woo передаются снаружи (так её можно проверить на поддельном сайте).

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<any>;
export type Woo = (method: string, path: string, body?: unknown) => Promise<any>;

export type FeedItem = {
  kind: "product" | "unit"; crm_id: string; product_id: string; woo_id: number | null; sku: string; name: string;
  price: number; qty: number; visible: boolean; categories: string[]; brand?: string; model?: string; memory?: string;
  color?: string; condition?: string; battery?: number | null; kit?: string; used?: Record<string, unknown>;
  attrs?: Record<string, unknown>; description?: string | null; photos?: string[]; warranty?: number | null;
};

import { DEFAULT_FIELDS, fieldsOf, shape, type Fields } from "./shape.ts";
export { DEFAULT_FIELDS, fieldsOf, type Fields };

/** Basic-авторизация WooCommerce REST API (ключи создаются в WooCommerce → Настройки → Дополнительно → REST API). */
export function wooClient(baseUrl: string, key: string, secret: string, fetcher: typeof fetch = fetch): Woo {
  const root = baseUrl.replace(/\/+$/, "") + "/wp-json/wc/v3/";
  const auth = "Basic " + btoa(key + ":" + secret);
  return async (method, path, body) => {
    const r = await fetcher(root + path, {
      method, headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new Error(`WooCommerce ${r.status}: ${(data && data.message) || String(text).slice(0, 200)}`);
    return data;
  };
}

const USED_LABELS: Record<string, string> = {
  cycles: "Циклы зарядки", body: "Корпус", screen: "Экран", repair: "Ремонт", parts: "Заменённые детали",
  faceid: "Face ID / Touch ID", truetone: "True Tone", icloud: "iCloud", simlock: "Привязка к оператору",
  region: "Регион", defects: "Особенности",
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const USED_ATTR: Record<string, string> = { cycles: "Циклы зарядки", body: "Корпус", screen: "Экран", repair: "Ремонт", faceid: "Face ID / Touch ID", truetone: "True Tone", region: "Регион" };
/** Характеристики товара для сайта. globals: глобальные атрибуты WooCommerce (имя → id), чтобы работали фильтры каталога. */
export function attributes(it: FeedItem, f: Fields = DEFAULT_FIELDS, globals?: Map<string, number>) {
  const a: { id?: number; name?: string; options: string[]; visible: boolean }[] = [];
  const seen = new Set<string>();
  const add = (on: boolean, name: string, v: unknown) => {
    if (!on || v === null || v === undefined) return;
    const val = Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "да" : "нет") : String(v);
    if (!val.trim() || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const gid = f.global_attrs && globals ? globals.get(name.toLowerCase()) : undefined;
    a.push(gid ? { id: gid, options: [val], visible: true } : { name, options: [val], visible: true });
  };
  const A = f.attrs;
  add(A.brand, "Бренд", it.brand); add(A.model, "Модель", it.model); add(A.memory, "Память", it.memory); add(A.color, "Цвет", it.color);
  add(A.condition, "Состояние", it.condition);
  add(A.warranty, "Гарантия", it.warranty ? it.warranty + " мес." : null);
  for (const [k, v] of Object.entries(it.attrs || {})) if (typeof v === "string" || typeof v === "number") add(A.extra, k, v);
  if (it.kind === "unit") {
    add(A.battery, "Ёмкость АКБ", it.battery != null ? it.battery + "%" : null); add(A.kit, "Комплект", it.kit);
    for (const [k, v] of Object.entries(it.used || {})) if (USED_ATTR[k]) add(A.used, USED_ATTR[k], v);
  }
  return a;
}

export function unitDescription(it: FeedItem) {
  const rows: string[] = [];
  if (it.condition) rows.push(`<li><b>Состояние:</b> ${esc(it.condition)}</li>`);
  if (it.battery != null) rows.push(`<li><b>Ёмкость АКБ:</b> ${esc(it.battery)}%</li>`);
  if (it.kit) rows.push(`<li><b>Комплект:</b> ${esc(it.kit)}</li>`);
  for (const [k, v] of Object.entries(it.used || {})) {
    const val = Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "да" : "нет") : v;
    if (val !== "" && val != null && USED_LABELS[k]) rows.push(`<li><b>${USED_LABELS[k]}:</b> ${esc(val)}</li>`);
  }
  return (it.description ? `<p>${esc(it.description)}</p>` : "") + (rows.length ? `<ul>${rows.join("")}</ul>` : "") +
    "<p>Устройство прошло диагностику перед продажей.</p>";
}

/** Найти или создать путь категорий («Смартфоны / iPhone») в WooCommerce; кэш на один прогон. */
async function categoryIds(woo: Woo, path: string[], cache: Map<string, number>) {
  let parent = 0; const ids: number[] = [];
  for (const name of path) {
    const key = parent + "/" + name.toLowerCase();
    let id = cache.get(key);
    if (id === undefined) {
      const found: any[] = await woo("GET", `products/categories?per_page=100&search=${encodeURIComponent(name)}`);
      const hit = (found || []).find((c) => String(c.name).toLowerCase() === name.toLowerCase() && (c.parent || 0) === parent);
      id = hit ? hit.id : (await woo("POST", "products/categories", { name, parent })).id;
      cache.set(key, id!);
    }
    ids.push(id!); parent = id!;
  }
  return ids.length ? [{ id: ids[ids.length - 1] }] : [];
}

/** Что меняется у существующей карточки — по настройкам (по умолчанию цена, остаток и видимость; описание и фото на сайте не трогаем). */
export async function updatePayload(it: FeedItem, f: Fields = DEFAULT_FIELDS, ctx?: Ctx) {
  const qty = Math.max(0, Math.floor(it.qty || 0)), U = f.update;
  const p: Record<string, unknown> = {};
  if (U.price) p.regular_price = String(it.price ?? 0);
  if (U.stock) { p.manage_stock = true; p.stock_quantity = qty; p.stock_status = qty > 0 ? "instock" : "outofstock"; }
  if (U.status) {
    if (!it.visible) p.status = "draft";                       // снят с сайта, продан или архив — прячем
    else if (it.kind === "unit") p.status = "publish";        // б/у экземпляр снова доступен
  }
  if (U.name) p.name = it.name;
  if (U.categories && ctx) p.categories = await ctx.categories(it.categories || []);
  if (U.attributes) p.attributes = attributes(it, f, ctx && ctx.globals);
  if (U.description) p.description = descriptionOf(it);
  if (U.photos) p.images = imagesOf(it);
  return p;
}
const descriptionOf = (it: FeedItem) => it.kind === "unit" ? unitDescription(it) : (it.description ? `<p>${esc(it.description)}</p>` : "");
const imagesOf = (it: FeedItem) => (it.photos || []).filter((u) => /^https?:\/\//.test(u)).map((src) => ({ src }));

/** Новая карточка: название, артикул, цена и остаток всегда; остальное — по настройкам. */
export async function createPayload(it: FeedItem, newStatus: string, f: Fields = DEFAULT_FIELDS, ctx?: Ctx) {
  const qty = Math.max(0, Math.floor(it.qty || 0)), C = f.create;
  const p: Record<string, unknown> = {
    name: it.name, sku: it.sku, type: "simple", regular_price: String(it.price ?? 0),
    manage_stock: true, stock_quantity: qty, stock_status: qty > 0 ? "instock" : "outofstock",
    status: it.kind === "unit" ? "publish" : newStatus,
  };
  if (C.categories && ctx) p.categories = await ctx.categories(it.categories || []);
  if (C.attributes) p.attributes = attributes(it, f, ctx && ctx.globals);
  if (C.description) p.description = descriptionOf(it);
  if (C.photos) p.images = imagesOf(it);
  return p;
}

export type Ctx = { categories: (path: string[]) => Promise<{ id: number }[]>; globals?: Map<string, number> };
/** Контекст прогона: категории и глобальные атрибуты сайта (загружаются один раз). */
export async function makeCtx(woo: Woo, f: Fields): Promise<Ctx> {
  const cache = new Map<string, number>();
  let globals: Map<string, number> | undefined;
  if (f.global_attrs) {
    try { const list: any[] = await woo("GET", "products/attributes?per_page=100"); globals = new Map((list || []).map((x) => [String(x.name).toLowerCase(), x.id])); }
    catch { globals = undefined; }
  }
  return { categories: (path) => categoryIds(woo, path, cache), globals };
}

export async function syncRun(rpc: Rpc, makeWoo: (cfg: any) => Woo | null, log: (m: string) => void = () => {}) {
  const cfg = await rpc("site_config");
  const jobs: any[] = await rpc("site_jobs_take", { p_limit: 100 });
  if (!jobs.length) return { jobs: 0 };
  if ((cfg.mode || "custom") === "custom") return notifySite(rpc, cfg, jobs, log);
  const woo = cfg.sync ? makeWoo(cfg) : null;
  if (!woo) {
    // выгрузка выключена или нет ключей — задания остаются в очереди
    await rpc("site_jobs_finish", { p_done: [], p_failed: jobs.map((j) => ({ id: j.id, error: cfg.sync ? "Нет адреса сайта или ключей WooCommerce" : "Выгрузка на сайт выключена" })) });
    return { jobs: jobs.length, skipped: true };
  }
  const done: number[] = []; const failed: { id: number; error: string }[] = [];
  const f = fieldsOf(cfg);
  const stat = { created: 0, updated: 0, linked: 0, orders: 0 };

  // 1) статусы заказов
  for (const j of jobs.filter((j) => j.action === "order_status")) {
    try { await woo("PUT", `orders/${j.payload.woo_id}`, { status: j.payload.status }); done.push(j.id); stat.orders++; }
    catch (e) { failed.push({ id: j.id, error: String((e as Error).message || e) }); }
  }

  // 2) товары
  const pj = jobs.filter((j) => j.action === "sync_product");
  const ids = [...new Set(pj.map((j) => j.payload.product_id))];
  if (ids.length) {
    const errByProduct = new Map<string, string>();
    try {
      const ctx = await makeCtx(woo, f);
      const feed: FeedItem[] = await rpc("site_feed", { p_ids: ids });
      const creates: { it: FeedItem; body: any }[] = []; const updates: { it: FeedItem; body: any }[] = [];
      for (const it of feed) {
        try {
          let wooId = it.woo_id;
          if (!wooId) {
            const found: any[] = await woo("GET", `products?sku=${encodeURIComponent(it.sku)}`);
            if (found && found.length) { wooId = found[0].id; await rpc("site_set_woo", { p_kind: it.kind, p_id: it.crm_id, p_woo: wooId }); stat.linked++; }
          }
          if (wooId) updates.push({ it, body: { id: wooId, ...(await updatePayload(it, f, ctx)) } });
          else if (it.visible && (it.kind === "product" || it.qty > 0)) creates.push({ it, body: await createPayload(it, cfg.new_status || "draft", f, ctx) });
        } catch (e) { errByProduct.set(it.product_id, String((e as Error).message || e)); }
      }
      for (let i = 0; i < Math.max(creates.length, updates.length); i += 50) {
        const c = creates.slice(i, i + 50), u = updates.slice(i, i + 50);
        if (!c.length && !u.length) continue;
        const res = await woo("POST", "products/batch", { create: c.map((x) => x.body), update: u.map((x) => x.body) });
        for (let k = 0; k < (res.create || []).length; k++) {
          const r = res.create[k], it = c[k].it;
          if (r.error) errByProduct.set(it.product_id, `${it.sku}: ${r.error.message || r.error.code}`);
          else if (r.id) { await rpc("site_set_woo", { p_kind: it.kind, p_id: it.crm_id, p_woo: r.id }); stat.created++; }
        }
        (res.update || []).forEach((r: any, k: number) => {
          const it = u[k].it;
          if (r.error) errByProduct.set(it.product_id, `${it.sku}: ${r.error.message || r.error.code}`); else stat.updated++;
        });
      }
    } catch (e) { for (const id of ids) errByProduct.set(id, String((e as Error).message || e)); }
    for (const j of pj) { const err = errByProduct.get(j.payload.product_id); if (err) failed.push({ id: j.id, error: err }); else done.push(j.id); }
  }
  // прочие задания (неизвестные) просто закрываем
  for (const j of jobs) if (!["order_status", "sync_product"].includes(j.action)) done.push(j.id);

  await rpc("site_jobs_finish", { p_done: done, p_failed: failed });
  await rpc("site_sync_log", { p_error: failed.length ? failed.slice(0, 3).map((f) => f.error).join(" | ") : null });
  log(JSON.stringify({ ...stat, failed: failed.length }));
  return { jobs: jobs.length, ...stat, failed: failed.length };
}

/** HMAC-SHA256 (base64) — подпись уведомлений сайту. */
export async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let s = ""; for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
/** Отправить уведомление своему сайту (Next.js): POST hook_url, заголовки X-Icase-Event и X-Icase-Signature. */
export async function postHook(cfg: any, payload: unknown, fetcher: typeof fetch = fetch) {
  const body = JSON.stringify(payload);
  const r = await fetcher(cfg.hook_url, { method: "POST", body, headers: { "Content-Type": "application/json",
    "X-Icase-Event": String((payload as any).event || ""), "X-Icase-Signature": await sign(cfg.hook_secret || "", body) } });
  if (!r.ok) throw new Error(`Сайт ответил ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return true;
}
/** Свой сайт: сайт сам читает каталог через API, CRM только сообщает, что изменилось (чтобы сайт сбросил кэш). */
export async function notifySite(rpc: Rpc, cfg: any, jobs: any[], log: (m: string) => void = () => {}, fetcher: typeof fetch = fetch) {
  const f = fieldsOf(cfg);
  const ids = [...new Set(jobs.filter((j) => j.action === "sync_product").map((j) => j.payload.product_id))];
  const orders = jobs.filter((j) => j.action === "order_status").map((j) => ({ id: j.payload.woo_id, status: j.payload.status }));
  const all = jobs.map((j) => j.id);
  if (!cfg.hook_url) { await rpc("site_jobs_finish", { p_done: all, p_failed: [] }); await rpc("site_sync_log", { p_error: null }); return { jobs: jobs.length, notified: false }; }
  try {
    const feed: any[] = ids.length ? await rpc("site_feed", { p_ids: ids }) : [];
    const products = feed.map((i) => shape(i, f));
    await postHook(cfg, { event: "catalog.updated", at: new Date().toISOString(),
      products: products.filter((p: any) => p.visible), removed: products.filter((p: any) => !p.visible).map((p: any) => ({ id: p.id, sku: p.sku, slug: p.slug })),
      orders }, fetcher);
    await rpc("site_jobs_finish", { p_done: all, p_failed: [] });
    await rpc("site_sync_log", { p_error: null });
    log(JSON.stringify({ notified: products.length, orders: orders.length }));
    return { jobs: jobs.length, notified: true, products: products.length, orders: orders.length };
  } catch (e) {
    const err = String((e as Error).message || e);
    await rpc("site_jobs_finish", { p_done: [], p_failed: jobs.map((j) => ({ id: j.id, error: err })) });
    await rpc("site_sync_log", { p_error: err });
    return { jobs: jobs.length, notified: false, failed: jobs.length, error: err };
  }
}

/** Предпросмотр: что уйдёт на сайт по товару (без обращения к сайту; категории — названиями). */
export async function preview(rpc: Rpc, productId: string) {
  const cfg = await rpc("site_config"); const f = fieldsOf(cfg);
  const ctx: Ctx = { categories: async (path) => path.length ? [{ id: 0, name: path.join(" / ") } as any] : [] };
  const feed: FeedItem[] = await rpc("site_feed", { p_ids: [productId] });
  if ((cfg.mode || "custom") === "custom") return { mode: "custom", fields: f, items: feed.map((it) => ({ kind: it.kind, sku: it.sku, visible: it.visible, api: shape(it, f) })) };
  const out = [];
  for (const it of feed) out.push({ kind: it.kind, sku: it.sku, woo_id: it.woo_id, visible: it.visible,
    create: await createPayload(it, cfg.new_status || "draft", f, ctx), update: await updatePayload(it, f, ctx) });
  return { fields: f, items: out };
}
/** Проверка подключения к WooCommerce. */
export async function testConnection(woo: Woo) {
  const products: any[] = await woo("GET", "products?per_page=1");
  let attrs: any[] = [];
  try { attrs = await woo("GET", "products/attributes?per_page=100"); } catch { /* права только на товары */ }
  return { ok: true, sample: products && products[0] ? products[0].name : null, global_attributes: (attrs || []).map((a) => a.name) };
}
