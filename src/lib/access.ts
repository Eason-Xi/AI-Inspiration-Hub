import { createHash, timingSafeEqual } from "node:crypto";
import { cloudStorage } from "./environment";

function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function authorize(request: Request): Response | null {
  let host: URL;
  try {
    host = new URL(
      "http://" + (request.headers.get("host") || new URL(request.url).host),
    );
  } catch {
    return Response.json({ error: "无效的请求来源" }, { status: 403 });
  }
  const password = process.env.APP_PASSWORD || "";
  const protectedMode = cloudStorage() || !!process.env.VERCEL || !!password;
  if (protectedMode && password.length < 24)
    return Response.json(
      { error: "请先配置至少 24 个字符的 APP_PASSWORD" },
      { status: 503 },
    );
  if (!protectedMode) {
    const hostname = host.hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
      return Response.json(
        { error: "远程访问需要配置访问密码" },
        { status: 403 },
      );
  } else {
    const auth = request.headers.get("authorization") || "";
    let supplied = "";
    if (auth.startsWith("Basic ") && auth.length < 2048) {
      try {
        supplied = Buffer.from(auth.slice(6), "base64").toString("utf8");
      } catch {
        /* invalid credentials */
      }
    }
    if (!equal(supplied, `${process.env.APP_USERNAME || "owner"}:${password}`))
      return new Response("请输入灵感库访问凭据", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Inspiration Hub", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      });
  }
  if (new URL(request.url).pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    let sameOrigin = !origin;
    try {
      if (origin) sameOrigin = new URL(origin).host === host.host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site")
      return Response.json({ error: "不允许跨站请求" }, { status: 403 });
  }
  return null;
}
