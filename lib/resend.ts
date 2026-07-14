import { Resend } from "resend";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("尚未設定 RESEND_API_KEY");
  return new Resend(key);
}

function fromAddress() {
  return process.env.EMAIL_FROM || "米舖 <onboarding@resend.dev>";
}

export async function sendEmail(to: string, subject: string, html: string) {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to,
    subject,
    html,
  });
  if (error) throw new Error(typeof error === "string" ? error : error.message || "寄信失敗");
}

export function verifyEmailHtml(link: string) {
  return `
    <div style="font-family:sans-serif;font-size:15px;color:#2C2C2A;">
      <p>你好，請點下面的連結完成信箱驗證：</p>
      <p><a href="${link}" style="color:#33415C;">點我驗證信箱</a></p>
      <p style="color:#8A8779;font-size:13px;">如果不是你本人操作，請忽略這封信。連結 24 小時內有效。</p>
    </div>`;
}

export function resetPasswordHtml(link: string) {
  return `
    <div style="font-family:sans-serif;font-size:15px;color:#2C2C2A;">
      <p>你好，我們收到重設密碼的請求，請點下面的連結設定新密碼：</p>
      <p><a href="${link}" style="color:#33415C;">點我重設密碼</a></p>
      <p style="color:#8A8779;font-size:13px;">如果不是你本人操作，請忽略這封信，你的密碼不會被更改。連結 1 小時內有效。</p>
    </div>`;
}
