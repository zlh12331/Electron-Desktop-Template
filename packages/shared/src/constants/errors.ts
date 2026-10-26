// errors.ts：跨进程共享的错误基础设施——错误码表 + 错误元数据（用户文案/可重试/严重级别）+ 统一错误类 AppError
// 流向：主进程抛 AppError → wrap() 捕获并 toIpcError() 过 IPC → 渲染层 unwrap() 抛 `[CODE] message` → getErrorMessage() 取 i18n 文案
/**
 * 错误码表：键与值同名，值即跨进程契约
 *
 * IpcError.code 原样过 IPC，渲染层据它拼 i18n key `errors.<code>`——改值不会编译报错，
 * 只会静默退回兜底文案（shared 单测因此逐个钉死码值）。
 *
 * 按域分组；新增码必须同步补 ERROR_META（Record<ErrorCode, ErrorMeta> 缺项编译期即报错）。
 */
export const ErrorCode = {
  // ── 通用 ────────────────────────────────────────────
  /** 未分类失败的兜底码（渲染层回合错误未分类时写它；主进程裸异常由 wrap() 归为 INTERNAL_ERROR） */
  UNKNOWN: 'UNKNOWN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',

  // ── IPC 边界 ────────────────────────────────────────
  /** 调用来源非法：发送方窗口已不存在，或其 URL 不在白名单（wrap() 在进 handler 前拒绝） */
  IPC_SENDER_INVALID: 'IPC_SENDER_INVALID',
  IPC_CHANNEL_NOT_FOUND: 'IPC_CHANNEL_NOT_FOUND',
  /** 渲染层未注入 preload（浏览器预览或打包异常），window.api 不存在 */
  BRIDGE_UNAVAILABLE: 'BRIDGE_UNAVAILABLE',
  /** 主进程 handler 返回结构不符合契约（resSchema 校验失败） */
  INVALID_RESPONSE: 'INVALID_RESPONSE',

  // ── 文件系统 ────────────────────────────────────────
  FS_READ_FAILED: 'FS_READ_FAILED',
  FS_WRITE_FAILED: 'FS_WRITE_FAILED',
  FS_DISK_FULL: 'FS_DISK_FULL',

  // ── 备份 ────────────────────────────────────────────
  /** 备份操作失败（恢复点不存在/损坏、路径非法）（docs/history/37-settings-gaps-2-spec.md §1B） */
  BACKUP_INVALID: 'BACKUP_INVALID',
} as const;

/** 错误码字面量联合类型（从 ErrorCode 派生） */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 错误严重级别（由低到高：info < warn < error < fatal；当前 ERROR_META 只用到前三级） */
export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

/**
 * 错误元数据
 *
 * - userMessage：面向终端用户的中文友好提示；渲染层 i18n 缺 `errors.<code>` 时的兜底
 *   （src/renderer/i18n/use-translation.ts）
 * - retryable：是否可自动重试（网络抖动等瞬时故障）
 * - severity：严重级别（ErrorSeverity）
 */
export interface ErrorMeta {
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly severity: ErrorSeverity;
}

/**
 * ERROR_META：错误码 → 元数据映射表
 *
 * 必须覆盖全部 ErrorCode（Record<ErrorCode, ErrorMeta> 类型层面强制；shared 单测另断言
 * userMessage 非空、severity 合法）
 */
