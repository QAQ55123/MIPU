"use client";
import { useEffect, useState } from "react";

type Mode = "MAIN" | "FB";
type Plan = { id: string; name: string; imageUrl?: string; codLimit: number; deadline?: string; closed: boolean };
type Product = { id: string; name: string; style: string; price: number; imageUrl?: string };
type CartItem = { name: string; style: string; qty: number };
type Identity = { source: string; nickname: string; fbUrl: string } | null;
type PendingAction = null | "order" | "history";

const fmt = (n: number) => new Intl.NumberFormat("zh-TW").format(Math.round(n));

export default function Home() {
  const [mode, setMode] = useState<Mode>("MAIN");
  const [view, setView] = useState<"identity" | "plans" | "order" | "history">("plans");
  const [identity, setIdentity] = useState<Identity>(null);
  const [toast, setToast] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // identity form state
  const [source, setSource] = useState<"LINE" | "Discord">("LINE");
  const [nickname, setNickname] = useState("");
  const [fbUrl, setFbUrl] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [needRegister, setNeedRegister] = useState(false);

  // plans / order state
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({}); // key: name||style
  const [payment, setPayment] = useState("匯款");
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((d) => setMode(d.mode));
    loadPlans();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  async function loadPlans() {
    setPlansLoading(true);
    const r = await fetch("/api/plans");
    const d = await r.json();
    setPlans(d.plans || []);
    setPlansLoading(false);
    setView("plans");
  }

  // 逛企劃、看商品完全不需要登入；只有「送出訂單」「查歷史訂單」才會要求先選身分
  async function openPlan(p: Plan) {
    const r = await fetch(`/api/plans/${p.id}`);
    const d = await r.json();
    setActivePlan(d.plan);
    setProducts(d.products || []);
    setCart({});
    setView("order");
  }

  function requireIdentity(action: PendingAction) {
    setPendingAction(action);
    setAuthMsg("");
    setView("identity");
  }

  async function onAuthNext() {
    setAuthMsg("");
    if (mode === "FB") {
      if (!nickname.trim()) return setAuthMsg("請填寫 FB 名字");
      if (!fbUrl.trim()) return setAuthMsg("請貼上 FB 個人首頁網址");
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "FB", fbName: nickname, fbUrl, password: password || "0000" }),
      });
      const d = await r.json();
      if (!r.ok) return setAuthMsg(d.error || "登入失敗");
      const id = { source: "FB", nickname: d.fbName, fbUrl: d.fbUrl };
      setIdentity(id);
      afterAuthSuccess(id);
      return;
    }

    if (!nickname.trim()) return setAuthMsg("請填寫暱稱");

    if (needRegister) {
      if (!fbUrl.trim()) return setAuthMsg("第一次使用，請登記你的 FB 個人網址");
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, nickname, fbUrl, password: password || "0000" }),
      });
      const d = await r.json();
      if (!r.ok) return setAuthMsg(d.error || "註冊失敗");
      const id = { source, nickname, fbUrl: d.fbUrl };
      setIdentity(id);
      setNeedRegister(false);
      afterAuthSuccess(id);
      return;
    }

    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "MAIN", source, nickname, password: password || "0000" }),
    });
    const d = await r.json();
    if (d.needRegister) {
      setNeedRegister(true);
      setAuthMsg("第一次使用這個暱稱，請往下登記你的 FB 個人網址");
      return;
    }
    if (!r.ok) return setAuthMsg(d.error || "登入失敗");
    const id = { source, nickname, fbUrl: d.fbUrl };
    setIdentity(id);
    afterAuthSuccess(id);
  }

  // 登入成功後，回到原本想做的事（送出訂單 / 查歷史），沒有的話就回企劃列表
  function afterAuthSuccess(id: Identity) {
    const action = pendingAction;
    setPendingAction(null);
    if (action === "order") {
      setView("order");
      showToast("身分驗證成功，請按「新增訂單」送出");
    } else if (action === "history") {
      openHistoryNow(id);
    } else {
      loadPlans();
    }
  }

  function changeQty(name: string, style: string, delta: number) {
    const key = `${name}||${style}`;
    setCart((prev) => {
      const next = { ...prev };
      const cur = next[key] || 0;
      const val = Math.max(0, cur + delta);
      if (val === 0) delete next[key];
      else next[key] = val;
      return next;
    });
  }

  const cartTotal = Object.entries(cart).reduce((sum, [key, qty]) => {
    const [name, style] = key.split("||");
    const p = products.find((pp) => pp.name === name && pp.style === style);
    return sum + (p ? p.price * qty : 0);
  }, 0);

  async function submitOrder() {
    if (!identity) {
      requireIdentity("order");
      return;
    }
    const items: CartItem[] = Object.entries(cart).map(([key, qty]) => {
      const [name, style] = key.split("||");
      return { name, style, qty };
    });
    if (items.length === 0) return showToast("請至少選擇一項商品");
    if (!activePlan) return;

    const r = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: activePlan.id,
        items,
        source: identity?.source,
        nickname: identity?.nickname,
        payment,
        fbUrl: identity?.fbUrl,
      }),
    });
    const d = await r.json();
    if (!r.ok) return showToast(d.error || "新增訂單失敗");
    showToast(`訂單已送出（編號 ${d.orderNo}）`);
    setCart({});
  }

  async function openHistory() {
    if (!identity) {
      requireIdentity("history");
      return;
    }
    openHistoryNow(identity);
  }

  async function openHistoryNow(useIdentity?: Identity) {
    const id = useIdentity || identity;
    if (!id) return;
    const params = new URLSearchParams();
    if (id.fbUrl) params.set("fbUrl", id.fbUrl);
    const r = await fetch(`/api/orders?${params.toString()}`);
    const d = await r.json();
    setHistory(d.orders || []);
    setView("history");
  }

  async function cancelOrder(orderNo: string) {
    if (!identity) return;
    if (!confirm("確定要取消這張訂單嗎？")) return;
    const r = await fetch(`/api/orders/${orderNo}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], fbUrl: identity.fbUrl }),
    });
    const d = await r.json();
    if (!r.ok) return showToast(d.error || "取消失敗");
    showToast("已取消訂單");
    openHistoryNow();
  }

  return (
    <>
      <div className="topbar">
        <h1>{mode === "FB" ? "米舖 試用版FB" : "米舖 試用版"}</h1>
        <span className="user">{identity ? `${identity.source}｜${identity.nickname}` : ""}</span>
      </div>

      <div className="layout">
        <aside className="sidebar">
          <button className="nav-btn" onClick={loadPlans}>企劃列表</button>
          <button className="nav-btn" onClick={openHistory}>查詢我的歷史訂單</button>
          {identity ? (
            <button className="nav-btn" onClick={() => { setIdentity(null); setView("plans"); }}>重新選擇身分</button>
          ) : (
            <button className="nav-btn" onClick={() => requireIdentity(null)}>選擇身分登入</button>
          )}
        </aside>

        <main className="main">
          {view === "identity" && (
            <div className="auth-card">
              <a className="auth-back-link" onClick={() => { setPendingAction(null); setView("plans"); }}>← 返回</a>
              <h2 className="section-title">{mode === "FB" ? "請填寫 FB 名字與連結" : "請選擇來源並填寫暱稱"}</h2>
              {pendingAction === "order" && <div className="rules-box">送出訂單前，請先驗證你的身分</div>}
              {pendingAction === "history" && <div className="rules-box">查詢歷史訂單前，請先驗證你的身分</div>}

              {mode === "MAIN" && (
                <div className="id-row">
                  <span className="id-label">來源</span>
                  <div className="source-btns">
                    {(["LINE", "Discord"] as const).map((s) => (
                      <button key={s} className={`src-btn ${source === s ? "active" : ""}`} onClick={() => { setSource(s); setNeedRegister(false); }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="id-row">
                <span className="id-label">{mode === "FB" ? "FB 名字" : "暱稱"}</span>
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={mode === "FB" ? "輸入你的 FB 名字（顯示用）" : "輸入你在該社群使用的暱稱"} />
              </div>

              {mode === "FB" && (
                <div className="id-row">
                  <span className="id-label">FB 連結</span>
                  <input value={fbUrl} onChange={(e) => setFbUrl(e.target.value)} placeholder="貼上 FB 個人首頁網址（必填）" />
                </div>
              )}

              {mode === "MAIN" && needRegister && (
                <div className="id-row">
                  <span className="id-label">FB 網址</span>
                  <input value={fbUrl} onChange={(e) => setFbUrl(e.target.value)} placeholder="https://www.facebook.com/你的個人頁" />
                </div>
              )}

              <div className="id-row">
                <span className="id-label">密碼</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="預設 0000（換裝置登入用）" />
              </div>

              <div className="auth-msg">{authMsg}</div>
              <button className="btn" onClick={onAuthNext}>繼續</button>
            </div>
          )}

          {view === "plans" && (
            <div>
              <h2 className="section-title">選擇商品企劃</h2>
              {plansLoading && <div className="spinner">載入中…</div>}
              <div className="plan-grid">
                {plans.map((p) => (
                  <div key={p.id} className="plan-card" onClick={() => openPlan(p)}>
                    {p.imageUrl && <img src={p.imageUrl} className="plan-img" alt={p.name} />}
                    <h3>{p.name}</h3>
                    <span className={`tag ${p.closed ? "closed" : "open"}`}>{p.closed ? "已截止" : "開放中"}</span>
                    {p.deadline && <div className="plan-deadline">截止：{new Date(p.deadline).toLocaleString("zh-TW")}</div>}
                  </div>
                ))}
                {!plansLoading && plans.length === 0 && <div className="spinner">目前沒有企劃</div>}
              </div>
            </div>
          )}

          {view === "order" && activePlan && (
            <div>
              <button className="btn secondary" onClick={() => setView("plans")}>&larr; 返回企劃列表</button>
              <h2 className="section-title">{activePlan.name}</h2>
              {activePlan.closed && <div className="banner warn">此企劃已截止，無法新增訂單</div>}
              {!identity && <div className="rules-box">現在可以先逛逛選商品，按「新增訂單」時才需要登入身分</div>}

              <div className="id-row pay-row">
                <span className="id-label">交易方式</span>
                <div className="source-btns">
                  {["匯款", ...(activePlan.codLimit > 0 ? ["取付"] : [])].map((p) => (
                    <button key={p} className={`src-btn ${payment === p ? "active" : ""}`} onClick={() => setPayment(p)}>{p}</button>
                  ))}
                </div>
              </div>

              {Object.entries(
                products.reduce<Record<string, Product[]>>((acc, p) => {
                  acc[p.name] = acc[p.name] || [];
                  acc[p.name].push(p);
                  return acc;
                }, {})
              ).map(([name, styles]) => (
                <div className="group" key={name}>
                  {styles[0].imageUrl && <img src={styles[0].imageUrl} alt={name} />}
                  <div className="info">
                    <h4>{name}</h4>
                    {styles.map((s) => {
                      const key = `${s.name}||${s.style}`;
                      const qty = cart[key] || 0;
                      return (
                        <div className="style-row" key={key}>
                          <span className="style-name">{s.style || "單一款式"}</span>
                          <span className="style-price">NT$ {fmt(s.price)}</span>
                          <div className="stepper">
                            <button className="step-btn" disabled={qty <= 0 || activePlan.closed} onClick={() => changeQty(s.name, s.style, -1)}>－</button>
                            <input className="qty" readOnly value={qty} />
                            <button className="step-btn" disabled={activePlan.closed} onClick={() => changeQty(s.name, s.style, 1)}>＋</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="footer-bar">
                <span className="total">
                  合計：NT$ {fmt(cartTotal)}
                  {payment === "取付" && activePlan.codLimit > 0 && (
                    <span className={`limit-info ${cartTotal > activePlan.codLimit ? "over" : ""}`}>
                      　（取付上限 NT$ {fmt(activePlan.codLimit)}）
                    </span>
                  )}
                </span>
                <button className="btn" disabled={activePlan.closed} onClick={submitOrder}>新增訂單</button>
              </div>
            </div>
          )}

          {view === "history" && (
            <div>
              <button className="btn secondary" onClick={loadPlans}>&larr; 返回企劃列表</button>
              <h2 className="section-title">我的歷史訂單</h2>
              {history.length === 0 && <div className="spinner">目前沒有訂單紀錄</div>}
              {history.map((o) => (
                <div className="hist-card" key={o.orderNo}>
                  <div className="hist-head">
                    <span className="hist-src">{o.planName}｜{o.source}｜{o.nickname}</span>
                    <span className="hist-time">{new Date(o.createdAt).toLocaleString("zh-TW")}</span>
                  </div>
                  {o.items.map((it: any, idx: number) => (
                    <div className="hist-item" key={idx}>
                      <span>{it.name}{it.style ? `（${it.style}）` : ""} x{it.qty}</span>
                      <span>NT$ {fmt(it.subtotal)}</span>
                    </div>
                  ))}
                  <div className="hist-total">交易方式：{o.payment}　合計 NT$ {fmt(o.total)}</div>
                  <div className="hist-actions">
                    <button className="btn danger small" onClick={() => cancelOrder(o.orderNo)}>取消訂單</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
