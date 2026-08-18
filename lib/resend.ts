import nodemailer from "nodemailer";

function getTransporter() {
  // 不快取連線：Serverless 環境下，快取的 SMTP 連線如果閒置太久會被 Gmail 斷線，
  // 之後沿用這個已經斷掉的連線寄信，有時候不會噴錯、但信其實根本沒送出去。
  // 每次都開一條新連線，雖然多一點點延遲，但比較不會遇到這種「顯示成功、實際沒寄出」的狀況。
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("尚未設定 GMAIL_USER / GMAIL_APP_PASSWORD");

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

/** 寄信：html 是主要內容，text 是純文字版本（有助於降低被判定為垃圾郵件的機率）。
 *  失敗會自動重試一次（間隔 1 秒），降低偶發性連線問題造成寄信失敗的機率。 */
export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const from = process.env.EMAIL_FROM || `米舖 <${process.env.GMAIL_USER}>`;
  const mail = { from, to, subject, html, text: text || stripHtml(html) };
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail(mail);
    if (!info?.accepted || info.accepted.length === 0) {
      throw new Error("Gmail 沒有接受這封信（accepted 清單是空的），可能被拒收");
    }
  } catch (e) {
    // 重試一次，間隔 1 秒
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const transporter = getTransporter();
    const info = await transporter.sendMail(mail);
    if (!info?.accepted || info.accepted.length === 0) {
      throw new Error("Gmail 沒有接受這封信（accepted 清單是空的），可能被拒收");
    }
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function verifyEmailContent(username: string, link: string): { html: string; text: string } {
  const html = `
    <div style="font-family:sans-serif;font-size:15px;color:#2C2C2A;">
      <p>親愛的「${username}」，你好：</p>
      <p>請點下面的連結完成信箱驗證：</p>
      <p><a href="${link}" style="color:#33415C;">點我驗證信箱</a></p>
      <p style="color:#8A8779;font-size:13px;">如果不是你本人操作，請忽略這封信。連結 24 小時內有效。</p>
      <p style="color:#8A8779;font-size:13px;">如果這封信剛好被歸類到垃圾郵件匣，請改標記為「不是垃圾郵件」，方便你以後能正常收到我們的通知。</p>
    </div>`;
  const text =
    `親愛的「${username}」，你好：\n\n` +
    `請點下面的連結完成信箱驗證：\n${link}\n\n` +
    `如果不是你本人操作，請忽略這封信。連結 24 小時內有效。\n\n` +
    `如果這封信剛好被歸類到垃圾郵件匣，請改標記為「不是垃圾郵件」，方便你以後能正常收到我們的通知。`;
  return { html, text };
}

export function resetPasswordContent(username: string, link: string): { html: string; text: string } {
  const html = `
    <div style="font-family:sans-serif;font-size:15px;color:#2C2C2A;">
      <p>親愛的「${username}」，你好：</p>
      <p>我們收到重設密碼的請求，請點下面的連結設定新密碼：</p>
      <p><a href="${link}" style="color:#33415C;">點我重設密碼</a></p>
      <p style="color:#8A8779;font-size:13px;">如果不是你本人操作，請忽略這封信，你的密碼不會被更改。連結 1 小時內有效。</p>
      <p style="color:#8A8779;font-size:13px;">如果這封信剛好被歸類到垃圾郵件匣，請改標記為「不是垃圾郵件」，方便你以後能正常收到我們的通知。</p>
    </div>`;
  const text =
    `親愛的「${username}」，你好：\n\n` +
    `我們收到重設密碼的請求，請點下面的連結設定新密碼：\n${link}\n\n` +
    `如果不是你本人操作，請忽略這封信，你的密碼不會被更改。連結 1 小時內有效。\n\n` +
    `如果這封信剛好被歸類到垃圾郵件匣，請改標記為「不是垃圾郵件」，方便你以後能正常收到我們的通知。`;
  return { html, text };
}
