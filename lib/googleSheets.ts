import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

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

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

/** 確保指定名稱的分頁存在，不存在就自動建立 */
async function ensureSheetExists(sheetName: string) {
  if (!SHEET_ID) throw new Error("尚未設定 GOOGLE_SHEET_ID");
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
  return sheets;
}

/** 在指定分頁最後面加一列（適合訂單這種「一直新增、不會修改」的資料） */
export async function appendRow(sheetName: string, headerRow: string[], row: (string | number)[]) {
  if (!SHEET_ID) return; // 沒設定就靜靜跳過，不影響主要功能
  const sheets = await ensureSheetExists(sheetName);

  // 檢查有沒有標題列，沒有就先補上
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:Z1` });
  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headerRow] },
    });
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
  const sheets = await ensureSheetExists(sheetName);

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:Z100000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headerRow, ...rows] },
  });
}
