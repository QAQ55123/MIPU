import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashAdminPw, resolveRoleFromInviteCode, signSession, sessionCookieHeader } from "@/lib/adminAuth";
import { sendEmail, verifyEmailHtml } from "@/lib/resend";
import { genToken, hoursFromNow, getSiteUrl } from "@/lib/tokens";

export async function POST(req: Request) {
  const body = await req.json();
  const username = String(body.username || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const inviteCode = String(body.inviteCode || "");

  let role: "owner" | "staff";
  try {
    role = resolveRoleFromInviteCode(inviteCode);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  if (username.length < 3) return NextResponse.json({ error: "帳號至少要 3 個字" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "請輸入有效的 Email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "密碼至少要 8 個字" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: existingUsername } = await supabase.from("admins").select("id").ilike("username", username).maybeSingle();
  if (existingUsername) return NextResponse.json({ error: "這個帳號已經被註冊了" }, { status: 409 });
  const { data: existingEmail } = await supabase.from("admins").select("id").ilike("email", email).maybeSingle();
  if (existingEmail) return NextResponse.json({ error: "這個 Email 已經被註冊過了" }, { status: 409 });

  const passwordHash = await hashAdminPw(password);
  const verifyToken = genToken();
  const { data: created, error } = await supabase
    .from("admins")
    .insert({
      username,
      email,
      password_hash: passwordHash,
      role,
      verify_token: verifyToken,
      verify_token_expires: hoursFromNow(24),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 寄驗證信（就算寄信失敗也不擋註冊流程，只是提醒使用者信箱還沒驗證）
  try {
    const link = `${getSiteUrl()}/api/admin/auth/verify-email?token=${verifyToken}`;
    await sendEmail(email, "請驗證你的米舖後台帳號信箱", verifyEmailHtml(link));
  } catch (e) {
    console.error("驗證信寄送失敗：", e);
  }

  const token = signSession(created.id, created.username, created.role);
  const res = NextResponse.json({ ok: true, username: created.username, role: created.role });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
