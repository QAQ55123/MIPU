import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashAdminPw } from "@/lib/adminAuth";
import { isExpired } from "@/lib/tokens";

export async function POST(req: Request) {
  const body = await req.json();
  const token = String(body.token || "");
  const password = String(body.password || "");
  if (!token) return NextResponse.json({ error: "缺少重設連結參數" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "密碼至少要 8 個字" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: admin } = await supabase.from("admins").select("*").eq("reset_token", token).maybeSingle();
  if (!admin || isExpired(admin.reset_token_expires)) {
    return NextResponse.json({ error: "連結無效或已過期，請重新申請忘記密碼" }, { status: 400 });
  }

  const passwordHash = await hashAdminPw(password);
  const { error, data: updated } = await supabase
    .from("admins")
    .update({ password_hash: passwordHash, reset_token: null, reset_token_expires: null })
    .eq("id", admin.id)
    .select();
  if (error) return NextResponse.json({ error: "密碼更新失敗：" + error.message }, { status: 500 });
  if (!updated || updated.length === 0) return NextResponse.json({ error: "密碼更新失敗，請稍後再試" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
