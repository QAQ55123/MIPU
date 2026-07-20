import { getSupabaseAdmin } from "./supabase";
import {
  getSheets, requireSheetId, requireCostSheetId,
  ensureSheetExists, getValuesAndFormulas, columnToLetter,
  buildClearRequest, buildWriteRequest, buildBoldRangeRequest, buildHideSheetRequest,
  runBatch, type BatchRequest, type SheetsClient,
} from "./googleSheets";

const ORDER_HEADER = ["訂單編號", "來源", "暱稱", "FB個人網址", "商品名稱", "款式", "數量", "單價", "小計", "訂單時間", "交易方式", "付款狀態"];
const CATALOG_HEADER = ["商品名稱", "款式", "單價", "圖片"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 失敗自動重試，配額被打回來的話要等滿一分鐘再試（Google 的配額是每分鐘重置，等短短幾秒重試沒有意義） */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 2;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const isQuotaError = /quota exceeded|resource_exhausted|rate limit/i.test(String(e?.message || ""));
      const delay = isQuotaError ? 65000 : 800;
      if (attempt < maxAttempts - 1) await sleep(delay);
    }
  }
  throw lastErr;
}

/** 從「付款狀態」欄解析出「實收金額」數字（NT$、逗號、空白都容忍；非數字回 0），比照原系統 parsePaidAmount_ */
function parsePaidAmount(v: any): number {
  const s = String(v == null ? "" : v).trim().replace(/nt\$?/i, "").replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type PlanRow = { id: string; name: string };

async function getAllPlans(): Promise<PlanRow[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("plans").select("id, name").order("sort_order", { ascending: true });
  return data || [];
}

async function getPlanProducts(planId: string) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("products").select("*").eq("plan_id", planId).order("sort_order", { ascending: true });
  return data || [];
}

async function getPlanOrders(planId: string) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("orders").select("*, order_items(*)").eq("plan_id", planId).order("created_at", { ascending: true });
  return data || [];
}

/** Google Sheet 的分頁名稱不能有這些符號，順手清一下，避免建立分頁失敗 */
function safeTabName(name: string): string {
  return (name || "未命名企劃").replace(/[\\/?*\[\]:]/g, "_").slice(0, 90);
}

// ==================================================================================
// 一、「訂單」同步：主試算表裡，每個企劃各一個分頁（商品目錄 + 訂單明細），比照原系統版面
//
// 設計重點：每個企劃「清空＋寫入＋排版」原本要拆成 4 次個別的 API 呼叫，改成先組成一份
// 請求清單（不會馬上打 API），呼叫端可以自己決定「這份清單要不要跟別的企劃合併、一次送出」。
// 「立即完整同步一次」會把所有企劃的清單合併成一份，整個流程只需要 1 次 API 呼叫，
// 不會再因為企劃一多就打爆 Google 的每分鐘寫入配額。
// ==================================================================================

/** 組出「某個企劃的訂單分頁」需要寫入的請求清單（純組資料，不呼叫 API） */
async function buildOrderTabRequests(mainSheetId: string, planId: string, planName: string): Promise<BatchRequest[]> {
  const tabName = safeTabName(planName);
  const { sheetId } = await ensureSheetExists(mainSheetId, tabName);

  const [products, orders] = await Promise.all([getPlanProducts(planId), getPlanOrders(planId)]);

  const catalogRows = products.map((p: any) => [p.name, p.style || "", Number(p.price) || 0, p.image_url || ""]);
  const catalogBlock = [CATALOG_HEADER, ...catalogRows];

  const orderRows: (string | number)[][] = [];
  orders.forEach((o: any) => {
    const paidAmount = Number(o.paid_amount) || 0;
    (o.order_items || []).forEach((it: any) => {
      orderRows.push([
        o.order_no,
        "",
        o.username,
        o.profile_url,
        it.product_name,
        it.style || "",
        it.qty,
        Number(it.unit_price) || 0,
        Number(it.subtotal) || 0,
        new Date(o.created_at).toLocaleString("zh-TW"),
        o.payment,
        paidAmount > 0 ? paidAmount : "",
      ]);
    });
  });

  const fullData: (string | number)[][] = [
    ...catalogBlock,
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ORDER_HEADER,
    ...orderRows,
  ];

  return [
    buildClearRequest(sheetId, 100000, 12),
    buildWriteRequest(sheetId, 0, 0, fullData),
    buildBoldRangeRequest(sheetId, 0, 1, 0, CATALOG_HEADER.length),
    buildBoldRangeRequest(sheetId, catalogBlock.length + 1, catalogBlock.length + 2, 0, ORDER_HEADER.length),
  ];
}

