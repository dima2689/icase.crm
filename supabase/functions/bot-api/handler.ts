// API для бота Telegram магазина (служба icase-bot на этом же сервере). Все запросы — с заголовком X-Bot-Key.
// Ключ создаёт и кладёт в настройки бота workflow «Bot connect» на сервере; людям его вводить не нужно.
//   GET  /bot-api/ping                 — проверка ключа
//   GET  /bot-api/lookup?q=            — IMEI / серийный / штрихкод / номер ремонта / слова названия
//   GET  /bot-api/summary?day=ГГГГ-ММ-ДД — сводка за день
//   GET  /bot-api/events?limit=        — новые события (ремонты, предзаказы) для сообщений сотрудникам
//   POST /bot-api/events/done {ids}    — события отправлены
//   POST /bot-api/tradein {id, model, …} — заявка на оценку trade-in → задача в CRM
//   Режим CRM_MODE в боте (каталог, продажи, клиенты, правка карточек — из CRM):
//   GET  /bot-api/catalog              — все товары с остатками и категории
//   GET  /bot-api/product?id=          — карточка для редактора; POST /bot-api/product {id, expect, fields{name,description,price}, actor}
//   GET  /bot-api/sales?kind=sale|return&from=&to=&offset=; GET /bot-api/finance?from=&to=
//   GET  /bot-api/customers?q=&offset=; GET /bot-api/customer?id=; GET /bot-api/customer-history?id=&kind=&offset=
//   POST /bot-api/customer {id?, updated?, name, phone, email, actor}
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<any>;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });

export function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, n: number) => (v === undefined || v === null ? "" : String(v)).slice(0, n);
const off = (v: string | null) => Math.min(Math.max(Number.parseInt(v || "0", 10) || 0, 0), 50000);

export async function handle(req: Request, rpc: Rpc): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/");
  const i = parts.indexOf("bot-api");
  const route = (i >= 0 ? parts.slice(i + 1) : parts.slice(-1)).join("/");
  const secret = await rpc("bot_api_secret");
  if (!secret) return json({ error: "Связь с ботом не настроена" }, 503);
  if (!safeEq(req.headers.get("x-bot-key") || "", secret)) return json({ error: "Неверный ключ" }, 401);
  const P = url.searchParams;
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  if (req.method === "GET" && route === "ping") return json({ ok: true });
  if (req.method === "GET" && route === "lookup") {
    const q = (P.get("q") || "").trim().slice(0, 120);
    if (q.length < 2) return json({ error: "Слишком короткий запрос" }, 400);
    return json(await rpc("bot_lookup", { p_q: q, p_limit: Number(P.get("limit") || 8) }));
  }
  if (req.method === "GET" && route === "summary") {
    const day = P.get("day") || "";
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Дата в формате ГГГГ-ММ-ДД" }, 400);
    return json(await rpc("bot_summary", { p_day: day || null }));
  }
  if (req.method === "GET" && route === "events") return json(await rpc("bot_events_take", { p_limit: Number(P.get("limit") || 50) }));
  if (req.method === "POST" && route === "events/done") {
    const b = await body();
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0).slice(0, 500);
    return json({ done: ids.length ? await rpc("bot_events_done", { p_ids: ids }) : 0 });
  }
  if (req.method === "POST" && route === "tradein") {
    const b = await body();
    const pick: Record<string, unknown> = {};
    for (const k of ["id", "model", "memory", "color", "imei", "serial", "condition", "note", "battery", "amount", "status", "creator"]) {
      const v = b[k];
      if (v !== undefined && v !== null && v !== "") pick[k] = String(v).slice(0, k === "note" || k === "condition" ? 2000 : 200);
    }
    if (!pick.id || !pick.model) return json({ error: "Нужны id и model" }, 400);
    return json(await rpc("bot_tradein", { p: pick }));
  }
  if (req.method === "GET" && route === "catalog") return json(await rpc("bot_catalog"));
  if (route === "product") {
    if (req.method === "GET") {
      const id = P.get("id") || "";
      if (!UUID.test(id)) return json({ error: "Некорректный товар" }, 400);
      const r = await rpc("bot_product", { p_id: id });
      return r ? json(r) : json({ error: "Товар не найден" }, 404);
    }
    if (req.method === "POST") {
      const b = await body();
      if (!UUID.test(String(b.id || ""))) return json({ error: "Некорректный товар" }, 400);
      const f = b.fields || {}, fields: Record<string, string> = {};
      for (const k of ["name", "description", "price"]) if (f[k] !== undefined && f[k] !== null) fields[k] = str(f[k], k === "description" ? 4096 : 255);
      return json(await rpc("bot_product_update", { p_id: b.id, p_expect: str(b.expect, 64), p_fields: fields, p_actor: str(b.actor, 100) }));
    }
  }
  if (req.method === "GET" && (route === "sales" || route === "finance")) {
    const from = P.get("from") || "", to = P.get("to") || "";
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return json({ error: "Дата в формате ГГГГ-ММ-ДД" }, 400);
    if (route === "finance") {
      if (!from || !to) return json({ error: "Нужны from и to" }, 400);
      return json(await rpc("bot_finance", { p_from: from, p_to: to }));
    }
    return json(await rpc("bot_sales", { p_kind: P.get("kind") === "return" ? "return" : "sale", p_from: from || null, p_to: to || null, p_offset: off(P.get("offset")) }));
  }
  if (req.method === "GET" && route === "customers") return json(await rpc("bot_customers", { p_q: str(P.get("q"), 255), p_offset: off(P.get("offset")) }));
  if (req.method === "GET" && (route === "customer" || route === "customer-history")) {
    const id = P.get("id") || "";
    if (!UUID.test(id)) return json({ error: "Некорректный идентификатор клиента" }, 400);
    if (route === "customer-history") return json(await rpc("bot_customer_history", { p_id: id, p_kind: P.get("kind") === "return" ? "return" : "sale", p_offset: off(P.get("offset")) }));
    const r = await rpc("bot_customer", { p_id: id });
    return r ? json(r) : json({ error: "Клиент не найден" }, 404);
  }
  if (req.method === "POST" && route === "customer") {
    const b = await body();
    if (b.id && !UUID.test(String(b.id))) return json({ error: "Некорректный идентификатор клиента" }, 400);
    const p: Record<string, string> = {};
    for (const k of ["id", "updated", "name", "phone", "email"]) if (b[k]) p[k] = str(b[k], 255);
    return json(await rpc("bot_customer_save", { p, p_actor: str(b.actor, 100) }));
  }
  return json({ error: "Нет такого запроса" }, 404);
}
