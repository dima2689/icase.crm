// Уведомления от iCase CRM: «изменились цены/остатки/товары» → сбросить кэш каталога.
// В CRM: Настройки → Сайт → «Адрес уведомлений сайта» = https://ваш-сайт/api/icase
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { ICASE_TAG } from "@/lib/icase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-icase-signature") || "";
  const expected = createHmac("sha256", process.env.ICASE_HOOK_SECRET!).update(body).digest("base64");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return Response.json({ error: "bad signature" }, { status: 401 });

  const event = JSON.parse(body) as {
    event: "ping" | "catalog.updated";
    products?: { slug: string; sku: string; price: number; qty: number }[];
    removed?: { slug: string; sku: string }[];
    orders?: { id: number; status: "completed" | "cancelled" }[];
  };
  if (event.event === "catalog.updated") {
    revalidateTag(ICASE_TAG);                                   // каталог, категории, карточки
    for (const p of [...(event.products || []), ...(event.removed || [])]) revalidatePath(`/product/${p.slug}`);
    // event.orders — статусы заказов из CRM («completed» / «cancelled»), если сайт хранит заказы у себя
  }
  return Response.json({ ok: true });
}
