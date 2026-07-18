import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const COST_SHEET_ID = process.env.GOOGLE_COST_SHEET_ID;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // 私鑰在環境變數裡通常會把換行符號變成字面上的 \n，這裡要還原成真正的換行
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("尚未設定 GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

type SheetsClient = ReturnType<typeof google.sheets>;

async function getSheets(): Promise<SheetsClient> {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

/** 確保指定試算表裡有這個名稱的分頁，不存在就自動建立；回傳這個分頁的數字 ID（格式設定要用） */
async function ensureSheetExists(spreadsheetId: string, sheetName: string): Promise<{ sheets: SheetsClient; sheetId: number }> {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const target = (meta.data.sheets || []).find((s) => s.properties?.title === sheetName);
  if (!target) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;
    return { sheets, sheetId: sheetId ?? 0 };
  }
  return { sheets, sheetId: target.properties?.sheetId ?? 0 };
}

/** 標題列排版：粗體＋淺色底、凍結第一列、欄寬自動依內容調整 */
async function formatHeader(sheets: SheetsClient, spreadsheetId: string, sheetId: number, columnCount: number) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.25, blue: 0.36 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columnCount },
          },
        },
      ],
    },
  });
}

/** 在指定分頁最後面加一列（適合訂單這種「一直新增、不會修改」的資料） */
export async function appendRow(sheetName: string, headerRow: string[], row: (string | number)[]) {
  if (!SHEET_ID) return; // 沒設定就靜靜跳過，不影響主要功能
  const { sheets, sheetId } = await ensureSheetExists(SHEET_ID, sheetName);

  // 檢查有沒有標題列，沒有就先補上（順便套用排版）
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:Z1` });
  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headerRow] },
    });
    await formatHeader(sheets, SHEET_ID, sheetId, headerRow.length);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

/** 清空指定分頁、整份重新寫入（適合會員/企劃/商品這種「會被編輯、需要跟資料庫保持一致」的資料） */
export async function overwriteSheet(sheetName: string, headerRow: string[], rows: (string | number)[][]) {
  if (!SHEET_ID) return;
  const { sheets, sheetId } = await ensureSheetExists(SHEET_ID, sheetName);

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:Z100000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headerRow, ...rows] },
  });
  await formatHeader(sheets, SHEET_ID, sheetId, headerRow.length);
}

// ---------------- 成本表（獨立的另一份試算表，訂單編號/帳號/企劃/金額自動同步，
// 「成本」欄留空給你自己在 Sheet 上手動填，「利潤」用公式自動算，右上角有總利潤加總） ----------------

const COST_SHEET_NAME = "成本";
const COST_HEADERS = ["訂單編號", "帳號", "企劃", "金額(TWD)", "成本(TWD)", "利潤(TWD)", "取貨狀態", "建立時間"];

/** 在標題列右邊放一個「總利潤(TWD)：」即時加總，新資料進來也會自動涵蓋進去 */
async function ensureCostSummary(sheets: SheetsClient, sheetId: number, lastDataRow: number) {
  const labelCol = COST_HEADERS.length + 2; // 空一欄當間隔
  const valueCol = labelCol + 1;
  const profitColLetter = String.fromCharCode(64 + COST_HEADERS.indexOf("利潤(TWD)") + 1); // F

  await sheets.spreadsheets.values.update({
    spreadsheetId: COST_SHEET_ID,
    range: `${COST_SHEET_NAME}!R1C${labelCol}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["總利潤(TWD)："]] },
  });
  const range = lastDataRow >= 2 ? `${profitColLetter}2:${profitColLetter}${lastDataRow}` : `${profitColLetter}2:${profitColLetter}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: COST_SHEET_ID,
    range: `${COST_SHEET_NAME}!R1C${valueCol}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[`=SUM(${range})`]] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: COST_SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: labelCol - 1, endColumnIndex: valueCol },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
            fields: "userEnteredFormat.textFormat",
          },
        },
      ],
    },
  });
}

/**
 * 把還沒同步過的訂單，寫進成本表（獨立試算表，用 GOOGLE_COST_SHEET_ID 指定）。
 * 用「訂單編號」判斷是否已經同步過，已存在的不會被覆蓋（避免洗掉你手動填的成本），
 * 每一列的「利潤」欄是公式：=金額-成本，你只要在 Sheet 上填成本，利潤會自動跳出來。
 */
export async function syncCostRows(
  orders: { orderNo: string; username: string; planName: string; amount: number; paidStatus: string; createdAt: string }[]
) {
  if (!COST_SHEET_ID) return; // 沒設定就靜靜跳過
  if (orders.length === 0) return;

  const { sheets, sheetId } = await ensureSheetExists(COST_SHEET_ID, COST_SHEET_NAME);

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: COST_SHEET_ID, range: `${COST_SHEET_NAME}!A:A` });
  const existingRows = existing.data.values || [];
  const hasHeader = existingRows.length > 0 && existingRows[0][0] === COST_HEADERS[0];
  const existingOrderNos = new Set(existingRows.slice(hasHeader ? 1 : 0).map((r) => r[0]));

  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: COST_SHEET_ID,
      range: `${COST_SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [COST_HEADERS] },
    });
    await formatHeader(sheets, COST_SHEET_ID, sheetId, COST_HEADERS.length);
  }

  const newOrders = orders.filter((o) => !existingOrderNos.has(o.orderNo));
  if (newOrders.length > 0) {
    const startRow = (hasHeader ? existingRows.length : existingRows.length + 1) + 1;
    const values = newOrders.map((o, i) => {
      const rowNum = startRow + i;
      return [
        o.orderNo,
        o.username,
        o.planName,
        o.amount,
        "", // 成本：留空給你自己填
        `=IF(E${rowNum}="","",D${rowNum}-E${rowNum})`, // 利潤 = 金額 - 成本
        o.paidStatus || "",
        o.createdAt,
      ];
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: COST_SHEET_ID,
      range: `${COST_SHEET_NAME}!A${startRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }

  const lastDataRow = (hasHeader ? existingRows.length : existingRows.length + 1) + newOrders.length;
  await ensureCostSummary(sheets, sheetId, lastDataRow);
}
