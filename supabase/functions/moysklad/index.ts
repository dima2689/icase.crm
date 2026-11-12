// Edge-функция moysklad: перенос данных из МоегоСклада (только чтение, по шагам — браузер забирает страницы и сам пишет в CRM).
//   POST {token, action:"check"}                 — проверить токен, сколько товаров/контрагентов, склады, виды цен
//   POST {token, action:"page", kind, offset}     — страница: store | folder | product | variant | counterparty | stock
// Токен МоегоСклада приходит в запросе и нигде не сохраняется. Доступ: владелец и управляющий.
import { createClient } from "npm:@supabase/supabase-js@2";
import { check, page } from "./ms.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await db.auth.getUser(jwt) : { data: null as any };
    if (!data?.user) return json({ error: "Нужно войти" }, 401);
    const { data: st } = await db.from("staff").select("role,is_active").eq("id", data.user.id).maybeSingle();
    if (!st || st.is_active === false || !["owner", "manager"].includes(st.role)) return json({ error: "Перенос доступен владельцу и управляющему" }, 403);
    let body: any = {}; try { body = await req.json(); } catch { body = {}; }
    const token = String(body.token || "").trim();
    if (!/^[\w.\-]{20,200}$/.test(token)) return json({ error: "Укажите токен МоегоСклада" }, 400);
    if (body.action === "check") return json(await check(fetch, token));
    if (body.action === "page") return json(await page(fetch, token, String(body.kind || ""), body.offset));
    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
