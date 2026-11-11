// Проверка обмена с Эвотором без сети: поддельное Облако + локальная база CRM.
// Запуск: deno run -A supabase/functions/tests/evotor_test.ts  (база fin на /tmp:5499 с mig_evotor)
import { docsFromHook, mapDoc, pullDocs, pushProducts, listStores } from "../evotor/evo.ts";
const sent: any[] = [];
const fake = async (url: string, init: RequestInit = {}) => {
  const h = init.headers as Record<string, string>;
  if (h["X-Authorization"] !== "tok") return new Response('{"message":"bad token"}', { status: 401 });
  if (url.endsWith("/stores")) return new Response(JSON.stringify({ items: [{ id: "S1", name: "Галерея" }] }));
  if (url.includes("/products") && init.method === "PUT") { sent.push({ ct: h["Content-Type"], body: JSON.parse(String(init.body)) }); return new Response('{"id":"task"}'); }
  if (url.includes("/documents")) {
    if (url.includes("cursor=c2")) return new Response(JSON.stringify({ items: [{ id: "d3", type: "PAYBACK", store_id: "S1", number: 3, close_date: "2026-11-11T09:00:00+0000", body: { result_sum: 500, payments: [{ type: "CASH", sum: 500 }], positions: [] } }], paging: {} }));
    return new Response(JSON.stringify({ items: [
      { id: "d1", type: "SELL", store_id: "S1", device_id: "dev", number: 1, close_date: "2026-11-11T08:00:00+0000", body: { result_sum: 1900, payments: [{ type: "ELECTRON", sum: 1000 }, { type: "CASH", sum: 900 }], positions: [{ product_id: "p1", product_name: "Чехол", quantity: 1, price: 2000, sum: 2000, result_sum: 1900 }] } },
      { id: "d2", type: "OPEN_SESSION", store_id: "S1", number: 2, close_date: "2026-11-11T07:00:00+0000", body: {} }], paging: { next_cursor: "c2" } }));
  }
  return new Response("nf", { status: 404 });
};
const ok = (c: boolean, m: string) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) Deno.exitCode = 1; };
ok((await listStores(fake as any, "tok"))[0].id === "S1", "магазины");
try { await listStores(fake as any, "bad"); ok(false, "плохой токен"); } catch (e) { ok(/401.*токен/.test(String(e)), "плохой токен → понятная ошибка"); }
const n = await pushProducts(fake as any, "tok", "S1", Array.from({ length: 5001 }, (_, i) => ({ id: "p" + i, name: "Т" + i, price: 10, quantity: 2, barcodes: [] })));
ok(n === 5001 && sent.length === 2 && sent[0].body.length === 5000 && /bulk/.test(sent[0].ct), "товары пачками по 5000, bulk");
ok(sent[0].body[0].tax === "NO_VAT" && sent[0].body[0].measure_name === "шт" && !("barcodes" in sent[0].body[0]), "поля товара");
const docs = await pullDocs(fake as any, "tok", "S1", 0);
ok(docs.length === 2 && docs[0].doc_type === "SELL" && docs[1].doc_type === "PAYBACK", "чеки с листанием, служебные документы пропущены");
ok(docs[0].payments.cash === 900 && docs[0].payments.card === 1000 && docs[0].total === 1900 && docs[0].items[0].sum === 1900, "оплаты и суммы чека");
ok(docsFromHook({ data: { id: "x", type: "SELL" } }).length === 1 && docsFromHook([1, 2]).length === 2, "формы вебхука");
ok(mapDoc({ type: "Z_REPORT" }) === null, "Z-отчёт не чек");
