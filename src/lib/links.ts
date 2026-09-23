import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
    !(p[0] === 192 && p[1] === 0 && p[2] === 0) &&
    !(p[0] === 192 && p[1] === 0 && p[2] === 2) &&
    !(p[0] === 192 && p[1] === 88 && p[2] === 99) &&
    !(p[0] === 198 && [18, 19].includes(p[1])) &&
    !(p[0] === 198 && p[1] === 51 && p[2] === 100) &&
    !(p[0] === 203 && p[1] === 0 && p[2] === 113) &&
    p[0] < 224
  );
}

function remoteUrl(raw: string) {
  const url = new URL(raw);
  if (
    raw.length > 2048 ||
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("不支持此网址");
  if (
    url.hostname.includes(":") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    (isIP(url.hostname) === 4 && !isPublicAddress(url.hostname))
  )
    throw new Error("仅解析公开网页");
  return url;
}

function isFakeProxyAddress(ip: string) {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts[0] === 198 && [18, 19].includes(parts[1]);
}

async function publicDnsAddresses(hostname: string) {
  // Some local proxies map every external hostname into 198.18.0.0/15.
  // Ask a public resolver and pin the connection to its verified public IPs.
  const endpoint = new URL("https://dns.google/resolve");
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", "A");
  return new Promise<{ address: string; family: 4 }[]>((resolve, reject) => {
    const req = https.get(
      endpoint,
      { signal: AbortSignal.timeout(5000) },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("无法验证公网地址"));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 16000) req.destroy(new Error("DNS 响应过大"));
        });
        res.on("end", () => {
          try {
            const result = JSON.parse(body) as {
              Status: number;
              Answer?: { type: number; data: string }[];
            };
            const addresses = (result.Answer || [])
              .filter((answer) => answer.type === 1)
              .map((answer) => ({ address: answer.data, family: 4 as const }));
            if (
              result.Status !== 0 ||
              !addresses.length ||
              addresses.some((address) => !isPublicAddress(address.address))
            )
              throw new Error("仅解析公开网页");
            resolve(addresses);
          } catch (error) {
            reject(error);
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
  });
}

async function readResource(
  raw: string,
  kind: "page" | "image",
  redirects = 0,
): Promise<{ body: Buffer; url: string; contentType: string }> {
  const url = remoteUrl(raw);
  let addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (
    addresses.length &&
    addresses.every((address) => isFakeProxyAddress(address.address))
  )
    addresses = await publicDnsAddresses(url.hostname);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("仅解析公开网页");
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        signal: AbortSignal.timeout(8000),
        lookup: (_host, _opts, cb) => cb(null, addresses),
        headers: {
          "User-Agent": "InspirationHub/0.1",
          Accept:
            kind === "page"
              ? "text/html"
              : "image/avif,image/webp,image/png,image/jpeg,image/gif",
          "Accept-Encoding": "identity",
        },
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
          readResource(
            new URL(res.headers.location, url).href,
            kind,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        const contentType = String(res.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const allowed =
          kind === "page"
            ? contentType === "text/html"
            : [
                "image/png",
                "image/jpeg",
                "image/webp",
                "image/gif",
                "image/avif",
              ].includes(contentType);
        if (res.statusCode !== 200 || !allowed) {
          res.resume();
          reject(new Error("无法读取页面"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const limit = kind === "page" ? 1_500_000 : 3_000_000;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) req.destroy(new Error("资源过大"));
          else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ body: Buffer.concat(chunks), url: url.href, contentType }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(6000, () => req.destroy(new Error("网页读取超时")));
    req.on("error", reject);
  });
}

function decode(text: string) {
  return text.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|amp|quot|apos|lt|gt|nbsp);/gi,
    (_, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
      };
      if (!entity.startsWith("#")) return named[entity.toLowerCase()] || "";
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    },
  );
}

function attributes(tag: string) {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  ))
    found.set(match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4]));
  return found;
}

export function parseLinkMetadata(html: string, pageUrl: string) {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (
      attrs.get("property") ||
      attrs.get("name") ||
      ""
    ).toLowerCase();
    if (key && attrs.has("content") && !meta.has(key))
      meta.set(key, attrs.get("content")!);
  }
  const plain = (value: string) => decode(value.replace(/<[^>]*>/g, "")).trim();
  const title = plain(
    meta.get("og:title") ||
      meta.get("twitter:title") ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      "",
  ).slice(0, 300);
  const description = plain(
    meta.get("og:description") ||
      meta.get("twitter:description") ||
      meta.get("description") ||
      "",
  ).slice(0, 1500);
  let linkImage: string | null = null;
  const rawImage =
    meta.get("og:image:secure_url") ||
    meta.get("og:image") ||
    meta.get("twitter:image");
  if (rawImage) {
    try {
      linkImage = remoteUrl(new URL(rawImage, pageUrl).href).href;
    } catch {
      /* Invalid image metadata should not hide the text preview. */
    }
  }
  return {
    linkTitle: title || new URL(pageUrl).hostname,
    linkDescription: description || null,
    linkImage,
  };
}

export async function linkMetadata(url: string) {
  const page = await readResource(url, "page");
  return parseLinkMetadata(page.body.toString("utf8"), page.url);
}

export async function linkImage(url: string) {
  return readResource(url, "image");
}
