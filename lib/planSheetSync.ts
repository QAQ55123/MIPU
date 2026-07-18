import { getSupabaseAdmin } from "./supabase";
import {
  getSheets, requireSheetId, requireCostSheetId,
  ensureSheetExists, formatHeader, boldRange, hideSheetTab,
  getValuesAndFormulas, writeRange, clearRange, columnToLetter,
} from "./googleSheets";

const ORDER_HEADER = ["訂單編號", "來源", "暱稱", "FB個人網址", "商品名稱", "款式", "數量", "單價", "小計", "訂單時間", "交易方式", "付款狀態"];
const CATALOG_HEADER = ["商品名稱", "款式", "單價", "圖片"];

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
// ==================================================================================

/** 同步單一企劃的訂單分頁（商品目錄永遠重新寫入；已存在的訂單列保留「付款狀態」欄的手動內容，不會被洗掉） */
export async function syncOnePlanOrderTab(planId: string, planName: string) {
  const id = requireSheetId();
  const tabName = safeTabName(planName);
  const { sheets, sheetId } = await ensureSheetExists(id, tabName);

  const [products, orders] = await Promise.all([getPlanProducts(planId), getPlanOrders(planId)]);

  // 讀取目前分頁內容，找出「訂單明細表頭」那一列，把已經存在的訂單列（含手動填的付款狀態）保留下來
  const { values: existingValues } = await getValuesAndFormulas(sheets, id, `${tabName}!A1:L100000`);
  let existingHeaderRow = -1;
  for (let i = 0; i < existingValues.length; i++) {
    if (String(existingValues[i]?.[0] || "").trim() === ORDER_HEADER[0]) { existingHeaderRow = i; break; }
  }
  const existingOrderRows: any[][] = existingHeaderRow >= 0 ? existingValues.slice(existingHeaderRow + 1) : [];
  const preservedPaidStatusByOrderItem = new Map<string, any>(); // key: 訂單編號|商品名稱|款式 -> 付款狀態
  existingOrderRows.forEach((r) => {
    const key = `${r[0] || ""}|${r[4] || ""}|${r[5] || ""}`;
    if (r[11] !== undefined && r[11] !== "") preservedPaidStatusByOrderItem.set(key, r[11]);
  });

  // 組「商品目錄」區塊
  const catalogRows = products.map((p: any) => [p.name, p.style || "", Number(p.price) || 0, p.image_url || ""]);
  const catalogBlock = [CATALOG_HEADER, ...catalogRows];

  // 組「訂單明細」區塊（保留手動填過的付款狀態）
  const orderRows: (string | number)[][] = [];
  orders.forEach((o: any) => {
    (o.order_items || []).forEach((it: any) => {
      const key = `${o.order_no}|${it.product_name}|${it.style || ""}`;
      const preserved = preservedPaidStatusByOrderItem.get(key);
      orderRows.push([
        o.order_no,
        "", // 來源：現在系統統一帳號制，沒有這個概念，留空
        o.username,
        o.profile_url,
        it.product_name,
        it.style || "",
        it.qty,
        Number(it.unit_price) || 0,
        Number(it.subtotal) || 0,
        new Date(o.created_at).toLocaleString("zh-TW"),
        o.payment,
        preserved !== undefined ? preserved : "",
      ]);
    });
  });

  const fullData: (string | number)[][] = [
    ...catalogBlock,
    ["", "", "", "", "", "", "", "", "", "", "", ""], // 分隔空列
    ORDER_HEADER,
    ...orderRows,
  ];

  await clearRange(sheets, id, `${tabName}!A1:L100000`);
  await writeRange(sheets, id, `${tabName}!A1`, fullData);
  await boldRange(sheets, id, sheetId, 0, 1, 0, CATALOG_HEADER.length);
  await boldRange(sheets, id, sheetId, catalogBlock.length + 1, catalogBlock.length + 2, 0, ORDER_HEADER.length);
}

/** 同步「所有」企劃的訂單分頁（給手動「立即完整同步一次」用） */
export async function syncAllPlanOrderTabs() {
  const plans = await getAllPlans();
  for (const p of plans) {
    await syncOnePlanOrderTab(p.id, p.name);
  }
}

/** 單一新訂單即時同步（客人下單當下呼叫；直接重寫該企劃分頁，資料量不大，這樣做最單純可靠） */
export async function syncOrderRealtimeToPlanTab(planId: string, planName: string) {
  await syncOnePlanOrderTab(planId, planName);
}

// ==================================================================================
// 二、「成本」試算表：每個企劃各一個分頁，完整比照原系統（商品成本表／運費計算／總覽／客戶應收運費）
//     進貨單價、單件重量、包裹總重、每公斤價格、內陸運費、其他 都是手填欄位，每次刷新都會被保留
// ==================================================================================

type Aggregated = {
  products: { name: string; style: string; price: number }[];
  qty: Record<string, number>; // "商品|款式" -> 數量
  customers: { display: string; items: Record<string, number>; paid: number }[];
};

/** 從「主試算表」剛同步好的企劃分頁讀取資料，統計商品目錄＋依人分組的訂購數量與已收金額（比照原系統 aggregatePlan_，
 *  這樣「已收金額」才能吃到你直接在 Sheet 上手動填的付款狀態） */
