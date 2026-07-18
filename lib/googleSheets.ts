import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
export const COST_SHEET_ID = process.env.GOOGLE_COST_SHEET_ID;
export { SHEET_ID };

function getAuth() {
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  let key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim();
  // 如果不小心把前後的雙引號也一起貼進去了（例如貼到 Vercel 後台環境變數欄位時），先拿掉
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  // 私鑰在環境變數裡通常會把換行符號變成字面上的 \n，這裡要還原成真正的換行
  key = key.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("尚未設定 GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY 格式看起來不正確（貼到 Vercel 後台時不需要加前後的雙引號，只要貼金鑰本身）");
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export type SheetsClient = ReturnType<typeof google.sheets>;

export async function getSheets(): Promise<SheetsClient> {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

export function requireSheetId(): string {
  if (!SHEET_ID) throw new Error("尚未設定 GOOGLE_SHEET_ID");
  return SHEET_ID;
}
export function requireCostSheetId(): string {
  if (!COST_SHEET_ID) throw new Error("尚未設定 GOOGLE_COST_SHEET_ID");
  return COST_SHEET_ID;
}

/** 欄號轉字母：1→A, 27→AA */
export function columnToLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m - 1) / 26);
  }
  return s;
}

/** 確保指定試算表裡有這個名稱的分頁，不存在就自動建立；回傳這個分頁的數字 ID（格式設定要用）
 *  insertAtIndex：想固定放在第一個分頁（例如「總覽」）時傳 0 */
export async function ensureSheetExists(
  spreadsheetId: string,
  sheetName: string,
  insertAtIndex?: number
): Promise<{ sheets: SheetsClient; sheetId: number }> {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const target = (meta.data.sheets || []).find((s) => s.properties?.title === sheetName);
  if (!target) {
    const props: any = { title: sheetName };
    if (insertAtIndex != null) props.index = insertAtIndex;
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: props } }] },
    });
    const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;
    return { sheets, sheetId: sheetId ?? 0 };
  }
  return { sheets, sheetId: target.properties?.sheetId ?? 0 };
}

/** 標題列排版：粗體＋淺色底、凍結第一列、欄寬自動依內容調整 */
export async function formatHeader(sheets: SheetsClient, spreadsheetId: string, sheetId: number, columnCount: number) {
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

/** 把某個粗體樣式套到某個範圍（例如小標題列、合計列） */
export async function boldRange(sheets: SheetsClient, spreadsheetId: string, sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat",
          },
        },
      ],
    },
  });
}

export async function hideSheetTab(sheets: SheetsClient, spreadsheetId: string, sheetId: number, hidden: boolean) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ updateSheetProperties: { properties: { sheetId, hidden }, fields: "hidden" } }],
    },
  });
}

/** 刪除指定名稱的分頁（如果存在的話；不存在就什麼都不做，安全可以重複呼叫） */
export async function deleteSheetTabIfExists(spreadsheetId: string, sheetName: string) {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const target = (meta.data.sheets || []).find((s) => s.properties?.title === sheetName);
  if (!target || target.properties?.sheetId == null) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteSheet: { sheetId: target.properties.sheetId } }] },
  });
}

/** 讀取一個範圍的「值」跟「公式」（公式儲存格會回傳公式字串，其餘回傳計算後的值） */
export async function getValuesAndFormulas(sheets: SheetsClient, spreadsheetId: string, range: string) {
  const [valuesRes, formulasRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range }),
    sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "FORMULA" }),
  ]);
  return { values: valuesRes.data.values || [], formulas: formulasRes.data.values || [] };
}

export async function writeRange(sheets: SheetsClient, spreadsheetId: string, range: string, values: any[][]) {
  if (values.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

export async function clearRange(sheets: SheetsClient, spreadsheetId: string, range: string) {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
}

/** 在指定分頁最後面加一列（適合訂單這種「一直新增、不會修改」的資料） */
export async function appendRow(sheetName: string, headerRow: string[], row: (string | number)[]) {
  const id = requireSheetId();
  const { sheets, sheetId } = await ensureSheetExists(id, sheetName);

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${sheetName}!A1:Z1` });
  if (!existing.data.values || existing.data.values.length === 0) {
    await writeRange(sheets, id, `${sheetName}!A1`, [headerRow]);
    await formatHeader(sheets, id, sheetId, headerRow.length);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

/** 清空指定分頁、整份重新寫入（適合會員/企劃/商品這種「會被編輯、需要跟資料庫保持一致」的資料） */
export async function overwriteSheet(sheetName: string, headerRow: string[], rows: (string | number)[][]) {
  const id = requireSheetId();
  const { sheets, sheetId } = await ensureSheetExists(id, sheetName);

  await clearRange(sheets, id, `${sheetName}!A1:Z100000`);
  await writeRange(sheets, id, `${sheetName}!A1`, [headerRow, ...rows]);
  await formatHeader(sheets, id, sheetId, headerRow.length);
}
