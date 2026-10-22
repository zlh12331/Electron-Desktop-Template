import { createHashRouter } from 'react-router';
import { ROUTES } from '@/lib/constants';
import { RootErrorBoundary, RootHydrateFallback, RootLayout } from './routes/root';

/**
 * 应用路由配置
 *
 * 使用 RR8 Data Mode：createHashRouter + RouterProvider。
 * hash 路由原因：生产构建以 file:// 加载（Electron loadFile），history 路由
 * 在 file:// 下 pathname 为文件路径导致全部路由 404；hash 路由在 dev（http）
 * 与生产（file）均正常工作。
 *
 * 代码分割：页面统一用 route.lazy 按需加载，首屏不包含页面级依赖。
 * 新增页面：lib/constants.ts 加路径常量 → 此处加一条 children → 新建 routes/<page>.tsx。
 */
export const router = createHashRouter([
  {
    path: ROUTES.home,
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    // biome-ignore lint/style/useNamingConvention: React Router 8 路由 API 要求 PascalCase 属性名
    HydrateFallback: RootHydrateFallback,
    children: [
      {
        index: true,
        lazy: async () => {
          const { HomePage } = await import('./routes/home');
          // biome-ignore lint/style/useNamingConvention: React Router lazy 要求模块导出 Component
          return { Component: HomePage };
        },
      },
      {
        path: ROUTES.about,
        lazy: async () => {
          const { AboutPage } = await import('./routes/about');
          // biome-ignore lint/style/useNamingConvention: React Router lazy 要求模块导出 Component
          return { Component: AboutPage };
        },
      },
    ],
  },
]);
