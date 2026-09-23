import { api, send } from "./client";

export async function stageFile(file: File, kind: "image" | "backup") {
  const ticket = await api<{
    mode: "local" | "supabase";
    key?: string;
    signedUrl?: string;
  }>("/api/storage", send("POST", { kind, size: file.size }));
  if (ticket.mode === "local") return null;
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  const response = await fetch(ticket.signedUrl!, {
    method: "PUT",
    body,
    credentials: "omit",
  });
  if (!response.ok) throw new Error("云端文件上传失败，请重试");
  return ticket.key!;
}
export async function uploadImage(file: File) {
  const key = await stageFile(file, "image");
  if (key) return api<{ url: string }>("/api/upload", send("POST", { key }));
  const form = new FormData();
  form.append("file", file);
  return api<{ url: string }>("/api/upload", { method: "POST", body: form });
}
