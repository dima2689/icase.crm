// Edge-функция site-api: сайт → CRM (заказы) и каталог для сайта. Доступ — по ключу API из CRM.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle, cors } from "./handler.ts";

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args || {});
    if (error) throw new Error(error.message);
    return data;
  };
  try { return await handle(req, rpc); }
  catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
