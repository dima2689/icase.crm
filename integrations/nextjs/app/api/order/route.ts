// Оформление заказа: браузер → ваш сервер Next.js → iCase CRM (ключ API остаётся на сервере).
import { createOrder, getProductBySku } from "@/lib/icase";

export async function POST(req: Request) {
  const form = await req.json() as {
    name: string; phone: string; email?: string; delivery?: string; address?: string; comment?: string;
    cart: { sku: string; qty: number }[];
  };
  if (!form.phone || String(form.phone).replace(/\D/g, "").length < 10) return Response.json({ error: "Укажите телефон" }, { status: 400 });
  // цены берём из CRM, а не из браузера
  const items = [];
  for (const c of form.cart || []) {
    const p = await getProductBySku(c.sku);
    if (!p || !p.in_stock) return Response.json({ error: `Товара «${c.sku}» уже нет в наличии` }, { status: 409 });
    items.push({ sku: p.sku, name: p.name, qty: Math.min(Math.max(1, c.qty | 0), p.qty), price: p.price });
  }
  if (!items.length) return Response.json({ error: "Корзина пуста" }, { status: 400 });
  try {
    const r = await createOrder({ id: `web-${Date.now()}`, customer: { name: form.name, phone: form.phone, email: form.email },
      items, delivery: form.delivery, address: form.address, comment: form.comment });
    return Response.json({ ok: true, num: r.num });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