async function aggregatePlanFromSheet(tabName: string): Promise<Aggregated> {
  const id = requireSheetId();
  const sheets = await getSheets();
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
        const paidVal = parsePaidAmount(r[11]);
        if (paidVal > 0) { c.paid += paidVal; paidSeenOrderNo.add(orderNo); }
      }
    }
  }

  return { products, qty, customers: Array.from(customersMap.values()) };
}

/** 產生/刷新單一企劃的成本分頁（保留你手填的進貨單價/單件重量/包裹總重/每公斤價格/內陸運費/其他） */
async function updateCostTab(costId: string, planTab: string, agg: Aggregated) {
  const products = agg.products;
  const N = products.length;
  if (N === 0) return; // 沒有商品，不是有效的企劃分頁

  const sheets = await getSheets();
  const { sheetId } = await ensureSheetExists(costId, planTab);

  const LABELS = [
    "商品", "【運費計算】", "包裹總重(g)", "每公斤價格", "內陸運費", "商品總重(g)",
    "包材重量(g)", "每g分攤比例", "【總覽】", "總收入", "總進貨成本", "其他", "淨利潤",
    "【客戶應收運費】", "客戶", "",
  ];

  // 先讀出目前內容，把手填欄位（含公式）保留下來
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
  data.push(["商品", "款式", "售價", "進貨單價", "單件重量(g)", "數量", "小計"]); // row 1
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
  data.push(["", "", "", "", "", "", ""]); // 空列

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

  // 隱藏明細分頁：放每位客戶的各商品數量，讓「客戶商品重量/小計」用公式即時算
  const customers = (agg.customers || []).slice().sort((a, b) => (a.display < b.display ? -1 : 1));
  const nCust = customers.length;
  const detailName = `_${planTab}_明細`;
  const detailRef = `'${detailName.replace(/'/g, "''")}'!`;
  const { sheetId: detailSheetId } = await ensureSheetExists(costId, detailName);
  await clearRange(sheets, costId, `${detailName}!A1:ZZ100000`);
  const ddata: (string | number)[][] = [["商品", "款式", ...customers.map((c) => c.display)]];
  products.forEach((p) => {
    const rowArr: (string | number)[] = [p.name, p.style];
    customers.forEach((c) => rowArr.push(Number(c.items[`${p.name}|${p.style}`]) || 0));
    ddata.push(rowArr);
  });
  await writeRange(sheets, costId, `${detailName}!A1`, ddata);
  await hideSheetTab(sheets, costId, detailSheetId, true);

  data.push(["", "", "", "", "", "", ""]);
  data.push(["【客戶應收運費】", "", "", "", "", "", ""]);
  data.push(["客戶", "應收運費", "商品小計", "應收總額", "已收", "尚欠", ""]);
  const custStartRow = N + 19;
  customers.forEach((c, i) => {
    const row = custStartRow + i;
    const col = columnToLetter(3 + i); // 明細分頁裡，這位客戶的欄（A商品 B款式 C起是客戶）
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

  await clearRange(sheets, costId, `${planTab}!A1:G100000`);
  await writeRange(sheets, costId, `${planTab}!A1`, data);
  await boldRange(sheets, costId, sheetId, 0, 1, 0, 7);
  await boldRange(sheets, costId, sheetId, N + 17, N + 19, 0, 7); // 客戶應收運費 標題兩列
}

/** 在成本試算表建立/刷新「總覽」分頁：每個企劃一列（銷售/成本/利潤），用公式參照各企劃分頁，最後一列是合計 */
async function buildCostSummary(costId: string, rows: { name: string; tab: string; incomeRow: number; costRow: number; profitRow: number }[]) {
  const sheets = await getSheets();
  const { sheetId } = await ensureSheetExists(costId, "總覽", 0);

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

  await clearRange(sheets, costId, `總覽!A1:D100000`);
  await writeRange(sheets, costId, `總覽!A1`, data);
  await boldRange(sheets, costId, sheetId, 0, 1, 0, 4);
  if (n > 0) await boldRange(sheets, costId, sheetId, n + 1, n + 2, 0, 4);
}

/** 刷新所有企劃的成本表（給手動「立即完整同步一次」用；也可以之後排程呼叫）
 *  注意：要先確保「訂單」分頁已經同步過，這裡會直接讀取主試算表裡每個企劃分頁的內容來統計 */
export async function syncCostWorkbook() {
  const costId = requireCostSheetId();
  const plans = await getAllPlans();

  const summaryRows: { name: string; tab: string; incomeRow: number; costRow: number; profitRow: number }[] = [];
  for (const p of plans) {
    const tabName = safeTabName(p.name);
    const agg = await aggregatePlanFromSheet(tabName);
    if (agg.products.length === 0) continue; // 這個企劃還沒有商品，略過
    await updateCostTab(costId, tabName, agg);
    const N = agg.products.length;
    summaryRows.push({ name: p.name, tab: tabName, incomeRow: N + 12, costRow: N + 13, profitRow: N + 15 });
  }
  await buildCostSummary(costId, summaryRows);
}
