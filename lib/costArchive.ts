import { getSupabaseAdmin } from "./supabase";
import {
  getSheets, requireCostSheetId, requireCostArchiveSheetId,
  buildWriteRequest, buildBoldRangeRequest, runBatch, type BatchRequest,
} from "./googleSheets";
import { safeTabName, readLiveSummaryRows, getArchivedSummaryRows, buildSummaryRequests } from "./planSheetSync";

/**
 * 「徹底刪除」企劃時的成本表封存流程，分兩段：
 *
 *   1. archivePlanCostBeforeDelete（刪資料庫之前做，失敗就整個取消，什麼都不刪）
 *      - 把成本試算表裡這個企劃分頁「目前算好的數字」複製到封存試算表（數值快照，不是公式）
 *      - 把總覽那一列的五個數字存進資料表 cost_archives，之後總覽會以「企劃名（已封存）」固定保留
 *
 *   2. removePlanCostTabsAfterDelete（資料庫刪除成功之後做）
 *      - 從成本試算表移除這個企劃的分頁＋隱藏的「_企劃名_明細」分頁
 *      - 同一批請求重寫總覽（拿掉原本連到該分頁的公式列，換成已封存的固定數字列），合計不變
 */

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function taipeiDateStamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts.replace(/-/g, "");
}

/** 從成本分頁的「計算後數值」找出總覽要用的五個數字（跟總覽公式的算法一樣） */
function extractSummaryNumbers(values: any[][]) {
  let income = 0, cost = 0, profit = 0, paid = 0, owing = 0;
  let custHeader = -1;
  for (let i = 0; i < values.length; i++) {
    const a = String(values[i]?.[0] ?? "").trim();
    if (a === "總收入") income = num(values[i][2]);
    else if (a === "總進貨成本") cost = num(values[i][2]);
    else if (a === "淨利潤") profit = num(values[i][2]);
    else if (a === "客戶" && String(values[i]?.[1] ?? "").trim() === "應收運費") { custHeader = i; break; }
  }
  if (custHeader >= 0) {
    for (let i = custHeader + 1; i < values.length; i++) {
      const a = String(values[i]?.[0] ?? "").trim();
      if (!a) break;
      paid += num(values[i][4]);
      owing += num(values[i][5]);
    }
  }
  return { income, cost, profit, paid, owing };
}

export type ArchiveResult = { archived: boolean; archiveId?: string; archiveTab?: string };

