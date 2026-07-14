import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin, hashPw, normFb } from "@/lib/util";

/** body: { pw, fbUrl } 或 { pw, source, nickname } → 密碼重設為 0000 */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    requireAdmin(body.pw);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  let member;

  if (body.fbUrl) {
    const fbNorm = normFb(body.fbUrl);
    const { data } = await supabase.from("members").select("*").eq("fb_url_norm", fbNorm).maybeSingle();
    member = data;
  } else if (body.source && body.nickname) {
    const nickCol = body.source === "LINE" ? "line_nick" : "discord_nick";
    const { data } = await supabase.from("members").select("*").ilike(nickCol, body.nickname).maybeSingle();
    member = data;
  } else {
    return NextResponse.json({ error: "請提供 fbUrl 或 source+nickname" }, { status: 400 });
  }

  if (!member) return NextResponse.json({ error: "找不到會員" }, { status: 404 });

  const newHash = hashPw(member.fb_url_norm, "0000");
  await supabase.from("members").update({ password_hash: newHash }).eq("id", member.id);

  return NextResponse.json({ ok: true });
}
