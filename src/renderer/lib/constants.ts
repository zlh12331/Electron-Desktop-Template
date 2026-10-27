/**
 * 应用路由路径常量
 *
 * 设计：
 * - 提供 path 模板（用于 router 声明）
 * - 提供工厂函数（用于组件导航跳转），避免手写字符串拼接
 *
 * @example
 * ```tsx
 * // 路由声明
 * <Route path={ROUTES.home} element={<HomePage />} />
 *
 * // 导航跳转
 * navigate(ROUTES.home);
 * ```
 */
export const ROUTES = {
  /** 首页（欢迎页） */
  home: '/',
  // notes-example:start
  /** Local Notes 参考切片：列表页（随示例整体删除） */
  notes: '/notes',
  /** Local Notes 参考切片：单条详情页（深链目标） */
  note: (id: string) => `/notes/${encodeURIComponent(id)}`,
  // notes-example:end
} as const;

/**
 * 响应式断点（px）— 与 useLayoutBreakpoint 对齐
 *
 * 低于该宽度时触发对应面板自动显隐：
 * - BREAKPOINT_COMPACT：右面板应自动隐藏（可浮层抽屉唤出）
 * - BREAKPOINT_NARROW：侧栏应自动隐藏（可浮层抽屉唤出）
 */
export const BREAKPOINT_COMPACT = 1200;
export const BREAKPOINT_NARROW = 900;
