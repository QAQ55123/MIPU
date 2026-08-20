import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { syncProductsSheet } from "@/lib/sheetsSync";

export const dynamic = "force-dynamic";

/**
 * 把某個企劃的整份商品目錄（名稱/款式/價格/圖片，不含限量，因為限量通常是每個企劃各自的庫存數）
 * 複製一份到另一個企劃底下。body: { targetPlanId, sourcePlanId }
 */
export async function POST(req: Request) {
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const body = await req.json();
  const targetPlanId = String(body.targetPlanId || "").trim();
  const sourcePlanId = String(body.sourcePlanId || "").trim();
  if (!targetPlanId || !sourcePlanId) return NextResponse.json({ error: "缺少 targetPlanId 或 sourcePlanId" }, { status: 400 });
  if (targetPlanId === sourcePlanId) return NextResponse.json({ error: "來源跟目標是同一個企劃" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: sourceProducts, error: fetchErr } = await supabase
    .from("products")
    .select("name, style, price, image_url, sort_order")
    .eq("plan_id", sourcePlanId)
    .order("sort_order", { ascending: true });
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!sourceProducts || sourceProducts.length === 0) return NextResponse.json({ error: "來源企劃沒有任何商品可以複製" }, { status: 400 });

  const rows = sourceProducts.map((p) => ({
    plan_id: targetPlanId,
    name: p.name,
    style: p.style || "",
    price: p.price,
    image_url: p.image_url,
    sort_order: p.sort_order,
  }));

  const { error: insertErr } = await supabase.from("products").insert(rows);
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  syncProductsSheet().catch(() => {});
  return NextResponse.json({ ok: true, copied: rows.length });
}
