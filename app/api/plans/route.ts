import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getMode } from "@/lib/util";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const mode = getMode();

  const { data, error } = await supabase
    .from("plans")
    .select("id, name, deadline, image_url, cod_limit, visible_to, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const plans = (data || [])
    .filter((p) => {
      // 顯示對象過濾：FB 前台只看得到含 FB 或留空的企劃；MAIN 前台看得到全部
      if (mode === "FB") {
        return !p.visible_to || p.visible_to.length === 0 || p.visible_to.includes("FB");
      }
      return true;
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.image_url,
      codLimit: p.cod_limit || 0,
      deadline: p.deadline,
      closed: p.deadline ? new Date(p.deadline).getTime() < now : false,
    }));

  return NextResponse.json({ plans });
}
