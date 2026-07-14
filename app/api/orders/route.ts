import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { genOrderNo, normFb, fmtMoney, getMode } from "@/lib/util";
import { notifyDiscord } from "@/lib/discord";

/** 新增訂單 */
export async function POST(req: Request) {
  const body = await req.json();
  const {
    planId,
    items, // [{ name, style, qty }]
    source, // MAIN: 'LINE'|'Discord'；FB 模式固定為 'FB'
    nickname,
    payment, // '匯款' | '取付'
    fbUrl,
  } = body;

  const mode = getMode();
  const supabase = getSupabaseAdmin();

  if (!planId) return NextResponse.json({ error: "缺少企劃" }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "請至少選擇一項商品的數量" }, { status: 400 });
  }

  let finalSource = String(source || "").trim();
  let finalFbUrl = String(fbUrl || "").trim();
  const finalNickname = String(nickname || "").trim();

  if (mode === "FB") {
    finalSource = "FB";
    if (!finalNickname) return NextResponse.json({ error: "請先填寫你的 FB 名字" }, { status: 400 });
    if (payment !== "匯款") return NextResponse.json({ error: "此前台僅接受匯款" }, { status: 400 });
    if (!finalFbUrl) return NextResponse.json({ error: "請貼上你的 FB 個人連結" }, { status: 400 });
    if (!/^https?:\/\//i.test(finalFbUrl)) finalFbUrl = "https://" + finalFbUrl;
  } else {
    if (!["LINE", "Discord"].includes(finalSource)) {
      return NextResponse.json({ error: "請先選擇來源（LINE / Discord）" }, { status: 400 });
    }
    if (!finalNickname) return NextResponse.json({ error: "請先填寫暱稱" }, { status: 400 });
    if (!["匯款", "取付"].includes(payment)) {
      return NextResponse.json({ error: "請先選擇交易方式（匯款 / 取付）" }, { status: 400 });
    }
    const nickCol = finalSource === "LINE" ? "line_nick" : "discord_nick";
    const { data: member } = await supabase.from("members").select("*").ilike(nickCol, finalNickname).maybeSingle();
    if (!member) {
      return NextResponse.json({ error: "找不到你的會員資料，請先完成第一次的 FB 個人網址登記。" }, { status: 400 });
    }
    finalFbUrl = member.fb_url;
  }
  const fbNorm = normFb(finalFbUrl);

  // 企劃 / 截止時間 / 取付上限
  const { data: plan, error: planErr } = await supabase.from("plans").select("*").eq("id", planId).single();
  if (planErr || !plan) return NextResponse.json({ error: "找不到企劃" }, { status: 404 });
  if (plan.deadline && new Date(plan.deadline).getTime() < Date.now()) {
    return NextResponse.json({ error: `此企劃已截止，無法新增訂單。` }, { status: 400 });
  }

  // 價目表對照（避免前端竄改價格）
  const { data: products } = await supabase.from("products").select("*").eq("plan_id", planId);
  const priceMap: Record<string, number> = {};
  (products || []).forEach((p) => { priceMap[`${p.name}||${p.style || ""}`] = Number(p.price); });

  let orderTotal = 0;
  const rows: { name: string; style: string; qty: number; unit: number; subtotal: number }[] = [];
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;
    const style = it.style || "";
    const unit = priceMap[`${it.name}||${style}`] ?? 0;
    const subtotal = qty * unit;
    orderTotal += subtotal;
    rows.push({ name: it.name, style, qty, unit, subtotal });
  }
  if (rows.length === 0) return NextResponse.json({ error: "請至少選擇一項商品的數量" }, { status: 400 });

  if (payment === "取付") {
    const codLimit = Number(plan.cod_limit) || 0;
    if (codLimit <= 0) return NextResponse.json({ error: "此企劃不提供取付，請改用匯款。" }, { status: 400 });
    if (orderTotal > codLimit) {
      return NextResponse.json(
        { error: `取付金額 NT$ ${fmtMoney(orderTotal)} 超過取付上限 NT$ ${fmtMoney(codLimit)}，請改用匯款或減少數量。` },
        { status: 400 }
      );
    }
  }

  const orderNo = genOrderNo();
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      order_no: orderNo,
      plan_id: planId,
      source: finalSource,
      nickname: finalNickname,
      fb_url: finalFbUrl,
      fb_url_norm: fbNorm,
      payment,
    })
    .select()
    .single();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });

  const itemRows = rows.map((r) => ({
    order_id: order.id,
    product_name: r.name,
    style: r.style,
    qty: r.qty,
    unit_price: r.unit,
    subtotal: r.subtotal,
  }));
  const { error: itemsErr } = await supabase.from("order_items").insert(itemRows);
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  // FB 前台：補進會員資料
  if (mode === "FB") {
    const { data: existing } = await supabase.from("members").select("*").eq("fb_url_norm", fbNorm).maybeSingle();
    if (!existing) {
      await supabase.from("members").insert({ fb_url: finalFbUrl, fb_url_norm: fbNorm, fb_nick: finalNickname, password_hash: "" });
    } else if (existing.fb_nick !== finalNickname) {
      await supabase.from("members").update({ fb_nick: finalNickname }).eq("id", existing.id);
    }
  }

  const lines = rows.map((r) => `• ${r.name}${r.style ? `（${r.style}）` : ""} x${r.qty} = NT$ ${fmtMoney(r.subtotal)}`).join("\n");
  notifyDiscord({
    username: "訂購通知",
    embeds: [
      {
        title: "🛒 有人喊單了！",
        color: 3447003,
        fields: [
          { name: "訂單編號", value: orderNo, inline: true },
          { name: "交易方式", value: payment, inline: true },
          { name: "來源", value: finalSource, inline: true },
          { name: "暱稱", value: finalNickname, inline: true },
          { name: "企劃", value: plan.name, inline: true },
          { name: "金額", value: `NT$ ${fmtMoney(orderTotal)}`, inline: true },
          { name: "FB", value: finalFbUrl },
          { name: "品項", value: lines || "(無)" },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  });

  return NextResponse.json({ ok: true, orderNo, count: rows.length, total: orderTotal });
}

/** 查詢歷史訂單：?fbUrl=... 或 ?nickname=...&source=... */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fbUrl = searchParams.get("fbUrl");
  const nickname = searchParams.get("nickname");
  const source = searchParams.get("source");

  const supabase = getSupabaseAdmin();
  let fbNorm = "";

  if (fbUrl) {
    fbNorm = normFb(fbUrl);
  } else if (nickname && source) {
    const nickCol = source === "LINE" ? "line_nick" : source === "Discord" ? "discord_nick" : "fb_nick";
    const { data: member } = await supabase.from("members").select("*").ilike(nickCol, nickname).maybeSingle();
    if (!member) return NextResponse.json({ orders: [] });
    fbNorm = member.fb_url_norm;
  } else {
    return NextResponse.json({ error: "請提供 fbUrl 或 nickname+source" }, { status: 400 });
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select("*, plans(name, image_url), order_items(*)")
    .eq("fb_url_norm", fbNorm)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    orders: (orders || []).map((o: any) => ({
      orderNo: o.order_no,
      planName: o.plans?.name,
      planImage: o.plans?.image_url,
      source: o.source,
      nickname: o.nickname,
      payment: o.payment,
      paidStatus: o.paid_status,
      createdAt: o.created_at,
      items: (o.order_items || []).map((it: any) => ({
        name: it.product_name,
        style: it.style,
        qty: it.qty,
        unitPrice: Number(it.unit_price),
        subtotal: Number(it.subtotal),
      })),
      total: (o.order_items || []).reduce((s: number, it: any) => s + Number(it.subtotal), 0),
    })),
  });
}
