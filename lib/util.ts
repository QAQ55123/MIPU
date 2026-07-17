import crypto from "crypto";
import bcrypt from "bcryptjs";

/** 會員密碼雜湊（bcrypt） */
export async function hashMemberPw(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
export async function verifyMemberPw(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** 個人頁網址正規化：拿掉查詢參數、結尾斜線、大小寫統一，讓同一個人不同網址寫法能比對出來 */
export function normFb(url: string): string {
  if (!url) return "";
  let u = url.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/^www\./, "");
  u = u.split("?")[0].split("#")[0];
  u = u.replace(/\/+$/, "");
  return u;
}

/** 產生訂單編號，例如 20260714-183245-482 */
/** 產生訂單編號：純隨機 9 碼數字，好記好唸（唯一性由資料庫的 unique 限制把關） */
export function genOrderNo(): string {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("zh-TW").format(Math.round(n));
}
