import { NextResponse } from "next/server";
import { requireOwnerSession } from "@/lib/adminAuth";
import { syncAllOrdersSheet, syncMembersSheet, syncPlansSheet, syncProductsSheet } from "@/lib/sheetsSync";

export async function POST(req: Request) {
  try {
    requireOwnerSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  try {
    await Promise.all([syncAllOrdersSheet(), syncMembersSheet(), syncPlansSheet(), syncProductsSheet()]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "同步失敗，請確認 Google Sheet 設定是否正確" }, { status: 500 });
  }
}
