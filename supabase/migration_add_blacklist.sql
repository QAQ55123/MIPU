-- 黑名單：列入的信箱／FB個人頁網址不能註冊、不能下單
-- 在 Supabase SQL Editor 執行一次即可

create table if not exists blacklist (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('email', 'fb')),
  value       text not null,          -- 管理者輸入的原始內容（顯示用）
  value_norm  text not null,          -- 正規化後的值（比對用：信箱小寫、FB網址走 normFb）
  note        text,                   -- 備註（只有管理者看得到）
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_blacklist_type_norm on blacklist (type, value_norm);
