"use client";
import { useEffect, useState } from "react";

type Category = { id: string; name: string; parent_id: string | null };
type PlanAdmin = {
  id: string; name: string; deadline: string | null; imageUrl: string | null;
  codLimit: number; visibleTo: string[]; categoryId: string | null; categoryName: string | null;
};
type ProductAdmin = { id: string; planId: string; name: string; style: string; price: number; imageUrl: string | null };

const emptyCategoryForm = { id: "", name: "", parentId: "" };
const emptyPlanForm = { id: "", name: "", deadline: "", imageUrl: "", codLimit: "0", visibleTo: [] as string[], categoryId: "" };
const emptyProductForm = { id: "", name: "", style: "", price: "0", imageUrl: "" };

export default function AdminPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");
  const [currentRole, setCurrentRole] = useState<"owner" | "staff" | "">("");
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

  // ---- 商品 ----
  const [activePlanForProducts, setActivePlanForProducts] = useState<PlanAdmin | null>(null);
  const [products, setProducts] = useState<ProductAdmin[]>([]);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [productMsg, setProductMsg] = useState("");
  const [uploadingProductImg, setUploadingProductImg] = useState(false);

  // ---- 其他既有工具 ----
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

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.loggedIn) {
          setUnlocked(true);
          setCurrentUsername(d.username);
          setCurrentRole(d.role);
        }
        setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));

    const params = new URLSearchParams(window.location.search);
    const verify = params.get("verify");
    if (verify === "success") setVerifyMsg("信箱驗證成功！");
    else if (verify === "invalid") setVerifyMsg("驗證連結無效或已過期。");
  }, []);

  useEffect(() => {
    if (unlocked) {
      loadCategories();
      loadPlans();
    }
  }, [unlocked]);

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
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/admin/upload", { method: "POST", body: form });
    const d = await r.json();
    if (r.status === 401) {
      setUnlocked(false);
      setLoginMsg("登入已過期，請重新登入");
    }
    if (!r.ok) throw new Error(d.error || "上傳失敗");
    return d.url;
  }

  // ================= 分類 =================
  async function loadCategories() {
    const r = await fetch("/api/categories");
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
    if (!confirm("確定要刪除這個企劃嗎？底下的商品和所有訂單會一起被刪除，無法復原！")) return;
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

  function toggleVisibleTo(v: string) {
    setPlanForm((f) => ({
      ...f,
      visibleTo: f.visibleTo.includes(v) ? f.visibleTo.filter((x) => x !== v) : [...f.visibleTo, v],
    }));
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
  async function doList() {
    setDupMsg("處理中…");
    try {
      const d = await callJson("/api/admin/duplicates", "POST", {});
      setDupList(d.items || []);
      setDupMsg(`完成，共 ${d.count} 筆。`);
    } catch (e: any) { setDupMsg("失敗：" + e.message); }
  }

  async function doMerge() {
    if (!keepId || !removeId) return setMergeMsg("請填兩個會員 ID");
    setMergeMsg("合併中…");
    try {
      const d = await callJson("/api/admin/merge", "POST", { keepId, removeId });
      setMergeMsg(`完成，改寫 ${d.changed} 筆訂單。`);
    } catch (e: any) { setMergeMsg("失敗：" + e.message); }
  }

  async function doReset() {
    if (!resetFb) return setResetMsg("請貼上 FB 連結");
    setResetMsg("重設中…");
    try {
      await callJson("/api/admin/reset-password", "POST", { fbUrl: resetFb });
      setResetMsg("已重設為 0000。");
    } catch (e: any) { setResetMsg("失敗：" + e.message); }
  }

  async function doResetNick() {
    if (!resetNick) return setResetNickMsg("請填暱稱");
    setResetNickMsg("重設中…");
    try {
      await callJson("/api/admin/reset-password", "POST", { source: resetSource, nickname: resetNick });
      setResetNickMsg("已重設為 0000。");
    } catch (e: any) { setResetNickMsg("失敗：" + e.message); }
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
          <span className="id-label">顯示對象</span>
          <div style={{ display: "flex", gap: 12 }}>
            {["LINE", "Discord", "FB"].map((v) => (
              <label key={v} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={planForm.visibleTo.includes(v)} onChange={() => toggleVisibleTo(v)} />{v}
              </label>
            ))}
          </div>
        </div>
        <div className="id-row">
          <span className="id-label">企劃圖片</span>
          <input type="file" accept="image/*" onChange={handlePlanImageUpload} />
        </div>
        {uploadingPlanImg && <div style={{ fontSize: 13, color: "#8A8779" }}>圖片上傳中…</div>}
        {planForm.imageUrl && <img src={planForm.imageUrl} alt="預覽" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}

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
            {products.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px dashed #EDE9DC" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {p.imageUrl && <img src={p.imageUrl} alt={p.name} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }} />}
                  <div>
                    <div style={{ fontSize: 14 }}>{p.name}{p.style ? `（${p.style}）` : ""}</div>
                    <div style={{ fontSize: 12, color: "#8A8779" }}>NT$ {p.price}</div>
                  </div>
                </div>
                <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn small secondary" onClick={() => editProduct(p)}>編輯</button>
                  <button className="btn small danger" onClick={() => deleteProduct(p.id)}>刪除</button>
                </span>
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
          <h3>疑似重複會員</h3>
          <button className="btn" onClick={doList}>列出疑似重複</button>
          <div style={{ fontSize: 13 }}>{dupMsg}</div>
          {dupList.map((d, i) => (
            <div key={i} style={{ fontSize: 13, borderTop: "1px dashed #EDE9DC", paddingTop: 6 }}>
              暱稱「{d.nickname}」→ 會員 {d.member1} / {d.member2}
            </div>
          ))}
        </div>

        <div className="auth-card">
          <h3>合併會員</h3>
          <div className="id-row"><span className="id-label">保留 ID</span><input type="text" value={keepId} onChange={(e) => setKeepId(e.target.value)} /></div>
          <div className="id-row"><span className="id-label">併掉 ID</span><input type="text" value={removeId} onChange={(e) => setRemoveId(e.target.value)} /></div>
          <button className="btn" onClick={doMerge}>合併</button>
          <div style={{ fontSize: 13 }}>{mergeMsg}</div>
        </div>

        <div className="auth-card">
          <h3>重設 FB 會員密碼</h3>
          <div className="id-row"><span className="id-label">FB 連結</span><input type="text" value={resetFb} onChange={(e) => setResetFb(e.target.value)} /></div>
          <button className="btn" onClick={doReset}>重設為 0000</button>
          <div style={{ fontSize: 13 }}>{resetMsg}</div>
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
          <div className="id-row"><span className="id-label">暱稱</span><input type="text" value={resetNick} onChange={(e) => setResetNick(e.target.value)} /></div>
          <button className="btn" onClick={doResetNick}>重設為 0000</button>
          <div style={{ fontSize: 13 }}>{resetNickMsg}</div>
        </div>
        </>
      )}
    </div>
  );
}