/** 同步單一企劃的訂單分頁（即時同步用：客人下單當下、後台改單當下呼叫） */
export async function syncOnePlanOrderTab(planId: string, planName: string) {
  const id = requireSheetId();
  const sheets = await getSheets();
  const requests = await buildOrderTabRequests(id, planId, planName);
  await runBatch(sheets, id, requests);
}

/** 同步「所有」企劃的訂單分頁（給手動「立即完整同步一次」用）。
 *  所有企劃的請求會合併成一份，整個流程只打「一次」批次寫入 API。 */
export async function syncAllPlanOrderTabs() {
  const id = requireSheetId();
  const sheets = await getSheets();
  const plans = await getAllPlans();
  const failedPlans: string[] = [];
  const allRequests: BatchRequest[] = [];

  for (const p of plans) {
    try {
      const requests = await buildOrderTabRequests(id, p.id, p.name);
      allRequests.push(...requests);
    } catch (e: any) {
      failedPlans.push(`${p.name}：${e?.message || "未知錯誤"}`);
    }
  }

  if (allRequests.length > 0) {
    await withRetry(() => runBatch(sheets, id, allRequests));
  }
  if (failedPlans.length > 0) {
    throw new Error(`部分企劃同步失敗（其餘企劃仍已正常同步）：${failedPlans.join("；")}`);
  }
}

/** 單一新訂單即時同步（客人下單當下呼叫；直接重寫該企劃分頁，資料量不大，這樣做最單純可靠） */
export async function syncOrderRealtimeToPlanTab(planId: string, planName: string) {
  await withRetry(() => syncOnePlanOrderTab(planId, planName));
}

// ==================================================================================
// 二、「成本」試算表：每個企劃各一個分頁，完整比照原系統（商品成本表／運費計算／總覽／客戶應收運費）
//     進貨單價、單件重量、包裹總重、每公斤價格、內陸運費、其他 都是手填欄位，每次刷新都會被保留
// ==================================================================================

type Aggregated = {
  products: { name: string; style: string; price: number }[];
  qty: Record<string, number>;
  customers: { display: string; items: Record<string, number>; paid: number }[];
};

/** 從「主試算表」剛同步好的企劃分頁讀取資料，統計商品目錄＋依人分組的訂購數量與已收金額 */
async function aggregatePlanFromSheet(sheets: SheetsClient, id: string, tabName: string): Promise<Aggregated> {
  const { values } = await getValuesAndFormulas(sheets, id, `${tabName}!A1:L100000`);

  const products: Aggregated["products"] = [];
  let headerRow = -1;
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    if (String(row[0] || "").trim() === ORDER_HEADER[0]) { headerRow = i; break; }
    if (i > 0 && String(row[0] || "").trim()) {
      products.push({ name: String(row[0]).trim(), style: String(row[1] || "").trim(), price: Number(row[2]) || 0 });
    }
  }

  const qty: Record<string, number> = {};
  const customersMap = new Map<string, { display: string; items: Record<string, number>; paid: number }>();
  const paidSeenOrderNo = new Set<string>();

  if (headerRow >= 0) {
    for (let i = headerRow + 1; i < values.length; i++) {
      const r = values[i] || [];
      const name = String(r[4] || "").trim();
      if (!name) continue;
      const style = String(r[5] || "").trim();
      const q = Number(r[6]) || 0;
      const key = `${name}|${style}`;
      qty[key] = (qty[key] || 0) + q;

      const username = String(r[2] || "").trim();
      if (!customersMap.has(username)) customersMap.set(username, { display: username, items: {}, paid: 0 });
      const c = customersMap.get(username)!;
      c.items[key] = (c.items[key] || 0) + q;

      const orderNo = String(r[0] || "").trim();
      if (orderNo && !paidSeenOrderNo.has(orderNo)) {
        paidSeenOrderNo.add(orderNo);
        c.paid += parsePaidAmount(r[11]);
      }
    }
  }

  return { products, qty, customers: Array.from(customersMap.values()) };
}

