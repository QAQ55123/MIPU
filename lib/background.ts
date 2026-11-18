import { waitUntil } from "@vercel/functions";

/**
 * 在「已經回覆使用者之後」繼續在背景把工作跑完。
 * 以前是直接 promise.catch(() => {}) 丟著不管，但 Vercel 在回覆送出後可能直接把函式停掉，
 * 背景的試算表同步就會做到一半被中斷；交給 waitUntil 後 Vercel 會等它跑完（最多到該 API 的 maxDuration）。
 * 使用者的等待時間不受影響；失敗只記 log，不影響原本的操作結果。
 */
export function runInBackground(task: Promise<unknown>, label: string) {
  const wrapped = task.catch((e) => {
    console.error(`[背景工作失敗] ${label}：`, e);
  });
  try {
    waitUntil(wrapped);
  } catch {
    // 不是在 Vercel 上執行（例如本機開發）時，就照舊讓它自己在背景跑
  }
}
