// Как товар отдаётся своему сайту (Next.js и др.): чистый JSON без закупочных цен.
// Набор полей — по настройкам CRM «Что передавать на сайт». Этот файл одинаковый в site-api и site-sync.
export type Fields = {
  create: { categories: boolean; attributes: boolean; description: boolean; photos: boolean };
  update: Record<string, boolean>;
  attrs: { brand: boolean; model: boolean; memory: boolean; color: boolean; condition: boolean; warranty: boolean; battery: boolean; kit: boolean; used: boolean; extra: boolean };
  global_attrs: boolean;
};
export const DEFAULT_FIELDS: Fields = {
  create: { categories: true, attributes: true, description: true, photos: true },
  update: { price: true, stock: true, status: true, name: false, categories: false, attributes: false, description: false, photos: false },
  attrs: { brand: true, model: true, memory: true, color: true, condition: true, warranty: true, battery: true, kit: true, used: true, extra: true },
  global_attrs: true,
};
export function fieldsOf(cfg: any): Fields {
  const f = (cfg && cfg.fields) || {};
  return { create: { ...DEFAULT_FIELDS.create, ...(f.create || {}) }, update: { ...DEFAULT_FIELDS.update, ...(f.update || {}) },
    attrs: { ...DEFAULT_FIELDS.attrs, ...(f.attrs || {}) }, global_attrs: f.global_attrs !== false };
}
const USED: Record<string, string> = { cycles: "Циклы зарядки", body: "Корпус", screen: "Экран", repair: "Ремонт", parts: "Заменённые детали",
  faceid: "Face ID / Touch ID", truetone: "True Tone", icloud: "iCloud", simlock: "Привязка к оператору", region: "Регион", defects: "Особенности" };
const TR: Record<string, string> = { "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya" };
/** ЧПУ-адрес товара: «iPhone 15 Pro 256 ГБ» → «iphone-15-pro-256-gb» + хвост артикула, чтобы был уникальным. */
export function slugOf(name: string, sku: string) {
  const base = String(name || "").toLowerCase().split("").map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const tail = String(sku || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8);
  return tail ? `${base}-${tail}` : base;
}
/** Товар для сайта. it — позиция из site_feed. */
export function shape(it: any, f: Fields = DEFAULT_FIELDS) {
  const A = f.attrs, C = f.create;
  const specs: { name: string; value: string }[] = [];
  const add = (on: boolean, name: string, v: unknown) => {
    if (!on || v === null || v === undefined) return;
    const val = Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "да" : "нет") : String(v);
    if (val.trim()) specs.push({ name, value: val });
  };
  add(A.brand, "Бренд", it.brand); add(A.model, "Модель", it.model); add(A.memory, "Память", it.memory); add(A.color, "Цвет", it.color);
  add(A.condition, "Состояние", it.condition); add(A.warranty, "Гарантия", it.warranty ? it.warranty + " мес." : null);
  for (const [k, v] of Object.entries(it.attrs || {})) if (typeof v === "string" || typeof v === "number") add(A.extra, k, v);
  if (it.kind === "unit") {
    add(A.battery, "Ёмкость АКБ", it.battery != null ? it.battery + "%" : null); add(A.kit, "Комплект", it.kit);
    for (const [k, v] of Object.entries(it.used || {})) if (USED[k]) add(A.used, USED[k], v);
  }
  const qty = Math.max(0, Math.floor(it.qty || 0));
  const o: Record<string, unknown> = {
    id: it.crm_id, sku: it.sku, slug: slugOf(it.name, it.sku), type: it.kind === "unit" ? "used_unit" : "product",
    name: it.name, price: Number(it.price || 0), in_stock: qty > 0, qty, visible: !!it.visible,
  };
  if (C.categories) o.category = it.categories || [];
  if (C.attributes) {
    o.specs = specs;
    // те же характеристики отдельными полями — удобно для фильтров на сайте
    if (A.brand) o.brand = it.brand || null; if (A.model) o.model = it.model || null; if (A.memory) o.memory = it.memory || null;
    if (A.color) o.color = it.color || null; if (A.condition) o.condition = it.condition || null; if (A.warranty) o.warranty_months = it.warranty || null;
    if (it.kind === "unit" && A.battery) o.battery = it.battery ?? null;
  }
  if (C.description) o.description = it.description || null;
  if (C.photos) o.photos = (it.photos || []).filter((u: string) => /^https?:\/\//.test(u));
  return o;
}
