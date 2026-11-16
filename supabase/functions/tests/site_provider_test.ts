// Проверка маршрутов provider-* в site-api без сети: ключ, проверка параметров, вызов нужной функции базы.
import { handle } from "../site-api/handler.ts";
let fails = 0;
const ok = (c: unknown, m: string) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) fails++; };
const calls: [string, any][] = [];
const rpc = async (fn: string, a: Record<string, unknown> = {}) => {
  calls.push([fn, a]);
  if (fn === "site_config") return { api_key: "k".repeat(48), mode: "custom" };
  if (fn === "site_provider_stock") return [];
  return { fn };
};
const K = { "x-api-key": "k".repeat(48) };
const r = (p: string, h: Record<string, string> = K) => handle(new Request("http://x/functions/v1/site-api/" + p, { headers: h }), rpc);
ok((await r("provider-lookups", {})).status === 401, "без ключа — 401");
await r("provider-lookups"); ok(calls.at(-1)![0] === "site_provider_lookups", "справочники");
await r("provider-catalog?offset=-3&limit=5000");
ok(calls.at(-1)![0] === "site_provider_catalog" && calls.at(-1)![1].p_offset === 0 && calls.at(-1)![1].p_limit === 1000, "каталог: отступ ≥ 0, не больше 1000 строк");
ok((await r("provider-stock?ids=x")).status === 400, "остатки: не UUID — 400");
const U = "11111111-2222-3333-4444-555555555555";
ok((await r(`provider-stock?ids=${U},${U}`)).status === 400, "остатки: повтор id — 400");
const s = await (await r(`provider-stock?ids=${U}`)).json();
ok(Array.isArray(s.items) && typeof s.observedAt === "string" && JSON.stringify(calls.at(-1)![1].p_ids) === JSON.stringify([U]), "остатки по списку id");
if (fails) { console.error(fails + " проверок не прошли"); Deno.exit(1); }
