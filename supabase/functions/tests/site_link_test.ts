// Связь товаров CRM с существующими товарами WooCommerce без сети. Запуск: deno run supabase/functions/tests/site_link_test.ts
import { linkExisting } from "../site-sync/sync.ts";
const calls: string[] = [];
const woo = async (m: string, path: string) => {
  calls.push(m + " " + path);
  if (m !== "GET") throw new Error("только чтение");
  const u = new URL("https://x/" + path);
  if (u.searchParams.get("include")) return u.searchParams.get("include")!.split(",").filter((i) => i !== "999").map((id) => ({ id: Number(id) }));
  if (u.searchParams.get("sku")) return u.searchParams.get("sku")!.split(",").filter((s) => s.startsWith("ok")).map((s, i) => ({ id: 700 + i, sku: s }));
  return [];
};
const ok = (c: boolean, m: string) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) Deno.exitCode = 1; };
const rows = [
  { id: "a", sku: "msi-woo:37645868-8607:product:5305" }, { id: "b", sku: "msi-woo:x:product:999" },
  { id: "c", sku: "ok-1" }, { id: "d", sku: "nope" }, { id: "e", sku: "ok,comma" },
];
const r = await linkExisting(woo as any, rows);
ok(r.links.some((l) => l.id === "a" && l.woo === 5305), "ссылка МоегоСклада → товар сайта");
ok(!r.links.some((l) => l.id === "b"), "несуществующий товар сайта не связывается");
ok(r.links.some((l) => l.id === "c" && l.woo >= 700), "по артикулу");
ok(r.stat.by_ms === 1 && r.stat.by_sku >= 1 && r.stat.not_found >= 2, "счётчики");
ok(calls.every((c) => c.startsWith("GET ")), "на сайте ничего не меняется (только GET)");
