// proxy.ts：Proxy 域 IPC 契约单一真源（proxy:test / proxy:detectSystem / proxy:clearAuth）
// 链路：设置页测试连接 → proxy:test（可带草稿配置）→ 主进程 TCP 探测 + 经代理 fetch；
//       从系统导入 → proxy:detectSystem → Chromium resolveProxy 解析系统代理。
// 边界：只定义契约；探测/解析在 src/main/ipc/proxy.handler.ts，配置值门禁在
// packages/shared/src/schemas/settings.ts，代理应用在 src/main/infra/network/。
import { z } from 'zod';

import { PROXY_PROTOCOLS, ProxySettingInputSchema } from './settings';

/** 探测目标：只接受 http(s) */
const ProxyTargetUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, '测试目标必须是 http(s) URL');

/** proxy:test 入参（config 省略 = 测试已保存配置；有草稿时用于未保存值即测） */
export const ProxyTestReqSchema = z.object({
  /** 待测配置草稿（含可选 auth；主进程只用于本次探测，不落库） */
  config: ProxySettingInputSchema.optional(),
  /** 探测目标（省略 = 主进程默认中立端点 https://www.gstatic.com/generate_204） */
  targetUrl: ProxyTargetUrlSchema.optional(),
});

/** proxy:test 入参类型（z.infer 自 ProxyTestReqSchema） */
export type ProxyTestReq = z.infer<typeof ProxyTestReqSchema>;

/** 代理连通性测试归因 */
export type ProxyTestKind =
  | 'ok'
  | 'proxy-unreachable'
  | 'target-unreachable'
  | 'auth-failed'
  | 'timeout'
  | 'not-applicable';

/** proxy:test 响应（ok 与 kind 同源：成功恒为 ok=true + kind='ok'） */
export interface ProxyTestRes {
  /** true = 探测成功（经当前代理配置到达目标） */
  readonly ok: boolean;
  /**
   * 归因（ok=false 时有值；ok=true 恒 'ok'）
   *
   * 'proxy-unreachable' = 代理端口不可达；'target-unreachable' = 代理可用但目标失败；
   * 'auth-failed' = 代理返回 407 / 认证被拒；'timeout' = 3s 内未完成；
   * 'not-applicable' = 当前模式无需探测（非 fixed 或无 IPC 桥）。
   */
  readonly kind: ProxyTestKind;
  /**
   * 归因补充文本：not-applicable 为模式提示；其余透传脱敏后的原始网络错误
   * （渲染层按 kind 映射 i18n 文案、不直出此字段）。
   */
  readonly message?: string;
  /** 从开始探测到拿到响应的耗时（毫秒；not-applicable 时不返回） */
  readonly latencyMs?: number;
}

/** proxy:test 响应契约 schema（注册层 wrap 校验 handler 返回值，防接口声明与实现漂移） */
export const ProxyTestResSchema = z.object({
  ok: z.boolean(),
  kind: z.enum([
    'ok',
    'proxy-unreachable',
    'target-unreachable',
    'auth-failed',
    'timeout',
    'not-applicable',
  ]),
  message: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

/** proxy:detectSystem 响应（解析系统代理；不返回任何凭据） */
export interface ProxyDetectSystemRes {
  /** true = 检测到可用的系统代理 */
  readonly detected: boolean;
  /** 解析出的协议（仅 detected=true） */
  readonly protocol?: (typeof PROXY_PROTOCOLS)[number];
  /** 解析出的主机（仅 detected=true；IPv6 不含方括号） */
  readonly host?: string;
  /** 解析出的端口（仅 detected=true） */
  readonly port?: number;
}

/** proxy:detectSystem 响应契约 schema */
export const ProxyDetectSystemResSchema = z.object({
  detected: z.boolean(),
  protocol: z.enum(PROXY_PROTOCOLS).optional(),
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

/** proxy:clearAuth 响应 schema（清除已保存的代理凭据） */
export const ProxyClearAuthResSchema = z.object({
  ok: z.boolean(),
});

/** proxy:clearAuth 响应 payload */
export interface ProxyClearAuthRes {
  readonly ok: boolean;
}
