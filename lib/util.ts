import crypto from "crypto";

/** 密碼雜湊：SHA-256(正規化FB + 密碼 + 固定鹽)，對應原本 GAS 的 hashPw_ */
export function hashPw(fbNorm: string, pw: string): string {
  const salt = process.env.PW_SALT || "mibu_pw_v1";
  const raw = `${fbNorm}|${pw ?? ""}|${salt}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/** FB 網址正規化：拿掉查詢參數、結尾斜線、大小寫統一，讓同一個人不同網址寫法能比對出來 */
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
export function genOrderNo(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${datePart}-${timePart}-${rand}`;
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("zh-TW").format(Math.round(n));
}

export function getMode(): "MAIN" | "FB" {
  return (process.env.FRONTEND_MODE === "FB" ? "FB" : "MAIN");
}
