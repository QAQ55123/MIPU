"use client";
import { useState } from "react";

export default function AdminPage() {
  const [pw, setPw] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [dupMsg, setDupMsg] = useState("");
  const [dupList, setDupList] = useState<any[]>([]);

  const [keepId, setKeepId] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [mergeMsg, setMergeMsg] = useState("");

  const [resetFb, setResetFb] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  const [resetSource, setResetSource] = useState("LINE");
  const [resetNick, setResetNick] = useState("");
  const [resetNickMsg, setResetNickMsg] = useState("");

  async function call(url: string, body: any) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pw, ...body }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "失敗");
    return d;
  }

  async function doList() {
    setDupMsg("處理中…");
    try {
      const d = await call("/api/admin/duplicates", {});
      setDupList(d.items || []);
      setDupMsg(`完成，共 ${d.count} 筆。`);
    } catch (e: any) { setDupMsg("失敗：" + e.message); }
  }

  async function doMerge() {
    if (!keepId || !removeId) return setMergeMsg("請填兩個會員 ID");
    setMergeMsg("合併中…");
    try {
      const d = await call("/api/admin/merge", { keepId, removeId });
      setMergeMsg(`完成，改寫 ${d.changed} 筆訂單。`);
    } catch (e: any) { setMergeMsg("失敗：" + e.message); }
  }

  async function doReset() {
    if (!resetFb) return setResetMsg("請貼上 FB 連結");
    setResetMsg("重設中…");
    try {
      await call("/api/admin/reset-password", { fbUrl: resetFb });
      setResetMsg("已重設為 0000。");
    } catch (e: any) { setResetMsg("失敗：" + e.message); }
  }

  async function doResetNick() {
    if (!resetNick) return setResetNickMsg("請填暱稱");
    setResetNickMsg("重設中…");
    try {
      await call("/api/admin/reset-password", { source: resetSource, nickname: resetNick });
      setResetNickMsg("已重設為 0000。");
    } catch (e: any) { setResetNickMsg("失敗：" + e.message); }
  }

  if (!unlocked) {
    return (
      <div style={{ maxWidth: 400, margin: "80px auto", padding: 20 }}>
        <h2>米舖 後台</h2>
        <input type="password" placeholder="後台密碼" value={pw} onChange={(e) => setPw(e.target.value)} style={{ padding: 8, width: "100%", marginBottom: 10 }} />
        <button className="btn" onClick={() => setUnlocked(true)}>進入</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 20 }}>
      <h2>米舖 後台</h2>
      <p style={{ color: "#6b7280", fontSize: 13 }}>只有你（知道密碼的人）能看到這頁。</p>

      <div className="auth-card">
        <h3>疑似重複會員</h3>
        <button className="btn" onClick={doList}>列出疑似重複</button>
        <div>{dupMsg}</div>
        {dupList.map((d, i) => (
          <div key={i} style={{ fontSize: 13, borderTop: "1px dashed #e5e7eb", paddingTop: 6 }}>
            暱稱「{d.nickname}」→ 會員 {d.member1} / {d.member2}
          </div>
        ))}
      </div>

      <div className="auth-card">
        <h3>合併會員</h3>
        <div className="id-row"><span className="id-label">保留 ID</span><input value={keepId} onChange={(e) => setKeepId(e.target.value)} /></div>
        <div className="id-row"><span className="id-label">併掉 ID</span><input value={removeId} onChange={(e) => setRemoveId(e.target.value)} /></div>
        <button className="btn" onClick={doMerge}>合併</button>
        <div>{mergeMsg}</div>
      </div>

      <div className="auth-card">
        <h3>重設 FB 會員密碼</h3>
        <div className="id-row"><span className="id-label">FB 連結</span><input value={resetFb} onChange={(e) => setResetFb(e.target.value)} /></div>
        <button className="btn" onClick={doReset}>重設為 0000</button>
        <div>{resetMsg}</div>
      </div>

      <div className="auth-card">
        <h3>重設密碼（來源＋暱稱）</h3>
        <div className="id-row">
          <span className="id-label">來源</span>
          <select value={resetSource} onChange={(e) => setResetSource(e.target.value)}>
            <option value="LINE">LINE</option>
            <option value="Discord">Discord</option>
          </select>
        </div>
        <div className="id-row"><span className="id-label">暱稱</span><input value={resetNick} onChange={(e) => setResetNick(e.target.value)} /></div>
        <button className="btn" onClick={doResetNick}>重設為 0000</button>
        <div>{resetNickMsg}</div>
      </div>
    </div>
  );
}
