-- 米舖訂購系統 — Supabase (PostgreSQL) schema
-- 在 Supabase 專案的 SQL Editor 貼上並執行一次即可建好所有資料表。

create extension if not exists "pgcrypto";

-- 管理者（後台帳號，跟 members 完全分開，互不影響）
-- role: 'owner'（最高權限，能碰會員相關工具）／'staff'（一般管理者，不能碰會員資料）
create table if not exists admins (
  id                    uuid primary key default gen_random_uuid(),
  username              text not null unique,
  email                 text unique,
  email_verified         boolean not null default false,
  password_hash         text not null,
  role                  text not null default 'staff' check (role in ('owner', 'staff')),
  verify_token          text,
  verify_token_expires  timestamptz,
  reset_token           text,
  reset_token_expires   timestamptz,
  created_at            timestamptz default now()
);

-- 分類（兩層：分類 > 子分類。子分類的 parent_id 指向上層分類；頂層分類 parent_id 為 null）
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  parent_id     uuid references categories(id) on delete cascade,
  sort_order    int default 0,
  created_at    timestamptz default now()
);
create index if not exists idx_categories_parent on categories (parent_id);

-- 企劃（原本「企劃清單」分頁）
create table if not exists plans (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,               -- 企劃名稱
  deadline      timestamptz,                 -- 截止時間（null = 不限期）
  image_url     text,                        -- 企劃圖片
  cod_limit     numeric default 0,           -- 取付上限（0 或負數 = 不開放取付）
  visible_to    text[] default '{}',         -- 顯示對象，例如 {LINE,DC}；空陣列 = 全部看得到
  category_id   uuid references categories(id) on delete set null,  -- 歸屬的分類或子分類（可為任一層）
  sort_order    int default 0,
  created_at    timestamptz default now()
);
create index if not exists idx_plans_category on plans (category_id);

-- 商品（原本每個企劃分頁裡的價目表）
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references plans(id) on delete cascade,
  name          text not null,
  style         text default '',
  price         numeric not null default 0,
  image_url     text,
  sort_order    int default 0
);

-- 會員（原本「會員資料」分頁，一人一筆，FB 網址正規化後當主鍵）
create table if not exists members (
  id            uuid primary key default gen_random_uuid(),
  fb_url        text not null,               -- 原始 FB 網址
  fb_url_norm   text not null unique,        -- 正規化後的 FB 網址（用來比對是否同一人）
  line_nick     text,
  discord_nick  text,
  fb_nick       text,                        -- FB 前台顯示用名字
  email         text,                        -- 選填，用來忘記密碼時找回帳號、或聯繫不上時使用
  password_hash text not null,               -- SHA-256(fb_url_norm|password|salt)
  reset_token          text,
  reset_token_expires  timestamptz,
  created_at    timestamptz default now()
);
create index if not exists idx_members_line_nick on members (lower(line_nick));
create index if not exists idx_members_discord_nick on members (lower(discord_nick));
create unique index if not exists idx_members_email on members (lower(email)) where email is not null;

-- 訂單（一張訂單一筆，品項另外存 order_items）
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  order_no      text not null unique,
  plan_id       uuid not null references plans(id) on delete cascade,
  source        text not null,               -- LINE / Discord / FB
  nickname      text not null,
  fb_url        text not null,
  fb_url_norm   text not null,
  payment       text not null,               -- 匯款 / 取付
  paid_status   text default '',             -- 空 / 已付款 等
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_orders_plan on orders (plan_id);
create index if not exists idx_orders_fb_norm on orders (fb_url_norm);

create table if not exists order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  product_name  text not null,
  style         text default '',
  qty           int not null,
  unit_price    numeric not null,
  subtotal      numeric not null
);
create index if not exists idx_order_items_order on order_items (order_id);

-- 疑似重複會員（後台工具用，對應原本的「疑似重複」分頁）
create table if not exists suspected_duplicates (
  id            uuid primary key default gen_random_uuid(),
  nickname      text not null,
  member_id_1   uuid references members(id),
  member_id_2   uuid references members(id),
  detected_at   timestamptz default now()
);

-- updated_at 自動更新
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- 商品圖片儲存空間（公開讀取，只有後台用 service role 金鑰才能上傳）
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
