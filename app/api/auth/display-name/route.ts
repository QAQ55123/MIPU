import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getMemberSession } from "@/lib/memberAuth";
import { validateDisplayName, isDisplayNameTaken, DISPLAY_NAME_TAKEN_MESSAGE } from "@/lib/memberDisplayName";

export const dynamic = "force-dynamic";

/** 會員設定／修改自己的會員名稱（顯示在賣場名稱用）。用登入 session 辨識是誰，不需要密碼。 */
export async function POST(req: Request) {
  const session = getMemberSession(req);
  if (!session) return NextResponse.json({ error: "請先登入" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dn = validateDisplayName(body.displayName);
  if (dn.error !== undefined) return NextResponse.json({ error: dn.error }, { status: 400 });
  const displayName = dn.name;

  // 大小寫視為相同；自己只改大小寫（例如 Abc → ABC）不算重複
  if (await isDisplayNameTaken(displayName, session.memberId)) {
    return NextResponse.json({ error: DISPLAY_NAME_TAKEN_MESSAGE }, { status: 409 });
  }

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("members")
    .update({ display_name: displayName })
    .eq("id", session.memberId)
    .select("display_name")
    .maybeSingle();
  if (error) {
    if (/idx_members_display_name/.test(error.message)) return NextResponse.json({ error: DISPLAY_NAME_TAKEN_MESSAGE }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "找不到這個會員，請重新登入" }, { status: 404 });

  return NextResponse.json({ ok: true, displayName: updated.display_name });
}
