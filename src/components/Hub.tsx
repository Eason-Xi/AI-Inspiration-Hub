"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  Archive,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Home,
  Image as ImageIcon,
  Inbox,
  LayoutGrid,
  Lightbulb,
  Link as LinkIcon,
  List,
  LoaderCircle,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Tag,
  X,
  Zap,
} from "lucide-react";
import type { Idea, Workspace, Settings, Project } from "@/lib/types";
import { statuses, projectStatuses } from "@/lib/types";
import { api, send } from "@/lib/client";
import NodeDetail from "./NodeDetail";
import SettingsPanel from "./SettingsPanel";
import { useDraft } from "@/lib/use-draft";

export default function Hub() {
  const pathname = usePathname();
  const router = useRouter();
  const parts = pathname.split("/").filter(Boolean);
  const view = parts[0] || "home";
  const projectId = view === "project" ? parts[1] : "";
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [toast, setToast] = useState("");
  const [projectModal, setProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | undefined>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  const reload = useCallback(() => setRefresh((x) => x + 1), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    setMobile(false);
    setPage(1);
    setTag("");
    setKind("");
    setStatus("");
    setProjectFilter("");
    if (view !== "search") {
      setQuery("");
      setSearch("");
    }
  }, [pathname, view]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const p = new URLSearchParams({
      view,
      q: view === "search" ? search : "",
      page: String(page),
    });
    if (projectId || projectFilter)
      p.set("project", projectId || projectFilter);
    if (tag) p.set("tag", tag);
    if (kind) p.set("type", kind);
    if (status) p.set("status", status);
    api<Workspace>("/api/workspace?" + p, { signal: controller.signal })
      .then((data) => {
        setWorkspace(data);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [
    view,
    search,
    page,
    projectId,
    projectFilter,
    tag,
    kind,
    status,
    refresh,
  ]);
  const pending = workspace?.nodes.some((n) => n.aiState === "pending");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 3500);
    return () => clearInterval(t);
  }, [pending, reload]);
  const projects = workspace?.projects || [];
  const currentProject = projects.find((p) => p.id === projectId);
  const title =
    (
      {
        home: "让每一个想法，都有下一步。",
        inbox: "收件箱",
        all: "全部记录",
        favorites: "我的收藏",
        archive: "归档",
        projects: "我的项目",
        tags: "标签",
        search: "搜索记录",
        settings: "设置",
        project: currentProject?.name || "项目",
      } as Record<string, string>
    )[view] || "灵感扩散库";
  const description = (
    {
      home: "先记录，再慢慢想清楚。这里是你的灵感生长地。",
      inbox: "把零散的念头放在这里，准备好时再整理。",
      all: "想过的、看过的、还想继续的，都在这里。",
      favorites: "把值得反复思考的内容，留在触手可及的地方。",
      archive: "暂时放下的想法，也有自己的位置。",
      projects: "围绕一个目标，让零散的想法汇聚起来。",
      tags: "沿着一个关键词，重新发现你的想法。",
      search: "从一个关键词，找回过去的灵感。",
      settings: "让这个思考空间，更适合你。",
      project: currentProject?.description || "",
    } as Record<string, string>
  )[view];
  async function favorite(n: Idea) {
    try {
      await api("/api/nodes/" + n.id, send("PATCH", { favorite: !n.favorite }));
      reload();
      notify(n.favorite ? "已取消收藏" : "已加入收藏");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const nav = [
    { id: "home", label: "灵感首页", icon: Home },
    {
      id: "inbox",
      label: "收件箱",
      icon: Inbox,
      count: workspace?.stats.inbox,
    },
    { id: "all", label: "全部记录", icon: LayoutGrid },
    { id: "favorites", label: "我的收藏", icon: Bookmark },
  ];
  const newIdea = () => {
    if (view !== "home" && view !== "inbox" && view !== "project")
      router.push("/home");
    setTimeout(() => composerRef.current?.focus(), 150);
  };
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "is-open" : "")}>
        <Link className="brand" href="/home">
          <span className="brand-mark">
            <Zap size={23} fill="currentColor" />
          </span>
          <span>
            灵感扩散库<small>INSPIRATION HUB</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="avatar small">我</span>
          <span>我的思考空间</span>
          <span className="personal-label">个人</span>
        </div>
        <button className="primary new-note" onClick={newIdea}>
          <Plus size={18} />
          记录新想法<span>⌘ ↵</span>
        </button>
        <nav aria-label="主导航">
          {nav.map((item) => (
            <Link
              key={item.id}
              href={"/" + item.id}
              className={"nav-item " + (view === item.id ? "active" : "")}
            >
              <item.icon size={19} />
              {item.label}
              {item.count ? <span className="count">{item.count}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="nav-group-heading">
          <Link href="/projects">我的项目</Link>
          <button
            className="icon-button"
            aria-label="新建项目"
            onClick={() => setProjectModal(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="project-nav">
          {projects
            .filter((p) => p.status !== "归档")
            .map((p) => (
              <Link
                href={"/project/" + p.id}
                className={"nav-item " + (projectId === p.id ? "active" : "")}
                key={p.id}
              >
                <Folder size={18} style={{ color: p.color }} />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          <button
            className="nav-item muted"
            onClick={() => setProjectModal(true)}
          >
            <Plus size={18} />
            新建项目
          </button>
        </div>
        <div className="nav-group-heading">整理与沉淀</div>
        <Link
          href="/tags"
          className={"nav-item " + (view === "tags" ? "active" : "")}
        >
          <Tag size={19} />
          标签管理
        </Link>
        <Link
          href="/archive"
          className={"nav-item " + (view === "archive" ? "active" : "")}
        >
          <Archive size={19} />
          归档
        </Link>
        <div className="sidebar-bottom">
          <div className="small-thought">
            <Sparkles size={17} />
            <p>
              好想法，值得被接住。<small>一点记录，一点新的可能。</small>
            </p>
          </div>
          <Link
            href="/settings"
            className={"nav-item " + (view === "settings" ? "active" : "")}
          >
            <SettingsIcon size={18} />
            设置
            <span className="tiny-dot" />
          </Link>
          <div className="profile">
            <span className="avatar">我</span>
            <div>
              个人工作空间<small>本地保存 · 随时回来</small>
            </div>
            <span className="version">MVP</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>我的空间</span>
            <ChevronRight size={14} />
            <strong>
              {view === "node"
                ? "记录详情"
                : view === "home"
                  ? "灵感首页"
                  : title}
            </strong>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="搜索所有记录"
              ref={searchRef}
              placeholder="搜索你的灵感…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (view !== "search") router.push("/search");
              }}
            />
            <kbd>⌘ K</kbd>
          </div>
          <span className="top-avatar">我</span>
        </header>
        <main>
          {error && (
            <div className="error-banner">
              {error}
              <button onClick={reload}>重试</button>
            </div>
          )}
          {!workspace && !error ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              正在打开你的思考空间…
            </div>
          ) : view === "node" ? (
            <NodeDetail
              id={parts[1]}
              projects={projects}
              settings={workspace?.settings}
              notify={notify}
              reload={reload}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  {view === "home" && (
                    <div className="eyebrow">
                      <span />
                      灵感，从这里开始
                    </div>
                  )}
                  <h1>{title}</h1>
                  <p>{description}</p>
                </div>
                {view === "home" ? (
                  <div className="date-label">
                    {new Date().toLocaleDateString("zh-CN", {
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    })}
                    <small>留一点时间，给新的可能</small>
                  </div>
                ) : view === "projects" ? (
                  <button
                    className="primary"
                    onClick={() => setProjectModal(true)}
                  >
                    <Plus size={17} />
                    新建项目
                  </button>
                ) : view === "project" && currentProject ? (
                  <div className="project-heading-actions">
                    <span className="project-state">
                      {currentProject.status}
                    </span>
                    <button
                      className="secondary"
                      onClick={() => {
                        setEditingProject(currentProject);
                        setProjectModal(true);
                      }}
                    >
                      <Pencil size={16} />
                      编辑项目
                    </button>
                  </div>
                ) : null}
              </div>
              {view === "settings" ? (
                <SettingsPanel
                  settings={workspace?.settings}
                  notify={notify}
                  reload={reload}
                />
              ) : view === "projects" ? (
                <div className="projects-grid">
                  {projects.map((p) => (
                    <Link
                      key={p.id}
                      href={"/project/" + p.id}
                      className="project-card"
                    >
                      <span
                        className="project-icon"
                        style={{ color: p.color, background: p.color + "12" }}
                      >
                        <FolderOpen size={28} />
                      </span>
                      <span className="project-status">{p.status}</span>
                      <h2>{p.name}</h2>
                      <p>{p.description || "给这个项目留一点生长的空间。"}</p>
                      <div>
                        {p.nodeCount || 0} 条记录 <ArrowRight size={16} />
                      </div>
                    </Link>
                  ))}
                  <button
                    className="project-card add-project"
                    onClick={() => setProjectModal(true)}
                  >
                    <Plus size={28} />
                    <span>开启一个新项目</span>
                  </button>
                </div>
              ) : (
                <div
                  className={
                    "content-columns " + (view === "home" ? "with-aside" : "")
                  }
                >
                  <section className="feed">
                    {["home", "inbox", "project"].includes(view) && (
                      <Composer
                        key={projectId || "inbox"}
                        refProp={composerRef}
                        projectId={projectId}
                        onSaved={() => {
                          reload();
                          notify("想法已保存");
                        }}
                        notify={notify}
                        configured={!!workspace?.settings.configured}
                      />
                    )}
                    {view === "tags" && (
                      <div className="tag-cloud">
                        {workspace?.tags.length ? (
                          workspace.tags.map((t) => (
                            <button
                              className={
                                "tag-choice " + (tag === t ? "selected" : "")
                              }
                              key={t}
                              onClick={() => {
                                setTag(tag === t ? "" : t);
                                setPage(1);
                              }}
                            >
                              <Hash size={15} />
                              {t}
                            </button>
                          ))
                        ) : (
                          <p className="muted">
                            为记录添加标签后，就能在这里按主题浏览。
                          </p>
                        )}
                      </div>
                    )}
                    <div className="feed-heading">
                      <div>
                        <h2>
                          {view === "home"
                            ? "最近记录"
                            : view === "search"
                              ? search
                                ? "搜索结果"
                                : "所有记录"
                              : view === "project"
                                ? "项目记录"
                                : "记录"}
                        </h2>
                        <span className="record-count">
                          {workspace?.total || 0}
                        </span>
                      </div>
                      <div className="view-switch">
                        <button
                          className={!list ? "selected" : ""}
                          aria-label="卡片视图"
                          onClick={() => setList(false)}
                        >
                          <LayoutGrid size={17} />
                        </button>
                        <button
                          className={list ? "selected" : ""}
                          aria-label="列表视图"
                          onClick={() => setList(true)}
                        >
                          <List size={19} />
                        </button>
                      </div>
                    </div>
                    <div className="filter-bar">
                      <div className="type-tabs">
                        {[
                          { v: "", t: "全部" },
                          { v: "text", t: "文字" },
                          { v: "image", t: "图片" },
                          { v: "link", t: "链接" },
                        ].map((t) => (
                          <button
                            className={kind === t.v ? "selected" : ""}
                            key={t.v}
                            onClick={() => {
                              setKind(t.v);
                              setPage(1);
                            }}
                          >
                            {t.t}
                          </button>
                        ))}
                      </div>
                      <div className="filters">
                        <select
                          aria-label="按标签筛选"
                          value={tag}
                          onChange={(e) => {
                            setTag(e.target.value);
                            setPage(1);
                          }}
                        >
                          <option value="">所有标签</option>
                          {workspace?.tags.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                        <select
                          aria-label="按状态筛选"
                          value={status}
                          onChange={(e) => {
                            setStatus(e.target.value);
                            setPage(1);
                          }}
                        >
                          <option value="">所有状态</option>
                          {statuses.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                        {view === "search" && (
                          <select
                            aria-label="按项目筛选"
                            value={projectFilter}
                            onChange={(e) => {
                              setProjectFilter(e.target.value);
                              setPage(1);
                            }}
                          >
                            <option value="">所有项目</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <span className="sort-label">
                          <ArrowDownWideNarrow size={14} />
                          最新
                        </span>
                      </div>
                    </div>
                    {!!workspace?.nodes.some((n) => n.sample) && (
                      <div className="sample-notice">
                        以下标有「示例」的内容，用来帮你熟悉这个空间。
                      </div>
                    )}
                    <div className={"notes-grid " + (list ? "list-view" : "")}>
                      {workspace?.nodes.map((n) => (
                        <NoteCard
                          key={n.id}
                          node={n}
                          project={projects.find((p) => p.id === n.projectId)}
                          onFavorite={() => favorite(n)}
                        />
                      ))}
                    </div>
                    {workspace?.nodes.length === 0 && (
                      <div className="empty-state">
                        <span>
                          <Lightbulb size={30} />
                        </span>
                        <h3>
                          {search || tag || kind || status
                            ? "没有找到匹配的记录"
                            : "还没有记录，先接住一个念头"}
                        </h3>
                        <p>
                          {search || tag || kind || status
                            ? "试试其他关键词，或放宽筛选条件。"
                            : "不需要想完整，一句话也可以成为起点。"}
                        </p>
                        {search || tag || kind || status ? (
                          <button
                            className="secondary"
                            onClick={() => {
                              setQuery("");
                              setTag("");
                              setKind("");
                              setStatus("");
                              setProjectFilter("");
                            }}
                          >
                            清除筛选
                          </button>
                        ) : (
                          <button className="secondary" onClick={newIdea}>
                            <Plus size={16} />
                            记录一个想法
                          </button>
                        )}
                      </div>
                    )}
                    {!!workspace && workspace.pages > 1 && (
                      <div className="pagination">
                        <button
                          disabled={page <= 1}
                          onClick={() => setPage((p) => p - 1)}
                          aria-label="上一页"
                        >
                          <ChevronLeft size={17} />
                        </button>
                        <span>
                          {workspace.page} / {workspace.pages}
                        </span>
                        <button
                          disabled={page >= workspace.pages}
                          onClick={() => setPage((p) => p + 1)}
                          aria-label="下一页"
                        >
                          <ChevronRight size={17} />
                        </button>
                      </div>
                    )}
                    {!!workspace?.nodes.length && (
                      <div className="feed-end">
                        <span />
                        每一个念头，都可能是一个开始
                        <span />
                      </div>
                    )}
                  </section>
                  {view === "home" && (
                    <aside className="right-rail">
                      <div className="growth-card">
                        <div className="section-kicker">
                          <span className="icon-tile">
                            <Lightbulb size={18} />
                          </span>
                          你的灵感花园
                        </div>
                        <div className="big-stat">
                          {workspace?.stats.total || 0}
                          <span>个想法，在这里生长</span>
                        </div>
                        <div className="mini-stats">
                          <Link href="/projects">
                            <strong>{projects.length}</strong>
                            <span>探索项目</span>
                          </Link>
                          <Link href="/favorites">
                            <strong>{workspace?.stats.favorites || 0}</strong>
                            <span>珍藏灵感</span>
                          </Link>
                          <Link href="/inbox">
                            <strong>{workspace?.stats.inbox || 0}</strong>
                            <span>等待整理</span>
                          </Link>
                        </div>
                      </div>
                      <div className="ai-intro">
                        <span className="purple-icon">
                          <Sparkles size={21} />
                        </span>
                        <span className="mini-badge">AI 思考伙伴</span>
                        <h3>
                          让一个想法，
                          <br />
                          长出更多可能。
                        </h3>
                        <p>
                          在记录旁边发现新的方向，
                          <br />
                          把值得探索的下一步留下来。
                        </p>
                        <ol>
                          <li>
                            <span>1</span>记下一个念头
                          </li>
                          <li>
                            <span>2</span>获得 3–5 个探索方向
                          </li>
                          <li>
                            <span>3</span>保存为新节点，继续生长
                          </li>
                        </ol>
                        <Link
                          href={
                            workspace?.settings.configured
                              ? "/all"
                              : "/settings"
                          }
                        >
                          {workspace?.settings.configured
                            ? "去探索我的记录"
                            : "连接我的 AI 模型"}
                          <ArrowRight size={16} />
                        </Link>
                      </div>
                      <div className="rail-tags">
                        <div className="rail-heading">
                          <h3>常用标签</h3>
                          <Link href="/tags" aria-label="查看全部标签">
                            <ArrowRight size={16} />
                          </Link>
                        </div>
                        <div>
                          {workspace?.tags.slice(0, 8).map((t) => (
                            <button
                              key={t}
                              onClick={() => {
                                setTag(tag === t ? "" : t);
                                setPage(1);
                              }}
                              className={"tag " + (tag === t ? "active" : "")}
                            >
                              # {t}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="quiet-quote">
                        “灵感偏爱那些
                        <br />
                        认真留意生活的人。”<span>保持好奇，慢慢生长。</span>
                      </div>
                    </aside>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {projectModal && (
        <ProjectDialog
          project={editingProject}
          onClose={() => {
            setProjectModal(false);
            setEditingProject(undefined);
          }}
          onDeleted={(count) => {
            setProjectModal(false);
            setEditingProject(undefined);
            reload();
            router.push("/projects");
            notify(`项目已删除，${count} 条记录已移回收件箱`);
          }}
          onCreated={(p) => {
            setProjectModal(false);
            setEditingProject(undefined);
            reload();
            router.push("/project/" + p.id);
            notify(editingProject ? "项目已更新" : "项目已创建");
          }}
        />
      )}
    </div>
  );
}
function NoteCard({
  node: n,
  project,
  onFavorite,
}: {
  node: Idea;
  project?: Project;
  onFavorite: () => void;
}) {
  const Icon =
    n.type === "image" ? ImageIcon : n.type === "link" ? LinkIcon : FileText;
  return (
    <article
      className={"note-card " + (n.type === "image" ? "image-note" : "")}
    >
      {n.image && (
        <Link href={"/node/" + n.id} className="note-image">
          <Image
            src={n.image}
            alt={n.title}
            fill
            sizes="(max-width: 800px) 100vw, 400px"
            unoptimized
          />
        </Link>
      )}
      <div className="note-card-inner">
        <div className="note-top">
          <span className={"type-icon " + n.type}>
            <Icon size={17} />
          </span>
          <span>
            {n.type === "image"
              ? "图片灵感"
              : n.type === "link"
                ? "链接收藏"
                : "文字记录"}
          </span>
          {n.sample && <span className="sample-label">示例</span>}
          <button
            className={"icon-button bookmark " + (n.favorite ? "saved" : "")}
            aria-label={n.favorite ? "取消收藏 " + n.title : "收藏 " + n.title}
            onClick={onFavorite}
          >
            <Bookmark size={17} fill={n.favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <Link href={"/node/" + n.id} className="note-main">
          <h3>{n.title}</h3>
          <p>
            {n.content || n.analysis?.summary || "一张图片，一个新的思考起点。"}
          </p>
        </Link>
        {n.url && (
          <a
            className="link-preview"
            href={n.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="link-globe">
              <LinkIcon size={15} />
            </span>
            <span>
              {n.linkTitle || new URL(n.url).hostname}
              <small>{new URL(n.url).hostname}</small>
            </span>
            <ArrowRight size={14} />
          </a>
        )}
        {n.analysis && (
          <Link href={"/node/" + n.id} className="ai-snippet">
            <Sparkles size={14} />
            <span>{n.analysis.expansions.length} 个探索方向，等你继续</span>
            <ArrowRight size={13} />
          </Link>
        )}
        {n.aiState === "pending" && (
          <div className="ai-snippet">
            <LoaderCircle size={14} className="spin" />
            AI 正在整理这个想法…
          </div>
        )}
        <div className="note-tags">
          {n.tags.slice(0, 3).map((t, i) => (
            <span className={"tag tint-" + i} key={t}>
              # {t}
            </span>
          ))}
        </div>
        <div className="note-footer">
          <span>
            {project ? (
              <>
                <Folder size={12} />
                {project.name}
              </>
            ) : (
              <>
                <Inbox size={12} />
                收件箱
              </>
            )}
          </span>
          <span className={"status-dot status-" + n.status}>{n.status}</span>
          <time>
            {new Date(n.createdAt).toLocaleDateString("zh-CN", {
              month: "numeric",
              day: "numeric",
            })}
          </time>
        </div>
      </div>
    </article>
  );
}
function Composer({
  refProp,
  projectId,
  onSaved,
  notify,
  configured,
}: {
  refProp: React.RefObject<HTMLTextAreaElement | null>;
  projectId: string;
  onSaved: () => void;
  notify: (s: string) => void;
  configured: boolean;
}) {
  const {
    draft: { text, image, url, showUrl },
    update,
    clear,
    ready,
    warning,
  } = useDraft(projectId);
  const setText = (text: string) => update({ text });
  const setImage = (image: string | null) => update({ image });
  const setUrl = (url: string) => update({ url });
  const setShowUrl = (showUrl: boolean) => update({ showUrl });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function upload(file?: File) {
    if (!file || !ready || busy || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await api<{ url: string }>("/api/upload", {
        method: "POST",
        body: form,
      });
      setImage(data.url);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function save() {
    if (!ready || busy || uploading || (!text.trim() && !image && !url.trim()))
      return;
    setBusy(true);
    try {
      const pasted = /^https?:\/\/\S+$/.test(text.trim()) ? text.trim() : null;
      await api(
        "/api/nodes",
        send("POST", {
          content: text.trim(),
          url: url.trim() || pasted,
          image,
          type: image ? "image" : url || pasted ? "link" : "text",
          projectId: projectId || null,
        }),
      );
      clear();
      onSaved();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="composer">
      <div className="composer-title">
        <span>
          <Plus size={18} />
        </span>
        此刻，有什么新想法？<small>不必完整，先记下来</small>
      </div>
      <textarea
        ref={refProp}
        aria-label="记录一个想法"
        disabled={!ready || busy}
        maxLength={50000}
        placeholder="一个突然的灵感、一个还没想清楚的问题，或一段值得留下的话…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) {
            e.preventDefault();
            upload(file);
          }
        }}
      />
      {image && (
        <div className="attachment-preview">
          <Image
            src={image}
            alt="待保存图片"
            width={90}
            height={60}
            unoptimized
          />
          <span>图片已添加</span>
          <button
            className="icon-button"
            aria-label="移除图片"
            disabled={busy}
            onClick={() => setImage(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {showUrl && (
        <div className="url-input">
          <LinkIcon size={16} />
          <input
            autoFocus
            aria-label="链接地址"
            disabled={!ready || busy}
            maxLength={2048}
            placeholder="https://…"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label="移除链接"
            disabled={busy}
            onClick={() => {
              setUrl("");
              setShowUrl(false);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="composer-bottom">
        <div className="composer-tools">
          <button onClick={() => refProp.current?.focus()}>
            <FileText size={16} />
            <span>文字</span>
          </button>
          <button
            disabled={!ready || busy || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ImageIcon size={16} />
            )}
            <span>图片</span>
          </button>
          <button
            className={showUrl ? "active" : ""}
            disabled={!ready || busy}
            onClick={() => setShowUrl(!showUrl)}
          >
            <LinkIcon size={16} />
            <span>链接</span>
          </button>
          <input
            ref={fileRef}
            aria-label="上传图片"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </div>
        <div className="save-group">
          <span className="save-hint">⌘ Enter</span>
          <button
            className="primary"
            disabled={
              !ready ||
              busy ||
              uploading ||
              (!text.trim() && !image && !url.trim())
            }
            onClick={save}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={17} />
            )}
            保存想法
          </button>
        </div>
      </div>
      {(warning || text || image || url) && (
        <p
          className={"draft-status " + (warning ? "draft-warning" : "")}
          role="status"
        >
          {warning || "草稿已保存到此浏览器 · 当前收件箱或项目独立保存"}
        </p>
      )}
      <div className="composer-note">
        <Sparkles size={13} />
        {configured
          ? "保存后，AI 会在后台帮你整理与发散"
          : "先安心记录，连接 AI 后即可生成摘要与探索方向"}
      </div>
    </div>
  );
}
function ProjectDialog({
  onClose,
  onCreated,
  project,
  onDeleted,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
  project?: Project;
  onDeleted: (count: number) => void;
}) {
  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [color, setColor] = useState(project?.color || "#8b5cf6");
  const [status, setStatus] = useState(project?.status || "探索中");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onCreated(
              await api<Project>(
                project ? "/api/projects/" + project.id : "/api/projects",
                send(project ? "PATCH" : "POST", {
                  name,
                  description,
                  color,
                  status,
                }),
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-header">
          <h2>{project ? "编辑项目" : "给想法一个共同的方向"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          {project
            ? "更新项目目标与进展，AI 会在之后的分析中参考这些信息。"
            : "创建项目，把相关的灵感慢慢聚在一起。"}
        </p>
        <label>
          项目名称
          <input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我的 AI 访谈助手"
          />
        </label>
        <label>
          项目描述
          <textarea
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="这个项目想解决什么问题？"
          />
        </label>
        <label>项目颜色</label>
        <div className="color-picker">
          {["#8b5cf6", "#14b8a6", "#f59e0b", "#3b82f6", "#ec4899"].map((c) => (
            <button
              type="button"
              key={c}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
            >
              {color === c && <Check size={17} />}
            </button>
          ))}
        </div>
        <label>
          项目状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {projectStatuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {project && (
          <div className="project-delete-area">
            {deleting ? (
              <>
                <p>
                  确认删除「{project.name}」？项目下的 {project.nodeCount || 0}{" "}
                  条记录将保留并移回收件箱，父子关系不变。
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setDeleting(false)}
                  >
                    保留项目
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const result = await api<{ movedNodes: number }>(
                          "/api/projects/" + project.id,
                          { method: "DELETE" },
                        );
                        onDeleted(result.movedNodes);
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "删除中…" : "确认删除项目"}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="danger-text"
                onClick={() => setDeleting(true)}
              >
                删除项目…
              </button>
            )}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button
            disabled={busy || !name.trim() || deleting}
            className="primary"
            type="submit"
          >
            {busy ? "保存中…" : project ? "保存项目" : "创建项目"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
