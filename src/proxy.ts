import { NextRequest, NextResponse } from "next/server";
export function proxy(req: NextRequest) {
  try {
    const host = new URL("http://" + req.headers.get("host")).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
      return NextResponse.json(
        { error: "此版本仅支持本机访问" },
        { status: 403 },
      );
    }
    const origin = req.headers.get("origin");
    if (
      (origin && new URL(origin).host !== req.headers.get("host")) ||
      req.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return NextResponse.json({ error: "不允许跨站请求" }, { status: 403 });
    }
    return NextResponse.next();
  } catch {
    return NextResponse.json({ error: "无效的请求来源" }, { status: 403 });
  }
}
export const config = { matcher: "/api/:path*" };
