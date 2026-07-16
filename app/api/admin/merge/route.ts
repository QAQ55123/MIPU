import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireOwnerSession } from "@/lib/adminAuth";

/** 把 removeId 名下的訂單改指向 keepId 的帳號，然後刪除 removeId 這個會員帳號 */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    requireOwnerSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  const { keepId, removeId } = body;
  if (!keepId || !removeId || keepId === removeId) {
    return NextResponse.json({ error: "請提供兩個不同的會員 ID" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: keep } = await supabase.from("members").select("*").eq("id", keepId).single();
  const { data: remove } = await supabase.from("members").select("*").eq("id", removeId).single();
  if (!keep || !remove) return NextResponse.json({ error: "找不到會員" }, { status: 404 });

  // 把 remove 名下的訂單，改成指向 keep 的帳號 / 個人頁網址
  const { data: changedOrders, error: updErr } = await supabase
    .from("orders")
    .update({ username: keep.username, profile_url: keep.profile_url })
    .ilike("username", remove.username)
    .select("id");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // remove 的收藏也一併轉移給 keep（重複的收藏會因為 unique 限制被忽略）
  const { data: favs } = await supabase.from("favorites").select("plan_id").eq("member_id", removeId);
  if (favs && favs.length > 0) {
    await supabase.from("favorites").insert(favs.map((f) => ({ member_id: keepId, plan_id: f.plan_id })));
  }

  await supabase.from("members").delete().eq("id", removeId);

  return NextResponse.json({ ok: true, changed: (changedOrders || []).length });
}