const LABELS = ["商品", "款式", "售價", "進貨單價", "單件重量(g)", "數量", "小計", "", "【運費計算】", "包裹總重(g)", "每公斤價格", "內陸運費", "商品總重(g)", "包材重量(g)", "每g分攤比例", "【總覽】", "總收入", "總進貨成本", "其他", "淨利潤", "【客戶應收運費】", "客戶"];

/** 組出「某個企劃的成本分頁＋隱藏明細分頁」需要寫入的請求清單（純組資料，不呼叫 API） */
async function buildCostTabRequests(sheets: SheetsClient, costId: string, planTab: string, agg: Aggregated): Promise<BatchRequest[]> {
  const { sheetId } = await ensureSheetExists(costId, planTab);
  const products = agg.products;
  const N = products.length;

  const manual = new Map<string, { buy: any; weightWrite: any }>();
  let pkgTotal: any = "", kgPrice: any = "", landFee: any = "", otherVal: any = "";
  const { values: oldValues, formulas: oldFormulas } = await getValuesAndFormulas(sheets, costId, `${planTab}!A1:G100000`);
  oldValues.forEach((v, i) => {
    const a = String(v[0] || "").trim();
    const cell = (c: number) => (oldFormulas[i]?.[c] ? oldFormulas[i][c] : v[c]);
    if (a === "包裹總重(g)") { pkgTotal = cell(2); return; }
    if (a === "每公斤價格") { kgPrice = cell(2); return; }
    if (a === "內陸運費") { landFee = cell(2); return; }
    if (a === "其他") { otherVal = cell(2); return; }
    if (a && LABELS.indexOf(a) === -1) {
      manual.set(`${a}|${String(v[1] || "").trim()}`, { buy: cell(3), weightWrite: cell(4) });
    }
  });

  const data: (string | number)[][] = [];
  data.push(["商品", "款式", "售價", "進貨單價", "單件重量(g)", "數量", "小計"]);
  products.forEach((p, i) => {
    const row = 2 + i;
    const m = manual.get(`${p.name}|${p.style}`) || ({} as any);
    const qty = agg.qty[`${p.name}|${p.style}`] || 0;
    data.push([
      p.name, p.style, p.price,
      m.buy !== undefined && m.buy !== "" ? m.buy : "",
      m.weightWrite !== undefined && m.weightWrite !== "" ? m.weightWrite : "",
      qty,
      `=IF(D${row}="","",D${row}*F${row})`,
    ]);
  });
  const lastP = N + 1;
  data.push(["", "", "", "", "", "", ""]);

  const pkgRow = N + 4, prodWRow = N + 7, pkgMatRow = N + 8;
  data.push(["【運費計算】", "", "", "", "", "", ""]);
  data.push(["包裹總重(g)", "", pkgTotal, "", "", "", ""]);
  data.push(["每公斤價格", "", kgPrice, "", "", "", ""]);
  data.push(["內陸運費", "", landFee, "", "", "", ""]);
  data.push(["商品總重(g)", "", `=SUMPRODUCT((E2:E${lastP}<>"")*E2:E${lastP}*F2:F${lastP})`, "", "", "", ""]);
  data.push(["包材重量(g)", "", `=IF(C${pkgRow}="","",C${pkgRow}-C${prodWRow})`, "", "", "", ""]);
  data.push(["每g分攤比例", "", `=IF(C${prodWRow}=0,"",C${pkgMatRow}/C${prodWRow})`, "", "", "", ""]);
  data.push(["", "", "", "", "", "", ""]);

  const incomeRow = N + 12, costRow = N + 13, otherRow = N + 14;
  const kgRow = N + 5, ratioRow = N + 9, landRow = N + 6;
  data.push(["【總覽】", "", "", "", "", "", ""]);
  data.push(["總收入", "", `=SUMPRODUCT((C2:C${lastP}<>"")*C2:C${lastP}*F2:F${lastP})`, "", "", "", ""]);
  data.push(["總進貨成本", "", `=SUMPRODUCT((D2:D${lastP}<>"")*D2:D${lastP}*F2:F${lastP})`, "", "", "", ""]);
  data.push(["其他", "", otherVal, "", "", "", ""]);
  data.push(["淨利潤", "", `=IF(C${incomeRow}="","",C${incomeRow}-C${costRow}+IF(C${otherRow}="",0,C${otherRow}))`, "", "", "", ""]);

  const customers = (agg.customers || []).slice().sort((a, b) => (a.display < b.display ? -1 : 1));
  const nCust = customers.length;
  const detailName = `_${planTab}_明細`;
  const detailRef = `'${detailName.replace(/'/g, "''")}'!`;
  const { sheetId: detailSheetId } = await ensureSheetExists(costId, detailName);
  const ddata: (string | number)[][] = [["商品", "款式", ...customers.map((c) => c.display)]];
  products.forEach((p) => {
    const rowArr: (string | number)[] = [p.name, p.style];
    customers.forEach((c) => rowArr.push(Number(c.items[`${p.name}|${p.style}`]) || 0));
    ddata.push(rowArr);
  });

  data.push(["", "", "", "", "", "", ""]);
  data.push(["【客戶應收運費】", "", "", "", "", "", ""]);
  data.push(["客戶", "應收運費", "商品小計", "應收總額", "已收", "尚欠", ""]);
  const custStartRow = N + 19;
  customers.forEach((c, i) => {
    const row = custStartRow + i;
    const col = columnToLetter(3 + i);
    const wSum = `SUMPRODUCT($E$2:$E$${lastP},${detailRef}${col}2:${col}${lastP})`;
    const ratioMul = `(1+IF($C$${ratioRow}="",0,$C$${ratioRow}))`;
    const landShare = `IF($C$${landRow}="",0,$C$${landRow}/${nCust})`;
    const feeF = `=CEILING(IF($C$${kgRow}="",0,(${wSum})*${ratioMul}*$C$${kgRow}/1000)+${landShare},1)`;
    const subtotalF = `=SUMPRODUCT($C$2:$C$${lastP},${detailRef}${col}2:${col}${lastP})`;
    data.push([
      c.display,
      feeF,
      subtotalF,
      `=B${row}+C${row}`,
      Number(c.paid) || 0,
      `=D${row}-E${row}`,
      "",
    ]);
  });

  return [
    buildClearRequest(sheetId, 100000, 7),
    buildWriteRequest(sheetId, 0, 0, data),
    buildBoldRangeRequest(sheetId, 0, 1, 0, 7),
    buildBoldRangeRequest(sheetId, N + 17, N + 19, 0, 7),
    buildClearRequest(detailSheetId, 100000, 26),
    buildWriteRequest(detailSheetId, 0, 0, ddata),
    buildHideSheetRequest(detailSheetId, true),
  ];
}

