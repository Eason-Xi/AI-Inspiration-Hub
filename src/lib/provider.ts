import type { Credentials } from "./settings";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}
export async function chatJson(
  config: Credentials,
  messages: unknown[],
  timeoutMs = 90000,
): Promise<unknown> {
  if (!config.apiKey) throw new ProviderError("请先在设置中连接 AI 模型");
  let response: Response;
  try {
    response = await fetch(
      config.baseUrl.replace(/\/+$/, "") + "/chat/completions",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (e) {
    throw new ProviderError(
      e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name)
        ? "模型响应超时"
        : "无法连接模型服务，请检查 API 地址和网络",
      true,
    );
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: "模型不支持当前请求，请检查模型名称、JSON 模式或图片能力",
      401: "API Key 无效，请检查 AI 设置",
      403: "该密钥没有访问此模型的权限",
      404: "模型或接口不存在，请检查 API 地址和模型名称",
      408: "模型响应超时",
      429: "模型服务限流或额度不足",
    };
    throw new ProviderError(
      messages[response.status] || `模型服务暂时不可用（${response.status}）`,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
    );
  }
  try {
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("empty");
    return JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new ProviderError("模型响应超时", true);
    if (error instanceof TypeError)
      throw new ProviderError("模型响应传输中断，请稍后重试", true);
    throw new ProviderError(
      "模型未返回有效的 JSON，请检查模型是否支持 JSON 模式",
    );
  }
}
export async function testConnection(config: Credentials) {
  const start = Date.now();
  const result = await chatJson(
    config,
    [
      {
        role: "system",
        content:
          'This is a connection test. Return only the JSON object {"ok":true}.',
      },
      {
        role: "user",
        content: "Please return the JSON connection test result.",
      },
    ],
    20000,
  );
  if (
    !result ||
    typeof result !== "object" ||
    !("ok" in result) ||
    result.ok !== true
  )
    throw new ProviderError("模型已响应，但未通过 JSON 输出检查");
  return { ok: true, model: config.model, latencyMs: Date.now() - start };
}
