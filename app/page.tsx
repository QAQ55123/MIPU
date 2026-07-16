"use client";
import { useEffect, useState } from "react";
import { Menu, Search, UserCircle, ShoppingCart, X, ChevronDown, ChevronRight, Heart } from "lucide-react";

type Category = { id: string; name: string; parentId: string | null };
type Plan = {
  id: string; name: string; imageUrl?: string; codLimit: number; deadline?: string; closed: boolean;
  categoryId?: string | null; categoryName?: string | null; categoryParentId?: string | null;
  promoImages?: string[];
};
type Product = { id: string; name: string; style: string; price: number; imageUrl?: string };
type CartItem = { name: string; style: string; qty: number };
type Identity = { username: string; profileUrl: string; email: string; emailVerified: boolean } | null;
type PendingAction = null | "order" | "history" | "favorites";

const fmt = (n: number) => new Intl.NumberFormat("zh-TW").format(Math.round(n));

export default function Home() {
  const [view, setView] = useState<"identity" | "plans" | "order" | "history" | "account" | "favorites">("plans");
  const [identity, setIdentity] = useState<Identity>(null);
  const [toast, setToast] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [accountCurrentPw, setAccountCurrentPw] = useState("");
  const [accountNewPw, setAccountNewPw] = useState("");
  const [accountConfirmPw, setAccountConfirmPw] = useState("");
  const [accountMsg, setAccountMsg] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountNewEmail, setAccountNewEmail] = useState("");
  const [accountNewProfileUrl, setAccountNewProfileUrl] = useState("");
  const [accountProfileMsg, setAccountProfileMsg] = useState("");
  const [accountProfileSaving, setAccountProfileSaving] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [favoritedPlanIds, setFavoritedPlanIds] = useState<Set<string>>(new Set());
  const [favoritePlans, setFavoritePlans] = useState<Plan[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  // identity form state
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regProfileUrl, setRegProfileUrl] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [verifyBannerMsg, setVerifyBannerMsg] = useState("");

  // categories / navigation
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [categoryQuickOpen, setCategoryQuickOpen] = useState(false);
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
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [selectedStyleByProduct, setSelectedStyleByProduct] = useState<Record<string, string>>({});
  const [payment, setPayment] = useState("匯款");
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/categories", { cache: "no-store" }).then((r) => r.json()).then((d) => setCategories(d.categories || []));
    loadPlans();

    const params = new URLSearchParams(window.location.search);
    const verify = params.get("verify");
    if (verify === "success") setVerifyBannerMsg("信箱驗證成功！");
    else if (verify === "invalid") setVerifyBannerMsg("驗證連結無效或已過期。");
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  async function loadPlans(categoryId?: string | null, q?: string) {
    setView("plans");
    setPlansLoading(true);
    const params = new URLSearchParams();
    if (categoryId) params.set("categoryId", categoryId);
    if (q) params.set("q", q);
    const r = await fetch(`/api/plans?${params.toString()}`, { cache: "no-store" });
    const d = await r.json();
    setPlans(d.plans || []);
    setPlansLoading(false);
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
    setSelectedProductName(null);
    setSelectedStyleByProduct({});
    setProductsLoading(false);
  }

  function requireIdentity(action: PendingAction) {
    setPendingAction(action);
    setAuthMsg("");
    setView("identity");
  }

  async function onLogin() {
    setAuthMsg("");
    if (!loginUsername.trim() || !loginPassword) return setAuthMsg("請輸入帳號密碼");
    setAuthSubmitting(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      const d = await r.json();
      if (!r.ok) return setAuthMsg(d.error || "登入失敗");
      const id = { username: d.username, profileUrl: d.profileUrl, email: d.email, emailVerified: d.emailVerified };
      setIdentity(id);
      setLoginPassword("");
      afterAuthSuccess(id);
    } catch {
      setAuthMsg("網路連線失敗，請再試一次");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function onRegister() {
    setAuthMsg("");
    if (regUsername.trim().length < 3) return setAuthMsg("帳號至少要 3 個字");
    if (regPassword.length < 6) return setAuthMsg("密碼至少要 6 個字");
    if (regPassword !== regConfirmPassword) return setAuthMsg("兩次輸入的密碼不一樣");
    if (!regProfileUrl.trim()) return setAuthMsg("請填寫個人頁網址");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)) return setAuthMsg("請輸入有效的 Email");

    setAuthSubmitting(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: regUsername.trim(),
          password: regPassword,
          confirmPassword: regConfirmPassword,
          profileUrl: regProfileUrl.trim(),
          email: regEmail.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) return setAuthMsg(d.error || "註冊失敗");
      const id = { username: d.username, profileUrl: d.profileUrl, email: d.email, emailVerified: d.emailVerified };
      setIdentity(id);
      showToast(
        d.verifyEmailSent !== false
          ? "註冊成功！我們也寄了一封驗證信到你的信箱，記得去點連結驗證（如果收件匣沒看到，記得也檢查一下垃圾郵件匣）"
          : "註冊成功！但驗證信寄送失敗了，可以之後到「編輯會員資料」重新觸發寄送"
      );
      afterAuthSuccess(id);
    } catch {
      setAuthMsg("網路連線失敗，請再試一次");
    } finally {
      setAuthSubmitting(false);
    }
  }

  // 登入成功後，回到原本想做的事（送出訂單 / 查歷史），沒有的話就回企劃列表
  function afterAuthSuccess(id: Identity) {
    const action = pendingAction;
    setPendingAction(null);
    loadFavorites(id);
    if (action === "order") {
      setView("order");
      showToast("身分驗證成功，請按「新增訂單」送出");
    } else if (action === "history") {
      openHistoryNow(id);
    } else if (action === "favorites") {
      openFavoritesNow(id);
    } else {
      loadPlans(selectedCategoryId, searchQuery);
    }
  }

  async function loadFavorites(useIdentity?: Identity) {
    const id = useIdentity || identity;
    if (!id) return;
    const r = await fetch(`/api/favorites?username=${encodeURIComponent(id.username)}`, { cache: "no-store" });
    const d = await r.json();
    setFavoritedPlanIds(new Set<string>(d.planIds || []));
    setFavoritePlans(
      (d.favorites || []).map((f: any) => ({
        id: f.id, name: f.name, imageUrl: f.imageUrl, codLimit: 0, deadline: f.deadline,
        closed: f.closed, categoryId: null, categoryName: f.categoryName, categoryParentId: null,
      }))
    );
  }

  async function toggleFavorite(planId: string) {
    if (!identity) {
      requireIdentity("favorites");
      showToast("請先登入才能收藏");
      return;
    }
    const isFav = favoritedPlanIds.has(planId);
    // 先更新畫面，讓使用者立刻看到反應，失敗再復原
    setFavoritedPlanIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(planId);
      else next.add(planId);
      return next;
    });
    try {
      const r = await fetch("/api/favorites", {
        method: isFav ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identity.username, planId }),
      });
      if (!r.ok) throw new Error();
      loadFavorites();
    } catch {
      // 失敗就復原剛剛的畫面更新
      setFavoritedPlanIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(planId);
        else next.delete(planId);
        return next;
      });
      showToast("收藏失敗，請再試一次");
    }
  }

  async function openFavorites() {
    if (!identity) {
      requireIdentity("favorites");
      return;
    }
    openFavoritesNow();
  }

  async function openFavoritesNow(useIdentity?: Identity) {
    const id = useIdentity || identity;
    if (!id) return;
    setView("favorites");
    setCategoryQuickOpen(false);
    setFavoritesLoading(true);
    await loadFavorites(id);
    setFavoritesLoading(false);
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
    if (submittingOrder) return; // 防呆：正在送出中，忽略後續點擊
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

    setSubmittingOrder(true);
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: activePlan.id,
          items,
          username: identity?.username,
          payment,
        }),
      });
      const d = await r.json();
      if (!r.ok) return showToast(d.error || "新增訂單失敗");
      showToast(`訂單已送出（編號 ${d.orderNo}）`);
      setCart({});
    } catch {
      showToast("網路連線失敗，請再試一次");
    } finally {
      setSubmittingOrder(false);
    }
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
    setCategoryQuickOpen(false);
    setHistoryLoading(true);
    const params = new URLSearchParams();
    params.set("username", id.username);
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
      body: JSON.stringify({ items: [], username: identity.username }),
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
    if (accountNewPw.length < 6) return setAccountMsg("新密碼至少要 6 個字");
    if (accountNewPw !== accountConfirmPw) return setAccountMsg("兩次輸入的新密碼不一樣");

    setAccountSaving(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identity.username, password: accountCurrentPw, newPassword: accountNewPw }),
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

  async function updateAccountProfile() {
    setAccountProfileMsg("");
    if (!identity) return;
    if (!accountCurrentPw && !accountNewEmail && !accountNewProfileUrl) return;
    if (!accountCurrentPw) return setAccountProfileMsg("請輸入目前的密碼");
    if (!accountNewEmail.trim() && !accountNewProfileUrl.trim()) return setAccountProfileMsg("請填寫要更新的信箱或個人頁網址");

    setAccountProfileSaving(true);
    try {
      const r = await fetch("/api/auth/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: identity.username,
          password: accountCurrentPw,
          newEmail: accountNewEmail.trim() || undefined,
          newProfileUrl: accountNewProfileUrl.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) return setAccountProfileMsg(d.error || "更新失敗");
      setIdentity({ username: d.username, profileUrl: d.profileUrl, email: d.email, emailVerified: d.emailVerified });
      setAccountNewEmail("");
      setAccountNewProfileUrl("");
      setAccountProfileMsg(d.verifyEmailSent ? "已更新，驗證信已寄出，請去收信點連結驗證（記得也檢查一下垃圾郵件匣）。" : "已更新。");
    } catch {
      setAccountProfileMsg("網路連線失敗，請再試一次");
    } finally {
      setAccountProfileSaving(false);
    }
  }

  async function resendMemberVerification() {
    setAccountProfileMsg("");
    if (!identity) return;
    if (!accountCurrentPw) return setAccountProfileMsg("請先在下面輸入目前的密碼，再點這個按鈕");
    setAccountProfileSaving(true);
    try {
      const r = await fetch("/api/auth/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identity.username, password: accountCurrentPw, newEmail: identity.email }),
      });
      const d = await r.json();
      if (!r.ok) return setAccountProfileMsg(d.error || "失敗");
      setIdentity({ username: d.username, profileUrl: d.profileUrl, email: d.email, emailVerified: d.emailVerified });
      setAccountProfileMsg(d.verifyEmailSent ? "驗證信已重新寄出，請去收信點連結驗證（記得也檢查一下垃圾郵件匣）。" : "這個信箱已經驗證過了。");
    } catch {
      setAccountProfileMsg("網路連線失敗，請再試一次");
    } finally {
      setAccountProfileSaving(false);
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

  const isAccountArea = view === "history" || view === "account" || view === "favorites";

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
          className={`account-nav-item ${view === "favorites" ? "active" : ""}`}
          onClick={() => { openFavoritesNow(); if (closeAfterSelect) setMobileDrawerOpen(false); }}
        >
          我的收藏
        </div>
        <div
          className={`account-nav-item ${view === "account" ? "active" : ""}`}
          onClick={() => { setView("account"); setAccountMsg(""); setCategoryQuickOpen(false); if (closeAfterSelect) setMobileDrawerOpen(false); }}
        >
          編輯會員資料
        </div>
      </>
    );
  }

  function renderCategoryTree(onAfterSelect?: () => void) {
    const roots = categories.filter((c) => !c.parentId);
    return (
      <>

        <div
          className={`category-item root ${!selectedCategoryId ? "active" : ""}`}
          onClick={() => { selectCategory(null); onAfterSelect?.(); }}
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
                onClick={() => { selectCategory(root.id); onAfterSelect?.(); }}
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
                      onClick={() => { selectCategory(child.id); onAfterSelect?.(); }}
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
                      setCategoryQuickOpen((v) => !v);
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
                        <div className="mibu-hover-panel-title">{identity.username}</div>
                        <div className="mibu-hover-panel-row"><span>個人頁</span><span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{identity.profileUrl}</span></div>
                      </>
                    ) : (
                      <div className="mibu-hover-panel-empty">尚未登入，點擊查看歷史訂單時會先要求登入</div>
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
            {verifyBannerMsg && <div className="rules-box">{verifyBannerMsg}</div>}
            {pendingAction === "order" && <div className="rules-box">送出訂單前，請先登入</div>}
            {pendingAction === "history" && <div className="rules-box">查詢歷史訂單前，請先登入</div>}
            {pendingAction === "favorites" && <div className="rules-box">收藏企劃前，請先登入</div>}

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button className={`src-btn ${authTab === "login" ? "active" : ""}`} onClick={() => { setAuthTab("login"); setAuthMsg(""); }}>登入</button>
              <button className={`src-btn ${authTab === "register" ? "active" : ""}`} onClick={() => { setAuthTab("register"); setAuthMsg(""); }}>註冊新帳號</button>
            </div>

            {authTab === "login" ? (
              <>
                <h2 className="section-title">登入</h2>
                <div className="id-row">
                  <span className="id-label">帳號</span>
                  <input type="text" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onLogin()} />
                </div>
                <div className="id-row">
                  <span className="id-label">密碼</span>
                  <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onLogin()} />
                </div>
                <div className="auth-msg">{authMsg}</div>
                <button className="btn" onClick={onLogin} disabled={authSubmitting}>{authSubmitting ? "登入中…" : "登入"}</button>
                <p style={{ fontSize: 13, marginTop: 10 }}>
                  <a href="/forgot-password" style={{ color: "var(--muted)" }}>忘記密碼？</a>
                </p>
              </>
            ) : (
              <>
                <h2 className="section-title">建立新帳號</h2>
                <div className="id-row">
                  <span className="id-label">帳號</span>
                  <input type="text" value={regUsername} onChange={(e) => setRegUsername(e.target.value)} placeholder="至少 3 個字" />
                </div>
                <div className="id-row">
                  <span className="id-label">密碼</span>
                  <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="至少 6 個字" />
                </div>
                <div className="id-row">
                  <span className="id-label">確認密碼</span>
                  <input type="password" value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} placeholder="再輸入一次" />
                </div>
                <div className="id-row">
                  <span className="id-label">個人頁網址</span>
                  <input type="text" value={regProfileUrl} onChange={(e) => setRegProfileUrl(e.target.value)} placeholder="例如你的 FB 個人首頁網址" />
                </div>
                <div className="id-row">
                  <span className="id-label">Email</span>
                  <input type="text" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="請留下可收信的信箱，會寄驗證信" />
                </div>
                <div className="auth-msg">{authMsg}</div>
                <button className="btn" onClick={onRegister} disabled={authSubmitting}>{authSubmitting ? "建立中…" : "註冊"}</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="mibu-content-row" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <aside
            className={`category-sidebar-desktop ${isAccountArea ? "account-sidebar-active" : ""}`}
            style={!isAccountArea ? { display: sidebarOpen ? undefined : "none" } : undefined}
          >
            {isAccountArea
              ? categoryQuickOpen
                ? renderCategoryTree(() => setCategoryQuickOpen(false))
                : renderAccountNav(false)
              : renderCategoryTree()}
          </aside>

          <div className={`category-drawer-mobile ${mobileDrawerOpen && !isAccountArea ? "open" : ""}`}>
            <div className="category-drawer-panel">{renderCategoryTree(() => setMobileDrawerOpen(false))}</div>
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
                {activePlan.closed && <div className="banner warn">此企劃已截止，無法新增訂單</div>}

                {activePlan.promoImages && activePlan.promoImages.length > 0 && (
                  <div className="promo-gallery">
                    {activePlan.promoImages.map((url, i) => (
                      <img key={i} src={url} alt={`宣傳圖 ${i + 1}`} onClick={() => setLightboxUrl(url)} />
                    ))}
                  </div>
                )}

                {(() => {
                  const grouped = products.reduce<Record<string, Product[]>>((acc, p) => {
                    acc[p.name] = acc[p.name] || [];
                    acc[p.name].push(p);
                    return acc;
                  }, {});
                  const productNames = Object.keys(grouped);
                  if (productNames.length === 0) return null;

                  const activeProductName = selectedProductName && grouped[selectedProductName] ? selectedProductName : productNames[0];
                  const activeStyles = grouped[activeProductName];
                  const currentStyle = selectedStyleByProduct[activeProductName] ?? activeStyles[0].style;
                  const current = activeStyles.find((s) => s.style === currentStyle) || activeStyles[0];
                  const key = `${current.name}||${current.style}`;
                  const qty = cart[key] || 0;

                  const productQtyTotal = (pname: string) =>
                    grouped[pname].reduce((sum, s) => sum + (cart[`${s.name}||${s.style}`] || 0), 0);

                  return (
                    <div className="product-card-v3">
                      <div className="product-title-block">
                        <h2 className="product-plan-title">{activePlan.name}</h2>
                        {activePlan.deadline && (
                          <div className="product-plan-deadline">
                            {activePlan.closed ? "已於 " : "截止 "}
                            {new Date(activePlan.deadline).toLocaleString("zh-TW")}
                          </div>
                        )}
                      </div>

                      <div className="product-gallery-v3">
                        {current.imageUrl ? (
                          <img
                            src={current.imageUrl}
                            alt={current.style || activeProductName}
                            onClick={() => setLightboxUrl(current.imageUrl!)}
                          />
                        ) : (
                          <div className="product-gallery-v3-empty">尚無圖片</div>
                        )}
                      </div>

                      <div className="product-info-v3">

                        <div className="product-price-row">
                          <span className="product-price-v3">NT$ {fmt(current.price)}</span>
                          <button
                            className={`favorite-icon-btn ${favoritedPlanIds.has(activePlan.id) ? "active" : ""}`}
                            onClick={() => toggleFavorite(activePlan.id)}
                            aria-label="收藏"
                          >
                            <Heart size={20} fill={favoritedPlanIds.has(activePlan.id) ? "#D85A30" : "none"} />
                          </button>
                        </div>

                        {productNames.length > 1 && (
                          <>
                            <div className="product-info-v3-label">商品</div>
                            <div className="style-pills">
                              {productNames.map((pname) => (
                                <button
                                  key={pname}
                                  className={`style-pill ${activeProductName === pname ? "active" : ""}`}
                                  onClick={() => setSelectedProductName(pname)}
                                >
                                  {pname}
                                  {productQtyTotal(pname) > 0 && <span className="style-pill-badge">{productQtyTotal(pname)}</span>}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        {productNames.length === 1 && <h4>{activeProductName}</h4>}

                        <div className="product-info-v3-label">款式</div>
                        <div className="style-pills">
                          {activeStyles.map((s) => (
                            <button
                              key={s.style}
                              className={`style-pill ${currentStyle === s.style ? "active" : ""}`}
                              onClick={() => setSelectedStyleByProduct((prev) => ({ ...prev, [activeProductName]: s.style }))}
                            >
                              {s.style || "單一款式"}
                              {(cart[`${s.name}||${s.style}`] || 0) > 0 && (
                                <span className="style-pill-badge">{cart[`${s.name}||${s.style}`]}</span>
                              )}
                            </button>
                          ))}
                        </div>

                        <div className="product-info-v3-label">數量</div>
                        <div className="stepper stepper-lg">
                          <button className="step-btn" disabled={qty <= 0 || activePlan.closed} onClick={() => changeQty(current.name, current.style, -1)}>－</button>
                          <input className="qty" readOnly value={qty} />
                          <button className="step-btn" disabled={activePlan.closed} onClick={() => changeQty(current.name, current.style, 1)}>＋</button>
                        </div>

                        <div className="product-checkout-row">
                          <span className="product-checkout-total">合計 NT$ {fmt(cartTotal)}</span>
                          <button className="btn" disabled={activePlan.closed || submittingOrder} onClick={submitOrder}>
                            {submittingOrder ? "送出中…" : "加入購物車"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
                      <span className="hist-src">{o.planName}｜{o.username}</span>
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

            {view === "favorites" && (
              <div>
                <h2 className="section-title">我的收藏</h2>
                {favoritesLoading && <div className="spinner">載入中…</div>}
                {!favoritesLoading && favoritePlans.length === 0 && <div className="spinner">還沒有收藏任何企劃</div>}
                {!favoritesLoading && favoritePlans.length > 0 && (
                  <div className="plan-grid">
                    {favoritePlans.map((p) => (
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
                  </div>
                )}
              </div>
            )}

            {view === "account" && identity && (
              <div>
                <h2 className="section-title">編輯會員資料</h2>
                <div className="auth-card" style={{ marginTop: 0 }}>
                  <div className="id-row"><span className="id-label">帳號</span><span>{identity.username}</span></div>
                  <div className="id-row"><span className="id-label">個人頁</span><span style={{ wordBreak: "break-all" }}>{identity.profileUrl}</span></div>
                  <div className="id-row">
                    <span className="id-label">Email</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {identity.email}
                      <span style={{ fontSize: 12, color: identity.emailVerified ? "#27500A" : "#B08E5A" }}>
                        {identity.emailVerified ? "（已驗證）" : "（尚未驗證）"}
                      </span>
                      {!identity.emailVerified && (
                        <button className="btn small secondary" onClick={resendMemberVerification} disabled={accountProfileSaving}>
                          {accountProfileSaving ? "寄送中…" : "驗證信箱"}
                        </button>
                      )}
                    </span>
                  </div>
                </div>

                <div className="auth-card">
                  <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>修改信箱／個人頁網址</h3>
                  <div className="id-row">
                    <span className="id-label">新 Email</span>
                    <input type="text" value={accountNewEmail} onChange={(e) => setAccountNewEmail(e.target.value)} placeholder="留空表示不更改" />
                  </div>
                  <div className="id-row">
                    <span className="id-label">新個人頁</span>
                    <input type="text" value={accountNewProfileUrl} onChange={(e) => setAccountNewProfileUrl(e.target.value)} placeholder="留空表示不更改" />
                  </div>
                  <div className="id-row">
                    <span className="id-label">目前密碼</span>
                    <input type="password" value={accountCurrentPw} onChange={(e) => setAccountCurrentPw(e.target.value)} placeholder="驗證身分用" />
                  </div>
                  <div className="auth-msg">{accountProfileMsg}</div>
                  <button className="btn" onClick={updateAccountProfile} disabled={accountProfileSaving}>{accountProfileSaving ? "儲存中…" : "更新"}</button>
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
