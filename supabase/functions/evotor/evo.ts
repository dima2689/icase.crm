// Обмен с Облаком Эвотор: товары и цены → кассы, чеки → CRM. Чистые функции — проверяются локально без сети.
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const API = "https://api.evotor.ru";
const V2 = "application/vnd.evotor.v2+json";

export function headers(token: string, bulk = false): Record<string, string> {
  return { "Accept": V2, "Content-Type": bulk ? "application/vnd.evotor.v2+bulk+json" : V2, "X-Authorization": token, "Authorization": "Bearer " + token };
}
async function call(f: Fetch, token: string, path: string, init: RequestInit = {}, bulk = false) {
  const r = await f(API + path, { ...init, headers: { ...headers(token, bulk), ...(init.headers || {}) } });
  const text = await r.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const msg = body && (body.message || body.error || (body.errors && JSON.stringify(body.errors))) || text || r.statusText;
    throw new Error(`Эвотор ${r.status}: ${String(msg).slice(0, 300)}${r.status === 401 ? " — проверьте токен" : ""}`);
  }
  return body;
}

/** Документ Эвотора (SELL / PAYBACK) → строка для evotor_ingest. Остальные типы — null. */
export function mapDoc(d: any) {
  if (!d) return null;
  const type = String(d.type || "").toUpperCase();
  if (!["SELL", "PAYBACK"].includes(type)) return null;
  const b = d.body || {};
  let cash = 0, card = 0;
  for (const p of b.payments || []) {
    const s = Number(p.sum) || 0;
    if (String(p.type).toUpperCase() === "CASH") cash += s; else card += s;   // ELECTRON, ADVANCE и прочее — безнал
  }
  const items = (b.positions || []).map((p: any) => ({
    product_id: p.product_id || null, name: p.product_name || p.name || "", barcode: (p.barcodes && p.barcodes[0]) || p.barcode || null,
    qty: Number(p.quantity) || 0, price: Number(p.price) || 0, sum: Number(p.result_sum ?? p.sum) || 0,
  }));
  const total = Number(b.result_sum ?? b.sum ?? (cash + card)) || items.reduce((a: number, i: any) => a + i.sum, 0);
  return { id: String(d.id), store_id: String(d.store_id || ""), device_id: d.device_id || null, doc_type: type, number: d.number != null ? String(d.number) : null,
    closed_at: d.close_date || d.closeDate || new Date().toISOString(), total: Math.round(total * 100) / 100,
    payments: { cash: Math.round(cash * 100) / 100, card: Math.round(card * 100) / 100 }, items };
}

/** Вебхук «Отправить чек»: тело бывает документом, массивом или обёрткой {data}/{items}. */
export function docsFromHook(body: any): any[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.items)) return body.items;
  if (body.data) return Array.isArray(body.data) ? body.data : [body.data];
  return [body];
}

/** Товар CRM → товар Эвотора (идентификатор = id товара в CRM, поэтому позиции чека сразу находят товар). */
export function mapProduct(p: any) {
  const o: Record<string, unknown> = {
    id: p.id, name: String(p.name || "Товар").slice(0, 100), type: p.type || "NORMAL", measure_name: p.measure_name || "шт",
    tax: p.tax || "NO_VAT", allow_to_sell: p.allow_to_sell !== false, price: Number(p.price) || 0, quantity: Math.max(0, Number(p.quantity) || 0),
  };
  if (p.cost_price != null) o.cost_price = Number(p.cost_price) || 0;
  if (p.article_number) o.article_number = String(p.article_number).slice(0, 20);
  if (p.barcodes && p.barcodes.length) o.barcodes = p.barcodes;
  return o;
}

export async function listStores(f: Fetch, token: string) {
  const r = await call(f, token, "/stores");
  return (r && (r.items || r)) || [];
}
/** Выгрузить товары на кассы магазина: PUT пачками до 5000. */
export async function pushProducts(f: Fetch, token: string, storeId: string, products: any[]) {
  let sent = 0;
  for (let i = 0; i < products.length; i += 5000) {
    const chunk = products.slice(i, i + 5000).map(mapProduct);
    await call(f, token, `/stores/${encodeURIComponent(storeId)}/products`, { method: "PUT", body: JSON.stringify(chunk) }, true);
    sent += chunk.length;
  }
  return sent;
}
/** Забрать чеки продажи и возврата с момента since (мс). */
export async function pullDocs(f: Fetch, token: string, storeId: string, since: number) {
  const out: any[] = [];
  let url = `/stores/${encodeURIComponent(storeId)}/documents?type=SELL,PAYBACK&since=${since}`;
  for (let page = 0; page < 50; page++) {
    const r = await call(f, token, url);
    for (const d of (r && r.items) || []) { const m = mapDoc(d); if (m) out.push(m); }
    const next = r && r.paging && r.paging.next_cursor;
    if (!next) break;
    url = `/stores/${encodeURIComponent(storeId)}/documents?cursor=${encodeURIComponent(next)}`;
  }
  return out;
}
