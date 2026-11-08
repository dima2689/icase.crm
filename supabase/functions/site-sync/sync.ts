// iCase CRM → WooCommerce: выгрузка цен, остатков, новых товаров и б/у экземпляров.
// Чистая логика без привязки к Supabase — rpc и woo передаются снаружи (так её можно проверить на поддельном сайте).

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<any>;
export type Woo = (method: string, path: string, body?: unknown) => Promise<any>;

export type FeedItem = {
  kind: "product" | "unit"; crm_id: string; product_id: string; woo_id: number | null; sku: string; name: string;
  price: number; qty: number; visible: boolean; categories: string[]; brand?: string; model?: string; memory?: string;
  color?: string; condition?: string; battery?: number | null; kit?: string; used?: Record<string, unknown>;
  attrs?: Record<string, unknown>; description?: string | null; photos?: string[];
};

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

export function attributes(it: FeedItem) {
  const a: { name: string; options: string[]; visible: boolean }[] = [];
  const add = (name: string, v: unknown) => { if (v !== null && v !== undefined && String(v).trim() !== "") a.push({ name, options: [String(v)], visible: true }); };
  add("Бренд", it.brand); add("Модель", it.model); add("Память", it.memory); add("Цвет", it.color); add("Состояние", it.condition);
  if (it.kind === "unit") { add("Ёмкость АКБ", it.battery != null ? it.battery + "%" : null); add("Комплект", it.kit); }
  for (const [k, v] of Object.entries(it.attrs || {})) if (typeof v === "string" || typeof v === "number") add(k, v);
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

/** Поля для обновления существующей карточки: только цена, наличие и видимость (описание и фото на сайте не трогаем). */
export function updatePayload(it: FeedItem) {
  const qty = Math.max(0, Math.floor(it.qty || 0));
  const p: Record<string, unknown> = {
    regular_price: String(it.price ?? 0), manage_stock: true, stock_quantity: qty, stock_status: qty > 0 ? "instock" : "outofstock",
  };
  if (!it.visible) p.status = "draft";                       // снят с сайта, продан или архив — прячем
  if (it.kind === "unit" && it.visible) p.status = "publish"; // б/у экземпляр снова доступен
  return p;
}

export async function createPayload(woo: Woo, it: FeedItem, newStatus: string, cache: Map<string, number>) {
  return {
    ...updatePayload(it), name: it.name, sku: it.sku, type: "simple",
    status: it.kind === "unit" ? "publish" : newStatus,
    categories: await categoryIds(woo, it.categories || [], cache),
    attributes: attributes(it),
    description: it.kind === "unit" ? unitDescription(it) : (it.description ? `<p>${esc(it.description)}</p>` : ""),
    images: (it.photos || []).filter((u) => /^https?:\/\//.test(u)).map((src) => ({ src })),
  };
}

export async function syncRun(rpc: Rpc, makeWoo: (cfg: any) => Woo | null, log: (m: string) => void = () => {}) {
  const cfg = await rpc("site_config");
  const jobs: any[] = await rpc("site_jobs_take", { p_limit: 100 });
  if (!jobs.length) return { jobs: 0 };
  const woo = cfg.sync ? makeWoo(cfg) : null;
  if (!woo) {
    // выгрузка выключена или нет ключей — задания остаются в очереди
    await rpc("site_jobs_finish", { p_done: [], p_failed: jobs.map((j) => ({ id: j.id, error: cfg.sync ? "Нет адреса сайта или ключей WooCommerce" : "Выгрузка на сайт выключена" })) });
    return { jobs: jobs.length, skipped: true };
  }
  const done: number[] = []; const failed: { id: number; error: string }[] = [];
  const cache = new Map<string, number>();
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
      const feed: FeedItem[] = await rpc("site_feed", { p_ids: ids });
      const creates: { it: FeedItem; body: any }[] = []; const updates: { it: FeedItem; body: any }[] = [];
      for (const it of feed) {
        try {
          let wooId = it.woo_id;
          if (!wooId) {
            const found: any[] = await woo("GET", `products?sku=${encodeURIComponent(it.sku)}`);
            if (found && found.length) { wooId = found[0].id; await rpc("site_set_woo", { p_kind: it.kind, p_id: it.crm_id, p_woo: wooId }); stat.linked++; }
          }
          if (wooId) updates.push({ it, body: { id: wooId, ...updatePayload(it) } });
          else if (it.visible && (it.kind === "product" || it.qty > 0)) creates.push({ it, body: await createPayload(woo, it, cfg.new_status || "draft", cache) });
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
