import { getSupabaseAdmin } from "./supabase";
import { appendRow, overwriteSheet, syncCostRows } from "./googleSheets";

/** 完整重新同步所有訂單歷史紀錄（給手動「立即同步」按鈕用，補齊這個功能上線前的舊訂單）
 *  注意：這裡「不」吞掉錯誤，失敗要讓呼叫端知道，才不會出現「顯示同步完成、但 Sheet 其實是空的」這種情況 */
export async function syncAllOrdersSheet() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: true });
  const rows = (data || []).map((o) => {
    const lines = (o.order_items || []).map((it: any) => `${it.product_name}${it.style ? `（${it.style}）` : ""} x${it.qty}`).join("；");
    const total = (o.order_items || []).reduce((s: number, it: any) => s + Number(it.subtotal), 0);
    return [o.order_no, o.username, o.plan_name_snapshot || "", o.payment, lines, total, new Date(o.created_at).toLocaleString("zh-TW")];
  });
  await overwriteSheet("訂單", ["訂單編號", "帳號", "企劃", "交易方式", "品項", "金額", "時間"], rows);
}

/** 訂單建立當下即時同步一列（呼叫端是客人下單流程，這裡「刻意」吞掉錯誤，
 *  Sheet 同步失敗不該讓客人沒辦法下單；真正的失敗原因會印在伺服器 log 裡，
 *  想確認同步有沒有成功，請用後台的「立即完整同步一次」，那裡的錯誤不會被吞掉 */
export async function syncOrderToSheet(params: {
  orderNo: string;
  username: string;
  planName: string;
  payment: string;
  itemsSummary: string;
  total: number;
}) {
  try {
    await appendRow(
      "訂單",
      ["訂單編號", "帳號", "企劃", "交易方式", "品項", "金額", "時間"],
      [params.orderNo, params.username, params.planName, params.payment, params.itemsSummary, params.total, new Date().toLocaleString("zh-TW")]
    );
  } catch (e) {
    console.error("Google Sheet 訂單同步失敗：", e);
  }
  try {
    await syncCostRows([{
      orderNo: params.orderNo,
      username: params.username,
      planName: params.planName,
      amount: params.total,
      paidStatus: "",
      createdAt: new Date().toLocaleString("zh-TW"),
    }]);
  } catch (e) {
    console.error("Google Sheet 成本表同步失敗：", e);
  }
}

/** 補齊所有還沒同步過的訂單到成本表（給手動「立即完整同步一次」按鈕用；已經同步過的不會被覆蓋，成本欄不會被洗掉） */
export async function syncAllOrdersCostSheet() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: true });
  const orders = (data || []).map((o) => ({
    orderNo: o.order_no,
    username: o.username,
    planName: o.plan_name_snapshot || "",
    amount: (o.order_items || []).reduce((s: number, it: any) => s + Number(it.subtotal), 0),
    paidStatus: o.paid_status || "",
    createdAt: new Date(o.created_at).toLocaleString("zh-TW"),
  }));
  await syncCostRows(orders);
}

/** 會員資料會一直被編輯，改用「整份重寫」保持跟資料庫一致 */
export async function syncMembersSheet() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("members").select("*").order("created_at", { ascending: true });
  const rows = (data || []).map((m) => [
    m.username,
    m.profile_url,
    m.email,
    m.email_verified ? "已驗證" : "未驗證",
    new Date(m.created_at).toLocaleString("zh-TW"),
  ]);
  await overwriteSheet("會員", ["帳號", "個人頁網址", "Email", "信箱驗證", "註冊時間"], rows);
}

/** 企劃資料同上，整份重寫 */
export async function syncPlansSheet() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("plans").select("*, categories(name)").order("sort_order", { ascending: true });
  const rows = (data || []).map((p) => [
    p.name,
    p.categories?.name || "（未分類）",
    p.deadline ? new Date(p.deadline).toLocaleString("zh-TW") : "常駐",
    Number(p.cod_limit) || 0,
    p.fulfillment_status || "",
    new Date(p.created_at).toLocaleString("zh-TW"),
  ]);
  await overwriteSheet("企劃", ["企劃名稱", "分類", "截止時間", "取付上限", "企劃狀態", "建立時間"], rows);
}

/** 商品資料同上，整份重寫 */
export async function syncProductsSheet() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("products").select("*, plans(name)").order("sort_order", { ascending: true });
  const rows = (data || []).map((p) => [p.plans?.name || "（企劃已刪除）", p.name, p.style || "", Number(p.price) || 0]);
  await overwriteSheet("商品", ["所屬企劃", "商品名稱", "款式", "價格"], rows);
}
