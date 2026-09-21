import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
export function isPublicAddress(ip: string) {
  if (ip.includes(":")) return false;
  const p = ip.split(".").map(Number);
  return (
    p.length === 4 &&
    p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) &&
    ![0, 10, 127].includes(p[0]) &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && p[1] === 168) &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    !(p[0] === 198 && [18, 19].includes(p[1])) &&
    p[0] < 224
  );
}
async function readPage(raw: string, redirects = 0): Promise<string> {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("不支持此网址");
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("仅解析公开网页");
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        signal: AbortSignal.timeout(8000),
        lookup: (_host, _opts, cb) => cb(null, addresses),
        headers: { "User-Agent": "InspirationHub/0.1", Accept: "text/html" },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirects >= 3) return reject(new Error("重定向次数过多"));
          readPage(new URL(res.headers.location, url).href, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (
          res.statusCode !== 200 ||
          !res.headers["content-type"]?.includes("text/html")
        ) {
          res.resume();
          reject(new Error("无法读取页面"));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1500000) req.destroy(new Error("网页过大"));
        });
        res.on("end", () => resolve(body));
        res.on("error", reject);
      },
    );
    req.setTimeout(6000, () => req.destroy(new Error("网页读取超时")));
    req.on("error", reject);
  });
}
export async function linkMetadata(url: string) {
  const html = await readPage(url);
  const clean = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  const title = clean(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
  ).slice(0, 300);
  let description = "";
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (
      /(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(
        tag,
      )
    ) {
      description = clean(
        tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || "",
      ).slice(0, 1500);
      break;
    }
  }
  return {
    linkTitle: title || new URL(url).hostname,
    linkDescription: description || null,
  };
}
