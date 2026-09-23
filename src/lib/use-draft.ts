"use client";
import { useEffect, useRef, useState } from "react";
type Draft = {
  text: string;
  image: string | null;
  url: string;
  showUrl: boolean;
};
const empty: Draft = { text: "", image: null, url: "", showUrl: false };
export function useDraft(scope: string) {
  const key = "inspiration-hub:draft:v1:" + (scope || "inbox");
  const [draft, setDraft] = useState<Draft>(empty);
  const latest = useRef<Draft>(empty);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        if (
          typeof value.text !== "string" ||
          typeof value.url !== "string" ||
          typeof value.showUrl !== "boolean" ||
          !(
            value.image === null ||
            (typeof value.image === "string" &&
              /^\/api\/files\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(
                value.image,
              ))
          )
        )
          throw new Error("invalid draft");
        latest.current = value;
        setDraft(value);
      }
    } catch {
      setWarning("无法读取浏览器草稿，请及时保存想法");
    }
    setReady(true);
  }, [key]);
  function update(changes: Partial<Draft>) {
    const next = { ...latest.current, ...changes };
    latest.current = next;
    setDraft(next);
    try {
      if (!next.text && !next.image && !next.url && !next.showUrl)
        localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
      setWarning("");
    } catch {
      setWarning("浏览器草稿保存失败，请及时保存想法，避免关闭页面后丢失");
    }
  }
  return { draft, update, clear: () => update(empty), ready, warning };
}
