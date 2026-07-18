import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession, requireOwnerSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 用訂單編號查詢訂單完整內容 ?orderNo=xxx */
export async function GET(req: Request) {
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orderNo = (searchParams.get("orderNo") || "").trim();
  if (!orderNo) return NextResponse.json({ error: "請輸入訂單編號" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from("orders")
    .select("*, plans(name), order_items(*)")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "找不到這張訂單" }, { status: 404 });

  return NextResponse.json({
    order: {
      orderNo: order.order_no,
      username: order.username,
      profileUrl: order.profile_url,
      planName: order.plan_name_snapshot || order.plans?.name || "（企劃已刪除）",
      payment: order.payment,
      paidStatus: order.paid_status,
      createdAt: order.created_at,
      items: (order.order_items || []).map((it: any) => ({
        name: it.product_name,
        style: it.style,
        qty: it.qty,
        unitPrice: Number(it.unit_price),
        subtotal: Number(it.subtotal),
        imageUrl: it.image_url,
      })),
      total: (order.order_items || []).reduce((s: number, it: any) => s + Number(it.subtotal), 0),
    },
  });
}

/** 刪除訂單（僅限最高權限）body: { orderNo } */
export async function DELETE(req: Request) {
  try {
    requireAdminSession(req); // 先確認有登入
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  try {
    requireOwnerSession(req); // 再確認是最高權限，權限不足跟登入過期要分開，不然一般管理者會被誤判成登入過期而登出
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const body = await req.json();
  const orderNo = String(body.orderNo || "").trim();
  if (!orderNo) return NextResponse.json({ error: "請輸入訂單編號" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase.from("orders").select("id").eq("order_no", orderNo).maybeSingle();
  if (!order) return NextResponse.json({ error: "找不到這張訂單" }, { status: 404 });

  const { error } = await supabase.from("orders").delete().eq("id", order.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
