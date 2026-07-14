import { NextResponse } from "next/server";
import { getMode } from "@/lib/util";

export async function GET() {
  return NextResponse.json({ mode: getMode() });
}
