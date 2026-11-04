import { getSupabaseAdmin } from "./supabase";

export const DISPLAY_NAME_MAX = 20;

/** 把字串裡 LIKE / ILIKE 的萬用字元（% _）和跳脫字元（\）跳脫掉，讓 ilike 變成「完全相符、只是不分大小寫」 */
export function escapeLike(s: string): string {
  return String(s || "").replace(/[\\%_]/g, (c) => "\\" + c);
}

/** 檢查會員名稱格式：去頭尾空白後 1～20 字。通過回傳 { name }，不通過回傳 { error } */
export function validateDisplayName(raw: any): { name: string; error?: undefined } | { name?: undefined; error: string } {
  const name = String(raw ?? "").trim();
  if (!name) return { error: "請填寫會員名稱" };
  if (Array.from(name).length > DISPLAY_NAME_MAX) return { error: `會員名稱最多 ${DISPLAY_NAME_MAX} 個字` };
  return { name };
}

/** 會員名稱是否已被其他會員使用（大小寫視為相同）；excludeMemberId＝自己，改自己的大小寫不算重複 */
export async function isDisplayNameTaken(name: string, excludeMemberId?: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  let q = supabase.from("members").select("id").ilike("display_name", escapeLike(name)).limit(1);
  if (excludeMemberId) q = q.neq("id", excludeMemberId);
  const { data } = await q;
  return (data || []).length > 0;
}

export const DISPLAY_NAME_TAKEN_MESSAGE = "這個會員名稱已經有人使用了，請換一個";
