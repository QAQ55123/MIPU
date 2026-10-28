-- 商品可以標記運送方式（空運／海運），成本計算要分開算運費
-- 在 Supabase SQL Editor 執行一次即可

alter table products add column if not exists shipping_method text;
comment on column products.shipping_method is '空運 / 海運 / 留空（不分運送方式，沿用單一運費計算）';
