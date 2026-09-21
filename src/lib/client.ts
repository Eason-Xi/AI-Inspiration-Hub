export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "操作失败，请重试");
  return data;
}
export const send = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});
