"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  GitBranch,
  Lightbulb,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Idea, Project, Settings, Expansion, AiTask } from "@/lib/types";
import { statuses } from "@/lib/types";
import { api, send } from "@/lib/client";
type Detail = {
  node: Idea;
  children: Idea[];
  parent: Idea | null;
  task: AiTask | null;
};
export default function NodeDetail({
  id,
  projects,
  settings,
  notify,
  reload,
}: {
  id: string;
  projects: Project[];
  settings?: Settings;
  notify: (s: string) => void;
  reload: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [mode, setMode] = useState("默认");
  const [busy, setBusy] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Detail>("/api/nodes/" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    setData(null);
    setEditing(false);
    setPreviewImageFailed(false);
    load();
  }, [load]);
  useEffect(() => {
    if (data?.node.aiState !== "pending") return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [data?.node.aiState, load]);
  useEffect(() => {
    if (confirmDelete) dialog.current?.showModal();
  }, [confirmDelete]);
  async function patch(changes: Partial<Idea>) {
    try {
      await api("/api/nodes/" + id, send("PATCH", changes));
      await load();
      reload();
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  }
  async function expand() {
    setBusy("analyze");
    try {
      await api("/api/nodes/" + id + "/analyze", send("POST", { mode }));
      await load();
      notify("AI 已开始思考，可以继续记录其他想法");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function toggleAction(index: number) {
    if (!data || savingAction) return;
    const before = data.node.completedActions;
    const completedActions = before.includes(index)
      ? before.filter((value) => value !== index)
      : [...before, index];
    setSavingAction(true);
    setData((current) =>
      current?.node.id === id
        ? { ...current, node: { ...current.node, completedActions } }
        : current,
    );
    try {
      if (!(await patch({ completedActions })))
        setData((current) =>
          current?.node.id === id
            ? {
                ...current,
                node: { ...current.node, completedActions: before },
              }
            : current,
        );
    } finally {
      setSavingAction(false);
    }
  }
  async function child(item: Expansion, key: string) {
    setBusy(key);
    try {
      await api<Idea>(
        "/api/nodes",
        send("POST", {
          title: item.title,
          content: item.content,
          parentId: id,
          projectId: data!.node.projectId,
          tags: data!.node.tags,
        }),
      );
      await load();
      reload();
      notify("已保存为子节点");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (error)
    return (
      <div className="empty-state">
        <FileText size={28} />
        <h2>{error}</h2>
        <Link href="/home" className="secondary">
          返回首页
        </Link>
      </div>
    );
  if (!data)
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" />
        正在读取记录…
      </div>
    );
  const { node: n, children, parent, task } = data;
  const analysis = n.analysis;
  const waiting = n.aiState === "pending";
  const taskLabel =
    task?.status === "queued"
      ? "已保存，等待分析"
      : task?.status === "retrying"
        ? "稍后自动重试"
        : "正在分析";
  return (
    <div className="detail-page">
      <Link
        href={n.projectId ? "/project/" + n.projectId : "/all"}
        className="back-link"
      >
        <ArrowLeft size={16} />
        返回{n.projectId ? "项目" : "全部记录"}
      </Link>
      <div className="detail-layout">
        <section className="detail-main">
          <article className="detail-paper">
            <div className="detail-topline">
              <span className="type-label">
                <FileText size={16} />
                {n.type === "image"
                  ? "图片灵感"
                  : n.type === "link"
                    ? "链接收藏"
                    : "文字记录"}
                {n.sample && <span className="sample-label">示例</span>}
              </span>
              <div>
                <button
                  className={"icon-button " + (n.favorite ? "saved" : "")}
                  aria-label={n.favorite ? "取消收藏" : "收藏记录"}
                  onClick={() => patch({ favorite: !n.favorite })}
                >
                  <Bookmark
                    size={18}
                    fill={n.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="icon-button"
                  aria-label="编辑记录"
                  onClick={() => {
                    setEditing(true);
                    setTitle(n.title);
                    setContent(n.content);
                    setTags(n.tags.join("，"));
                  }}
                >
                  <Pencil size={17} />
                </button>
              </div>
            </div>
            {parent && (
              <Link className="parent-link" href={"/node/" + parent.id}>
                <GitBranch size={14} />
                延伸自：{parent.title}
                <ChevronRight size={14} />
              </Link>
            )}
            {editing ? (
              <form
                className="edit-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy("save");
                  if (
                    await patch({
                      title,
                      content,
                      tags: tags
                        .split(/[,，\n]/)
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  )
                    setEditing(false);
                  setBusy("");
                }}
              >
                <label>
                  标题
                  <input
                    aria-label="记录标题"
                    value={title}
                    maxLength={160}
                    required
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  正文
                  <textarea
                    aria-label="记录正文"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </label>
                <label>
                  标签（逗号分隔）
                  <input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button className="primary" disabled={busy === "save"}>
                    <Save size={16} />
                    保存修改
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h1>{n.title}</h1>
                <div className="detail-date">
                  创建于{" "}
                  {new Date(n.createdAt).toLocaleString("zh-CN", {
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div className="markdown">
                  <Markdown>{n.content}</Markdown>
                </div>
              </>
            )}
            {n.image && (
              <a
                href={n.image}
                target="_blank"
                rel="noreferrer"
                className="detail-image"
              >
                <Image
                  src={n.image}
                  alt={n.title}
                  width={1000}
                  height={750}
                  unoptimized
                />
              </a>
            )}
            {n.url && (
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="detail-link"
              >
                {n.linkImage && !previewImageFailed ? (
                  <span className="detail-link-image">
                    <Image
                      src={`/api/nodes/${n.id}/preview-image`}
                      alt=""
                      fill
                      sizes="96px"
                      unoptimized
                      onError={() => setPreviewImageFailed(true)}
                    />
                  </span>
                ) : (
                  <ExternalLink size={19} />
                )}
                <div className="detail-link-copy">
                  <strong>{n.linkTitle || new URL(n.url).hostname}</strong>
                  <span>{n.linkDescription || n.url}</span>
                  {n.linkDescription && (
                    <small>{new URL(n.url).hostname}</small>
                  )}
                </div>
                <ArrowRight size={17} />
              </a>
            )}
            <div className="detail-tags">
              {n.tags.map((t) => (
                <span key={t} className="tag">
                  # {t}
                </span>
              ))}
            </div>
            <div className="node-properties">
              <label>
                所属项目
                <select
                  aria-label="所属项目"
                  value={n.projectId || ""}
                  onChange={(e) => patch({ projectId: e.target.value || null })}
                >
                  <option value="">收件箱 · 暂不分类</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                当前状态
                <select
                  aria-label="当前状态"
                  value={n.status}
                  onChange={(e) =>
                    patch({ status: e.target.value as Idea["status"] })
                  }
                >
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          </article>
          <section className="detail-section">
            <div className="section-title">
              <GitBranch size={19} />
              <h2>延伸的想法</h2>
              <span className="record-count">{children.length}</span>
            </div>
            {children.length ? (
              children.map((c) => (
                <Link href={"/node/" + c.id} key={c.id} className="child-node">
                  <span>
                    <GitBranch size={17} />
                  </span>
                  <div>
                    <strong>{c.title}</strong>
                    <small>{c.content.slice(0, 85)}</small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              ))
            ) : (
              <div className="subtle-empty">
                从右侧选择一个探索方向，保存为新节点。
                <br />
                一个想法，就这样开始生长。
              </div>
            )}
          </section>
          <div className="node-bottom">
            <button
              onClick={() =>
                patch({ status: n.status === "归档" ? "未处理" : "归档" })
              }
            >
              <Archive size={15} />
              {n.status === "归档" ? "恢复记录" : "归档记录"}
            </button>
            <button
              className="danger-text"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={15} />
              删除记录
            </button>
          </div>
        </section>
        <aside className="detail-ai">
          <div className="ai-panel-heading">
            <span>
              <Sparkles size={21} />
            </span>
            <div>
              <h2>一起，再想一步</h2>
              <p>让 AI 成为你的思考伙伴</p>
            </div>
          </div>
          {!settings?.configured ? (
            <div className="ai-setup">
              <Lightbulb size={30} />
              <h3>为这个想法，打开新的方向</h3>
              <p>
                连接一个 AI 模型后，即可生成摘要、关键词、探索方向和下一步行动。
              </p>
              <Link href="/settings" className="primary">
                连接 AI 模型
                <ArrowRight size={16} />
              </Link>
              <small>原始记录已安全保存在本机。</small>
            </div>
          ) : (
            <>
              <div className="ai-controls">
                <select
                  aria-label="AI 发散模式"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  {["默认", "实用", "创意", "反向", "产品"].map((m) => (
                    <option key={m} value={m}>
                      {m}模式
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  disabled={waiting || busy === "analyze"}
                  onClick={expand}
                >
                  {waiting ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {waiting ? taskLabel : analysis ? "重新发散" : "开始发散"}
                </button>
              </div>
              {waiting && (
                <div className="task-progress" role="status">
                  <div>
                    <strong>{taskLabel}</strong>
                    <p>
                      {task?.status === "retrying"
                        ? `${task.error}。将在 ${new Date(task.nextRunAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 重试。`
                        : "可以离开本页，关闭应用后会在下次启动继续处理。"}
                      {task
                        ? ` 已尝试 ${task.attempts}/${task.maxAttempts} 次。`
                        : ""}
                    </p>
                  </div>
                  <button
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy("cancel");
                      try {
                        await api("/api/nodes/" + id + "/analyze", {
                          method: "DELETE",
                        });
                        await load();
                        reload();
                        notify("任务已取消，本次结果不会再写入");
                      } catch (error) {
                        notify((error as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    取消任务
                  </button>
                </div>
              )}
              {n.aiError && (
                <div className="ai-error">
                  {n.aiError}
                  <button disabled={waiting || !!busy} onClick={expand}>
                    重新尝试
                  </button>
                </div>
              )}
              {waiting && !analysis && (
                <div className="ai-working">
                  <Sparkles size={24} className="pulse" />
                  <h3>正在寻找值得探索的方向</h3>
                  <p>保存已经完成，AI 的思考会稍晚到达。</p>
                  <div className="skeleton" />
                  <div className="skeleton short" />
                  <div className="skeleton" />
                </div>
              )}
              {!analysis && !waiting && !n.aiError && (
                <div className="subtle-empty">
                  选择一种发散模式，开始探索这条记录。
                </div>
              )}
            </>
          )}
          {analysis && (
            <>
              <section className="analysis-summary">
                <div className="section-title">
                  <Sparkles size={15} />
                  <h3>AI 理解</h3>
                  <span className="mini-badge">{analysis.category}</span>
                </div>
                <p>{analysis.summary}</p>
              </section>
              <div className="expansions-header">
                <h3>可以继续探索的方向</h3>
                <span>{analysis.expansions.length} 个方向</span>
              </div>
              {analysis.expansions.map((item, i) => {
                const saved = children.some((c) => c.content === item.content);
                return (
                  <article className="expansion" key={i}>
                    <span className="expansion-number">0{i + 1}</span>
                    <h3>{item.title}</h3>
                    <div className="markdown">
                      <Markdown>{item.content}</Markdown>
                    </div>
                    <button
                      className={saved ? "is-saved" : ""}
                      disabled={saved || !!busy}
                      onClick={() => child(item, "expansion-" + i)}
                    >
                      {saved ? <Check size={14} /> : <Plus size={14} />}
                      {saved
                        ? "已保存为子节点"
                        : busy === "expansion-" + i
                          ? "保存中…"
                          : "保存为新节点"}
                    </button>
                  </article>
                );
              })}
              <section className="next-actions">
                <div className="section-title">
                  <Check size={17} />
                  <h3>下一步行动</h3>
                </div>
                {analysis.actions.map((action, i) => (
                  <div className="action-item" key={i}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={savingAction}
                        checked={n.completedActions.includes(i)}
                        onChange={() => toggleAction(i)}
                      />
                      <span>{action}</span>
                    </label>
                    <button
                      className="icon-button"
                      aria-label={"保存行动为节点 " + (i + 1)}
                      disabled={
                        !!busy || children.some((c) => c.content === action)
                      }
                      onClick={() =>
                        child(
                          { title: action.slice(0, 72), content: action },
                          "action-" + i,
                        )
                      }
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                ))}
              </section>
              <p className="ai-footnote">AI 提供思考方向，判断和选择留给你。</p>
            </>
          )}
        </aside>
      </div>
      {confirmDelete && (
        <dialog
          ref={dialog}
          className="modal"
          onCancel={() => setConfirmDelete(false)}
        >
          <h2>删除这条记录？</h2>
          <p>删除后无法恢复。已保存的子节点会保留。</p>
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              保留记录
            </button>
            <button
              className="danger-button"
              onClick={async () => {
                try {
                  await api("/api/nodes/" + id, { method: "DELETE" });
                  reload();
                  router.push("/all");
                  notify("记录已删除");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              确认删除
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