export async function archivePlanCostBeforeDelete(planName: string): Promise<ArchiveResult> {
  const costId = requireCostSheetId();
  const archiveSheetId = requireCostArchiveSheetId();
  const sheets = await getSheets();
  const tab = safeTabName(planName);

  const costMeta = await sheets.spreadsheets.get({ spreadsheetId: costId });
  const costTitles = new Set((costMeta.data.sheets || []).map((s) => s.properties?.title || ""));
  if (!costTitles.has(tab)) {
    // 這個企劃沒有成本分頁（例如從來沒有商品/訂單同步過），沒有東西要封存
    return { archived: false };
  }

  // 讀「計算後的數值」：數字維持數字，公式算出來的結果直接拿結果
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: costId,
    range: `'${tab.replace(/'/g, "''")}'!A1:H100000`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values: any[][] = (res.data.values || []).map((row) =>
    row.map((c: any) => (typeof c === "number" ? c : c == null ? "" : String(c)))
  );
  // 避免文字內容剛好是「=」開頭被當成公式
  const safeValues: (string | number)[][] = values.map((row) =>
    row.map((c) => (typeof c === "string" && c.startsWith("=") ? `'${c}` : c))
  );

  // 封存試算表的分頁名稱：同名已存在就加日期，再撞名就加 -2、-3…
  const archiveMeta = await sheets.spreadsheets.get({ spreadsheetId: archiveSheetId });
  const archiveTitles = new Set((archiveMeta.data.sheets || []).map((s) => s.properties?.title || ""));
  let archiveTab = tab;
  if (archiveTitles.has(archiveTab)) {
    const base = `${tab.slice(0, 85)}_${taipeiDateStamp()}`;
    archiveTab = base;
    let k = 2;
    while (archiveTitles.has(archiveTab)) archiveTab = `${base}-${k++}`;
  }

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: archiveSheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: archiveTab,
            gridProperties: { rowCount: Math.max(1000, safeValues.length + 10), columnCount: 26 },
          },
        },
      }],
    },
  });
  const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;

  const requests: BatchRequest[] = [];
  if (safeValues.length > 0) requests.push(buildWriteRequest(newSheetId, 0, 0, safeValues));
  // 跟原本成本分頁一樣的粗體：第一列標題、各區塊小標題、客戶表頭
  requests.push(buildBoldRangeRequest(newSheetId, 0, 1, 0, 8));
  values.forEach((row, i) => {
    const a = String(row?.[0] ?? "").trim();
    if (a.startsWith("【") || (a === "客戶" && String(row?.[1] ?? "").trim() === "應收運費")) {
      requests.push(buildBoldRangeRequest(newSheetId, i, i + 1, 0, 8));
    }
  });
  await runBatch(sheets, archiveSheetId, requests);

  const nums = extractSummaryNumbers(values);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cost_archives")
    .insert({ plan_name: planName, archive_tab: archiveTab, ...nums })
    .select("id")
    .single();
  if (error) {
    // 總覽數字沒存成功，封存分頁也撤掉，維持「什麼都沒發生」
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: archiveSheetId,
      requestBody: { requests: [{ deleteSheet: { sheetId: newSheetId } }] },
    }).catch(() => {});
    throw new Error("儲存封存的總覽數字失敗（是否尚未執行 migration_add_cost_archives.sql？）：" + error.message);
  }

  return { archived: true, archiveId: data.id, archiveTab };
}

/** 資料庫刪除失敗時，把剛剛建立的封存紀錄撤回（避免企劃還在、總覽卻又多一列已封存，重複計算） */
export async function rollbackPlanCostArchive(result: ArchiveResult) {
  if (!result.archived || !result.archiveId) return;
  const supabase = getSupabaseAdmin();
  await supabase.from("cost_archives").delete().eq("id", result.archiveId);
  if (result.archiveTab) {
    try {
      const sheets = await getSheets();
      const archiveSheetId = requireCostArchiveSheetId();
      const meta = await sheets.spreadsheets.get({ spreadsheetId: archiveSheetId });
      const target = (meta.data.sheets || []).find((s) => s.properties?.title === result.archiveTab);
      if (target?.properties?.sheetId != null) {
        await runBatch(sheets, archiveSheetId, [{ deleteSheet: { sheetId: target.properties.sheetId } }]);
      }
    } catch {}
  }
}

export async function removePlanCostTabsAfterDelete(planName: string) {
  const costId = requireCostSheetId();
  const sheets = await getSheets();
  const tab = safeTabName(planName);
  const detailName = `_${tab}_明細`;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: costId });
  const byTitle = new Map<string, number>();
  for (const s of meta.data.sheets || []) {
    if (s.properties?.title != null && s.properties?.sheetId != null) byTitle.set(s.properties.title, s.properties.sheetId);
  }

  const requests: BatchRequest[] = [];
  const summarySheetId = byTitle.get("總覽");
  if (summarySheetId != null) {
    // 先重寫總覽（這個企劃的公式列拿掉、改成已封存的固定數字），再刪分頁，同一批送出
    const liveRows = await readLiveSummaryRows(sheets, costId, planName);
    const archived = await getArchivedSummaryRows();
    requests.push(...buildSummaryRequests(summarySheetId, liveRows, archived));
  }
  for (const t of [tab, detailName]) {
    const id = byTitle.get(t);
    if (id != null) requests.push({ deleteSheet: { sheetId: id } });
  }
  await runBatch(sheets, costId, requests);
}
