// meta.ts：IPC 通道元数据表（channel + kind 的纯字符串单一真源，按域分组）
//
// 为什么单独成表：preload 运行在 sandbox: true 下，引入含 zod 的 definitions.ts 会静默失败
// （window.api 变 undefined）——故 channel/kind 抽成零依赖字符串，由 preload 生成器
// （src/preload/utils/create-api.ts 的 createIpcApi）直接遍历本表，无需加载 zod。
// 边界：本文件不装 schema 与类型标记（definitions.ts 在其上合并），也不定义失败语义。
// 依赖方向：meta（本文件）← definitions.ts（+ zod schema）← channels.ts（deriveChannels 推导常量）。
// 增改约束：域键即 channel 前缀，deriveChannels 在 channel 与域键不匹配时直接抛错；
// channel 形态：请求 {domain}:{action}，事件 {domain}:event:{name} / {domain}:stream:{event}。
// 新增一个 IPC 方法 = 本表一行 + definitions.ts 一行 + 主进程 handler 一个方法，其余自动。
/**
 * 声明一个请求-响应方法（渲染层调用后等待返回）
 *
 * 返回值用 `as const` 保持字面量类型：derive.ts 的通道键名推导与定义表的 kind 判别
 * 都依赖字面量，一旦被拓宽成 string，IpcApi / InferHandlers 的推导会整体落空。
 */
export const request = <C extends string>(channel: C) => ({ kind: 'request', channel }) as const;

/**
 * 声明一个事件订阅方法：渲染层订阅并用返回的函数退订
 *
 * 与 request 的差别是单向推送（调用不返回结果）；payload 类型由 definitions.ts 的
 * payload 标记补上，本表不承载。
 */
export const event = <C extends string>(channel: C) => ({ kind: 'event', channel }) as const;

/**
 * IPC 通道元数据表（单一真源的 channel 部分，按域分组）
 *
 * definitions.ts 在此基础上合并 zod schema 与类型标记；
 * preload 生成器（createIpcApi）直接遍历本表，无需加载 zod。
 * 条目一律经 request / event 包裹——kind 字段参与定义表判别，手写对象会破坏类型推导。
 */
export const IPC_META = {
  app: {
    getStatus: request('app:getStatus'),
    getInfo: request('app:getInfo'),
    openExternal: request('app:openExternal'),
    openDataDir: request('app:openDataDir'),
    // 诊断包导出：日志 + 版本信息 → 用户选定路径的 zip（排障闭环的出口）
    exportDiagnostics: request('app:exportDiagnostics'),
    // 开机自启：读写 OS 登录项而非 SQLite 设置——托盘菜单与设置页必须同源
    getLoginItemSettings: request('app:getLoginItemSettings'),
    setLoginItemSettings: request('app:setLoginItemSettings'),
    // 退出应用：交给 app.quit 走完整善后链（dispose 服务 → flush 遥测/日志）
    quit: request('app:quit'),
    // 深链接事件：自定义协议唤起时主进程广播，渲染层据此导航
    subscribeDeepLink: event('app:event:deepLink'),
    // 冷启动深链：渲染层挂载后主动取走（订阅晚于主进程广播时会丢事件）
    takePendingDeepLink: request('app:takePendingDeepLink'),
    // 登录项变更事件：payload 为写入后的真实回读值（托盘菜单改自启 → 设置页回显）
    subscribeLoginItemChanged: event('app:event:loginItemChanged'),
  },

  window: {
    // 界面缩放：主进程统一 setZoomFactor（渲染层只管上报档位），并联动 Windows
    // titleBarOverlay 高度——固定高度不随 CSS 缩放，不联动会与自绘顶栏错位
    applyZoom: request('window:applyZoom'),
  },

  backup: {
    // 恢复点列表：backups/ 轮转环 + quick_check 健康度，最新在前
    list: request('backup:list'),
    // 立即备份：与启动备份走同一路径、进同一轮转环（同样会被轮转淘汰）
    create: request('backup:create'),
    // 从恢复点恢复：暂存 + 重启生效；模板版无运行中任务前置校验
    restore: request('backup:restore'),
  },

  settings: {
    getAll: request('settings:getAll'),
    set: request('settings:set'),
    getTelemetryLevel: request('settings:getTelemetryLevel'),
    setTelemetryLevel: request('settings:setTelemetryLevel'),
    // 设置导出/导入（app_settings 全表 JSON，version=1 格式；API Key 等 keychain 凭据不在其中）
    exportSettings: request('settings:export'),
    importSettings: request('settings:import'),
    // 恢复全部设置为默认：删除 SETTING_KEYS 全部键（app_settings 回到空表）
    resetAll: request('settings:resetAll'),
    // 设置变更事件：主进程侧的写入（如托盘菜单改关窗行为）广播该域新值，设置页据此回显
    subscribeChanged: event('settings:event:changed'),
  },

  proxy: {
    // 代理连通性探测：主进程先重读库内配置注入 proxiedFetch 再探轻量端点；mode 非 fixed 返回 not-applicable
    test: request('proxy:test'),
    // 清除已保存的代理凭据（keychain 保留键；渲染层只触发，不读取）
    clearAuth: request('proxy:clearAuth'),
  },

  secrets: {
    // 凭据存储：safeStorage 加密落 keychain.dat。刻意**不提供取明文的方法**——
    // 主进程业务代码直接 import getSecret，渲染层只可见掩码值
    isAvailable: request('secrets:isAvailable'),
    list: request('secrets:list'),
    set: request('secrets:set'),
    delete: request('secrets:delete'),
    getMasked: request('secrets:getMasked'),
  },

  system: {
    getStatus: request('system:getStatus'),
  },

  logs: {
    read: request('logs:read'),
  },

  telemetry: {
    // 渲染层错误转发：主进程统一落日志 + Sentry（无 IPC 桥的浏览器模式走本地 electron-log）
    captureError: request('telemetry:captureError'),
    // Web Vitals 批量上报：主进程转为 OTel histogram（遥测级别非 full 时丢弃）
    reportWebVitals: request('telemetry:reportWebVitals'),
    rendererReady: request('telemetry:rendererReady'),
    // 设置页可观测性状态卡：Sentry/OTel 启用态 + 管道健康
    getStatus: request('telemetry:getStatus'),
    // 连接测试：OTLP 真实探测；Sentry 仅校验 DSN 结构（不发送测试事件）
    testConnection: request('telemetry:testConnection'),
  },

  devtools: {
    open: request('devtools:open'),
  },

  dialog: {
    pickDirectory: request('dialog:pickDirectory'),
    pickFiles: request('dialog:pickFiles'),
  },

  invalidation: {
    // 缓存失效事件：主进程写路径声明受影响域后广播，渲染层按域前缀失效查询缓存
    subscribeDomains: event('invalidation:event:domains'),
  },

  update: {
    check: request('update:check'),
    install: request('update:install'),
    cancel: request('update:cancel'),
    getStatus: request('update:getStatus'),
    getCacheInfo: request('update:getCacheInfo'),
    clearCache: request('update:clearCache'),
    subscribeStatus: event('update:event:status'),
  },
} as const;

/** IPC 元数据表类型 */
export type IpcMeta = typeof IPC_META;

/** 元数据条目形状 */
export type MetaEntry = { readonly kind: 'request' | 'event'; readonly channel: string };
