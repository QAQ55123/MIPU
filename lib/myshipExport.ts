import { getSupabaseAdmin } from "./supabase";
import { getSheets, requireCostSheetId } from "./googleSheets";
import { safeTabName } from "./planSheetSync";

export type MyshipRow = { account: string; amount: number };
export type MyshipGroup = { productName: string; description: string; rows: MyshipRow[] };
export type MyshipExportResult = {
  planName: string;
  imageUrl: string | null;
  groups: MyshipGroup[];
  totalCustomers: number;
  overLimit: string[]; // 差額超過賣貨便單一規格 20,000 上限的帳號，需要另外手動處理
};

const MAX_ROWS_PER_PRODUCT = 50; // 賣貨便規定：一個商品最多 50 個規格
const MYSHIP_PRICE_MAX = 20000;

/**
 * 算出某個企劃裡，每一位顧客要在賣貨便上付的金額（尚欠 = 應收總額－已收，已經含運費）。
 * 這份清單是給顧客自己在賣貨便上「選自己的名字」下單用的，所以不管金額是不是 0，
 * 這個企劃底下所有訂單的顧客都要列出來，不能只列還欠錢的人。
 *
 * 金額直接讀「成本試算表」裡這個企劃分頁的「客戶應收運費」區塊算好的「尚欠」欄位（已經把運費算進去了），
 * 不是資料庫裡「商品金額－已收金額」，因為運費是手動填在 Sheet 上的資料，資料庫裡沒有。
 * 如果成本試算表這個企劃的分頁還沒同步過（找不到客戶應收運費資料），會直接報錯，
 * 提醒要先去後台按過「立即完整同步一次」或至少下過一筆訂單觸發過同步。
 */
export async function computeMyshipExport(planId: string): Promise<MyshipExportResult> {
  const supabase = getSupabaseAdmin();
  const { data: plan } = await supabase.from("plans").select("id, name, image_url").eq("id", planId).maybeSingle();
  if (!plan) throw new Error("找不到這個企劃");

  const costId = requireCostSheetId();
  const sheets = await getSheets();
  const tabName = safeTabName(plan.name);

  let values: any[][] = [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: costId, range: `${tabName}!A1:G100000` });
    values = res.data.values || [];
  } catch {
    throw new Error(`成本試算表裡找不到「${plan.name}」這個分頁，請先去後台按一次「立即完整同步一次」`);
  }

  // 找「客戶應收運費」區塊的標題列（A欄＝客戶），下面接著就是每位顧客各自一列
  let headerRow = -1;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i]?.[0] || "").trim() === "客戶") { headerRow = i; break; }
  }
  if (headerRow < 0) {
    throw new Error(`「${plan.name}」的成本分頁裡找不到「客戶應收運費」區塊，可能這個企劃還沒有任何訂單，或分頁資料是舊格式，請先去後台按一次「立即完整同步一次」`);
  }

  const overLimit: string[] = [];
  const rows: MyshipRow[] = [];
  for (let i = headerRow + 1; i < values.length; i++) {
    const r = values[i] || [];
    const account = String(r[0] || "").trim();
    if (!account) break; // 客戶清單結束
    const owing = Number(r[5]); // F欄＝尚欠
    const amount = Math.round(Number.isFinite(owing) ? owing : 0);
    if (amount > MYSHIP_PRICE_MAX) { overLimit.push(`${account}（尚欠 NT$${amount}）`); continue; }
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
    overLimit,
  };
}
