"use client";
import { useEffect, useState } from "react";
import { Menu, Search, UserCircle, ShoppingCart, X, ChevronDown, ChevronRight } from "lucide-react";

type Mode = "MAIN" | "FB";
type Category = { id: string; name: string; parentId: string | null };
type Plan = {
  id: string; name: string; imageUrl?: string; codLimit: number; deadline?: string; closed: boolean;
  categoryId?: string | null; categoryName?: string | null; categoryParentId?: string | null;
};
type Product = { id: string; name: string; style: string; price: number; imageUrl?: string };
type CartItem = { name: string; style: string; qty: number };
type Identity = { source: string; nickname: string; fbUrl: string } | null;
type PendingAction = null | "order" | "history";

const fmt = (n: number) => new Intl.NumberFormat("zh-TW").format(Math.round(n));

export default function Home() {
  const [mode, setMode] = useState<Mode>("MAIN");
  const [view, setView] = useState<"identity" | "plans" | "order" | "history" | "account">("plans");
  const [identity, setIdentity] = useState<Identity>(null);
  const [toast, setToast] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [accountCurrentPw, setAccountCurrentPw] = useState("");
  const [accountNewPw, setAccountNewPw] = useState("");
  const [accountConfirmPw, setAccountConfirmPw] = useState("");
  const [accountMsg, setAccountMsg] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // identity form state
  const [source, setSource] = useState<"LINE" | "Discord">("LINE");
  const [nickname, setNickname] = useState("");
  const [fbUrl, setFbUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [needRegister, setNeedRegister] = useState(false);

  // categories / navigation
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // plans / order state
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({}); // key: name||style
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [payment, setPayment] = useState("匯款");
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((d) => setMode(d.mode));
    fetch("/api/categories", { cache: "no-store" }).then((r) => r.json()).then((d) => setCategories(d.categories || []));
    loadPlans();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  async function loadPlans(categoryId?: string | null, q?: string) {
    setPlansLoading(true);
    const params = new URLSearchParams();
    if (categoryId) params.set("categoryId", categoryId);
    if (q) params.set("q", q);
    const r = await fetch(`/api/plans?${params.toString()}`, { cache: "no-store" });
    const d = await r.json();
    setPlans(d.plans || []);
    setPlansLoading(false);
    setView("plans");
  }

  function selectCategory(id: string | null) {
    setSelectedCategoryId(id);
    loadPlans(id, searchQuery);
    setMobileDrawerOpen(false);
    // 選到有子分類的分類時，自動展開，不用另外去點小箭頭
    if (id && categories.some((c) => c.parentId === id)) {
      setExpandedIds((prev) => new Set(prev).add(id));
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runSearch() {
    loadPlans(selectedCategoryId, searchQuery);
    setSearchOpen(false);
  }

  function getCategoryChain(id: string | null): Category[] {
    if (!id) return [];
    const chain: Category[] = [];
    let cur = categories.find((c) => c.id === id) || null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? categories.find((c) => c.id === cur!.parentId) || null : null;
    }
    return chain;
  }

  // 逛企劃、看商品完全不需要登入；只有「送出訂單」「查歷史訂單」才會要求先選身分
  async function openPlan(p: Plan) {
    setView("order");
    setActivePlan(null);
    setProducts([]);
    setProductsLoading(true);
    const r = await fetch(`/api/plans/${p.id}`, { cache: "no-store" });
    const d = await r.json();
    setActivePlan(d.plan);
    setProducts(d.products || []);
    setCart({});
    setProductFilter(null);
    setProductsLoading(false);
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
        body: JSON.stringify({ source, nickname, fbUrl, password: password || "0000", email: email.trim() || undefined }),
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
      loadPlans(selectedCategoryId, searchQuery);
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
  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);

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
    setView("history");
    setHistoryLoading(true);
    const params = new URLSearchParams();
    if (id.fbUrl) params.set("fbUrl", id.fbUrl);
    const r = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
    const d = await r.json();
    setHistory(d.orders || []);
    setHistoryLoading(false);
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

  async function changeAccountPassword() {
    setAccountMsg("");
    if (!identity) return;
    if (!accountCurrentPw) return setAccountMsg("請輸入目前的密碼");
    if (accountNewPw.length < 1) return setAccountMsg("請輸入新密碼");
    if (accountNewPw !== accountConfirmPw) return setAccountMsg("兩次輸入的新密碼不一樣");

    setAccountSaving(true);
    try {
      const body =
        identity.source === "FB"
          ? { mode: "FB", fbName: identity.nickname, fbUrl: identity.fbUrl, oldPassword: accountCurrentPw, newPassword: accountNewPw }
          : { mode: "MAIN", source: identity.source, nickname: identity.nickname, password: accountCurrentPw, newPassword: accountNewPw };
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return setAccountMsg(d.error || "修改失敗");
      setAccountMsg("密碼已更新");
      setAccountCurrentPw("");
      setAccountNewPw("");
      setAccountConfirmPw("");
    } catch {
      setAccountMsg("網路連線失敗，請再試一次");
    } finally {
      setAccountSaving(false);
    }
  }

  function goHome() {
    setSelectedCategoryId(null);
    loadPlans(null, "");
    setSearchQuery("");
  }

  // ---- 麵包屑 ----
  // 在企劃詳細頁時，路徑要用「這個企劃實際歸屬的分類」，而不是使用者是從哪個篩選點進來的
  const chain =
    view === "order" && activePlan ? getCategoryChain(activePlan.categoryId ?? null) : getCategoryChain(selectedCategoryId);
  const breadcrumbParts: { label: string; onClick?: () => void }[] = [
    { label: "全部", onClick: () => goHome() },
  ];
  chain.forEach((c) => {
    breadcrumbParts.push({ label: c.name, onClick: () => selectCategory(c.id) });
  });
  if (view === "order" && activePlan) {
    breadcrumbParts.push({ label: activePlan.name });
  }

  const isAccountArea = view === "history" || view === "account";

  function renderAccountNav(closeAfterSelect: boolean) {
    return (
      <>
        <p className="category-tree-title">會員專區</p>
        <div
          className={`account-nav-item ${view === "history" ? "active" : ""}`}
          onClick={() => { openHistoryNow(); if (closeAfterSelect) setMobileDrawerOpen(false); }}
        >
          顯示歷史資料
        </div>
        <div
          className={`account-nav-item ${view === "account" ? "active" : ""}`}
          onClick={() => { setView("account"); setAccountMsg(""); if (closeAfterSelect) setMobileDrawerOpen(false); }}
        >
          編輯會員資料
        </div>
      </>
    );
  }

  function renderCategoryTree(closeAfterSelect: boolean) {
    const roots = categories.filter((c) => !c.parentId);
    return (
      <>

        <div
          className={`category-item root ${!selectedCategoryId ? "active" : ""}`}
          onClick={() => { selectCategory(null); if (closeAfterSelect) setMobileDrawerOpen(false); }}
        >
          全部
        </div>
        {roots.map((root) => {
          const children = categories.filter((c) => c.parentId === root.id);
          const hasChildren = children.length > 0;
          const expanded = expandedIds.has(root.id);
          return (
            <div key={root.id}>
              <div
                className={`category-item ${selectedCategoryId === root.id ? "active" : ""}`}
                onClick={() => { selectCategory(root.id); if (closeAfterSelect) setMobileDrawerOpen(false); }}
              >
                <span>{root.name}</span>
                {hasChildren && (
                  <span onClick={(e) => { e.stopPropagation(); toggleExpand(root.id); }} style={{ display: "flex", padding: 6, margin: -6 }}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                )}
              </div>
              {hasChildren && expanded && (
                <div>
                  {children.map((child) => (
                    <div
                      key={child.id}
                      className={`subcategory-item ${selectedCategoryId === child.id ? "active" : ""}`}
                      onClick={() => { selectCategory(child.id); if (closeAfterSelect) setMobileDrawerOpen(false); }}
                    >
                      {child.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  function renderBreadcrumb() {
    return (
      <div className="breadcrumb-row">
        {breadcrumbParts.map((part, idx) => {
          const isLast = idx === breadcrumbParts.length - 1;
          return (
            <span key={idx}>
              <span
                className={`breadcrumb-item ${isLast ? "current" : ""}`}
                onClick={isLast ? undefined : part.onClick}
              >
                {part.label}
              </span>
              {!isLast && <span className="breadcrumb-sep">&rsaquo;</span>}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <header className="mibu-header">
        <div className="mibu-header-inner">
          {!searchOpen && (
            <div className="mibu-header-row">
              <div className="mibu-logo-group">
                <button
                  className="mibu-icon-btn"
                  aria-label="展開分類目錄"
                  onClick={() => {
                    if (isAccountArea) {
                      goHome();
                    } else {
                      setSidebarOpen((v) => !v);
                      setMobileDrawerOpen((v) => !v);
                    }
                  }}
                >
                  <Menu size={20} />
                </button>
                <span className="mibu-logo" onClick={goHome} style={{ cursor: "pointer" }}>米舖</span>
              </div>
              <div className="mibu-right-group">
                <div className="mibu-search-desktop">
                  <Search size={15} color="var(--muted)" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                    placeholder="搜尋企劃、商品"
                  />
                </div>
                <button className="mibu-icon-btn mibu-search-icon-mobile" aria-label="搜尋" onClick={() => setSearchOpen(true)}>
                  <Search size={19} />
                </button>
                <div className="mibu-hover-wrap">
                  <button className="mibu-icon-btn" aria-label="會員／我的訂單" onClick={openHistory}>
                    <UserCircle size={19} />
                  </button>
                  <div className="mibu-hover-panel">
                    {identity ? (
                      <>
                        <div className="mibu-hover-panel-title">{identity.nickname}</div>
                        <div className="mibu-hover-panel-row"><span>來源</span><span>{identity.source}</span></div>
                        <div className="mibu-hover-panel-row"><span>FB</span><span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{identity.fbUrl}</span></div>
                      </>
                    ) : (
                      <div className="mibu-hover-panel-empty">尚未登入，點擊查看歷史訂單時會先要求驗證身分</div>
                    )}
                  </div>
                </div>
                <div className="mibu-hover-wrap">
                  <div className="mibu-cart-wrap">
                    <ShoppingCart size={19} color="var(--muted)" />
                    {cartCount > 0 && <span className="mibu-cart-badge">{cartCount}</span>}
                  </div>
                  <div className="mibu-hover-panel">
                    <div className="mibu-hover-panel-title">目前選購</div>
                    {cartCount === 0 ? (
                      <div className="mibu-hover-panel-empty">購物車是空的</div>
                    ) : (
                      <>
                        {Object.entries(cart).map(([key, qty]) => {
                          const [name, style] = key.split("||");
                          const p = products.find((pp) => pp.name === name && pp.style === style);
                          return (
                            <div className="mibu-hover-panel-row" key={key}>
                              <span>{name}{style ? `（${style}）` : ""} x{qty}</span>
                              <span>NT$ {fmt((p?.price || 0) * qty)}</span>
                            </div>
                          );
                        })}
                        <div className="mibu-hover-panel-row" style={{ borderTop: "1px dashed var(--line)", marginTop: 6, paddingTop: 6, fontWeight: 600, color: "var(--text)" }}>
                          <span>合計</span><span>NT$ {fmt(cartTotal)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {identity ? (
                  <button className="mibu-auth-link" onClick={() => { setIdentity(null); goHome(); }}>登出</button>
                ) : (
                  <button className="mibu-auth-link" onClick={() => requireIdentity(null)}>登入 / 註冊</button>
                )}
              </div>
            </div>
          )}
          {searchOpen && (
            <div className="mibu-header-row mibu-search-mobile-bar">
              <Search size={16} color="var(--muted)" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                placeholder="搜尋企劃、商品"
              />
              <button className="mibu-icon-btn" aria-label="關閉搜尋" onClick={() => setSearchOpen(false)}>
                <X size={18} />
              </button>
            </div>
          )}
        </div>
      </header>

      {view === "identity" ? (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
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
              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={mode === "FB" ? "輸入你的 FB 名字（顯示用）" : "輸入你在該社群使用的暱稱"} />
            </div>

            {mode === "FB" && (
              <div className="id-row">
                <span className="id-label">FB 連結</span>
                <input type="text" value={fbUrl} onChange={(e) => setFbUrl(e.target.value)} placeholder="貼上 FB 個人首頁網址（必填）" />
              </div>
            )}

            {mode === "MAIN" && needRegister && (
              <>
                <div className="id-row">
                  <span className="id-label">FB 網址</span>
                  <input type="text" value={fbUrl} onChange={(e) => setFbUrl(e.target.value)} placeholder="https://www.facebook.com/你的個人頁" />
                </div>
                <div className="id-row">
                  <span className="id-label">Email</span>
                  <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="選填，忘記密碼時用來找回帳號" />
                </div>
              </>
            )}

            <div className="id-row">
              <span className="id-label">密碼</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="預設 0000（換裝置登入用）" />
            </div>

            <div className="auth-msg">{authMsg}</div>
            <button className="btn" onClick={onAuthNext}>繼續</button>
            {!needRegister && (
              <p style={{ fontSize: 13 }}>
                <a href="/forgot-password" style={{ color: "var(--muted)" }}>忘記密碼？（需曾登記過 Email）</a>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mibu-content-row" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <aside
            className={`category-sidebar-desktop ${isAccountArea ? "account-sidebar-active" : ""}`}
            style={!isAccountArea ? { display: sidebarOpen ? undefined : "none" } : undefined}
          >
            {isAccountArea ? renderAccountNav(false) : renderCategoryTree(false)}
          </aside>

          <div className={`category-drawer-mobile ${mobileDrawerOpen && !isAccountArea ? "open" : ""}`}>
            <div className="category-drawer-panel">{renderCategoryTree(true)}</div>
          </div>

          <main className="main" style={{ flex: 1, minWidth: 0, padding: "20px 24px" }}>
            {!isAccountArea && renderBreadcrumb()}

            {view === "plans" && (
              <div>
                {plansLoading ? (
                  <div className="spinner">載入中…</div>
                ) : (
                  <div className="plan-grid">
                    {plans.map((p) => (
                      <div key={p.id} className={`plan-card-v2 ${p.closed ? "closed" : ""}`} onClick={() => openPlan(p)}>
                        <div className="plan-card-v2-img">
                          {p.imageUrl && <img src={p.imageUrl} alt={p.name} />}
                          {p.categoryName && <span className="plan-card-v2-tag">{p.categoryName}</span>}
                          <span className={`plan-card-v2-status ${p.closed ? "closed-tag" : "open"}`}>
                            {p.closed ? "已截止" : "開放中"}
                          </span>
                        </div>
                        <div className="plan-card-v2-body">
                          <p className="plan-card-v2-name">{p.name}</p>
                          {p.deadline && (
                            <p className="plan-card-v2-meta">
                              {p.closed ? "已於 " : "截止 "}
                              {new Date(p.deadline).toLocaleString("zh-TW")}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    {plans.length === 0 && <div className="spinner">沒有符合條件的企劃</div>}
                  </div>
                )}
              </div>
            )}

            {view === "order" && productsLoading && (
              <div className="spinner">載入中…</div>
            )}

            {view === "order" && !productsLoading && activePlan && (
              <div>
                <h2 className="section-title">{activePlan.name}</h2>
                {activePlan.closed && <div className="banner warn">此企劃已截止，無法新增訂單</div>}

                <div className="id-row pay-row" style={{ marginBottom: 24 }}>
                  <span className="id-label">交易方式</span>
                  <div className="source-btns">
                    {["匯款", ...(activePlan.codLimit > 0 ? ["取付"] : [])].map((p) => (
                      <button key={p} className={`src-btn ${payment === p ? "active" : ""}`} onClick={() => setPayment(p)}>{p}</button>
                    ))}
                  </div>
                </div>

                {(() => {
                  const grouped = products.reduce<Record<string, Product[]>>((acc, p) => {
                    acc[p.name] = acc[p.name] || [];
                    acc[p.name].push(p);
                    return acc;
                  }, {});
                  const productNames = Object.keys(grouped);
                  const visibleEntries = Object.entries(grouped).filter(
                    ([name]) => !productFilter || name === productFilter
                  );
                  return (
                    <>
                      {productNames.length > 1 && (
                        <div className="filter-bar">
                          <span
                            className={`chip ${!productFilter ? "active" : ""}`}
                            onClick={() => setProductFilter(null)}
                          >
                            全部
                          </span>
                          {productNames.map((name) => (
                            <span
                              key={name}
                              className={`chip ${productFilter === name ? "active" : ""}`}
                              onClick={() => setProductFilter(name)}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}

                      {visibleEntries.map(([name, styles]) => (
                        <div className="group" key={name}>
                          <div className="info" style={{ width: "100%" }}>
                            <h4>{name}</h4>
                            {styles.map((s) => {
                              const key = `${s.name}||${s.style}`;
                              const qty = cart[key] || 0;
                              return (
                                <div className="style-row" key={key}>
                                  {s.imageUrl ? (
                                    <img
                                      src={s.imageUrl}
                                      alt={s.style || name}
                                      className="style-img"
                                      onClick={() => setLightboxUrl(s.imageUrl!)}
                                    />
                                  ) : (
                                    <div className="style-img-empty" />
                                  )}
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
                    </>
                  );
                })()}

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
                <h2 className="section-title">我的歷史訂單</h2>
                {historyLoading && <div className="spinner">載入中…</div>}
                {!historyLoading && history.length === 0 && <div className="spinner">目前沒有訂單紀錄</div>}
                {!historyLoading && history.map((o) => (
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

            {view === "account" && identity && (
              <div>
                <h2 className="section-title">編輯會員資料</h2>
                <div className="auth-card" style={{ marginTop: 0 }}>
                  <div className="id-row"><span className="id-label">來源</span><span>{identity.source}</span></div>
                  <div className="id-row"><span className="id-label">暱稱</span><span>{identity.nickname}</span></div>
                  <div className="id-row"><span className="id-label">FB 網址</span><span style={{ wordBreak: "break-all" }}>{identity.fbUrl}</span></div>
                </div>

                <div className="auth-card">
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>修改密碼</h3>
                  <div className="id-row">
                    <span className="id-label">目前密碼</span>
                    <input type="password" value={accountCurrentPw} onChange={(e) => setAccountCurrentPw(e.target.value)} />
                  </div>
                  <div className="id-row">
                    <span className="id-label">新密碼</span>
                    <input type="password" value={accountNewPw} onChange={(e) => setAccountNewPw(e.target.value)} />
                  </div>
                  <div className="id-row">
                    <span className="id-label">確認新密碼</span>
                    <input type="password" value={accountConfirmPw} onChange={(e) => setAccountConfirmPw(e.target.value)} />
                  </div>
                  <div className="auth-msg">{accountMsg}</div>
                  <button className="btn" onClick={changeAccountPassword} disabled={accountSaving}>{accountSaving ? "儲存中…" : "更新密碼"}</button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>

      {lightboxUrl && (
        <div className="lightbox show" onClick={() => setLightboxUrl(null)}>
          <span className="lightbox-close" onClick={() => setLightboxUrl(null)}>&times;</span>
          <img src={lightboxUrl} className="lightbox-img" alt="放大檢視" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
