import { getSupabaseAdmin } from "./supabase";
import { normFb } from "./util";

/** 被擋下來時給使用者看的訊息：刻意不透露是黑名單 */
export const BLACKLIST_MESSAGE = "此帳號無法使用本服務，如有疑問請聯絡管理者";

export function normBlacklistEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

/** 檢查信箱或FB個人頁網址是不是在黑名單裡（任何一個命中就算） */
export async function isBlacklisted(params: { email?: string | null; profileUrl?: string | null }): Promise<boolean> {
  const emailNorm = params.email ? normBlacklistEmail(params.email) : "";
  const fbNorm = params.profileUrl ? normFb(params.profileUrl) : "";
  if (!emailNorm && !fbNorm) return false;

  const supabase = getSupabaseAdmin();
  const checks: PromiseLike<{ data: any[] | null }>[] = [];
  if (emailNorm) checks.push(supabase.from("blacklist").select("id").eq("type", "email").eq("value_norm", emailNorm).limit(1));
  if (fbNorm) checks.push(supabase.from("blacklist").select("id").eq("type", "fb").eq("value_norm", fbNorm).limit(1));

  const results = await Promise.all(checks);
  return results.some((r) => (r.data || []).length > 0);
}
