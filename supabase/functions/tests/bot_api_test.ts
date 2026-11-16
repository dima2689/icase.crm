// Проверка bot-api без сети: ключ, маршруты, очистка входных данных.
import { handle } from "../bot-api/handler.ts";
let fails = 0;
const ok = (c: unknown, m: string) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) fails++; };
const calls: [string, any][] = [];
const rpc = async (fn: string, a: Record<string, unknown> = {}) => {
  calls.push([fn, a]);
  if (fn === "bot_api_secret") return "k".repeat(48);
  if (fn === "bot_events_done") return (a.p_ids as number[]).length;
  return { fn };
};
const K = { "x-bot-key": "k".repeat(48) };
const r = (p: string, init: RequestInit = {}) => handle(new Request("http://x/functions/v1/bot-api/" + p, init), rpc);
ok((await r("ping")).status === 401, "без ключа — 401");
ok((await r("ping", { headers: { "x-bot-key": "k".repeat(47) + "x" } })).status === 401, "чужой ключ — 401");
ok((await (await r("ping", { headers: K })).json()).ok === true, "ping с ключом");
ok((await r("lookup?q=a", { headers: K })).status === 400, "короткий запрос — 400");
await r("lookup?q=" + encodeURIComponent("17 pro max"), { headers: K });
ok(calls.at(-1)![0] === "bot_lookup" && calls.at(-1)![1].p_q === "17 pro max", "lookup → bot_lookup");
ok((await r("summary?day=2026-1-1", { headers: K })).status === 400, "плохая дата — 400");
await r("summary", { headers: K }); ok(calls.at(-1)![1].p_day === null, "сводка за сегодня");
const d = await (await r("events/done", { method: "POST", headers: K, body: JSON.stringify({ ids: [1, "2", -3, "x", 1.5] }) })).json();
ok(d.done === 2 && JSON.stringify(calls.at(-1)![1].p_ids) === "[1,2]", "events/done берёт только целые id");
ok((await r("tradein", { method: "POST", headers: K, body: JSON.stringify({ model: "iPhone" }) })).status === 400, "trade-in без id — 400");
await r("tradein", { method: "POST", headers: K, body: JSON.stringify({ id: 5, model: "iPhone 13", amount: 21000, phone: "+79990000000", extra: 1 }) });
const p = calls.at(-1)![1].p;
ok(p.id === "5" && p.amount === "21000" && !("phone" in p) && !("extra" in p), "trade-in: только разрешённые поля, без телефона");
ok((await r("nope", { headers: K })).status === 404, "неизвестный маршрут — 404");
if (fails) { console.error(fails + " проверок не прошли"); Deno.exit(1); }
