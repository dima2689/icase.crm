// Edge-функция bot-api: бот Telegram магазина ↔ CRM. Доступ — по ключу бота (X-Bot-Key).
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

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
    const msg = String((e as Error).message || e);
    return new Response(JSON.stringify({ error: /[А-Яа-яЁё]/.test(msg) ? msg : "Внутренняя ошибка CRM" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
