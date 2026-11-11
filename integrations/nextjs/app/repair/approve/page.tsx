// Страница согласования ремонта: клиент открывает ссылку из сообщения, видит смету и нажимает «Согласен» / «Отказываюсь».
// Решение сразу попадает в CRM: ремонт переходит «в работу», мастеру ставится задача.
import { getRepairQuote, decideRepair } from "@/lib/icase";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
const rub = (v: number) => Math.round(Number(v) || 0).toLocaleString("ru-RU") + " ₽";

export default async function Page({ searchParams }: { searchParams: Promise<{ n?: string; t?: string; e?: string }> }) {
  const { n = "", t = "", e } = await searchParams;
  const q = n && t ? await getRepairQuote(n, t) : null;
  if (!q) return <main style={{ maxWidth: 560, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}><h1>Ссылка недействительна</h1><p>Проверьте ссылку из сообщения или позвоните нам.</p></main>;

  async function decide(form: FormData) {
    "use server";
    const d = form.get("decision") === "yes" ? "yes" : "no";
    try { await decideRepair(n, t, d, String(form.get("comment") || "")); } catch (err) { /* показываем актуальное состояние */ }
    revalidatePath("/repair/approve");
  }
  const rows = [...q.works, ...q.parts];
  return (
    <main style={{ maxWidth: 560, margin: "32px auto", padding: 16, fontFamily: "system-ui", lineHeight: 1.45 }}>
      <p style={{ color: "#666", margin: 0 }}>{q.shop.name}</p>
      <h1 style={{ margin: "4px 0 12px" }}>Ремонт {q.num}</h1>
      <p><b>{q.device}</b><br />{q.problem}</p>
      {q.diagnosis && <p><b>Диагностика:</b> {q.diagnosis}</p>}
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0" }}>
          <tbody>{rows.map((r, i) => <tr key={i} style={{ borderBottom: "1px solid #eee" }}><td style={{ padding: "6px 0" }}>{r.name}{r.qty > 1 ? ` × ${r.qty}` : ""}</td><td style={{ textAlign: "right" }}>{rub(r.price * r.qty)}</td></tr>)}</tbody>
        </table>
      )}
      <p style={{ fontSize: 20 }}>Итого: <b>{rub(q.total)}</b>{q.paid > 0 && <span style={{ color: "#666", fontSize: 15 }}> · внесено {rub(q.paid)}</span>}</p>
      {q.decision ? (
        <p style={{ padding: 12, borderRadius: 12, background: q.decision.decision === "yes" ? "#DCEBD5" : "#F4DAD3" }}>
          {q.decision.decision === "yes" ? "Спасибо! Вы согласовали ремонт — мастер приступает к работе." : "Вы отказались от ремонта. Устройство можно забрать в сервисе."}
        </p>
      ) : q.can_decide ? (
        <form action={decide}>
          <textarea name="comment" placeholder="Комментарий (необязательно)" rows={2} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button name="decision" value="yes" style={{ flex: 1, padding: 14, borderRadius: 12, border: 0, background: "#16170F", color: "#fff", fontSize: 16 }}>Согласен — делайте</button>
            <button name="decision" value="no" style={{ flex: 1, padding: 14, borderRadius: 12, border: "1px solid #ccc", background: "#fff", fontSize: 16 }}>Отказываюсь</button>
          </div>
        </form>
      ) : <p>Решение по этому ремонту уже не требуется.</p>}
      {q.shop.phone && <p style={{ color: "#666" }}>Вопросы: {q.shop.phone}{q.shop.address ? ` · ${q.shop.address}` : ""}</p>}
    </main>
  );
}
