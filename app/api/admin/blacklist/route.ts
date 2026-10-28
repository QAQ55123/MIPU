import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminSession, requireOwnerSession } from "@/lib/adminAuth";
import { normFb } from "@/lib/util";
import { normBlacklistEmail } from "@/lib/blacklist";

export const dynamic = "force-dynamic";

function guard(req: Request): NextResponse | null {
  try {
    requireAdminSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  try {
    requireOwnerSession(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  return null;
}

/** 列出黑名單（最高權限限定） */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("blacklist").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    items: (data || []).map((b) => ({ id: b.id, type: b.type, value: b.value, note: b.note || "", createdAt: b.created_at })),
  });
}

/** 新增一筆黑名單 body: { type: "email" | "fb", value, note? } */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const body = await req.json();
  const type = body.type === "fb" ? "fb" : body.type === "email" ? "email" : "";
  const value = String(body.value || "").trim();
  const note = String(body.note || "").trim();
  if (!type) return NextResponse.json({ error: "類型必須是 email 或 fb" }, { status: 400 });
  if (!value) return NextResponse.json({ error: "請填寫要加入黑名單的內容" }, { status: 400 });

  const valueNorm = type === "email" ? normBlacklistEmail(value) : normFb(/^https?:\/\//i.test(value) ? value : "https://" + value);
  if (!valueNorm) return NextResponse.json({ error: "內容格式不正確" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("blacklist").insert({ type, value, value_norm: valueNorm, note: note || null });
  if (error) {
    if (String(error.message).includes("duplicate")) return NextResponse.json({ error: "這筆已經在黑名單裡了" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** 從黑名單移除 body: { id } */
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const body = await req.json();
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("blacklist").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