/** 組出「總覽」分頁完整重建的請求清單 */
function buildCostSummaryRequests(sheetId: number, rows: { name: string; tab: string; incomeRow: number; costRow: number; profitRow: number }[]): BatchRequest[] {
  const data: (string | number)[][] = [["企劃", "銷售(收入)", "進貨成本", "淨利潤"]];
  rows.forEach((r) => {
    const ref = `'${r.tab.replace(/'/g, "''")}'!C`;
    data.push([r.name, `=${ref}${r.incomeRow}`, `=${ref}${r.costRow}`, `=${ref}${r.profitRow}`]);
  });
  const n = rows.length;
  if (n > 0) {
    const first = 2, last = 1 + n;
    data.push(["合計", `=SUM(B${first}:B${last})`, `=SUM(C${first}:C${last})`, `=SUM(D${first}:D${last})`]);
  }

  const requests: BatchRequest[] = [
    buildClearRequest(sheetId, 100000, 4),
    buildWriteRequest(sheetId, 0, 0, data),
    buildBoldRangeRequest(sheetId, 0, 1, 0, 4),
  ];
  if (n > 0) requests.push(buildBoldRangeRequest(sheetId, n + 1, n + 2, 0, 4));
  return requests;
}

/** 刷新「單一」企劃的成本分頁（下單當下即時呼叫用，只更新這一個企劃；
 *  同時也會把這個企劃在「總覽」裡的那一列一併新增/更新好） */
