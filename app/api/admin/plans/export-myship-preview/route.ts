import { NextResponse } from "next/server";
import { requireAdminSession, requireOwnerSession } from "@/lib/adminAuth";
import { computeMyshipExport } from "@/lib/myshipExport";

export const dynamic = "force-dynamic";

/** 預覽賣貨便匯出結果：?planId=xxx */
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

  try {
    const result = await computeMyshipExport(planId);
    return NextResponse.json({
      planName: result.planName,
      totalCustomers: result.totalCustomers,
      groupCount: result.groups.length,
      skippedZero: result.skippedZero,
      overLimit: result.overLimit,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
