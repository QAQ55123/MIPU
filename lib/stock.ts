import { getSupabaseAdmin } from "./supabase";

/** 統計某個企劃底下，每個「商品名稱｜款式」目前已經被訂購的總數量。
 *  只要訂單還存在資料庫裡就算（不分取付/匯款、含取消審核中的，因為還沒真的取消）。 */
export async function getStockUsage(planId: string): Promise<Map<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data: orders } = await supabase.from("orders").select("id").eq("plan_id", planId);
  const orderIds = (orders || []).map((o) => o.id);
  const usage = new Map<string, number>();
  if (orderIds.length === 0) return usage;

  const { data: items } = await supabase.from("order_items").select("product_name, style, qty").in("order_id", orderIds);
  for (const it of items || []) {
    const key = `${it.product_name}|${it.style || ""}`;
    usage.set(key, (usage.get(key) || 0) + Number(it.qty));
  }
  return usage;
}

export function stockKey(name: string, style: string | null | undefined): string {
  return `${name}|${style || ""}`;
}
