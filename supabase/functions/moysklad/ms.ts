// Перенос из МоегоСклада (JSON API 1.2): чтение справочников и остатков. Только чтение, ничего в МоёмСкладе не меняется.
// Чистые функции — проверяются без сети (tests/moysklad_test.ts).
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const API = "https://api.moysklad.ru/api/remap/1.2";
export const PAGE = 1000;

// что можно читать (и как превратить строку МоегоСклада в строку для CRM)
export const KINDS: Record<string, { path: string; map: (r: any) => any }> = {
  store: { path: "/entity/store", map: (r) => ({ id: r.id, name: r.name || "Склад", address: r.address || null, archived: !!r.archived }) },
  folder: { path: "/entity/productfolder", map: (r) => ({ id: r.id, name: r.name || "Без названия", path: r.pathName || "", archived: !!r.archived }) },
  product: { path: "/entity/product", map: mapProduct },
  variant: { path: "/entity/variant", map: mapVariant },
  counterparty: { path: "/entity/counterparty", map: mapParty },
  stock: { path: "/report/stock/bystore", map: mapStock },
};

export const idOf = (href?: string) => (String(href || "").split("?")[0].split("/").pop() || "");
const rub = (v: any) => Math.round(Number(v || 0)) / 100;            // в МоёмСкладе суммы в копейках
const prices = (list: any[]) => {
  const o: Record<string, number> = {};
  for (const p of list || []) { const n = p?.priceType?.name || "Цена продажи"; o[n] = rub(p.value); }
  return o;
};
const codes = (b: any[]) => (b || []).map((x) => x && (x.ean13 || x.ean8 || x.code128 || x.gtin || x.upc)).filter(Boolean);

export function mapProduct(r: any) {
  return {
    id: r.id, name: r.name || "Без названия", article: r.article || "", code: r.code || "", barcodes: codes(r.barcodes),
    prices: prices(r.salePrices), buy: rub(r.buyPrice?.value), folder: idOf(r.productFolder?.meta?.href) || null,
    archived: !!r.archived, serial: !!r.isSerialTrackable, min: Number(r.minimumBalance) || 0, variants: Number(r.variantsCount) || 0,
    descr: r.description || "",
  };
}
export function mapVariant(r: any) {
  const chars: Record<string, string> = {};
  for (const c of r.characteristics || []) if (c?.name) chars[c.name] = String(c.value ?? "");
  return {
    id: r.id, product: idOf(r.product?.meta?.href), name: r.name || "", code: r.code || "", barcodes: codes(r.barcodes),
    prices: prices(r.salePrices), buy: rub(r.buyPrice?.value), archived: !!r.archived, chars,
  };
}
export function mapParty(r: any) {
  return {
    id: r.id, name: r.name || "", phone: r.phone || "", email: r.email || "", inn: r.inn || "", type: r.companyType || "legal",
    tags: r.tags || [], note: r.description || "", archived: !!r.archived,
  };
}
export function mapStock(r: any) {
  const by: Record<string, number> = {};
  for (const s of r.stockByStore || []) { const q = Number(s.stock) || 0; if (q) by[idOf(s.meta?.href)] = q; }
  return { id: idOf(r.meta?.href), type: r.meta?.type || "", by };
}

async function call(f: Fetch, token: string, url: string) {
  // Accept-Encoding не задаём: fetch сам просит gzip и распаковывает ответ (МойСклад без сжатия не отвечает)
  const r = await f(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json;charset=utf-8" } });
  const text = await r.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!r.ok) {
    const e = body?.errors?.[0]?.error || text.slice(0, 200) || r.statusText;
    throw new Error(`МойСклад ${r.status}: ${e}${r.status === 401 ? " — проверьте токен" : ""}${r.status === 403 ? " — у токена нет прав на этот раздел" : ""}`);
  }
  return body;
}

/** Одна страница (до 1000 строк) — уже в виде строк для CRM. */
export async function page(f: Fetch, token: string, kind: string, offset = 0) {
  const k = KINDS[kind]; if (!k) throw new Error("Неизвестный раздел: " + kind);
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const b = await call(f, token, `${API}${k.path}?limit=${PAGE}&offset=${off}`);
  const rows = (b?.rows || []).map(k.map);
  const size = Number(b?.meta?.size ?? rows.length);
  return { rows, size, next: off + PAGE < size ? off + PAGE : null };
}

/** Проверка токена и сколько чего лежит в МоёмСкладе. */
export async function check(f: Fetch, token: string) {
  const me = await call(f, token, `${API}/context/employee`);
  const count = async (kind: string) => Number((await call(f, token, `${API}${KINDS[kind].path}?limit=1`))?.meta?.size || 0);
  const out: Record<string, number> = {};
  for (const k of ["store", "folder", "product", "variant", "counterparty"]) out[k] = await count(k);
  let priceTypes: string[] = [];
  try { priceTypes = ((await call(f, token, `${API}/context/companysettings/pricetype`)) || []).map((p: any) => p.name).filter(Boolean); } catch { /* нет прав — возьмём из товаров */ }
  const stores = (await page(f, token, "store")).rows;
  return { user: me?.fullName || me?.name || "", counts: out, priceTypes, stores };
}
