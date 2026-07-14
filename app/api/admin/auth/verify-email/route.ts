import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isExpired, getSiteUrl } from "@/lib/tokens";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token") || "";
  const site = getSiteUrl();

  if (!token) return NextResponse.redirect(`${site}/admin?verify=missing`);

  const supabase = getSupabaseAdmin();
  const { data: admin } = await supabase.from("admins").select("*").eq("verify_token", token).maybeSingle();
  if (!admin || isExpired(admin.verify_token_expires)) {
    return NextResponse.redirect(`${site}/admin?verify=invalid`);
  }

  await supabase.from("admins").update({ email_verified: true, verify_token: null, verify_token_expires: null }).eq("id", admin.id);
  return NextResponse.redirect(`${site}/admin?verify=success`);
}
