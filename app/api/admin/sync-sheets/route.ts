import { NextResponse } from "next/server";
import { requireOwnerSession } from "@/lib/adminAuth";
import { syncAllOrdersSheet, syncMembersSheet, syncPlansSheet, syncProductsSheet, syncAllOrdersCostSheet } from "@/lib/sheetsSync";

export async function POST(req: Request) {
  try {
    requireOwnerSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const tasks: { label: string; fn: () => Promise<void> }[] = [
    { label: "訂單", fn: syncAllOrdersSheet },
    { label: "會員", fn: syncMembersSheet },
    { label: "企劃", fn: syncPlansSheet },
    { label: "商品", fn: syncProductsSheet },
    { label: "成本表", fn: syncAllOrdersCostSheet },
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.fn()));

  const failed = results
    .map((r, i) => ({ label: tasks[i].label, result: r }))
    .filter((x) => x.result.status === "rejected")
    .map((x) => `${x.label}：${(x.result as PromiseRejectedResult).reason?.message || "同步失敗"}`);

  if (failed.length > 0) {
    return NextResponse.json({ error: failed.join("；") }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