export async function syncOnePlanCostTab(planId: string, planName: string) {
  const costId = requireCostSheetId();
  const tabName = safeTabName(planName);
  await withRetry(async () => {
    const sheets = await getSheets();
    const agg = await aggregatePlanFromSheet(sheets, requireSheetId(), tabName);
    if (agg.products.length === 0) return;

    const costRequests = await buildCostTabRequests(sheets, costId, tabName, agg);

    const { sheetId: summarySheetId } = await ensureSheetExists(costId, "總覽", 0);
    const { values } = await getValuesAndFormulas(sheets, costId, `總覽!A1:D100000`);
    const N = agg.products.length;
    const incomeRow = N + 12, costRow = N + 13, profitRow = N + 15;
    const ref = `'${tabName.replace(/'/g, "''")}'!C`;
    const newRow: (string | number)[] = [planName, `=${ref}${incomeRow}`, `=${ref}${costRow}`, `=${ref}${profitRow}`];
    let dataRows = values.slice(1);
    const hasTotal = dataRows.length > 0 && String(dataRows[dataRows.length - 1]?.[0] || "").trim() === "合計";
    if (hasTotal) dataRows = dataRows.slice(0, -1);
    const idx = dataRows.findIndex((r) => String(r[0] || "").trim() === planName);
    if (idx >= 0) dataRows[idx] = newRow;
    else dataRows.push(newRow);

    const finalData: (string | number)[][] = [["企劃", "銷售(收入)", "進貨成本", "淨利潤"], ...dataRows];
    const n = dataRows.length;
    if (n > 0) {
      const first = 2, last = 1 + n;
      finalData.push(["合計", `=SUM(B${first}:B${last})`, `=SUM(C${first}:C${last})`, `=SUM(D${first}:D${last})`]);
    }
    const summaryRequests: BatchRequest[] = [
      buildClearRequest(summarySheetId, 100000, 4),
      buildWriteRequest(summarySheetId, 0, 0, finalData),
      buildBoldRangeRequest(summarySheetId, 0, 1, 0, 4),
    ];
    if (n > 0) summaryRequests.push(buildBoldRangeRequest(summarySheetId, n + 1, n + 2, 0, 4));

    await runBatch(sheets, costId, [...costRequests, ...summaryRequests]);
  });
}

/** 刷新「所有」企劃的成本表（給手動「立即完整同步一次」用；也會重建「總覽」分頁）。
 *  所有企劃的請求會合併成一份，整個流程只打「一次」批次寫入 API。 */
export async function syncCostWorkbook() {
  const costId = requireCostSheetId();
  const mainId = requireSheetId();
  const sheets = await getSheets();
  const plans = await getAllPlans();

  const summaryRows: { name: string; tab: string; incomeRow: number; costRow: number; profitRow: number }[] = [];
  const failedPlans: string[] = [];
  const allRequests: BatchRequest[] = [];

  for (const p of plans) {
    try {
      const tabName = safeTabName(p.name);
      const agg = await aggregatePlanFromSheet(sheets, mainId, tabName);
      if (agg.products.length === 0) continue;
      const requests = await buildCostTabRequests(sheets, costId, tabName, agg);
      allRequests.push(...requests);
      const N = agg.products.length;
      summaryRows.push({ name: p.name, tab: tabName, incomeRow: N + 12, costRow: N + 13, profitRow: N + 15 });
    } catch (e: any) {
      failedPlans.push(`${p.name}：${e?.message || "未知錯誤"}`);
    }
  }

  const { sheetId: summarySheetId } = await ensureSheetExists(costId, "總覽", 0);
  allRequests.push(...buildCostSummaryRequests(summarySheetId, summaryRows));

  if (allRequests.length > 0) {
    await withRetry(() => runBatch(sheets, costId, allRequests));
  }
  if (failedPlans.length > 0) {
    throw new Error(`部分企劃成本表同步失敗（其餘企劃仍已正常同步）：${failedPlans.join("；")}`);
  }
}
