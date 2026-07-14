import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;


/** 後台用：列出某個企劃底下的所有商品 ?pw=&planId= */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  const planId = searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "缺少 planId" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    products: (data || []).map((p) => ({
      id: p.id,
      planId: p.plan_id,
      name: p.name,
      style: p.style,
      price: Number(p.price),
      imageUrl: p.image_url,
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (!body.planId) return NextResponse.json({ error: "缺少企劃" }, { status: 400 });
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "請填寫商品名稱" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("products")
    .insert({
      plan_id: body.planId,
      name,
      style: body.style || "",
      price: Number(body.price) || 0,
      image_url: body.imageUrl || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, product: data });
}

export async function PUT(req: Request) {
  const body = await req.json();
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (!body.id) return NextResponse.json({ error: "缺少商品 id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("products")
    .update({
      name: body.name,
      style: body.style || "",
      price: Number(body.price) || 0,
      image_url: body.imageUrl || null,
    })
    .eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = await req.json();
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (!body.id) return NextResponse.json({ error: "缺少商品 id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("products").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
