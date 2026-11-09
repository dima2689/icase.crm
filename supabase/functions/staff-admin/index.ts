// Edge-функция staff-admin: управление сотрудниками (только владелец). Сервисный ключ — только внутри функции.
import { createClient } from "npm:@supabase/supabase-js@2";
import { run } from "./handler.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: null as any };
  if (!who?.user) return json({ error: "Нужно войти" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const q = async (p: PromiseLike<{ data: any; error: any }>) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
  try {
    const r = await run(who.user.id, body, db.auth.admin as any, {
      staff: (id) => q(db.from("staff").select("*").eq("id", id).maybeSingle()),
      staffList: () => q(db.from("staff").select("id,email")),
      insertStaff: async (row) => { await q(db.from("staff").upsert(row)); },
      mark: async (id, patch) => { await q(db.rpc("staff_admin_mark", { p_id: id, p_patch: patch })); },
      audit: async (by, action, ref, details) => { await q(db.from("audit_log").insert({ staff_id: by, action, ref, details: details || "" })); },
      sendRecovery: async (email, redirectTo) => { const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo }); if (error) throw error; },
      removeRequest: async (id) => { await q(db.from("staff_requests").delete().eq("id", id)); },
    });
    return json(r.body, r.status);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
