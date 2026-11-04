import { getSupabaseAdmin } from "./supabase";
import { getSheets, requireCostSheetId } from "./googleSheets";
import { safeTabName } from "./planSheetSync";

export type MyshipRow = { account: string; amount: number };
export type MyshipGroup = { productName: string; description: string; rows: MyshipRow[] };
export type MyshipExportResult = {
  planName: string;
  imageUrl: string;           // 已轉成賣貨便接受的格式；不接受的來源會是空字串
  imageWarning: string;       // 圖片不能用時給後台預覽顯示的提醒（沒問題就是空字串）
  groups: MyshipGroup[];
  totalCustomers: number;
  overLimit: string[]; // 差額超過賣貨便單一規格 20,000 上限的帳號，需要另外手動處理
};

/**
 * 賣貨便的商品圖片只接受 Google 雲端硬碟、Dropbox、Imgur 三種來源，
 * 而且雲端硬碟要用「https://drive.google.com/file/d/圖片編號/view?usp=sharing」這種分享連結格式。
 * 網站存的企劃圖片：
 *   - 貼雲端連結的，存檔時已被轉成 thumbnail 格式（網頁顯示用）→ 這裡轉回分享連結格式（同一個檔案編號）
 *   - Dropbox / Imgur → 原樣使用
 *   - 其他（例如後台直接上傳、存在 Supabase 的圖片）→ 賣貨便不接受，留空並提醒
 */
export function toMyshipImageUrl(raw: string | null | undefined): { url: string; warning: string } {
  const u = String(raw || "").trim();
  if (!u) return { url: "", warning: "" };
  if (/^https?:\/\/(drive|docs)\.google\.com\//i.test(u)) {
    let m = u.match(/\/file\/d\/([^/?#]+)/);
    if (!m) m = u.match(/[?&]id=([^&#]+)/);
    if (m && m[1]) return { url: `https://drive.google.com/file/d/${m[1]}/view?usp=sharing`, warning: "" };
  }
  if (/^https?:\/\/([a-z0-9-]+\.)*(dropbox\.com|imgur\.com)\//i.test(u)) return { url: u, warning: "" };
  return {
    url: "",
    warning: "這個企劃的圖片不是 Google 雲端硬碟／Dropbox／Imgur 的連結（例如是在後台直接上傳的圖片），賣貨便不接受，匯出檔的圖片欄會留空，請到賣貨便手動補圖。",
  };
}

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

  // 規格名稱改用會員自己設定的「會員名稱」；對不到會員（例如還沒被認領的舊訂單）或還沒設定的，沿用訂單上原本的名稱
  const rawAccounts: string[] = [];
  for (let i = headerRow + 1; i < values.length; i++) {
    const a = String(values[i]?.[0] || "").trim();
    if (!a) break;
    rawAccounts.push(a);
  }
  const nameMap = new Map<string, string>();
  for (let i = 0; i < rawAccounts.length; i += 200) {
    const chunk = rawAccounts.slice(i, i + 200);
    const { data: ms } = await supabase.from("members").select("username, display_name").in("username", chunk);
    for (const m of ms || []) if (m.display_name) nameMap.set(String(m.username), String(m.display_name));
  }
  const displayFor = (account: string) => nameMap.get(account) || account;

  const overLimit: string[] = [];
  const rows: MyshipRow[] = [];
  for (let i = headerRow + 1; i < values.length; i++) {
    const r = values[i] || [];
    const rawAccount = String(r[0] || "").trim();
    if (!rawAccount) break; // 客戶清單結束
    const account = displayFor(rawAccount);
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
    groups.push({ productName, description: "紀錄", rows: chunk });
  }

  const img = toMyshipImageUrl(plan.image_url);

  return {
    planName: plan.name,
    imageUrl: img.url,
    imageWarning: img.warning,
    groups,
    totalCustomers: rows.length,
    overLimit,
  };
}
