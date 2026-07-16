"use client";
import { useEffect, useState } from "react";

type Category = { id: string; name: string; parent_id: string | null };
type PlanAdmin = {
  id: string; name: string; deadline: string | null; imageUrl: string | null;
  codLimit: number; visibleTo: string[]; categoryId: string | null; categoryName: string | null;
  promoImages?: string[];
};
type ProductAdmin = { id: string; planId: string; name: string; style: string; price: number; imageUrl: string | null };

const emptyCategoryForm = { id: "", name: "", parentId: "" };
const emptyPlanForm = { id: "", name: "", deadline: "", imageUrl: "", codLimit: "0", visibleTo: [] as string[], categoryId: "", promoImages: [] as string[] };
const emptyProductForm = { id: "", name: "", style: "", price: "0", imageUrl: "" };

export default function AdminPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");
  const [currentRole, setCurrentRole] = useState<"owner" | "staff" | "">("");
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentEmailVerified, setCurrentEmailVerified] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminEmailPw, setAdminEmailPw] = useState("");
  const [adminEmailMsg, setAdminEmailMsg] = useState("");
  const [savingAdminEmail, setSavingAdminEmail] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [unlocked, setUnlocked] = useState(false);

  // ---- 分類 ----
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [categoryMsg, setCategoryMsg] = useState("");

  // ---- 企劃 ----
  const [plans, setPlans] = useState<PlanAdmin[]>([]);
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [planMsg, setPlanMsg] = useState("");
  const [uploadingPlanImg, setUploadingPlanImg] = useState(false);
  const [uploadingPromoImg, setUploadingPromoImg] = useState(false);

  // ---- 商品 ----
  const [activePlanForProducts, setActivePlanForProducts] = useState<PlanAdmin | null>(null);
  const [products, setProducts] = useState<ProductAdmin[]>([]);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const [productMsg, setProductMsg] = useState("");
  const [uploadingProductImg, setUploadingProductImg] = useState(false);

  // ---- 其他既有工具 ----
  const [keepId, setKeepId] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [mergeMsg, setMergeMsg] = useState("");
  const [resetUsername, setResetUsername] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [profileRequests, setProfileRequests] = useState<any[]>([]);
  const [profileRequestsMsg, setProfileRequestsMsg] = useState("");
  const [inviteCodes, setInviteCodes] = useState<any[]>([]);
  const [inviteCodesMsg, setInviteCodesMsg] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.loggedIn) {
          setUnlocked(true);
          setCurrentUsername(d.username);
          setCurrentRole(d.role);
          setCurrentEmail(d.email || "");
          setCurrentEmailVerified(d.emailVerified || false);
        }
        setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));

    const params = new URLSearchParams(window.location.search);
    const verify = params.get("verify");
    if (verify === "success") setVerifyMsg("信箱驗證成功！");
    else if (verify === "invalid") setVerifyMsg("驗證連結無效或已過期。");
    if (verify) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (unlocked) {
      loadCategories();
      loadPlans();
      if (currentRole === "owner") {
        loadProfileRequests();
        loadInviteCodes();
      }
    }
  }, [unlocked, currentRole]);

  async function doLogin() {
    setLoginMsg("");
    if (!username.trim() || !password) return setLoginMsg("請輸入帳號密碼");
    setLoggingIn(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok) return setLoginMsg(d.error || "登入失敗");
      setCurrentUsername(d.username);
      setCurrentRole(d.role);
      setCurrentEmail(d.email || "");
      setCurrentEmailVerified(d.emailVerified || false);
      setUnlocked(true);
      setPassword("");
    } catch {
      setLoginMsg("網路連線失敗，請再試一次");
    } finally {
      setLoggingIn(false);
    }
  }

  async function doLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setUnlocked(false);
    setCurrentRole("");
    setCurrentUsername("");
    setUsername("");
  }

  async function saveAdminEmail() {
    setAdminEmailMsg("");
    if (!adminEmailPw) return setAdminEmailMsg("請輸入目前的密碼");
    if (!newAdminEmail.trim()) return setAdminEmailMsg("請輸入 Email");
    setSavingAdminEmail(true);
    try {
      const d = await callJson("/api/admin/account", "POST", { password: adminEmailPw, newEmail: newAdminEmail.trim() });
      setCurrentEmail(d.email);
      setCurrentEmailVerified(d.emailVerified);
      setAdminEmailPw("");
      setAdminEmailMsg(d.verifyEmailSent ? "已更新，驗證信已寄出，請去收信點連結驗證（記得也檢查一下垃圾郵件匣）。" : "已更新。");
    } catch (e: any) {
      setAdminEmailMsg("失敗：" + e.message);
    } finally {
      setSavingAdminEmail(false);
    }
  }

  async function resendAdminVerification() {
    setAdminEmailMsg("");
    if (!adminEmailPw) return setAdminEmailMsg("請先在下面輸入目前的密碼，再點這個按鈕");
    setSavingAdminEmail(true);
    try {
      const d = await callJson("/api/admin/account", "POST", { password: adminEmailPw, newEmail: currentEmail });
      setCurrentEmailVerified(d.emailVerified);
      setAdminEmailPw("");
      setAdminEmailMsg(d.verifyEmailSent ? "驗證信已重新寄出，請去收信點連結驗證（記得也檢查一下垃圾郵件匣）。" : "這個信箱已經驗證過了。");
    } catch (e: any) {
      setAdminEmailMsg("失敗：" + e.message);
    } finally {
      setSavingAdminEmail(false);
    }
  }

  async function callJson(url: string, method: string, body: any) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.status === 401) {
      setUnlocked(false);
      setLoginMsg("登入已過期，請重新登入");
    }
    if (!r.ok) throw new Error(d.error || "失敗");
    return d;
  }

  async function uploadImage(file: File): Promise<string> {
    if (file.size > 4 * 1024 * 1024) {
      throw new Error("圖片大小請控制在 4MB 以內，太大的圖片建議先壓縮再上傳");
    }
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/admin/upload", { method: "POST", body: form });

    let d: any;
    try {
      d = await r.json();
    } catch {
      // 伺服器回傳的不是 JSON（例如平台層級擋掉過大請求），視情況給友善訊息
      throw new Error(r.status === 413 ? "圖片檔案太大，請壓縮後再上傳" : "上傳失敗，請再試一次");
    }

    if (r.status === 401) {
      setUnlocked(false);
      setLoginMsg("登入已過期，請重新登入");
    }
    if (!r.ok) throw new Error(d.error || "上傳失敗");
    return d.url;
  }

  // ================= 分類 =================
  async function loadCategories() {
    const r = await fetch("/api/categories", { cache: "no-store" });
    const d = await r.json();
    setCategories((d.categories || []).map((c: any) => ({ id: c.id, name: c.name, parent_id: c.parentId })));
  }

  function editCategory(c: Category) {
    setCategoryForm({ id: c.id, name: c.name, parentId: c.parent_id || "" });
  }

  async function saveCategory() {
    if (!categoryForm.name.trim()) return setCategoryMsg("請填寫分類名稱");
    setCategoryMsg("處理中…");
    try {
      if (categoryForm.id) {
        await callJson("/api/admin/categories", "PUT", { id: categoryForm.id, name: categoryForm.name, parentId: categoryForm.parentId || null });
      } else {
        await callJson("/api/admin/categories", "POST", { name: categoryForm.name, parentId: categoryForm.parentId || null });
      }
      setCategoryForm(emptyCategoryForm);
      setCategoryMsg("已儲存");
      loadCategories();
    } catch (e: any) {
      setCategoryMsg("失敗：" + e.message);
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm("確定要刪除這個分類嗎？（子分類會一起被刪除，底下企劃不會被刪除，只是會變成未分類）")) return;
    try {
      await callJson("/api/admin/categories", "DELETE", { id });
      loadCategories();
    } catch (e: any) {
      setCategoryMsg("失敗：" + e.message);
    }
  }

  const topCategories = categories.filter((c) => !c.parent_id);
  function childrenOf(id: string) {
    return categories.filter((c) => c.parent_id === id);
  }

  // ================= 企劃 =================
  async function loadPlans() {
    const r = await fetch(`/api/admin/plans`);
    if (r.status === 401) { setUnlocked(false); setLoginMsg("登入已過期，請重新登入"); return; }
    const d = await r.json();
    setPlans(d.plans || []);
  }

  function editPlan(p: PlanAdmin) {
    setPlanForm({
      id: p.id,
      name: p.name,
      deadline: p.deadline ? p.deadline.slice(0, 16) : "",
      imageUrl: p.imageUrl || "",
      codLimit: String(p.codLimit || 0),
      visibleTo: p.visibleTo || [],
      categoryId: p.categoryId || "",
      promoImages: p.promoImages || [],
    });
  }

  async function savePlan() {
    if (!planForm.name.trim()) return setPlanMsg("請填寫企劃名稱");
    setPlanMsg("處理中…");
    const payload = {
      name: planForm.name,
      deadline: planForm.deadline ? new Date(planForm.deadline).toISOString() : null,
      imageUrl: planForm.imageUrl || null,
      codLimit: planForm.codLimit,
      visibleTo: planForm.visibleTo,
      categoryId: planForm.categoryId || null,
      promoImages: planForm.promoImages,
    };
    try {
      if (planForm.id) {
        await callJson("/api/admin/plans", "PUT", { id: planForm.id, ...payload });
      } else {
        await callJson("/api/admin/plans", "POST", payload);
      }
      setPlanForm(emptyPlanForm);
      setPlanMsg("已儲存");
      loadPlans();
    } catch (e: any) {
      setPlanMsg("失敗：" + e.message);
    }
  }

  async function deletePlan(id: string) {
    if (!confirm("確定要刪除這個企劃嗎？底下的商品會一起被刪除，無法復原！（訂單記錄會保留，不會被刪除）")) return;
    try {
      await callJson("/api/admin/plans", "DELETE", { id });
      if (activePlanForProducts?.id === id) setActivePlanForProducts(null);
      loadPlans();
    } catch (e: any) {
      setPlanMsg("失敗：" + e.message);
    }
  }

  async function handlePlanImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPlanImg(true);
    try {
      const url = await uploadImage(file);
      setPlanForm((f) => ({ ...f, imageUrl: url }));
    } catch (err: any) {
      setPlanMsg("圖片上傳失敗：" + err.message);
    } finally {
      setUploadingPlanImg(false);
    }
  }

  async function handlePromoImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPromoImg(true);
    try {
      const url = await uploadImage(file);
      setPlanForm((f) => ({ ...f, promoImages: [...f.promoImages, url] }));
    } catch (err: any) {
      setPlanMsg("圖片上傳失敗：" + err.message);
    } finally {
      setUploadingPromoImg(false);
      e.target.value = "";
    }
  }

  function removePromoImage(index: number) {
    setPlanForm((f) => ({ ...f, promoImages: f.promoImages.filter((_, i) => i !== index) }));
  }

  // ================= 商品 =================
  async function openProductManager(p: PlanAdmin) {
    setActivePlanForProducts(p);
    setProductForm(emptyProductForm);
    const r = await fetch(`/api/admin/products?planId=${p.id}`);
    if (r.status === 401) { setUnlocked(false); setLoginMsg("登入已過期，請重新登入"); return; }
    const d = await r.json();
    setProducts(d.products || []);
  }

  function editProduct(p: ProductAdmin) {
    setProductForm({ id: p.id, name: p.name, style: p.style || "", price: String(p.price), imageUrl: p.imageUrl || "" });
  }

  async function saveProduct() {
    if (!activePlanForProducts) return;
    if (!productForm.name.trim()) return setProductMsg("請填寫商品名稱");
    setProductMsg("處理中…");
    const payload = {
      planId: activePlanForProducts.id,
      name: productForm.name,
      style: productForm.style,
      price: productForm.price,
      imageUrl: productForm.imageUrl || null,
    };
    try {
      if (productForm.id) {
        await callJson("/api/admin/products", "PUT", { id: productForm.id, ...payload });
      } else {
        await callJson("/api/admin/products", "POST", payload);
      }
      setProductForm(emptyProductForm);
      setProductMsg("已儲存");
      openProductManager(activePlanForProducts);
    } catch (e: any) {
      setProductMsg("失敗：" + e.message);
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm("確定要刪除這個商品款式嗎？")) return;
    try {
      await callJson("/api/admin/products", "DELETE", { id });
      if (activePlanForProducts) openProductManager(activePlanForProducts);
    } catch (e: any) {
      setProductMsg("失敗：" + e.message);
    }
  }

  function handleProductDrop(targetId: string) {
    if (!draggedProductId || draggedProductId === targetId) return;
    setProducts((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((p) => p.id === draggedProductId);
      const toIdx = next.findIndex((p) => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      // 存到後端（不用等回應才更新畫面，畫面已經先動了）
      callJson("/api/admin/products/reorder", "POST", { ids: next.map((p) => p.id) }).catch((e) => {
        setProductMsg("排序儲存失敗：" + e.message);
      });
      return next;
    });
    setDraggedProductId(null);
  }

  async function handleProductImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProductImg(true);
    try {
      const url = await uploadImage(file);
      setProductForm((f) => ({ ...f, imageUrl: url }));
    } catch (err: any) {
      setProductMsg("圖片上傳失敗：" + err.message);
    } finally {
      setUploadingProductImg(false);
    }
  }

  // ================= 既有工具 =================
  async function doMerge() {
    if (!keepId || !removeId) return setMergeMsg("請填兩個會員 ID");
    setMergeMsg("合併中…");
    try {
      const d = await callJson("/api/admin/merge", "POST", { keepId, removeId });
      setMergeMsg(`完成，改寫 ${d.changed} 筆訂單。`);
    } catch (e: any) { setMergeMsg("失敗：" + e.message); }
  }

  async function doReset() {
    if (!resetUsername) return setResetMsg("請填帳號");
    setResetMsg("重設中…");
    try {
      await callJson("/api/admin/reset-password", "POST", { username: resetUsername });
      setResetMsg("已重設為 0000。");
    } catch (e: any) { setResetMsg("失敗：" + e.message); }
  }

  async function loadProfileRequests() {
    try {
      const r = await fetch("/api/admin/profile-requests", { cache: "no-store" });
      if (r.status === 401) { setUnlocked(false); setLoginMsg("登入已過期，請重新登入"); return; }
      const d = await r.json();
      setProfileRequests(d.requests || []);
    } catch {
      setProfileRequestsMsg("載入失敗");
    }
  }

  async function approveProfileRequest(memberId: string) {
    setProfileRequestsMsg("處理中…");
    try {
      await callJson("/api/admin/profile-requests", "POST", { memberId });
      setProfileRequestsMsg("已核准。");
      loadProfileRequests();
    } catch (e: any) {
      setProfileRequestsMsg("失敗：" + e.message);
    }
  }

  async function rejectProfileRequest(memberId: string) {
    if (!confirm("確定要拒絕這個個人頁網址修改申請嗎？")) return;
    setProfileRequestsMsg("處理中…");
    try {
      await callJson("/api/admin/profile-requests", "DELETE", { memberId });
      setProfileRequestsMsg("已拒絕。");
      loadProfileRequests();
    } catch (e: any) {
      setProfileRequestsMsg("失敗：" + e.message);
    }
  }

  async function loadInviteCodes() {
    try {
      const r = await fetch("/api/admin/invite-codes", { cache: "no-store" });
      if (r.status === 401) { setUnlocked(false); setLoginMsg("登入已過期，請重新登入"); return; }
      const d = await r.json();
      setInviteCodes(d.codes || []);
    } catch {
      setInviteCodesMsg("載入失敗");
    }
  }

  async function generateInviteCode() {
    setInviteCodesMsg("");
    setGeneratingCode(true);
    try {
      const d = await callJson("/api/admin/invite-codes", "POST", {});
      setInviteCodesMsg(`已產生新邀請碼：${d.code}`);
      loadInviteCodes();
    } catch (e: any) {
      setInviteCodesMsg("失敗：" + e.message);
    } finally {
      setGeneratingCode(false);
    }
  }

  async function revokeInviteCode(id: string, used: boolean) {
    if (!confirm(used ? "確定要刪除這筆已使用的邀請碼紀錄嗎？" : "確定要撤銷這組還沒使用過的邀請碼嗎？")) return;
    setInviteCodesMsg("");
    try {
      await callJson("/api/admin/invite-codes", "DELETE", { id });
      setInviteCodesMsg(used ? "已刪除紀錄。" : "已撤銷。");
      loadInviteCodes();
    } catch (e: any) {
      setInviteCodesMsg("失敗：" + e.message);
    }
  }

  function copyInviteCode(code: string) {
    navigator.clipboard?.writeText(code);
    setInviteCodesMsg(`已複製：${code}`);
  }

  if (checkingSession) {
    return <div style={{ textAlign: "center", padding: 60, color: "#8A8779" }}>載入中…</div>;
  }

  if (!unlocked) {
    return (
      <div style={{ maxWidth: 380, margin: "80px auto", padding: 20 }}>
        <h2>米舖 後台</h2>
        {verifyMsg && <div style={{ background: "#EAF3DE", color: "#27500A", fontSize: 13, padding: "8px 12px", borderRadius: 8, marginBottom: 10 }}>{verifyMsg}</div>}
        <div className="id-row">
          <span className="id-label">帳號</span>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLogin()} />
        </div>
        <div className="id-row">
          <span className="id-label">密碼</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLogin()} />
        </div>
        <div style={{ color: "#dc2626", fontSize: 13, minHeight: 18, margin: "6px 0" }}>{loginMsg}</div>
        <button className="btn" onClick={doLogin} disabled={loggingIn}>{loggingIn ? "登入中…" : "登入"}</button>
        <p style={{ marginTop: 16, fontSize: 13 }}>
          還沒有帳號？<a href="/admin/register">用邀請碼建立管理者帳號</a>
        </p>
        <p style={{ marginTop: 6, fontSize: 13 }}>
          <a href="/admin/forgot-password">忘記密碼？</a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>米舖 後台</h2>
        <div style={{ fontSize: 13, color: "#6B6858", display: "flex", alignItems: "center", gap: 10 }}>
          <span>已登入：{currentUsername}（{currentRole === "owner" ? "最高權限" : "一般管理者"}）</span>
          <button className="btn secondary small" onClick={doLogout}>登出</button>
        </div>
      </div>
      <p style={{ color: "#8A8779", fontSize: 13 }}>登入超過 8 小時會自動要求重新登入。</p>

      {/* ---------------- 我的帳號設定 ---------------- */}
      <div className="auth-card">
        <h3>我的帳號設定</h3>
        <div className="id-row">
          <span className="id-label">目前信箱</span>
          <span style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            {currentEmail || "尚未設定"}
            {currentEmail && (
              <span style={{ fontSize: 12, color: currentEmailVerified ? "#27500A" : "#B08E5A" }}>
                {currentEmailVerified ? "（已驗證）" : "（尚未驗證）"}
              </span>
            )}
            {currentEmail && !currentEmailVerified && (
              <button className="btn small secondary" onClick={resendAdminVerification} disabled={savingAdminEmail}>
                {savingAdminEmail ? "寄送中…" : "驗證信箱"}
              </button>
            )}
          </span>
        </div>
        <div className="id-row">
          <span className="id-label">新信箱</span>
          <input type="text" value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} placeholder="輸入要設定/更改成的 Email" />
        </div>
        <div className="id-row">
          <span className="id-label">目前密碼</span>
          <input type="password" value={adminEmailPw} onChange={(e) => setAdminEmailPw(e.target.value)} placeholder="驗證身分用" />
        </div>
        <button className="btn" onClick={saveAdminEmail} disabled={savingAdminEmail}>{savingAdminEmail ? "儲存中…" : "更新信箱"}</button>
        <div style={{ fontSize: 13, marginTop: 6 }}>{adminEmailMsg}</div>
      </div>

      {/* ---------------- 分類管理 ---------------- */}
      <div className="auth-card">
        <h3>分類管理</h3>
        <div style={{ marginBottom: 12 }}>
          {topCategories.map((c) => (
            <div key={c.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 600 }}>
                <span>{c.name}</span>
                <span>
                  <button className="btn small secondary" onClick={() => editCategory(c)} style={{ marginRight: 6 }}>編輯</button>
                  <button className="btn small danger" onClick={() => deleteCategory(c.id)}>刪除</button>
                </span>
              </div>
              {childrenOf(c.id).map((sub) => (
                <div key={sub.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#6B6858", paddingLeft: 16, marginTop: 4 }}>
                  <span>└ {sub.name}</span>
                  <span>
                    <button className="btn small secondary" onClick={() => editCategory(sub)} style={{ marginRight: 6 }}>編輯</button>
                    <button className="btn small danger" onClick={() => deleteCategory(sub.id)}>刪除</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
          {topCategories.length === 0 && <div style={{ fontSize: 13, color: "#8A8779" }}>目前沒有分類</div>}
        </div>

        <div className="id-row">
          <span className="id-label">名稱</span>
          <input type="text" value={categoryForm.name} onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如：食品、米菓" />
        </div>
        <div className="id-row">
          <span className="id-label">上層分類</span>
          <select value={categoryForm.parentId} onChange={(e) => setCategoryForm((f) => ({ ...f, parentId: e.target.value }))} style={{ flex: 1, padding: 8 }}>
            <option value="">（無，這是頂層分類）</option>
            {topCategories.filter((c) => c.id !== categoryForm.id).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={saveCategory}>{categoryForm.id ? "儲存修改" : "新增分類"}</button>
          {categoryForm.id && <button className="btn secondary" onClick={() => setCategoryForm(emptyCategoryForm)}>取消編輯</button>}
        </div>
        <div style={{ fontSize: 13, marginTop: 6 }}>{categoryMsg}</div>
      </div>

      {/* ---------------- 企劃管理 ---------------- */}
      <div className="auth-card">
        <h3>企劃管理</h3>
        <div style={{ marginBottom: 12 }}>
          {plans.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px dashed #EDE9DC" }}>
              <div>
                <div style={{ fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "#8A8779" }}>{p.categoryName || "未分類"}{p.deadline ? `　截止 ${new Date(p.deadline).toLocaleString("zh-TW")}` : ""}</div>
              </div>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn small secondary" onClick={() => openProductManager(p)}>管理商品</button>
                <button className="btn small secondary" onClick={() => editPlan(p)}>編輯</button>
                <button className="btn small danger" onClick={() => deletePlan(p.id)}>刪除</button>
              </span>
            </div>
          ))}
          {plans.length === 0 && <div style={{ fontSize: 13, color: "#8A8779" }}>目前沒有企劃</div>}
        </div>

        <div className="id-row">
          <span className="id-label">名稱</span>
          <input type="text" value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} placeholder="企劃名稱" />
        </div>
        <div className="id-row">
          <span className="id-label">分類</span>
          <select value={planForm.categoryId} onChange={(e) => setPlanForm((f) => ({ ...f, categoryId: e.target.value }))} style={{ flex: 1, padding: 8 }}>
            <option value="">（未分類）</option>
            {topCategories.map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name}</option>
                {childrenOf(c.id).map((sub) => (
                  <option key={sub.id} value={sub.id}>　└ {sub.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="id-row">
          <span className="id-label">截止時間</span>
          <input type="datetime-local" value={planForm.deadline} onChange={(e) => setPlanForm((f) => ({ ...f, deadline: e.target.value }))} style={{ flex: 1, padding: 8 }} />
        </div>
        <div className="id-row">
          <span className="id-label">取付上限</span>
          <input type="number" value={planForm.codLimit} onChange={(e) => setPlanForm((f) => ({ ...f, codLimit: e.target.value }))} placeholder="0＝不開放取付" />
        </div>
        <div className="id-row">
          <span className="id-label">企劃圖片</span>
          <input type="file" accept="image/*" onChange={handlePlanImageUpload} />
        </div>
        {uploadingPlanImg && <div style={{ fontSize: 13, color: "#8A8779" }}>圖片上傳中…</div>}
        {planForm.imageUrl && <img src={planForm.imageUrl} alt="預覽" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}

        <div className="id-row" style={{ alignItems: "flex-start" }}>
          <span className="id-label" style={{ paddingTop: 8 }}>宣傳圖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#8A8779", marginBottom: 8 }}>可以放好幾張，顯示在商品頁最上方；沒有放的話那個區塊就不會出現</div>
            {planForm.promoImages.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {planForm.promoImages.map((url, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={url} alt={`宣傳圖 ${i + 1}`} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid #EDE9DC" }} />
                    <span
                      onClick={() => removePromoImage(i)}
                      style={{ position: "absolute", top: -6, right: -6, background: "#dc2626", color: "#fff", borderRadius: "999px", width: 18, height: 18, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    >
                      ×
                    </span>
                  </div>
                ))}
              </div>
            )}
            <input type="file" accept="image/*" onChange={handlePromoImageUpload} />
            {uploadingPromoImg && <div style={{ fontSize: 13, color: "#8A8779", marginTop: 4 }}>圖片上傳中…</div>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={savePlan}>{planForm.id ? "儲存修改" : "新增企劃"}</button>
          {planForm.id && <button className="btn secondary" onClick={() => setPlanForm(emptyPlanForm)}>取消編輯</button>}
        </div>
        <div style={{ fontSize: 13, marginTop: 6 }}>{planMsg}</div>
      </div>

      {/* ---------------- 商品管理 ---------------- */}
      {activePlanForProducts && (
        <div className="auth-card">
          <h3>商品管理：{activePlanForProducts.name}</h3>
          <div style={{ marginBottom: 12 }}>
            {Object.entries(
              products.reduce<Record<string, ProductAdmin[]>>((acc, p) => {
                acc[p.name] = acc[p.name] || [];
                acc[p.name].push(p);
                return acc;
              }, {})
            ).map(([name, styles]) => (
              <div key={name} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#33415C", padding: "6px 0" }}>{name}</div>
                {styles.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={() => setDraggedProductId(p.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleProductDrop(p.id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 8px 10px", borderBottom: "1px dashed #EDE9DC", cursor: "grab", opacity: draggedProductId === p.id ? 0.4 : 1 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#B0AC9C", fontSize: 14, cursor: "grab" }} title="拖曳排序">⠿</span>
                      {p.imageUrl && <img src={p.imageUrl} alt={p.name} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />}
                      <div>
                        <div style={{ fontSize: 14 }}>{p.style || "單一款式"}</div>
                        <div style={{ fontSize: 12, color: "#8A8779" }}>NT$ {p.price}</div>
                      </div>
                    </div>
                    <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className="btn small secondary" onClick={() => editProduct(p)}>編輯</button>
                      <button className="btn small danger" onClick={() => deleteProduct(p.id)}>刪除</button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {products.length === 0 && <div style={{ fontSize: 13, color: "#8A8779" }}>這個企劃還沒有商品</div>}
          </div>

          <div className="id-row">
            <span className="id-label">商品名稱</span>
            <input type="text" value={productForm.name} onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如：原味米菓" />
          </div>
          <div className="id-row">
            <span className="id-label">款式</span>
            <input type="text" value={productForm.style} onChange={(e) => setProductForm((f) => ({ ...f, style: e.target.value }))} placeholder="例如：6入（沒有分款式可留空）" />
          </div>
          <div className="id-row">
            <span className="id-label">價格</span>
            <input type="number" value={productForm.price} onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))} />
          </div>
          <div className="id-row">
            <span className="id-label">商品圖片</span>
            <input type="file" accept="image/*" onChange={handleProductImageUpload} />
          </div>
          {uploadingProductImg && <div style={{ fontSize: 13, color: "#8A8779" }}>圖片上傳中…</div>}
          {productForm.imageUrl && <img src={productForm.imageUrl} alt="預覽" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={saveProduct}>{productForm.id ? "儲存修改" : "新增商品"}</button>
            {productForm.id && <button className="btn secondary" onClick={() => setProductForm(emptyProductForm)}>取消編輯</button>}
            <button className="btn secondary" onClick={() => setActivePlanForProducts(null)}>關閉商品管理</button>
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{productMsg}</div>
        </div>
      )}

      {/* ---------------- 會員相關工具（僅限最高權限） ---------------- */}
      {currentRole === "owner" && (
        <>
        <div className="auth-card">
          <h3>合併會員</h3>
          <div className="id-row"><span className="id-label">保留 ID</span><input type="text" value={keepId} onChange={(e) => setKeepId(e.target.value)} /></div>
          <div className="id-row"><span className="id-label">併掉 ID</span><input type="text" value={removeId} onChange={(e) => setRemoveId(e.target.value)} /></div>
          <button className="btn" onClick={doMerge}>合併</button>
          <div style={{ fontSize: 13 }}>{mergeMsg}</div>
        </div>

        <div className="auth-card">
          <h3>重設會員密碼</h3>
          <div className="id-row"><span className="id-label">帳號</span><input type="text" value={resetUsername} onChange={(e) => setResetUsername(e.target.value)} /></div>
          <button className="btn" onClick={doReset}>重設為 0000</button>
          <div style={{ fontSize: 13 }}>{resetMsg}</div>
        </div>

        <div className="auth-card">
          <h3>個人頁網址修改審核</h3>
          {profileRequests.length === 0 && <div style={{ fontSize: 13, color: "#8A8779" }}>目前沒有待審核的申請</div>}
          {profileRequests.map((r) => (
            <div key={r.memberId} style={{ padding: "8px 0", borderBottom: "1px dashed #EDE9DC" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r.username}</div>
              <div style={{ fontSize: 12, color: "#8A8779", margin: "4px 0" }}>
                目前：<span style={{ wordBreak: "break-all" }}>{r.currentProfileUrl}</span>
              </div>
              <div style={{ fontSize: 12, color: "#33415C", marginBottom: 8 }}>
                申請改成：<span style={{ wordBreak: "break-all" }}>{r.pendingProfileUrl}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn small" onClick={() => approveProfileRequest(r.memberId)}>核准</button>
                <button className="btn small danger" onClick={() => rejectProfileRequest(r.memberId)}>拒絕</button>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 13, marginTop: 6 }}>{profileRequestsMsg}</div>
        </div>

        <div className="auth-card">
          <h3>Staff 邀請碼管理</h3>
          <p style={{ fontSize: 12, color: "#8A8779", margin: 0 }}>
            每組邀請碼只能用一次，用過就會失效。owner 的邀請碼另外用固定的環境變數，不受這裡影響。
          </p>
          <button className="btn" onClick={generateInviteCode} disabled={generatingCode}>
            {generatingCode ? "產生中…" : "產生新的邀請碼"}
          </button>
          <div style={{ fontSize: 13 }}>{inviteCodesMsg}</div>

          {inviteCodes.length === 0 && <div style={{ fontSize: 13, color: "#8A8779" }}>目前沒有任何邀請碼</div>}
          {inviteCodes.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px dashed #EDE9DC" }}>
              <div>
                <div style={{ fontSize: 14, fontFamily: "monospace" }}>{c.code}</div>
                <div style={{ fontSize: 12, color: c.used ? "#791F1F" : "#27500A" }}>
                  {c.used ? `已使用（${c.usedBy || "未知帳號"}）` : "未使用"}
                </div>
              </div>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {!c.used ? (
                  <>
                    <button className="btn small secondary" onClick={() => copyInviteCode(c.code)}>複製</button>
                    <button className="btn small danger" onClick={() => revokeInviteCode(c.id, false)}>撤銷</button>
                  </>
                ) : (
                  <button className="btn small danger" onClick={() => revokeInviteCode(c.id, true)}>刪除紀錄</button>
                )}
              </span>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
