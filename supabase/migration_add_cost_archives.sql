-- 徹底刪除企劃時，把成本表總覽那一列的數字「凍結」存起來，
-- 讓成本試算表的「總覽」在企劃刪除後仍保留這一列（標示「已封存」），合計不會因為刪除而改變。
create table if not exists cost_archives (
  id uuid primary key default gen_random_uuid(),
  plan_name text not null,
  archive_tab text not null,          -- 封存試算表裡對應的分頁名稱
  income numeric not null default 0,  -- 銷售(收入)
  cost numeric not null default 0,    -- 進貨成本
  profit numeric not null default 0,  -- 淨利潤
  paid numeric not null default 0,    -- 已收款金額
  owing numeric not null default 0,   -- 未收款金額
  archived_at timestamptz not null default now()
);

alter table cost_archives enable row level security;
