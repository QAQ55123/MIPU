import { getSupabaseAdmin } from "./supabase";

export type MyshipRow = { account: string; amount: number };
export type MyshipGroup = { productName: string; description: string; rows: MyshipRow[] };
export type MyshipExportResult = {
  planName: string;
  imageUrl: string | null;
  groups: MyshipGroup[];
  totalCustomers: number;
  skippedZero: number; // 差額為 0（已經付清）的人數，這些人不會出現在匯出結果裡
  overLimit: string[]; // 差額超過賣貨便單一規格 20,000 上限的帳號，需要另外手動處理
};

const MAX_ROWS_PER_PRODUCT = 50; // 賣貨便規定：一個商品最多 50 個規格
const MYSHIP_PRICE_MAX = 20000;

/** 算出某個企劃裡，每個顧客「應付總額 - 已收金額」的差額，只列出差額 > 0 的人（不管交易方式）。
 *  超過 50 人會自動分成好幾組（企劃名稱(1)、企劃名稱(2)...），符合賣貨便一個商品最多 50 規格的限制。 */
export async function computeMyshipExport(planId: string): Promise<MyshipExportResult> {
  const supabase = getSupabaseAdmin();
  const { data: plan } = await supabase.from("plans").select("id, name, image_url").eq("id", planId).maybeSingle();
  if (!plan) throw new Error("找不到這個企劃");

  const { data: orders } = await supabase
    .from("orders")
    .select("username, paid_amount, order_items(subtotal)")
    .eq("plan_id", planId);

  const balanceByAccount = new Map<string, number>();
  for (const o of orders || []) {
    const total = (o.order_items || []).reduce((s: number, it: any) => s + (Number(it.subtotal) || 0), 0);
    const paid = Number(o.paid_amount) || 0;
    const diff = total - paid;
    const key = o.username;
    balanceByAccount.set(key, (balanceByAccount.get(key) || 0) + diff);
  }

  const overLimit: string[] = [];
  const rows: MyshipRow[] = [];
  let skippedZero = 0;
  for (const [account, amountRaw] of balanceByAccount) {
    const amount = Math.round(amountRaw);
    if (amount <= 0) { skippedZero++; continue; }
    if (amount > MYSHIP_PRICE_MAX) { overLimit.push(`${account}（差額 NT$${amount}）`); continue; }
    rows.push({ account, amount });
  }
  rows.sort((a, b) => a.account.localeCompare(b.account));

  const groups: MyshipGroup[] = [];
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_PRODUCT) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_PRODUCT);
    const groupIdx = Math.floor(i / MAX_ROWS_PER_PRODUCT);
    const productName = groups.length === 0 && rows.length <= MAX_ROWS_PER_PRODUCT ? plan.name : `${plan.name}(${groupIdx + 1})`;
    groups.push({ productName, description: `『${plan.name}』代收尾款`, rows: chunk });
  }

  return {
    planName: plan.name,
    imageUrl: plan.image_url,
    groups,
    totalCustomers: rows.length,
    skippedZero,
    overLimit,
  };
}
