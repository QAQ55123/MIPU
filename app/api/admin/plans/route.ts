import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { deleteStorageFiles } from "@/lib/storage";

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
    .order("created_at", { ascending: true });
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
      promoImages: p.promo_images || [],
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
      promo_images: body.promoImages || [],
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

  // 先抓舊資料，等下比對哪些圖片被換掉/移除了，順便清掉 Storage 裡的舊檔案
  const { data: oldPlan } = await supabase.from("plans").select("image_url, promo_images").eq("id", body.id).single();

  const { error } = await supabase
    .from("plans")
    .update({
      name: body.name,
      deadline: body.deadline || null,
      image_url: body.imageUrl || null,
      cod_limit: Number(body.codLimit) || 0,
      visible_to: body.visibleTo || [],
      category_id: body.categoryId || null,
      promo_images: body.promoImages || [],
    })
    .eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (oldPlan) {
    const newImageUrl = body.imageUrl || null;
    const newPromoImages: string[] = body.promoImages || [];
    const removedUrls = [
      ...(oldPlan.image_url && oldPlan.image_url !== newImageUrl ? [oldPlan.image_url] : []),
      ...((oldPlan.promo_images || []).filter((u: string) => !newPromoImages.includes(u))),
    ];
    if (removedUrls.length > 0) deleteStorageFiles(removedUrls).catch(() => {});
  }

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

  // 刪除前先把這個企劃、以及底下所有商品用到的圖片蒐集起來，等資料庫刪除成功後一併清掉 Storage 檔案
  const { data: plan } = await supabase.from("plans").select("image_url, promo_images").eq("id", body.id).single();
  const { data: products } = await supabase.from("products").select("image_url").eq("plan_id", body.id);
  const urlsToDelete = [
    plan?.image_url,
    ...(plan?.promo_images || []),
    ...((products || []).map((p) => p.image_url)),
  ];

  // 注意：刪除企劃會連同底下的商品一起刪除（外鍵 cascade），但訂單記錄會保留（只是不再連到這個企劃，企劃名稱已經有快照）
  const { error } = await supabase.from("plans").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  deleteStorageFiles(urlsToDelete).catch(() => {});

  return NextResponse.json({ ok: true });
}
