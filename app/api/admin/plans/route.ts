import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;


/** 後台用：列出所有企劃（不受前台顯示對象限制），含分類名稱 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("plans")
    .select("*, categories(id, name, parent_id)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    plans: (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      deadline: p.deadline,
      imageUrl: p.image_url,
      codLimit: p.cod_limit,
      visibleTo: p.visible_to,
      categoryId: p.category_id,
      categoryName: p.categories?.name || null,
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
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "請填寫企劃名稱" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("plans")
    .insert({
      name,
      deadline: body.deadline || null,
      image_url: body.imageUrl || null,
      cod_limit: Number(body.codLimit) || 0,
      visible_to: body.visibleTo || [],
      category_id: body.categoryId || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plan: data });
}

export async function PUT(req: Request) {
  const body = await req.json();
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (!body.id) return NextResponse.json({ error: "缺少企劃 id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("plans")
    .update({
      name: body.name,
      deadline: body.deadline || null,
      image_url: body.imageUrl || null,
      cod_limit: Number(body.codLimit) || 0,
      visible_to: body.visibleTo || [],
      category_id: body.categoryId || null,
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
  if (!body.id) return NextResponse.json({ error: "缺少企劃 id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  // 注意：刪除企劃會連同底下的商品、訂單一起刪除（外鍵 cascade）
  const { error } = await supabase.from("plans").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
