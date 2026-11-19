import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { toDirectImageUrl } from "@/lib/imageUrl";
import { syncProductsSheet, syncPlanTabsById } from "@/lib/sheetsSync";
import { runInBackground } from "@/lib/background";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const HEADER = ["商品名稱", "款式", "單價", "圖片連結", "運送方式", "限量"];
const MAX_ROWS = 500;

/** 下載 Excel 範本 */
export async function GET(req: Request) {
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  const ws = XLSX.utils.aoa_to_sheet([
    HEADER,
    ["韓國保濕面膜", "玫瑰", 120, "https://drive.google.com/file/d/xxxx/view?usp=sharing", "空運", 20],
    ["韓國保濕面膜", "綠茶", 120, "", "空運", ""],
  ]);
  ws["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 50 }, { wch: 10 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "商品");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("商品上架範本.xlsx")}`,
    },
  });
}

type PreviewRow = {
  row: number;            // Excel 列號（含表頭，第一筆資料是第 2 列）
  status: "new" | "update" | "error";
  name: string;
  style: string;
  price: number | null;
  oldPrice?: number;
  shippingMethod: string;
  stockLimit: number | null;
  hasImage: boolean;
  errors: string[];
};

function cellText(v: any): string {
  return String(v ?? "").trim();
}

/**
 * 上傳 Excel 上架商品（multipart：planId、file、commit=1 才真的寫入，否則只回傳預覽）
 * 規則：只新增；「商品名稱＋款式」跟現有商品一樣的就更新（單價、運送方式、限量；圖片連結有填才更新）
 */
export async function POST(req: Request) {
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const form = await req.formData();
  const planId = String(form.get("planId") || "");
  const commit = String(form.get("commit") || "") === "1";
  const file = form.get("file") as File | null;
  if (!planId) return NextResponse.json({ error: "缺少企劃" }, { status: 400 });
  if (!file) return NextResponse.json({ error: "請選擇 Excel 檔案" }, { status: 400 });

  let rows: any[][];
  try {
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as any[][];
  } catch {
    return NextResponse.json({ error: "讀不到這個檔案，請確認是 Excel（.xlsx）格式" }, { status: 400 });
  }

  // 找表頭（第一列），依欄位名稱對應，欄位順序被調換也讀得到
  const head = (rows[0] || []).map(cellText);
  const col: Record<string, number> = {};
  HEADER.forEach((h) => { col[h] = head.indexOf(h); });
  if (col["商品名稱"] < 0 || col["單價"] < 0) {
    return NextResponse.json({ error: "第一列要是欄位名稱，至少要有「商品名稱」和「單價」，請用下載的範本填寫" }, { status: 400 });
  }
  const get = (r: any[], h: string) => (col[h] >= 0 ? r[col[h]] : "");

  const supabase = getSupabaseAdmin();
  const { data: plan } = await supabase.from("plans").select("id, name").eq("id", planId).maybeSingle();
  if (!plan) return NextResponse.json({ error: "找不到這個企劃" }, { status: 404 });

  const { data: existing, error: exErr } = await supabase
    .from("products")
    .select("id, name, style, price, sort_order")
    .eq("plan_id", planId);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const existingMap = new Map<string, any>();
  for (const p of existing || []) existingMap.set(`${String(p.name || "").trim()}|${String(p.style || "").trim()}`, p);

  const preview: PreviewRow[] = [];
  const parsed: { pr: PreviewRow; imageUrl: string; existingId?: string }[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = cellText(get(r, "商品名稱"));
    const style = cellText(get(r, "款式"));
    const priceRaw = cellText(get(r, "單價"));
    const image = cellText(get(r, "圖片連結"));
    const ship = cellText(get(r, "運送方式"));
    const limitRaw = cellText(get(r, "限量"));
    if (!name && !style && !priceRaw && !image && !ship && !limitRaw) continue; // 整列空白略過

    const errors: string[] = [];
    if (!name) errors.push("商品名稱不能空白");
    const price = Number(priceRaw.replace(/[,，\s]/g, ""));
    if (!priceRaw || !Number.isFinite(price) || price < 1) errors.push("單價必須是 1 以上的數字");
    if (ship && ship !== "空運" && ship !== "海運") errors.push("運送方式只能填「空運」「海運」或留空");
    let stockLimit: number | null = null;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 0) errors.push("限量必須是 0 以上的整數，或留空（不限量）");
      else stockLimit = n;
    }
    if (image && !/^https?:\/\//i.test(image)) errors.push("圖片連結要是 http 開頭的網址");

    const key = `${name}|${style}`;
    if (name && seen.has(key)) errors.push("Excel 裡已經有一列一樣的商品名稱＋款式");
    if (name) seen.add(key);

    const ex = existingMap.get(key);
    const pr: PreviewRow = {
      row: i + 1,
      status: errors.length ? "error" : ex ? "update" : "new",
      name, style,
      price: Number.isFinite(price) ? price : null,
      oldPrice: ex ? Number(ex.price) : undefined,
      shippingMethod: ship,
      stockLimit,
      hasImage: !!image,
      errors,
    };
    preview.push(pr);
    if (!errors.length) parsed.push({ pr, imageUrl: image ? toDirectImageUrl(image) : "", existingId: ex?.id });
  }

  if (preview.length > MAX_ROWS) {
    return NextResponse.json({ error: `一次最多上架 ${MAX_ROWS} 列，請分批上傳` }, { status: 400 });
  }

  const summary = {
    newCount: preview.filter((p) => p.status === "new").length,
    updateCount: preview.filter((p) => p.status === "update").length,
    errorCount: preview.filter((p) => p.status === "error").length,
  };

  if (!commit) return NextResponse.json({ ok: true, planName: plan.name, rows: preview, ...summary });
  if (parsed.length === 0) return NextResponse.json({ error: "沒有可以上架的商品" }, { status: 400 });

  // 寫入：更新的逐筆更新，新增的一次插入，排在現有商品後面（照 Excel 順序）
  let nextSort = Math.max(-1, ...(existing || []).map((p: any) => Number(p.sort_order) || 0)) + 1;
  const inserts: any[] = [];
  const failed: string[] = [];
  for (const it of parsed) {
    const base = {
      price: it.pr.price,
      shipping_method: it.pr.shippingMethod || null,
      stock_limit: it.pr.stockLimit,
    };
    if (it.existingId) {
      const upd: any = { ...base };
      if (it.imageUrl) upd.image_url = it.imageUrl; // 圖片連結空白 → 保留原本的圖
      const { error } = await supabase.from("products").update(upd).eq("id", it.existingId);
      if (error) failed.push(`第 ${it.pr.row} 列：${error.message}`);
    } else {
      inserts.push({ plan_id: planId, name: it.pr.name, style: it.pr.style, image_url: it.imageUrl || null, sort_order: nextSort++, ...base });
    }
  }
  if (inserts.length) {
    const { error } = await supabase.from("products").insert(inserts);
    if (error) failed.push(`新增商品失敗：${error.message}`);
  }

  syncProductsSheet().catch(() => {});
  runInBackground(syncPlanTabsById(planId), "Excel 上架後更新企劃分頁");

  if (failed.length) return NextResponse.json({ error: failed.join("；") }, { status: 500 });
  return NextResponse.json({ ok: true, ...summary });
}
