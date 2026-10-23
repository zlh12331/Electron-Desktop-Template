// telemetry.ts：渲染层 → 主进程遥测上报契约（错误转发 + Web Vitals）
// 边界：只定义形状与上限；是否真正上报由主进程按遥测级别与后端配置决定
// （Sentry DSN / OTLP 端点未配置时一律 no-op，主进程仍返回 accepted 以保持 fire-and-forget 语义）

import { z } from 'zod';

/** 单条错误消息体最大长度（栈可能很长，但 32KB 足以覆盖压缩后调用链） */
const MAX_STACK_LENGTH = 32_768;

/** React 组件栈最大长度 */
const MAX_COMPONENT_STACK_LENGTH = 16_384;

/** 单个 tag 键/值长度上限（防渲染层构造超长键污染后端索引） */
const MAX_TAG_KEY_LENGTH = 64;

const MAX_TAG_VALUE_LENGTH = 256;

const MAX_TAGS = 20;

/** 单次上报的 Web Vitals 条数上限（一次 flush 最多 5 个指标，留冗余） */
const MAX_WEB_VITALS = 20;

/** 渲染层上报的错误载荷（主进程转换为 Sentry 事件 + 结构化日志） */
export interface TelemetryCaptureErrorReq {
  /** 错误名（Error.name；非 Error 抛出物可省略） */
  readonly name?: string;
  /** 错误消息（非空；调用方负责 String() 归一） */
  readonly message: string;
  /** 调用栈（可选；跨进程序列化后仍保留原始栈） */
  readonly stack?: string;
  /** React 组件栈（错误边界场景） */
  readonly componentStack?: string;
  /** 分组标签（scope / boundary / route 等，值会脱敏后进 Sentry tags） */
  readonly tags?: Readonly<Record<string, string>>;
}

/**
 * 错误上报入参 schema
 *
 * tags 用 refine 限制键数量：zod 的 record 只能约束单键/单值长度，
 * 不限制条目数时渲染层错误循环可能撑大 IPC 与后端事件体积。
 */
export const TelemetryCaptureErrorReqSchema = z.object({
  name: z.string().max(200).optional(),
  message: z.string().min(1).max(8_192),
  stack: z.string().max(MAX_STACK_LENGTH).optional(),
  componentStack: z.string().max(MAX_COMPONENT_STACK_LENGTH).optional(),
  tags: z
    .record(z.string().min(1).max(MAX_TAG_KEY_LENGTH), z.string().max(MAX_TAG_VALUE_LENGTH))
    .refine((tags) => Object.keys(tags).length <= MAX_TAGS, {
      message: `tags 最多 ${MAX_TAGS} 个键`,
    })
    .optional(),
});

/** 错误上报响应：accepted=false 表示遥测关闭或触发速率上限（调用方无需重试） */
export interface TelemetryCaptureErrorRes {
  readonly accepted: boolean;
}

/** 错误上报响应 schema（always 返回结构稳定的 accepted，避免渲染层分支处理协议错误） */
export const TelemetryCaptureErrorResSchema = z.object({ accepted: z.boolean() });

/** Web Vitals 指标名（web-vitals 包的标准五项） */
export const WebVitalNameSchema = z.enum(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

/** Web Vitals 指标名类型 */
export type WebVitalName = z.infer<typeof WebVitalNameSchema>;

/** Web Vitals 评级（web-vitals 的 rating 字段） */
export const WebVitalRatingSchema = z.enum(['good', 'needs-improvement', 'poor']);

/** Web Vitals 评级类型 */
export type WebVitalRating = z.infer<typeof WebVitalRatingSchema>;

const WebVitalSchema = z.object({
  name: WebVitalNameSchema,
  /** 指标值：CLS 无量纲，其余为毫秒 */
  value: z.number().nonnegative().max(86_400_000),
  rating: WebVitalRatingSchema.optional(),
  /** 本次相对上次上报的增量（web-vitals 的 delta） */
  delta: z.number().nonnegative().max(86_400_000).optional(),
  /** 导航类型（navigate / reload / back-forward-cache / prerender） */
  navigationType: z.string().max(32).optional(),
});

/** Web Vitals 批量上报入参 */
export interface TelemetryReportWebVitalsReq {
  readonly metrics: readonly z.infer<typeof WebVitalSchema>[];
}

/**
 * Web Vitals 批量上报 schema
 *
 * 渲染层在页面隐藏/批次满时 flush；空数组视为无效请求（避免无意义 IPC）。
 */
export const TelemetryReportWebVitalsReqSchema = z.object({
  metrics: z.array(WebVitalSchema).min(1).max(MAX_WEB_VITALS),
});

/** Web Vitals 上报响应：accepted 为实际接收条数（遥测非 full 或后端未启用时为 0） */
export interface TelemetryReportWebVitalsRes {
  readonly accepted: number;
}

/** Web Vitals 上报响应 schema */
export const TelemetryReportWebVitalsResSchema = z.object({
  accepted: z.number().int().nonnegative(),
});
