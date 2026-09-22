import { z } from "zod";
import { statuses, projectStatuses } from "./types";
export const modes = ["默认", "实用", "创意", "反向", "产品"] as const;
export const projectInput = z.object({
  name: z.string().trim().min(1, "请输入项目名称").max(60),
  description: z.string().trim().max(500).default(""),
  color: z
    .string()
    .regex(/^#[a-f0-9]{6}$/i)
    .default("#8b5cf6"),
  status: z.enum(projectStatuses).default("探索中"),
});
export const settingsInput = z.object({
  baseUrl: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      );
    }, "请填写 HTTPS 基础地址；本机服务也支持 HTTP，地址不能含凭据或查询参数"),
  model: z.string().trim().min(1, "请输入模型名称").max(100),
  apiKey: z.string().trim().max(1000).optional(),
});
const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((tags) => [...new Set(tags)]);
export const urlSchema = z
  .string()
  .max(2048)
  .url()
  .refine(
    (s) => ["http:", "https:"].includes(new URL(s).protocol),
    "仅支持 HTTP 或 HTTPS 链接",
  );
export const nodeInput = z
  .object({
    title: z.string().trim().max(160).optional(),
    content: z.string().max(50000).default(""),
    image: z
      .string()
      .regex(/^\/api\/files\/[a-f0-9-]+\.(png|jpg|webp|gif)$/)
      .nullable()
      .optional(),
    url: urlSchema.nullable().optional(),
    type: z.enum(["text", "image", "link"]).default("text"),
    projectId: z.string().uuid().nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    tags: tagsSchema.optional(),
  })
  .refine(
    (n) => !!n.content.trim() || !!n.image || !!n.url,
    "请写下想法、添加链接或上传图片",
  );
export const nodePatch = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  content: z.string().max(50000).optional(),
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(statuses).optional(),
  tags: tagsSchema.optional(),
  favorite: z.boolean().optional(),
  completedActions: z.array(z.number().int().min(0).max(9)).max(10).optional(),
});
export const analysisSchema = z.object({
  summary: z.string().min(1).max(1500),
  tags: z.array(z.string().min(1).max(40)).max(8),
  category: z.string().max(80),
  expansions: z
    .array(
      z.object({
        title: z.string().min(1).max(150),
        content: z.string().min(1).max(3000),
      }),
    )
    .min(3)
    .max(5),
  actions: z.array(z.string().min(1).max(500)).min(1).max(5),
});
