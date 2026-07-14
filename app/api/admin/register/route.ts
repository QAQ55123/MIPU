import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashAdminPw, resolveRoleFromInviteCode, signSession, sessionCookieHeader } from "@/lib/adminAuth";

export async function POST(req: Request) {
  const body = await req.json();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const inviteCode = String(body.inviteCode || "");

  let role: "owner" | "staff";
  try {
    role = resolveRoleFromInviteCode(inviteCode);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  if (username.length < 3) return NextResponse.json({ error: "帳號至少要 3 個字" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "密碼至少要 8 個字" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from("admins").select("id").ilike("username", username).maybeSingle();
  if (existing) return NextResponse.json({ error: "這個帳號已經被註冊了" }, { status: 409 });

  const passwordHash = await hashAdminPw(password);
  const { data: created, error } = await supabase
    .from("admins")
    .insert({ username, password_hash: passwordHash, role })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const token = signSession(created.id, created.username, created.role);
  const res = NextResponse.json({ ok: true, username: created.username, role: created.role });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