export const ERROR_META: Readonly<Record<ErrorCode, ErrorMeta>> = {
  // ── 通用 ────────────────────────────────────────────
  UNKNOWN: { userMessage: '未知错误', retryable: false, severity: 'error' },
  INTERNAL_ERROR: { userMessage: '内部错误', retryable: false, severity: 'error' },
  INVALID_INPUT: { userMessage: '输入参数有误', retryable: false, severity: 'warn' },
  NOT_FOUND: { userMessage: '资源不存在', retryable: false, severity: 'warn' },
  ALREADY_EXISTS: { userMessage: '目标已存在', retryable: false, severity: 'warn' },
  UNAUTHORIZED: { userMessage: '未授权', retryable: false, severity: 'warn' },
  RATE_LIMITED: { userMessage: '操作过于频繁', retryable: true, severity: 'warn' },

  // ── IPC 边界 ────────────────────────────────────────
  IPC_SENDER_INVALID: { userMessage: 'IPC 调用来源无效', retryable: false, severity: 'error' },
  IPC_CHANNEL_NOT_FOUND: { userMessage: 'IPC 通道不存在', retryable: false, severity: 'error' },
  BRIDGE_UNAVAILABLE: {
    userMessage: '应用桥接不可用',
    retryable: false,
    severity: 'warn',
  },
  INVALID_RESPONSE: {
    userMessage: '主进程响应不符合契约',
    retryable: false,
    severity: 'error',
  },

  // ── 文件系统 ────────────────────────────────────────
  FS_READ_FAILED: { userMessage: '文件读取失败', retryable: false, severity: 'error' },
  FS_WRITE_FAILED: { userMessage: '文件写入失败', retryable: false, severity: 'error' },
  FS_DISK_FULL: { userMessage: '磁盘空间不足', retryable: false, severity: 'warn' },

  // ── 备份 ────────────────────────────────────────────
  BACKUP_INVALID: {
    userMessage: '备份文件无效或不存在',
    retryable: false,
    severity: 'warn',
  },
};

/**
 * IPC 错误序列化结构
 *
 * 主进程 wrap() 捕获 AppError 后调用 toIpcError()，经 IPC 序列化传输到渲染层
 */
export interface IpcError {
  readonly code: ErrorCode;
  readonly message: string;
  /** 结构化上下文（如 zod 校验的 issues）；cause 有意不外传（可能含不可序列化的原生错误对象） */
  readonly details?: unknown;
}

/**
 * AppError：应用统一错误类
 *
 * - 主进程 service / infra 层抛出 AppError（可预期失败；裸 Error 由 wrap() 归为 INTERNAL_ERROR）
 * - wrap() 捕获并调用 toIpcError() 返回给渲染层；渲染层 unwrap() 抛 `[CODE] message`，
 *   unwrapErrorMessage() + getErrorMessage() 据 code 取 i18n 文案并提示
 *
 * 注意：复用 ES2022 Error 原生 cause 属性（通过 super 第二参数传入）
 * 不在子类重新声明 cause，避免与 lib.es2022.error 的 Error.cause 冲突
 */
export class AppError extends Error {
  /** 错误码（单一身份标识） */
  readonly code: ErrorCode;

  /** 附加上下文（如校验失败的字段列表），会序列化到 IPC details */
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, cause?: unknown, details?: unknown) {
    // 回退到 ERROR_META：调用方没给 message 时，渲染层也要有可展示文案
    const messageOrDefault = message ?? ERROR_META[code].userMessage;
    // cause 缺省时不传 ErrorOptions：exactOptionalPropertyTypes 下不允许显式传 cause: undefined
    if (cause !== undefined) {
      super(messageOrDefault, { cause });
    } else {
      super(messageOrDefault);
    }
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  /** 元数据访问器（retryable / severity） */
  get meta(): ErrorMeta {
    return ERROR_META[this.code];
  }

  /** 是否可自动重试（AI 限流、超时等） */
  get retryable(): boolean {
    return this.meta.retryable;
  }

  /** 严重级别（来自 ERROR_META） */
  get severity(): ErrorSeverity {
    return this.meta.severity;
  }

  /**
   * 序列化为 IPC 传输结构
   *
   * 注意 cause 不序列化（可能含不可序列化的原生错误对象）
   */
  toIpcError(): IpcError {
    // details 是 readonly 可选字段：只能条件构建对象（不可先建再补字段），也避免显式传 undefined
    if (this.details !== undefined) {
      return {
        code: this.code,
        message: this.message,
        details: this.details,
      };
    }
    return {
      code: this.code,
      message: this.message,
    };
  }
}
