import { NextRequest, NextResponse } from "next/server";
import { authorize } from "./lib/access";
export function proxy(req: NextRequest) {
  try {
    if (req.nextUrl.pathname === "/api/cron/worker") return NextResponse.next();
    return authorize(req) || NextResponse.next();
  } catch {
    return NextResponse.json({ error: "无效的请求来源" }, { status: 403 });
  }
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg).*)"],
};
