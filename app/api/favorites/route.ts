import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normFb } from "@/lib/util";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function findMemberId(supabase: ReturnType<typeof getSupabaseAdmin>, fbUrl: string) {
  const fbNorm = normFb(fbUrl);
  const { data } = await supabase.from("members").select("id").eq("fb_url_norm", fbNorm).maybeSingle();
  return data?.id || null;
}

/** GET ?fbUrl=... 回傳這個會員收藏的企劃清單（含企劃基本資訊，前台可以直接拿來顯示） */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fbUrl = searchParams.get("fbUrl") || "";
  if (!fbUrl) return NextResponse.json({ favorites: [], planIds: [] }, { headers: { "Cache-Control": "no-store" } });

  const supabase = getSupabaseAdmin();
  const memberId = await findMemberId(supabase, fbUrl);
  if (!memberId) return NextResponse.json({ favorites: [], planIds: [] }, { headers: { "Cache-Control": "no-store" } });

  const { data, error } = await supabase
    .from("favorites")
    .select("plan_id, plans(id, name, image_url, deadline, category_id, categories(name))")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const favorites = (data || [])
    .filter((f: any) => f.plans)
    .map((f: any) => ({
      id: f.plans.id,
      name: f.plans.name,
      imageUrl: f.plans.image_url,
      deadline: f.plans.deadline,
      closed: f.plans.deadline ? new Date(f.plans.deadline).getTime() < now : false,
      categoryName: f.plans.categories?.name || null,
    }));

  return NextResponse.json(
    { favorites, planIds: favorites.map((f) => f.id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST { fbUrl, planId } 加入收藏 */
export async function POST(req: Request) {
  const body = await req.json();
  const fbUrl = String(body.fbUrl || "");
  const planId = String(body.planId || "");
  if (!fbUrl || !planId) return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const memberId = await findMemberId(supabase, fbUrl);
  if (!memberId) return NextResponse.json({ error: "找不到會員資料，請先完成身分驗證" }, { status: 404 });

  const { error } = await supabase.from("favorites").insert({ member_id: memberId, plan_id: planId });
  // 已經收藏過（觸發 unique 限制）視為成功，不算錯誤
  if (error && !error.message.includes("duplicate")) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE { fbUrl, planId } 取消收藏 */
export async function DELETE(req: Request) {
  const body = await req.json();
  const fbUrl = String(body.fbUrl || "");
  const planId = String(body.planId || "");
  if (!fbUrl || !planId) return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const memberId = await findMemberId(supabase, fbUrl);
  if (!memberId) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("favorites").delete().eq("member_id", memberId).eq("plan_id", planId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
