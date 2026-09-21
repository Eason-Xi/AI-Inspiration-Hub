"use client";
import { useState } from "react";
import {
  CheckCircle2,
  Database,
  Download,
  KeyRound,
  LoaderCircle,
  Save,
  Sparkles,
} from "lucide-react";
import { api, send } from "@/lib/client";
import type { Settings } from "@/lib/types";
export default function SettingsPanel({
  settings,
  notify,
  reload,
}: {
  settings?: Settings;
  notify: (s: string) => void;
  reload: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(
    settings?.baseUrl || "https://api.openai.com/v1",
  );
  const [model, setModel] = useState(settings?.model || "gpt-4.1-mini");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="icon-tile">
            <Sparkles size={21} />
          </span>
          <div>
            <h2>AI 模型连接</h2>
            <p>使用兼容 OpenAI Chat Completions 的模型服务。</p>
          </div>
          <span
            className={
              "connection-status " + (settings?.configured ? "connected" : "")
            }
          >
            {settings?.configured ? (
              <>
                <CheckCircle2 size={14} />
                已配置
              </>
            ) : (
              "未连接"
            )}
          </span>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(
                "/api/settings",
                send("PUT", { baseUrl, model, apiKey: key || undefined }),
              );
              setKey("");
              reload();
              notify("AI 设置已保存，打开一条记录即可开始发散");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            API 地址
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required
              placeholder="https://api.openai.com/v1"
            />
            <small>填写服务的基础地址，通常以 /v1 结尾。</small>
          </label>
          <div className="settings-fields">
            <label>
              模型名称
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
                placeholder="gpt-4.1-mini"
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  settings?.configured
                    ? "已保存；留空保持原密钥"
                    : "输入你的 API Key"
                }
                required={!settings?.configured}
              />
            </label>
          </div>
          <div className="security-note">
            <KeyRound size={16} />
            <p>
              密钥仅保存于本机服务端，不会返回浏览器。启用后，记录内容和图片会发送至你配置的模型服务。
            </p>
          </div>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Save size={16} />
            )}
            保存 AI 设置
          </button>
        </form>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading">
          <span className="icon-tile teal">
            <Database size={21} />
          </span>
          <div>
            <h2>你的数据，留在你这里</h2>
            <p>记录、项目与图片保存在本机 data 目录。</p>
          </div>
        </div>
        <p className="settings-description">
          当前版本适合个人本地使用。备份整个 data
          文件夹，可以保留数据库、图片与模型设置。导出的 JSON 包含文字、项目和
          AI 结果，不包含图片文件与 API Key。
        </p>
        <a className="secondary" href="/api/export" download>
          <Download size={16} />
          导出全部记录（JSON）
        </a>
      </section>
      <section className="scope-note">
        <h3>关于这个 MVP</h3>
        <p>
          专注记录、整理与 AI
          发散。语义搜索、知识图谱、自动回顾和多设备同步将留给后续版本。
        </p>
      </section>
    </div>
  );
}
