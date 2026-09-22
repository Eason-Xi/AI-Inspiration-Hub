export const statuses = [
  "未处理",
  "探索中",
  "待行动",
  "已解决",
  "归档",
] as const;
export type Status = (typeof statuses)[number];
export type Expansion = { title: string; content: string };
export type Analysis = {
  summary: string;
  tags: string[];
  category: string;
  expansions: Expansion[];
  actions: string[];
};
export type Idea = {
  id: string;
  title: string;
  content: string;
  type: "text" | "image" | "link";
  image: string | null;
  url: string | null;
  linkTitle: string | null;
  linkDescription: string | null;
  projectId: string | null;
  parentId: string | null;
  status: Status;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  analysis: Analysis | null;
  aiState: "idle" | "pending" | "done" | "error";
  aiError: string | null;
  completedActions: number[];
  sample: boolean;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  status: string;
  createdAt: string;
  nodeCount?: number;
};
export const projectStatuses = [
  "探索中",
  "进行中",
  "暂停",
  "完成",
  "归档",
] as const;
export type AiTask = {
  id: string;
  nodeId: string;
  mode: string;
  status: "queued" | "running" | "retrying" | "done" | "failed" | "cancelled";
  attempts: number;
  maxAttempts: number;
  nextRunAt: number;
  error: string | null;
};
export type Settings = { baseUrl: string; model: string; configured: boolean };
export type Workspace = {
  nodes: Idea[];
  projects: Project[];
  settings: Settings;
  total: number;
  page: number;
  pages: number;
  stats: { total: number; inbox: number; favorites: number; exploring: number };
  tags: string[];
};
