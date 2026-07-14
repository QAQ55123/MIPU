import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = getSupabaseAdmin();

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("*")
    .eq("id", params.id)
    .single();
  if (planErr || !plan) return NextResponse.json({ error: "找不到企劃" }, { status: 404 });

  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, name, style, price, image_url")
    .eq("plan_id", params.id)
    .order("sort_order", { ascending: true });
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  const closed = plan.deadline ? new Date(plan.deadline).getTime() < Date.now() : false;

  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      imageUrl: plan.image_url,
      codLimit: plan.cod_limit || 0,
      deadline: plan.deadline,
      closed,
    },
    products: (products || []).map((p) => ({
      id: p.id,
      name: p.name,
      style: p.style || "",
      price: Number(p.price),
      imageUrl: p.image_url,
    })),
  });
}
