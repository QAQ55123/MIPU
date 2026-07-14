import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;


export async function GET(req: Request) {
  try {
    const session = requireAdminSession(req);
    return NextResponse.json({ loggedIn: true, username: session.username, role: session.role });
  } catch {
    return NextResponse.json({ loggedIn: false });
  }
}
