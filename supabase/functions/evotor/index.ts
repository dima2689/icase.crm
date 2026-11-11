// Edge-функция evotor: обмен CRM ↔ Облако Эвотор.
//   POST {action:"test"}           — проверить токен, вернуть список магазинов Эвотора (их ID вписываются в точки CRM)
//   POST {action:"push_products"}  — выгрузить товары, цены и остатки на кассы каждой точки
//   POST {action:"pull", days?}    — забрать чеки продажи/возврата и сверить с продажами CRM (по расписанию каждые 10 минут)
//   POST /evotor/hook?key=…        — вебхук Облака «Отправить чек»: чек приходит сразу после пробития
// Доступ: владелец/управляющий (JWT), расписание (x-cron-token) или вебхук (ключ из Vault).
import { createClient } from "npm:@supabase/supabase-js@2";
import { docsFromHook, listStores, mapDoc, pullDocs, pushProducts } from "./evo.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-token" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args || {});
    if (error) throw new Error(fn + ": " + error.message);
    return data;
  };
  try {
    const url = new URL(req.url);
    const cfg = await rpc("evotor_config");
    // --- вебхук Облака Эвотор ---
    if (url.pathname.replace(/\/+$/, "").endsWith("/hook")) {
      const key = url.searchParams.get("key") || "";
      if (!cfg.hook_key || key !== cfg.hook_key) return json({ error: "Неверный ключ" }, 401);
      let body: any = null; try { body = await req.json(); } catch { body = null; }
      const rows = docsFromHook(body).map(mapDoc).filter(Boolean);
      const r = rows.length ? await rpc("evotor_ingest", { p: rows }) : { new: 0 };
      return json({ ok: true, ...r });
    }
    // --- кто вызывает ---
    const cron = req.headers.get("x-cron-token");
    let allowed = cron ? await rpc("site_check_cron", { p_token: cron }) : false;
    if (!allowed) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const { data } = await db.auth.getUser(jwt);
        if (data && data.user) {
          const { data: st } = await db.from("staff").select("role,is_active").eq("id", data.user.id).maybeSingle();
          allowed = !!st && st.is_active !== false && ["owner", "manager"].includes(st.role);
        }
      }
    }
    if (!allowed) return json({ error: "Нет доступа" }, 401);
    if (!cfg.token) return json({ error: "Токен Эвотора не задан: «Настройки → Эвотор»" }, 400);
    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const action = body.action || "pull";
    if (action === "test") {
      const stores = await listStores(fetch, cfg.token);
      return json({ ok: true, stores: stores.map((s: any) => ({ id: s.id || s.uuid, name: s.name, address: s.address })) });
    }
    const stores = (cfg.stores || []).filter((s: any) => s.store_id);
    if (!stores.length) return json({ error: "Ни у одной точки не указан ID магазина Эвотора" }, 400);
    if (action === "push_products") {
      const out = [];
      for (const s of stores) {
        try { const goods = await rpc("evotor_products", { p_wh: s.wh }); out.push({ point: s.name, sent: await pushProducts(fetch, cfg.token, s.store_id, goods || []) }); }
        catch (e) { out.push({ point: s.name, error: String((e as Error).message || e) }); }
      }
      return json({ ok: out.every((x: any) => !x.error), result: out });
    }
    if (action === "pull") {
      const days = Math.min(31, Math.max(1, Number(body.days) || 2));
      const since = Date.now() - days * 864e5;
      const out = [];
      for (const s of stores) {
        try { const rows = await pullDocs(fetch, cfg.token, s.store_id, since); const r = rows.length ? await rpc("evotor_ingest", { p: rows }) : { new: 0, matched: 0 }; out.push({ point: s.name, got: rows.length, ...r }); }
        catch (e) { out.push({ point: s.name, error: String((e as Error).message || e) }); }
      }
      return json({ ok: out.every((x: any) => !x.error), result: out });
    }
    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
