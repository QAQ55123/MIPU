-- 會員名稱：顯示在賣場名稱用（匯出賣貨便的「規格」、滑鼠移到會員圖示時顯示的名字）
-- 不能和其他會員重複，大小寫視為相同（例如已有 Abc，別人就不能取 abc）
alter table members add column if not exists display_name text;
create unique index if not exists idx_members_display_name on members (lower(display_name)) where display_name is not null;
