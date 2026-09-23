"use client";
import { useState } from "react";
import { Database, Download, LoaderCircle, Upload } from "lucide-react";
import { api } from "@/lib/client";
import type { BackupPreview } from "@/lib/backup";
import { stageFile } from "@/lib/transfers";

export default function BackupPanel({
  notify,
  reload,
}: {
  notify: (s: string) => void;
  reload: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [staged, setStaged] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function download() {
    setBusy("download");
    setError("");
    try {
      const response = await fetch("/api/backup");
      if (!response.ok)
        throw new Error((await response.json()).error || "备份失败");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `inspiration-hub-full-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("完整备份已生成");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function inspect(selected: File) {
    setStaged(null);
    setFile(selected);
    setPreview(null);
    setError("");
    if (selected.size > 32 * 1024 * 1024) {
      setError("备份不能超过 32 MB");
      return;
    }
    setBusy("preview");
    try {
      const key = await stageFile(selected, "backup");
      setStaged(key);
      setPreview(
        await api<BackupPreview>("/api/backup", {
          method: "POST",
          body: key ? JSON.stringify({ key }) : selected,
          headers: { "Content-Type": "application/json" },
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function restore() {
    if (!file || !preview) return;
    setBusy("restore");
    setError("");
    try {
      const result = await api<BackupPreview>("/api/backup", {
        method: "POST",
        body: staged ? JSON.stringify({ key: staged }) : file,
        headers: {
          "Content-Type": "application/json",
          "X-Backup-Preview": preview.token,
        },
      });
      setPreview(null);
      setFile(null);
      setStaged(null);
      reload();
      notify(
        `恢复完成：新增 ${result.newNodes} 条记录、${result.newProjects} 个项目，跳过 ${result.skippedNodes} 条已有记录`,
      );
    } catch (error) {
      setError((error as Error).message);
      setPreview(null);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <span className="icon-tile teal">
          <Database size={21} />
        </span>
        <div>
          <h2>备份与恢复</h2>
          <p>把记录、项目、AI 结果与图片一起带走。</p>
        </div>
      </div>
      <p className="settings-description">
        完整备份包含已保存的数据，不包含 API Key、浏览器草稿和 AI
        任务。恢复时合并新增内容，相同 ID
        的记录与项目保持现状并跳过；不会自动调用 AI。
      </p>
      <div className="button-row">
        <button className="primary" onClick={download} disabled={!!busy}>
          {busy === "download" ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Download size={16} />
          )}
          完整备份（含图片）
        </button>
        <a className="secondary" href="/api/export" download>
          导出文字（JSON）
        </a>
      </div>
      <div className="backup-import">
        <label>
          选择完整备份文件
          <input
            aria-label="选择完整备份文件"
            type="file"
            accept="application/json,.json"
            disabled={!!busy}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (selected) void inspect(selected);
            }}
          />
        </label>
        <p className="settings-help">
          先预览，再确认导入。支持本应用版本 2 完整备份，最大 32 MB、5,000
          条记录，图片总量 20 MB；更大的资料库请使用数据库和存储服务备份。
        </p>
        {busy === "preview" && <p role="status">正在检查备份…</p>}
        {error && (
          <p role="alert" className="connection-result failure">
            {error}
          </p>
        )}
        {preview && (
          <div className="backup-preview" role="region" aria-label="恢复预览">
            <h3>恢复预览</h3>
            <p>
              {file?.name} ·{" "}
              {new Date(preview.exportedAt).toLocaleString("zh-CN")}
            </p>
            <p>
              备份包含 {preview.nodes} 条记录、{preview.projects} 个项目、
              {preview.images} 张图片。
            </p>
            <p>
              <strong>
                新增 {preview.newNodes} 条记录、{preview.newProjects} 个项目
              </strong>
            </p>
            <p>
              跳过 {preview.skippedNodes} 条已有记录、{preview.skippedProjects}{" "}
              个已有项目。
            </p>
            <p className="settings-help">
              已有内容不会被覆盖，包括备份中的旧版本。新增记录关联到同 ID
              的现有项目或父记录；仅复制新增记录使用的图片。
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={!!busy || (!preview.newNodes && !preview.newProjects)}
                onClick={restore}
              >
                {busy === "restore" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Upload size={16} />
                )}
                确认合并导入
              </button>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
