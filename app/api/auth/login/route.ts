import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPw, normFb } from "@/lib/util";

export async function POST(req: Request) {
  const body = await req.json();
  const mode = body.mode === "FB" ? "FB" : "MAIN";
  const supabase = getSupabaseAdmin();

  if (mode === "MAIN") {
    const source = String(body.source || "").trim();
    const nickname = String(body.nickname || "").trim();
    const password = String(body.password || "");
    const newPassword = body.newPassword ? String(body.newPassword) : "";

    if (!["LINE", "Discord"].includes(source) || !nickname) {
      return NextResponse.json({ error: "請選擇來源並填寫暱稱" }, { status: 400 });
    }
    const nickCol = source === "LINE" ? "line_nick" : "discord_nick";

    const { data: member } = await supabase
      .from("members")
      .select("*")
      .ilike(nickCol, nickname)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ ok: false, needRegister: true, error: "找不到會員資料，請先完成第一次的 FB 個人網址登記。" });
    }

    const expected = hashPw(member.fb_url_norm, password);
    if (expected !== member.password_hash) {
      return NextResponse.json({ error: "密碼錯誤" }, { status: 401 });
    }

    if (newPassword) {
      const newHash = hashPw(member.fb_url_norm, newPassword);
      await supabase.from("members").update({ password_hash: newHash }).eq("id", member.id);
    }

    return NextResponse.json({ ok: true, source, nickname, fbUrl: member.fb_url });
  }

  // ---- FB 前台 ----
  const fbName = String(body.fbName || "").trim();
  const fbUrlRaw = String(body.fbUrl || "").trim();
  const password = String(body.password || "0000");
  const oldPassword = body.oldPassword ? String(body.oldPassword) : "";
  const newPassword = body.newPassword ? String(body.newPassword) : "";

  if (!fbName) return NextResponse.json({ error: "請填寫 FB 名字" }, { status: 400 });
  if (!fbUrlRaw) return NextResponse.json({ error: "請貼上 FB 個人首頁網址" }, { status: 400 });

  const fbUrl = /^https?:\/\//i.test(fbUrlRaw) ? fbUrlRaw : "https://" + fbUrlRaw;
  const fbNorm = normFb(fbUrl);

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("fb_url_norm", fbNorm)
    .maybeSingle();

  if (!member) {
    // 第一次使用這個 FB 網址：直接建立會員，密碼設為傳入值（預設 0000）
    const passwordHash = hashPw(fbNorm, password);
    const { data: created, error: insErr } = await supabase
      .from("members")
      .insert({ fb_url: fbUrl, fb_url_norm: fbNorm, fb_nick: fbName, password_hash: passwordHash })
      .select()
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, fbName, fbUrl: created.fb_url });
  }

  // 已存在：驗證密碼
  const expected = hashPw(member.fb_url_norm, oldPassword || password);
  if (expected !== member.password_hash) {
    return NextResponse.json({ error: "密碼錯誤" }, { status: 401 });
  }

  const updates: Record<string, any> = { fb_nick: fbName };
  if (newPassword) updates.password_hash = hashPw(member.fb_url_norm, newPassword);
  await supabase.from("members").update(updates).eq("id", member.id);

  return NextResponse.json({ ok: true, fbName, fbUrl: member.fb_url });
}
