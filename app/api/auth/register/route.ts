import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPw, normFb } from "@/lib/util";

/**
 * 一般前台（MAIN 模式）第一次使用：登記 來源 + 暱稱 + FB 網址 + 密碼
 * 之後同一個來源+暱稱 就用 /api/auth/login 登入
 */
export async function POST(req: Request) {
  const body = await req.json();
  const source = String(body.source || "").trim(); // 'LINE' | 'Discord'
  const nickname = String(body.nickname || "").trim();
  const fbUrl = String(body.fbUrl || "").trim();
  const password = String(body.password || "0000");

  if (!["LINE", "Discord"].includes(source)) {
    return NextResponse.json({ error: "請選擇來源（LINE / Discord）" }, { status: 400 });
  }
  if (!nickname) return NextResponse.json({ error: "請填寫暱稱" }, { status: 400 });
  if (!fbUrl) return NextResponse.json({ error: "請登記 FB 個人網址" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const nickCol = source === "LINE" ? "line_nick" : "discord_nick";
  const fbNorm = normFb(fbUrl);

  // 這個來源+暱稱是否已經有人用過？
  const { data: existingByNick } = await supabase
    .from("members")
    .select("*")
    .ilike(nickCol, nickname)
    .maybeSingle();
  if (existingByNick) {
    return NextResponse.json(
      { error: "這個暱稱已經登記過了，請直接登入，或換一個暱稱。" },
      { status: 409 }
    );
  }

  // 這個 FB 網址是否已經是別人的會員資料？是的話合併進去（補上這個來源的暱稱）
  const { data: existingByFb } = await supabase
    .from("members")
    .select("*")
    .eq("fb_url_norm", fbNorm)
    .maybeSingle();

  const passwordHash = hashPw(fbNorm, password);

  if (existingByFb) {
    const { error: updErr } = await supabase
      .from("members")
      .update({ [nickCol]: nickname })
      .eq("id", existingByFb.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, memberId: existingByFb.id, fbUrl: existingByFb.fb_url });
  }

  const { data: created, error: insErr } = await supabase
    .from("members")
    .insert({
      fb_url: fbUrl,
      fb_url_norm: fbNorm,
      [nickCol]: nickname,
      password_hash: passwordHash,
    })
    .select()
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, memberId: created.id, fbUrl: created.fb_url });
}
