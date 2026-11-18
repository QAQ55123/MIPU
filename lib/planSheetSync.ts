import { getSupabaseAdmin } from "./supabase";
import {
  getSheets, requireSheetId, requireCostSheetId,
  ensureSheetExistsCached, getValuesAndFormulas, batchGetValues, columnToLetter,
  buildClearRequest, buildClearFormatRequest, buildWriteRequest, buildBoldRangeRequest, buildHideSheetRequest, buildNumberFormatRequest, buildEnsureColumnCountRequest,
  runBatch, type BatchRequest, type SheetsClient, type SheetMetaCache,
} from "./googleSheets";
import { getDisplayNameMap } from "./memberDisplayName";

// 「會員名稱」刻意放在最後一欄（M 欄）：前面 A~L 欄的位置成本表統計會用到，不能移動
const ORDER_HEADER = ["訂單編號", "來源", "暱稱", "FB個人網址", "商品名稱", "款式", "數量", "單價", "小計", "訂單時間", "交易方式", "付款狀態", "會員名稱"];
const CATALOG_HEADER = ["商品名稱", "款式", "單價", "圖片", "運送方式"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function parsePaidAmount(v: any): number {
  const s = String(v == null ? "" : v).trim().replace(/nt\$?/i, "").replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type PlanRow = { id: string; name: string; deadline?: string | null };

async function getAllPlans(): Promise<PlanRow[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("plans").select("id, name, sort_order, deadline");
  function statusRank(p: { deadline: string | null }) {
    if (!p.deadline) return 1;
    return new Date(p.deadline).getTime() < Date.now() ? 2 : 0;
  }
  const rows = (data || []) as any[];
  rows.sort((a, b) => {
    const r = statusRank(a) - statusRank(b);
    if (r !== 0) return r;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  return rows;
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

export function safeTabName(name: string): string {
  return (name || "未命名企劃").replace(/[\\/?*\[\]:]/g, "_").slice(0, 90);
}

async function buildOrderTabRequests(sheets: SheetsClient, mainSheetId: string, planId: string, planName: string, cache: SheetMetaCache): Promise<BatchRequest[]> {
  const tabName = safeTabName(planName);
  const sheetId = await ensureSheetExistsCached(sheets, mainSheetId, tabName, cache);

  const [products, orders] = await Promise.all([getPlanProducts(planId), getPlanOrders(planId)]);

  const memberNames = await getDisplayNameMap(orders.map((o: any) => o.username));
  const catalogRows = products.map((p: any) => [p.name, p.style || "", Number(p.price) || 0, p.image_url || "", p.shipping_method || ""]);
  const catalogBlock = [CATALOG_HEADER, ...catalogRows];

  const orderRows: (string | number)[][] = [];
  orders.forEach((o: any) => {
    const paidAmount = Number(o.paid_amount) || 0;
    (o.order_items || []).forEach((it: any) => {
      orderRows.push([
        o.order_no, "", o.username, o.profile_url, it.product_name, it.style || "",
        it.qty, Number(it.unit_price) || 0, Number(it.subtotal) || 0,
        new Date(o.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }), o.payment, paidAmount > 0 ? paidAmount : "",
        memberNames.get(String(o.username || "").trim()) || "",
      ]);
    });
  });

  const fullData: (string | number)[][] = [
    ...catalogBlock,
    ["", "", "", "", "", "", "", "", "", "", "", "", ""],
    ORDER_HEADER,
    ...orderRows,
  ];

  return [
    buildClearRequest(sheetId, 100000, 13),
    buildWriteRequest(sheetId, 0, 0, fullData),
    buildBoldRangeRequest(sheetId, 0, 1, 0, CATALOG_HEADER.length),
    buildBoldRangeRequest(sheetId, catalogBlock.length + 1, catalogBlock.length + 2, 0, ORDER_HEADER.length),
  ];
}

export async function syncOnePlanOrderTab(planId: string, planName: string) {
  const id = requireSheetId();
  const sheets = await getSheets();
  const requests = await buildOrderTabRequests(sheets, id, planId, planName, new Map());
  await runBatch(sheets, id, requests);
}

export async function syncAllPlanOrderTabs() {
  const id = requireSheetId();
  const sheets = await getSheets();
  const plans = await getAllPlans();
  const failedPlans: string[] = [];
  const allRequests: BatchRequest[] = [];
  const cache: SheetMetaCache = new Map();

  for (const p of plans) {
    try {
      const requests = await buildOrderTabRequests(sheets, id, p.id, p.name, cache);
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

export async function syncOrderRealtimeToPlanTab(planId: string, planName: string) {
  await withRetry(() => syncOnePlanOrderTab(planId, planName));
}

type Aggregated = {
  products: { name: string; style: string; price: number; shippingMethod: string }[];
  qty: Record<string, number>;
  customers: { display: string; items: Record<string, number>; paid: number }[];
};

function aggregateFromValues(values: any[][]): Aggregated {
  const products: Aggregated["products"] = [];
  let headerRow = -1;
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    if (String(row[0] || "").trim() === ORDER_HEADER[0]) { headerRow = i; break; }
    if (i > 0 && String(row[0] || "").trim()) {
      products.push({ name: String(row[0]).trim(), style: String(row[1] || "").trim(), price: Number(row[2]) || 0, shippingMethod: String(row[4] || "").trim() });
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

async function aggregatePlanFromSheet(sheets: SheetsClient, id: string, tabName: string): Promise<Aggregated> {
  const { values } = await getValuesAndFormulas(sheets, id, `'${tabName.replace(/'/g, "''")}'!A1:L100000`);
  return aggregateFromValues(values);
}

const LABELS = [
  "商品", "款式", "運送方式", "售價", "進貨單價", "單件重量(g)", "數量", "小計", "",
  "【空運運費計算】", "【海運運費計算】", "【運費計算】", "包裹總重(g)", "每公斤價格", "商品總重(g)", "空運商品總重(g)", "海運商品總重(g)", "包材重量(g)", "每g分攤比例",
  "內陸運費",
  "【總覽】", "總收入", "總進貨成本", "其他", "淨利潤",
  "【客戶應收運費】", "客戶",
];

async function buildCostTabRequests(
  sheets: SheetsClient,
  costId: string,
  planTab: string,
  agg: Aggregated,
  oldValues: any[][],
  oldFormulas: any[][],
  cache: SheetMetaCache
): Promise<{ requests: BatchRequest[]; custStartRow: number; custCount: number; incomeRow: number; costRow: number; profitRow: number }> {
  const sheetId = await ensureSheetExistsCached(sheets, costId, planTab, cache);
  const products = agg.products;
  const N = products.length;

  const manual = new Map<string, { buy: any; weightWrite: any }>();
  let pkgTotalAir: any = "", kgPriceAir: any = "";
  let pkgTotalSea: any = "", kgPriceSea: any = "";
  let landFee: any = "", otherVal: any = "";
  let seenAirBlock = false, seenSeaBlock = false;
  // 判斷舊分頁是哪種格式（看第一列表頭的 C 欄）：
  //   舊格式（空運/海運分開之前）：商品｜款式｜售價｜進貨單價｜單件重量｜數量｜小計，只有一個【運費計算】區塊
  //   新格式：                     商品｜款式｜運送方式｜售價｜進貨單價｜單件重量｜數量｜小計，分【空運】【海運】兩個區塊
  // 以前不分格式一律照新格式的位置讀，舊格式分頁一同步就把進貨單價讀成空白、重量讀成數量、運費整個不見
  const header = (oldValues[0] || []).map((x: any) => String(x ?? "").trim());
  const isOldLayout = header[0] === "商品" && header[2] === "售價";
  const buyCol = isOldLayout ? 3 : 4;
  const weightCol = isOldLayout ? 4 : 5;
  oldValues.forEach((v, i) => {
    if (i === 0) return; // 表頭
    const a = String(v[0] || "").trim();
    const cell = (c: number) => (oldFormulas[i]?.[c] ? oldFormulas[i][c] : v[c]);
    if (a === "【空運運費計算】") { seenAirBlock = true; seenSeaBlock = false; return; }
    if (a === "【海運運費計算】") { seenSeaBlock = true; seenAirBlock = false; return; }
    if (a === "【運費計算】") { seenAirBlock = true; seenSeaBlock = false; return; } // 舊格式唯一的運費區塊 → 放進空運
    if (a === "包裹總重(g)") { if (seenSeaBlock) pkgTotalSea = cell(2); else pkgTotalAir = cell(2); return; }
    if (a === "每公斤價格") { if (seenSeaBlock) kgPriceSea = cell(2); else kgPriceAir = cell(2); return; }
    if (a === "內陸運費") { landFee = cell(2); return; }
    if (a === "其他") { otherVal = cell(2); return; }
    if (a && LABELS.indexOf(a) === -1 && !manual.has(`${a}|${String(v[1] || "").trim()}`)) {
      manual.set(`${a}|${String(v[1] || "").trim()}`, { buy: cell(buyCol), weightWrite: cell(weightCol) });
    }
  });

  const data: (string | number)[][] = [];
  data.push(["商品", "款式", "運送方式", "售價", "進貨單價", "單件重量(g)", "數量", "小計"]);
  products.forEach((p, i) => {
    const row = 2 + i;
    const m = manual.get(`${p.name}|${p.style}`) || ({} as any);
    const qty = agg.qty[`${p.name}|${p.style}`] || 0;
    data.push([
      p.name, p.style, p.shippingMethod || "", p.price,
      m.buy !== undefined && m.buy !== "" ? m.buy : "",
      m.weightWrite !== undefined && m.weightWrite !== "" ? m.weightWrite : "",
      qty,
      `=IF(E${row}="","",E${row}*G${row})`,
    ]);
  });
  const lastP = N + 1;
  const pad8 = () => ["", "", "", "", "", "", "", ""];
  data.push(pad8());

  const airPkgRow = N + 4, airKgRow = N + 5, airProdWRow = N + 6, airPkgMatRow = N + 7, airRatioRow = N + 8;
  data.push(["【空運運費計算】", "", "", "", "", "", "", ""]);
  data.push(["包裹總重(g)", "", pkgTotalAir, "", "", "", "", ""]);
  data.push(["每公斤價格", "", kgPriceAir, "", "", "", "", ""]);
  data.push(["空運商品總重(g)", "", `=SUMPRODUCT((C2:C${lastP}="空運")*F2:F${lastP}*G2:G${lastP})`, "", "", "", "", ""]);
  data.push(["包材重量(g)", "", `=IF(C${airPkgRow}="","",C${airPkgRow}-C${airProdWRow})`, "", "", "", "", ""]);
  data.push(["每g分攤比例", "", `=IF(C${airProdWRow}=0,"",C${airPkgMatRow}/C${airProdWRow})`, "", "", "", "", ""]);
  data.push(pad8());

  const seaPkgRow = N + 11, seaKgRow = N + 12, seaProdWRow = N + 13, seaPkgMatRow = N + 14, seaRatioRow = N + 15;
  data.push(["【海運運費計算】", "", "", "", "", "", "", ""]);
  data.push(["包裹總重(g)", "", pkgTotalSea, "", "", "", "", ""]);
  data.push(["每公斤價格", "", kgPriceSea, "", "", "", "", ""]);
  data.push(["海運商品總重(g)", "", `=SUMPRODUCT((C2:C${lastP}="海運")*F2:F${lastP}*G2:G${lastP})`, "", "", "", "", ""]);
  data.push(["包材重量(g)", "", `=IF(C${seaPkgRow}="","",C${seaPkgRow}-C${seaProdWRow})`, "", "", "", "", ""]);
  data.push(["每g分攤比例", "", `=IF(C${seaProdWRow}=0,"",C${seaPkgMatRow}/C${seaProdWRow})`, "", "", "", "", ""]);
  data.push(pad8());

  const landRow = N + 17;
  data.push(["內陸運費", "", landFee, "", "", "", "", ""]);
  data.push(pad8());

  const incomeRow = N + 20, costRow = N + 21, otherRow = N + 22, profitRow = N + 23;
  data.push(["【總覽】", "", "", "", "", "", "", ""]);
  data.push(["總收入", "", `=SUMPRODUCT((D2:D${lastP}<>"")*D2:D${lastP}*G2:G${lastP})`, "", "", "", "", ""]);
  data.push(["總進貨成本", "", `=SUMPRODUCT((E2:E${lastP}<>"")*E2:E${lastP}*G2:G${lastP})`, "", "", "", "", ""]);
  data.push(["其他", "", otherVal, "", "", "", "", ""]);
  data.push(["淨利潤", "", `=IF(C${incomeRow}="","",C${incomeRow}-C${costRow}+IF(C${otherRow}="",0,C${otherRow}))`, "", "", "", "", ""]);

  const customers = (agg.customers || []).slice().sort((a, b) => (a.display < b.display ? -1 : 1));
  const nCust = customers.length;
  const detailName = `_${planTab}_明細`;
  const detailRef = `'${detailName.replace(/'/g, "''")}'!`;
  const detailSheetId = await ensureSheetExistsCached(sheets, costId, detailName, cache);
  const ddata: (string | number)[][] = [["商品", "款式", ...customers.map((c) => c.display)]];
  products.forEach((p) => {
    const rowArr: (string | number)[] = [p.name, p.style];
    customers.forEach((c) => rowArr.push(Number(c.items[`${p.name}|${p.style}`]) || 0));
    ddata.push(rowArr);
  });

  data.push(pad8());
  data.push(["【客戶應收運費】", "", "", "", "", "", "", ""]);
  // 「會員名稱」放在 G 欄：A~F 欄的位置總覽公式、匯出賣貨便、封存都會用到，不能移動
  data.push(["客戶", "應收運費", "商品小計", "應收總額", "已收", "尚欠", "會員名稱", ""]);
  const custStartRow = N + 27;
  const custMemberNames = await getDisplayNameMap(customers.map((c) => c.display));
  customers.forEach((c, i) => {
    const row = custStartRow + i;
    const col = columnToLetter(3 + i);
    const wSumAir = `SUMPRODUCT(($C$2:$C$${lastP}="空運")*$F$2:$F$${lastP},${detailRef}${col}2:${col}${lastP})`;
    const wSumSea = `SUMPRODUCT(($C$2:$C$${lastP}="海運")*$F$2:$F$${lastP},${detailRef}${col}2:${col}${lastP})`;
    const ratioMulAir = `(1+IF($C$${airRatioRow}="",0,$C$${airRatioRow}))`;
    const ratioMulSea = `(1+IF($C$${seaRatioRow}="",0,$C$${seaRatioRow}))`;
    const landShare = `IF($C$${landRow}="",0,$C$${landRow}/${nCust})`;
    const airFee = `IF($C$${airKgRow}="",0,(${wSumAir})*${ratioMulAir}*$C$${airKgRow}/1000)`;
    const seaFee = `IF($C$${seaKgRow}="",0,(${wSumSea})*${ratioMulSea}*$C$${seaKgRow}/1000)`;
    const feeF = `=CEILING(${airFee}+${seaFee}+${landShare},1)`;
    const subtotalF = `=SUMPRODUCT($D$2:$D$${lastP},${detailRef}${col}2:${col}${lastP})`;
    data.push([c.display, feeF, subtotalF, `=B${row}+C${row}`, Number(c.paid) || 0, `=D${row}-E${row}`, custMemberNames.get(c.display) || "", ""]);
  });

  const detailColCount = Math.max(60, 2 + customers.length + 10);

  return {
    requests: [
      buildClearRequest(sheetId, 100000, 8),
      // 連格式一起清掉再重新套用：以前只清內容，商品／客戶數量一變，舊的粗體就留在錯的列上，看起來跑版
      buildClearFormatRequest(sheetId, 100000, 8),
      buildWriteRequest(sheetId, 0, 0, data),
      buildBoldRangeRequest(sheetId, 0, 1, 0, 8),
      buildBoldRangeRequest(sheetId, N + 24, N + 26, 0, 8),
      buildEnsureColumnCountRequest(detailSheetId, detailColCount),
      buildClearRequest(detailSheetId, 100000, detailColCount),
      buildWriteRequest(detailSheetId, 0, 0, ddata),
      buildHideSheetRequest(detailSheetId, true),
    ],
    custStartRow,
    custCount: customers.length,
    incomeRow,
    costRow,
    profitRow,
  };
}

export const ARCHIVED_SUFFIX = "（已封存）";
const SUMMARY_HEADER = ["企劃", "銷售(收入)", "進貨成本", "淨利潤", "已收款金額", "未收款金額", "淨利潤率"];

export type ArchivedSummaryRow = { plan_name: string; income: number; cost: number; profit: number; paid: number; owing: number };

/** 讀取「徹底刪除時封存」的企劃總覽數字（資料表 cost_archives）。
 *  資料表還沒建立（migration 沒跑）時回傳空陣列，不影響一般同步。 */
export async function getArchivedSummaryRows(): Promise<ArchivedSummaryRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cost_archives")
    .select("plan_name, income, cost, profit, paid, owing")
    .order("archived_at", { ascending: true });
  if (error) {
    console.error("讀取 cost_archives 失敗（是否尚未執行 migration_add_cost_archives.sql？）：", error.message);
    return [];
  }
  return (data || []).map((r: any) => ({
    plan_name: r.plan_name,
    income: Number(r.income) || 0,
    cost: Number(r.cost) || 0,
    profit: Number(r.profit) || 0,
    paid: Number(r.paid) || 0,
    owing: Number(r.owing) || 0,
  }));
}

/** 讀取目前總覽裡「現有企劃」的列（A~F 欄，公式保留公式），排除合計列、已封存列，以及 excludeName 指定的企劃 */
export async function readLiveSummaryRows(sheets: SheetsClient, costId: string, excludeName?: string): Promise<(string | number)[][]> {
  const { values, formulas } = await getValuesAndFormulas(sheets, costId, `總覽!A1:G100000`);
  return values
    .slice(1)
    .map((v, i) => {
      const f = formulas[i + 1] || [];
      return [0, 1, 2, 3, 4, 5].map((ci) => (f[ci] ? f[ci] : v[ci] ?? ""));
    })
    .filter((r) => {
      const name = String(r[0] || "").trim();
      if (!name || name === "合計") return false;
      if (name.endsWith(ARCHIVED_SUFFIX)) return false;
      if (excludeName != null && name === excludeName) return false;
      return true;
    });
}

/** 組出整個「總覽」分頁的寫入請求：現有企劃（公式，連到各企劃分頁）＋已封存企劃（固定數字）＋合計 */
export function buildSummaryRequests(sheetId: number, liveRows: (string | number)[][], archived: ArchivedSummaryRow[]): BatchRequest[] {
  const archivedRows: (string | number)[][] = archived.map((a) => [
    `${a.plan_name}${ARCHIVED_SUFFIX}`, a.income, a.cost, a.profit, a.paid, a.owing,
  ]);
  const dataRows: (string | number)[][] = [...liveRows, ...archivedRows].map((r, i) => {
    const row = i + 2;
    return [...r.slice(0, 6), `=IF(B${row}=0,"",D${row}/B${row})`];
  });
  const finalData: (string | number)[][] = [SUMMARY_HEADER, ...dataRows];
  const n = dataRows.length;
  const requests: BatchRequest[] = [
    buildClearRequest(sheetId, 100000, 7),
    buildBoldRangeRequest(sheetId, 0, 1, 0, 7),
    buildNumberFormatRequest(sheetId, 1, n + 1, 6, 7, "0.0%"),
  ];
  if (n > 0) {
    const first = 2, last = 1 + n;
    const totalRow = n + 3;
    finalData.push(["", "", "", "", "", "", ""]);
    finalData.push(["合計", `=SUM(B${first}:B${last})`, `=SUM(C${first}:C${last})`, `=SUM(D${first}:D${last})`, `=SUM(E${first}:E${last})`, `=SUM(F${first}:F${last})`, `=IF(B${totalRow}=0,"",D${totalRow}/B${totalRow})`]);
    requests.push(buildBoldRangeRequest(sheetId, totalRow - 1, totalRow, 0, 7));
    requests.push(buildNumberFormatRequest(sheetId, totalRow - 1, totalRow, 6, 7, "0.0%"));
  }
  requests.splice(1, 0, buildWriteRequest(sheetId, 0, 0, finalData));
  return requests;
}

function summaryRowForPlan(name: string, tab: string, incomeRow: number, costRow: number, profitRow: number, custStartRow: number, custCount: number): (string | number)[] {
  const ref = `'${tab.replace(/'/g, "''")}'!`;
  const custEndRow = custStartRow + custCount - 1;
  const paidF = custCount > 0 ? `=SUM(${ref}E${custStartRow}:E${custEndRow})` : 0;
  const owingF = custCount > 0 ? `=SUM(${ref}F${custStartRow}:F${custEndRow})` : 0;
  return [name, `=${ref}C${incomeRow}`, `=${ref}C${costRow}`, `=${ref}C${profitRow}`, paidF, owingF];
}

export async function syncOnePlanCostTab(planId: string, planName: string) {
  const costId = requireCostSheetId();
  const tabName = safeTabName(planName);
  await withRetry(async () => {
    const sheets = await getSheets();
    const agg = await aggregatePlanFromSheet(sheets, requireSheetId(), tabName);
    if (agg.products.length === 0) return;

    const cache: SheetMetaCache = new Map();
    // 新企劃第一次同步時成本分頁還不存在：直接讀會出錯（以前就是卡在這裡，分頁永遠建不起來），
    // 先確認分頁在不在，不在就當作空白成本表，後面 buildCostTabRequests 會建立分頁
    await ensureSheetExistsCached(sheets, costId, "總覽", cache, 0);
    const costTabExists = cache.get(costId)?.has(tabName) ?? false;
    const { values: oldValues, formulas: oldFormulas } = costTabExists
      ? await getValuesAndFormulas(sheets, costId, `'${tabName.replace(/'/g, "''")}'!A1:H100000`)
      : { values: [] as any[][], formulas: [] as any[][] };
    const { requests: costRequests, custStartRow, custCount, incomeRow, costRow, profitRow } = await buildCostTabRequests(sheets, costId, tabName, agg, oldValues, oldFormulas, cache);

    const summarySheetId = await ensureSheetExistsCached(sheets, costId, "總覽", cache, 0);
    const otherRows = await readLiveSummaryRows(sheets, costId, planName);
    const selfRow = summaryRowForPlan(planName, tabName, incomeRow, costRow, profitRow, custStartRow, custCount);
    const archived = await getArchivedSummaryRows();
    const summaryRequests = buildSummaryRequests(summarySheetId, [...otherRows, selfRow], archived);

    await runBatch(sheets, costId, [...costRequests, ...summaryRequests]);
  });
}

export async function syncCostWorkbook() {
  const costId = requireCostSheetId();
  const mainId = requireSheetId();
  const sheets = await getSheets();
  const plans = await getAllPlans();
  const cache: SheetMetaCache = new Map();

  const mainTabNames = plans.map((p) => safeTabName(p.name));
  if (mainTabNames.length > 0) {
    await ensureSheetExistsCached(sheets, mainId, mainTabNames[0], cache).catch(() => {});
  }
  const mainMeta = cache.get(mainId);
  const existingMainTabs = new Set(mainTabNames.filter((t) => mainMeta?.has(t)));
  const mainRanges = mainTabNames.filter((t) => existingMainTabs.has(t)).map((t) => `${t}!A1:L100000`);
  const mainValuesMap = mainRanges.length > 0 ? await batchGetValues(sheets, mainId, mainRanges) : {};

  await ensureSheetExistsCached(sheets, costId, "總覽", cache, 0);
  const costMeta = cache.get(costId);
  const costTabNames = plans.map((p) => safeTabName(p.name));
  const existingCostTabs = new Set(costTabNames.filter((t) => costMeta?.has(t)));
  const costRanges = costTabNames.filter((t) => existingCostTabs.has(t)).map((t) => `${t}!A1:H100000`);
  const [costValuesMap, costFormulasMap] = costRanges.length > 0
    ? await Promise.all([
        batchGetValues(sheets, costId, costRanges),
        batchGetValues(sheets, costId, costRanges, "FORMULA"),
      ])
    : [{}, {}];

  const summaryRows: { name: string; tab: string; incomeRow: number; costRow: number; profitRow: number; custStartRow: number; custCount: number }[] = [];
  const failedPlans: string[] = [];
  const allRequests: BatchRequest[] = [];

  for (const p of plans) {
    try {
      const tabName = safeTabName(p.name);
      const mainValues = mainValuesMap[`${tabName}!A1:L100000`] || [];
      const agg = aggregateFromValues(mainValues);
      if (agg.products.length === 0) continue;

      const oldValues = costValuesMap[`${tabName}!A1:H100000`] || [];
      const oldFormulas = costFormulasMap[`${tabName}!A1:H100000`] || [];
      const { requests, custStartRow, custCount, incomeRow, costRow, profitRow } = await buildCostTabRequests(sheets, costId, tabName, agg, oldValues, oldFormulas, cache);
      allRequests.push(...requests);
      summaryRows.push({ name: p.name, tab: tabName, incomeRow, costRow, profitRow, custStartRow, custCount });
    } catch (e: any) {
      failedPlans.push(`${p.name}：${e?.message || "未知錯誤"}`);
    }
  }

  const summarySheetId = await ensureSheetExistsCached(sheets, costId, "總覽", cache, 0);
  const archived = await getArchivedSummaryRows();
  const liveRows = summaryRows.map((r) => summaryRowForPlan(r.name, r.tab, r.incomeRow, r.costRow, r.profitRow, r.custStartRow, r.custCount));
  allRequests.push(...buildSummaryRequests(summarySheetId, liveRows, archived));

  if (allRequests.length > 0) {
    await withRetry(() => runBatch(sheets, costId, allRequests));
  }
  if (failedPlans.length > 0) {
    throw new Error(`部分企劃成本表同步失敗（其餘企劃仍已正常同步）：${failedPlans.join("；")}`);
  }
}
