import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireOwnerSession } from "@/lib/adminAuth";

/** 找出「同暱稱卻不同 FB」的疑似重複會員，寫進 suspected_duplicates 表 */
export async function POST(req: Request) {
  const body = await req.json();
  try {
    requireOwnerSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: members, error } = await supabase.from("members").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const groups: Record<string, any[]> = {};
  (members || []).forEach((m) => {
    [m.line_nick, m.discord_nick, m.fb_nick].filter(Boolean).forEach((nick: string) => {
      const key = nick.trim().toLowerCase();
      if (!key) return;
      groups[key] = groups[key] || [];
      groups[key].push(m);
    });
  });

  const dup: { nickname: string; member1: string; member2: string }[] = [];
  Object.entries(groups).forEach(([nick, list]) => {
    const uniqueFb = [...new Set(list.map((m) => m.fb_url_norm))];
    if (uniqueFb.length > 1) {
      for (let i = 1; i < list.length; i++) {
        if (list[i].fb_url_norm !== list[0].fb_url_norm) {
          dup.push({ nickname: nick, member1: list[0].id, member2: list[i].id });
        }
      }
    }
  });

  await supabase.from("suspected_duplicates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (dup.length > 0) {
    await supabase.from("suspected_duplicates").insert(
      dup.map((d) => ({ nickname: d.nickname, member_id_1: d.member1, member_id_2: d.member2 }))
    );
  }

  return NextResponse.json({ ok: true, count: dup.length, items: dup });
}
