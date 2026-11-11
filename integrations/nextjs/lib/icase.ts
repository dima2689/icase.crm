// Клиент iCase CRM для сайта на Next.js (App Router). Используйте только на сервере:
// в серверных компонентах, route handlers и server actions — ключ API не должен попасть в браузер.
import "server-only";

const BASE = process.env.ICASE_API_URL!;   // https://<проект>.supabase.co/functions/v1/site-api
const KEY = process.env.ICASE_API_KEY!;    // ключ API из CRM: Настройки → Сайт

export type Spec = { name: string; value: string };
export type Product = {
  id: string; sku: string; slug: string; type: "product" | "used_unit";
  name: string; price: number; in_stock: boolean; qty: number; visible: boolean;
  category?: string[]; specs?: Spec[]; brand?: string | null; model?: string | null; memory?: string | null;
  color?: string | null; condition?: string | null; warranty_months?: number | null; battery?: number | null;
  description?: string | null; photos?: string[];
};
export type Category = { name: string; slug: string; count: number; children: { name: string; slug: string; count: number }[] };
export type CatalogQuery = { q?: string; category?: string; in_stock?: boolean; type?: "product" | "used_unit"; sort?: "price" | "-price" | "name"; page?: number; per_page?: number };

/** Тег кэша: по уведомлению CRM сайт сбрасывает его (см. app/api/icase/route.ts). */
export const ICASE_TAG = "icase-catalog";

async function get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== false) qs.set(k, v === true ? "1" : String(v));
  const r = await fetch(`${BASE}/${path}${qs.size ? "?" + qs : ""}`, {
    headers: { "X-Api-Key": KEY },
    next: { tags: [ICASE_TAG], revalidate: 300 },   // кэш 5 минут + мгновенный сброс по уведомлению CRM
  });
  if (r.status === 404) return null as T;
  if (!r.ok) throw new Error(`iCase CRM ${r.status}: ${await r.text()}`);
  return r.json();
}

export const getCatalog = (q: CatalogQuery = {}) =>
  get<{ total: number; page: number; per_page: number; items: Product[] }>("catalog", { ...q });
export const getProduct = (slug: string) => get<Product | null>("product", { slug });
export const getProductBySku = (sku: string) => get<Product | null>("product", { sku });
export const getCategories = () => get<Category[]>("categories");

export type OrderInput = {
  id: string | number;                       // номер заказа на вашем сайте
  customer: { name: string; phone: string; email?: string };
  items: { sku: string; qty: number; price: number; name?: string }[];
  delivery?: string; address?: string; city?: string; payment?: string; comment?: string;
  paid?: boolean; total?: number;
};
/** Отправить заказ в CRM: товар зарезервируется, заказ появится в CRM в разделе «Заказы». */
export async function createOrder(order: OrderInput) {
  const r = await fetch(`${BASE}/order`, { method: "POST", cache: "no-store",
    headers: { "X-Api-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(order) });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.error || `iCase CRM ${r.status}`);
  return data as { ok: true; num: string; status: string };
}
/** Статус заказа для покупателя: номер (С-…) и последние 4 цифры телефона. */
export async function getOrderStatus(num: string, phone4: string) {
  const r = await fetch(`${BASE}/order-status?num=${encodeURIComponent(num)}&phone=${encodeURIComponent(phone4)}`,
    { headers: { "X-Api-Key": KEY }, cache: "no-store" });
  return r.ok ? (await r.json() as { num: string; status: "new" | "confirmed" | "done" | "cancelled"; paid: boolean; total: number; items: { name: string; qty: number; price: number }[] }) : null;
}

/* ---------- согласование ремонта по ссылке ----------
   Ссылка в сообщении клиенту: https://<сайт>/repair/approve?n=Р-1001&t=<токен>  (токен выдаёт CRM) */
export type RepairQuote = {
  num: string; device: string; status: string; problem: string; diagnosis: string | null;
  works: { name: string; qty: number; price: number }[]; parts: { name: string; qty: number; price: number }[];
  total: number; paid: number; due_date: string | null; can_decide: boolean;
  decision: { decision: "yes" | "no"; at: string; sum: number; comment: string | null } | null;
  shop: { name: string; phone: string | null; address: string | null };
};
export async function getRepairQuote(num: string, t: string): Promise<RepairQuote | null> {
  const r = await fetch(`${BASE}/repair-quote?num=${encodeURIComponent(num)}&t=${encodeURIComponent(t)}`, { headers: { "X-Api-Key": KEY }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`iCase CRM ${r.status}: ${await r.text()}`);
  return r.json();
}
export async function decideRepair(num: string, t: string, decision: "yes" | "no", comment = ""): Promise<RepairQuote & { ok: boolean }> {
  const r = await fetch(`${BASE}/repair-decide`, { method: "POST", headers: { "X-Api-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ num, t, decision, comment }), cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `iCase CRM ${r.status}`);
  return j;
}
