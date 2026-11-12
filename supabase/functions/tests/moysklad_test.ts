// Перенос из МоегоСклада без сети: поддельный API. Запуск: deno run supabase/functions/tests/moysklad_test.ts
import { check, idOf, page } from "../moysklad/ms.ts";
const B = "https://api.moysklad.ru/api/remap/1.2";
const seen: string[] = [];
const fake = async (url: string, init: RequestInit = {}) => {
  seen.push(url);
  const h = init.headers as Record<string, string>;
  if (h.Authorization !== "Bearer tok") return new Response('{"errors":[{"error":"Ошибка аутентификации"}]}', { status: 401 });
  if ("Accept-Encoding" in h) return new Response("сжатие задаёт fetch", { status: 415 });
  const u = new URL(url); const off = Number(u.searchParams.get("offset") || 0);
  if (u.pathname.endsWith("/context/employee")) return new Response('{"fullName":"Иван"}');
  if (u.pathname.endsWith("/pricetype")) return new Response('[{"name":"Цена продажи"},{"name":"Опт"}]');
  if (u.pathname.endsWith("/entity/store")) return new Response(JSON.stringify({ meta: { size: 1 }, rows: [{ id: "S1", name: "Галерея" }] }));
  if (u.pathname.endsWith("/entity/product")) return new Response(JSON.stringify({ meta: { size: 1500 }, rows: off ? [{ id: "P2", name: "Чехол" }] : [{
    id: "P1", name: "iPhone 15", article: "IP15", code: "00001", isSerialTrackable: true, variantsCount: 2, minimumBalance: 1,
    salePrices: [{ value: 8999000, priceType: { name: "Цена продажи" } }, { value: 8500000, priceType: { name: "Опт" } }], buyPrice: { value: 7000000 },
    barcodes: [{ ean13: "4600000000017" }], productFolder: { meta: { href: B + "/entity/productfolder/F1" } } }] }));
  if (u.pathname.endsWith("/entity/variant")) return new Response(JSON.stringify({ meta: { size: 1 }, rows: [{ id: "V1", name: "iPhone 15 (Черный, 128 ГБ)",
    product: { meta: { href: B + "/entity/product/P1?expand=x" } }, characteristics: [{ name: "Цвет", value: "Черный" }, { name: "Память", value: "128 ГБ" }], salePrices: [{ value: 0, priceType: { name: "Цена продажи" } }] }] }));
  if (u.pathname.endsWith("/report/stock/bystore")) return new Response(JSON.stringify({ meta: { size: 1 }, rows: [{ meta: { href: B + "/entity/variant/V1?expand=supplier", type: "variant" },
    stockByStore: [{ meta: { href: B + "/entity/store/S1" }, stock: 3 }, { meta: { href: B + "/entity/store/S2" }, stock: 0 }] }] }));
  if (u.pathname.endsWith("/entity/counterparty") || u.pathname.endsWith("/entity/productfolder") || u.pathname.endsWith("/entity/variant")) return new Response(JSON.stringify({ meta: { size: 7 }, rows: [] }));
  return new Response("nf", { status: 404 });
};
const ok = (c: boolean, m: string) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) Deno.exitCode = 1; };
const c = await check(fake as any, "tok");
ok(c.user === "Иван" && c.counts.product === 1500 && c.stores[0].name === "Галерея" && c.priceTypes.length === 2, "проверка токена и счётчики");
try { await check(fake as any, "bad"); ok(false, "плохой токен"); } catch (e) { ok(/401.*токен/.test(String(e)), "плохой токен → понятная ошибка"); }
const p1 = await page(fake as any, "tok", "product", 0), p = p1.rows[0];
ok(p1.next === 1000 && (await page(fake as any, "tok", "product", 1000)).next === null, "листание по 1000");
ok(p.prices["Цена продажи"] === 89990 && p.prices["Опт"] === 85000 && p.buy === 70000, "цены из копеек в рубли, все виды цен");
ok(p.serial && p.variants === 2 && p.folder === "F1" && p.barcodes[0] === "4600000000017" && p.article === "IP15", "поля товара");
const v = (await page(fake as any, "tok", "variant")).rows[0];
ok(v.product === "P1" && v.chars["Цвет"] === "Черный" && v.chars["Память"] === "128 ГБ", "модификация: товар и характеристики");
const s = (await page(fake as any, "tok", "stock")).rows[0];
ok(s.id === "V1" && s.type === "variant" && s.by.S1 === 3 && !("S2" in s.by), "остатки по складам, нули отброшены");
ok(idOf(B + "/entity/product/abc?expand=1") === "abc", "id из ссылки");
try { await page(fake as any, "tok", "../../security"); ok(false, "чужой путь"); } catch { ok(true, "читать можно только разрешённые разделы"); }
ok(seen.every((u) => u.startsWith(B + "/")), "запросы только в api.moysklad.ru");
