import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashMemberPw, verifyMemberPw } from "@/lib/util";
import { signMemberSession, memberSessionCookieHeader } from "@/lib/memberAuth";
import { escapeLike } from "@/lib/memberDisplayName";

export async function POST(req: Request) {
  const body = await req.json();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const newPassword = body.newPassword ? String(body.newPassword) : "";

  if (!username || !password) return NextResponse.json({ error: "請輸入帳號密碼" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  // 可以用「帳號」或「信箱」登入（都不分大小寫、必須完全相符）：先找帳號，密碼不對或找不到再找信箱
  const pattern = escapeLike(username);
  const { data: byUsername } = await supabase.from("members").select("*").ilike("username", pattern).limit(1);
  const { data: byEmail } = await supabase.from("members").select("*").ilike("email", pattern).limit(1);
  const candidates = [...(byUsername || []), ...(byEmail || [])].filter(
    (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
  );

  let member: any = null;
  for (const c of candidates) {
    if (c.password_hash && (await verifyMemberPw(password, c.password_hash))) { member = c; break; }
  }
  if (!member) return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });

  if (newPassword) {
    const newHash = await hashMemberPw(newPassword);
    const { error: pwErr } = await supabase.from("members").update({ password_hash: newHash }).eq("id", member.id);
    if (pwErr) return NextResponse.json({ error: "密碼更新失敗：" + pwErr.message }, { status: 500 });
  }

  const token = signMemberSession(member.id, member.username);
  const res = NextResponse.json({
    ok: true,
    username: member.username,
    displayName: member.display_name || null,
    profileUrl: member.profile_url,
    pendingProfileUrl: member.pending_profile_url,
    email: member.email,
    emailVerified: member.email_verified,
  });
  res.headers.set("Set-Cookie", memberSessionCookieHeader(token));
  return res;
}
