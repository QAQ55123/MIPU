import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdminSession, requireOwnerSession } from "@/lib/adminAuth";
import { computeMyshipExport } from "@/lib/myshipExport";

export const dynamic = "force-dynamic";

/** 依照賣貨便官方「單規格商品匯入」範本格式，產生可以直接上傳的 xlsx 檔案。?planId=xxx
 *  欄位：A商品名稱 B商品圖片 C商品描述 D規格 E數量 F價格 G優惠價 H商品狀態 I單次下單上限 J最低下單數量
 *  同一個商品（企劃）只有第一列填 A/B/C/H，後面的列留空，賣貨便會自動把連續空白的列歸到上一個商品底下。 */
export async function GET(req: Request) {
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  try {
    requireOwnerSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const planId = (searchParams.get("planId") || "").trim();
  if (!planId) return NextResponse.json({ error: "缺少 planId" }, { status: 400 });

  let result;
  try {
    result = await computeMyshipExport(planId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (result.groups.length === 0) return NextResponse.json({ error: "沒有任何顧客還有差額，不需要匯出" }, { status: 400 });

  const header = ["＊商品名稱", "商品圖片(連結)", "＊商品描述(文字)", "＊規格", "＊數量", "＊價格", "優惠價", "＊商品狀態", "單次下單上限", "最低下單數量"];
  const aoa: string[][] = [header];
  for (const g of result.groups) {
    g.rows.forEach((r, i) => {
      if (i === 0) {
        aoa.push([g.productName, result.imageUrl || "", g.description, r.account, "1", String(r.amount), "", "新品", "", ""]);
      } else {
        aoa.push(["", "", "", r.account, "1", String(r.amount), "", "", "", ""]);
      }
    });
  }

  // 每個欄位都用文字格式寫入（賣貨便範本要求儲存格格式要是「文字」，不能是數字/一般格式）
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell) cell.t = "s"; // 強制文字型別
    }
  }
  ws["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "單規格商品匯入");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = encodeURIComponent(`賣貨便匯入_${result.planName}.xlsx`);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
