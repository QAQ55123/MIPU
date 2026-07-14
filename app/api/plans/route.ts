import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getMode } from "@/lib/util";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const mode = getMode();
  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");
  const q = (searchParams.get("q") || "").trim();

  let query = supabase
    .from("plans")
    .select("id, name, deadline, image_url, cod_limit, visible_to, sort_order, category_id, categories(id, name, parent_id)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  // 分類篩選：選到上層分類時，要包含它底下所有子分類的企劃
  if (categoryId) {
    const { data: allCats } = await supabase.from("categories").select("id, parent_id");
    const ids = [categoryId];
    (allCats || []).forEach((c) => {
      if (c.parent_id === categoryId) ids.push(c.id);
    });
    query = query.in("category_id", ids);
  }

  // 搜尋：企劃名稱符合，或底下有商品名稱符合
  let matchPlanIdsFromProducts: string[] | null = null;
  if (q) {
    const { data: matchedProducts } = await supabase
      .from("products")
      .select("plan_id")
      .ilike("name", `%${q}%`);
    matchPlanIdsFromProducts = [...new Set((matchedProducts || []).map((p) => p.plan_id))];
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data || [];

  // 如果有搜尋，額外把「商品名稱符合、但企劃名稱不符合」的企劃也撈回來
  if (q && matchPlanIdsFromProducts && matchPlanIdsFromProducts.length > 0) {
    const existingIds = new Set(rows.map((r) => r.id));
    const missingIds = matchPlanIdsFromProducts.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      const { data: extra } = await supabase
        .from("plans")
        .select("id, name, deadline, image_url, cod_limit, visible_to, sort_order, category_id, categories(id, name, parent_id)")
        .in("id", missingIds);
      rows = rows.concat(extra || []);
    }
  }

  const now = Date.now();
  const plans = rows
    .filter((p: any) => {
      if (mode === "FB") {
        return !p.visible_to || p.visible_to.length === 0 || p.visible_to.includes("FB");
      }
      return true;
    })
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.image_url,
      codLimit: p.cod_limit || 0,
      deadline: p.deadline,
      closed: p.deadline ? new Date(p.deadline).getTime() < now : false,
      categoryId: p.category_id,
      categoryName: p.categories?.name || null,
      categoryParentId: p.categories?.parent_id || null,
    }));

  return NextResponse.json({ plans }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
