-- 商品（款式）可以設定限量，留空＝不限量
-- 在 Supabase SQL Editor 執行一次即可

alter table products add column if not exists stock_limit integer;
