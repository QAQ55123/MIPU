import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/util";

/** 把 removeId 的資料併進 keepId，然後刪除 removeId（訂單改指向 keep 的 fb_url_norm） */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    requireAdmin(body.pw);
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

  // 補齊欄位：remove 有但 keep 沒有的暱稱，補進 keep
  const updates: Record<string, any> = {};
  if (!keep.line_nick && remove.line_nick) updates.line_nick = remove.line_nick;
  if (!keep.discord_nick && remove.discord_nick) updates.discord_nick = remove.discord_nick;
  if (!keep.fb_nick && remove.fb_nick) updates.fb_nick = remove.fb_nick;
  if (Object.keys(updates).length > 0) {
    await supabase.from("members").update(updates).eq("id", keepId);
  }

  // 把 remove 名下的訂單，改成指向 keep 的 fb_url_norm / fb_url
  const { data: changedOrders, error: updErr } = await supabase
    .from("orders")
    .update({ fb_url: keep.fb_url, fb_url_norm: keep.fb_url_norm })
    .eq("fb_url_norm", remove.fb_url_norm)
    .select("id");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await supabase.from("members").delete().eq("id", removeId);

  return NextResponse.json({ ok: true, changed: (changedOrders || []).length });
}
