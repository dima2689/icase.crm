// Edge-функция site-sync: запускается по расписанию (pg_cron, заголовок x-cron-token)
// или вручную из CRM владельцем/управляющим (кнопка «Выгрузить сейчас»).
import { createClient } from "npm:@supabase/supabase-js@2";
import { syncRun, wooClient } from "./sync.ts";

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
  // кто вызывает
  const token = req.headers.get("x-cron-token");
  let allowed = token ? await rpc("site_check_cron", { p_token: token }) : false;
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
  try {
    let total = { jobs: 0 } as Record<string, unknown>;
    for (let i = 0; i < 5; i++) {                       // до 500 заданий за запуск
      const r = await syncRun(rpc, (cfg) => cfg.url && cfg.woo_key && cfg.woo_secret ? wooClient(cfg.url, cfg.woo_key, cfg.woo_secret) : null, console.log);
      total = { ...r, jobs: Number(total.jobs) + Number(r.jobs) };
      if (!r.jobs || (r as any).skipped || Number(r.jobs) < 100) break;
    }
    return json(total);
  } catch (e) {
    await rpc("site_sync_log", { p_error: String((e as Error).message || e) }).catch(() => {});
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
