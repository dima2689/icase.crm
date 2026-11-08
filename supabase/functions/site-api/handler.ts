// Приём данных с сайта. Маршруты:
//   POST /site-api/woo-order  — вебхук WooCommerce «Заказ создан/обновлён» (подпись X-WC-Webhook-Signature, секрет = ключ API из CRM)
//   POST /site-api/order      — то же для любого сайта: JSON в формате заказа WooCommerce, заголовок X-Api-Key
//   GET  /site-api/feed       — каталог для сайта (цены, наличие, характеристики), заголовок X-Api-Key или ?key=
// Логика без Supabase: rpc передаётся снаружи, чтобы её можно было проверить локально.
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<any>;

export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-api-key, x-wc-webhook-signature, x-wc-webhook-topic" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

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

export async function handle(req: Request, rpc: Rpc): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  const cfg = await rpc("site_config");
  if (!cfg.api_key) return json({ error: "Обмен с сайтом не настроен: создайте ключ в CRM (Настройки → Сайт)" }, 503);
  const apiKey = req.headers.get("x-api-key") || url.searchParams.get("key") || "";

  if (route === "feed" && req.method === "GET") {
    if (!safeEq(apiKey, cfg.api_key)) return json({ error: "Неверный ключ" }, 401);
    const items = (await rpc("site_feed", { p_ids: null }) as any[]).filter((i) => i.visible);
    return json({ updated_at: new Date().toISOString(), count: items.length, items });
  }

  if ((route === "woo-order" || route === "order") && req.method === "POST") {
    const raw = await req.text();
    if (route === "woo-order") {
      // WooCommerce при создании вебхука шлёт проверочный запрос «webhook_id=…» — отвечаем 200
      if (/^webhook_id=\d+/.test(raw)) return json({ ok: true, ping: true });
      const sig = req.headers.get("x-wc-webhook-signature") || "";
      if (!sig || !safeEq(sig, await hmacBase64(cfg.api_key, raw))) return json({ error: "Неверная подпись вебхука" }, 401);
    } else if (!safeEq(apiKey, cfg.api_key)) return json({ error: "Неверный ключ" }, 401);
    if (!cfg.orders) return json({ ok: true, ignored: "Приём заказов выключен в CRM" });
    let order: any;
    try { order = JSON.parse(raw); } catch { return json({ error: "Ожидается JSON заказа" }, 400); }
    if (!order || !order.id) return json({ error: "В заказе нет id" }, 400);
    const id = await rpc("site_order_upsert", { p: order });
    return json({ ok: true, crm_order: id });
  }
  return json({ error: "Неизвестный адрес. Доступно: GET /feed, POST /woo-order, POST /order" }, 404);
}
