# 米舖訂購系統（Next.js + Supabase 重建版）

從 Google Apps Script + Google 試算表，改為完全獨立、脫離 Google 的架構：

| 原本 (GAS) | 現在 |
|---|---|
| Google 試算表 | Supabase (PostgreSQL) |
| `google.script.run` | Next.js API Routes |
| `LockService` | 資料庫層級操作（大流量時建議升級為 transaction，見下方「已知限制」） |
| `PropertiesService` | `.env.local` 環境變數 |
| GAS Web App 網址 | Vercel 部署網址（可綁自訂網域） |

## 一、建立 Supabase 專案（免費）

1. 到 https://supabase.com 註冊、建立新專案
2. 進入專案的 **SQL Editor**，貼上 `supabase/schema.sql` 的全部內容並執行
3. 到 **Project Settings → API**，複製：
   - `Project URL` → 對應 `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → 對應 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → 對應 `SUPABASE_SERVICE_ROLE_KEY`（⚠️ 此金鑰有完整權限，絕對不能外流或放到前端）

## 二、本機測試

```bash
npm install
cp .env.local.example .env.local
# 編輯 .env.local，填入上面拿到的值
npm run dev
```

打開 http://localhost:3000 應該就能看到下單頁；http://localhost:3000/admin 是後台。

## 三、匯入原本的企劃 / 商品資料

目前 `plans` / `products` 兩張表是空的。有兩個方式建立資料：

1. **手動**：到 Supabase 後台的 **Table Editor**，直接在 `plans`、`products` 表格裡新增列。
2. **從舊試算表匯入**：把「企劃清單」分頁與各企劃的價目表分頁分別匯出成 CSV，用 Supabase 的 Table Editor →「Import data from CSV」匯入（欄位名稱需對應 schema，例如 `name`、`price`、`style`、`image_url`）。

（會員與訂單資料通常建議一頁新的開始，不建議把舊的密碼雜湊直接搬過來，因為舊系統的雜湊鹽值 `PW_SECRET` 可能不同，會對不起來。）

## 四、部署到 Vercel（免費）

1. 把這個資料夾 push 到你自己的 GitHub repo
2. 到 https://vercel.com 用 GitHub 登入，選擇這個 repo 匯入
3. 在 Vercel 專案的 **Settings → Environment Variables**，把 `.env.local` 裡的每一項都加進去
4. 部署完成後會拿到一個 `https://your-project.vercel.app` 網址；也可以在 Vercel 裡綁自訂網域

## 五、兩個前台（一般 / FB）怎麼處理

原本 GAS 版本是「複製兩個獨立專案」，一個設 `FRONTEND_MODE=MAIN`、一個設 `FRONTEND_MODE=FB`。
在這個新架構，建議做法：

- **選項 A（最簡單）**：直接部署兩次（兩個 Vercel 專案，指向同一個 Supabase），只有 `FRONTEND_MODE` 環境變數不同
- **選項 B**：改用網址參數或子網域判斷模式（例如 `fb.yourdomain.com`），但這需要再加一點程式邏輯，可以之後再擴充

## 六、已知限制 / 建議之後加強的地方

- **搶購時的併發鎖定**：原本 GAS 用 `LockService` 序列化寫入；目前版本沒有做到完全一致的鎖定，正常使用量沒問題，但如果會有「同時有 50 人搶最後 1 件」這種瞬間流量，建議之後加上 Supabase 的 Postgres function + `SELECT ... FOR UPDATE` 做真正的交易鎖定
- **備份**：原本「立即備份整份試算表」的功能，在 Postgres 世界對應的是 Supabase 內建的每日自動備份（免費方案有 7 天內的 Point-in-Time 概念，付費方案更完整），不需要自己刻備份按鈕
- **圖片放大 (lightbox)、分類篩選列**：目前簡化掉了，功能都還在（商品列表、訂單、歷史），但沒有原本那麼多細節動畫，之後可以再補
- **Discord 通知**：邏輯照搬，只要在 `.env.local` 填 `DISCORD_WEBHOOK_URL` 即可

## 檔案結構

```
app/
  page.tsx              主要下單頁（身分驗證／企劃列表／下單／歷史）
  admin/page.tsx         後台頁面
  api/
    plans/                企劃列表 + 詳細內容
    auth/                 註冊／登入／改密碼
    orders/                新增／查詢／編輯／取消訂單
    admin/                 疑似重複會員／合併／重設密碼
lib/
  supabase.ts            Supabase client
  util.ts                密碼雜湊、FB 網址正規化、訂單編號等工具
  discord.ts              Discord Webhook 通知
supabase/schema.sql       資料庫結構（貼到 Supabase SQL Editor 執行一次）
```
