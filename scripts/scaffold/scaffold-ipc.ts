// scripts/scaffold/scaffold-ipc.ts
// IPC 脚手架：从定义表体系生成新域/新方法骨架，自动完成 meta.ts 插通道元数据、
// domains/<domain>.ts 插 schema 绑定（新域同时登记 domains/index.ts）、handler 骨架
// 用法：pnpm scaffold:ipc --domain <name> --method <method> [--kind request|event]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedArgs } from './lib/args';
import { optionalValue, parseArgs, rejectPositionals, requireValue } from './lib/args';
import { camelToPascal, isValidDomain, isValidMethod } from './lib/naming';
import { insertBeforeAnchor, insertIntoObjectBlock, insertSortedLine } from './lib/text';

/** 仓库根（scripts/scaffold/ → 根） */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface MethodSpec {
  readonly domain: string;
  readonly method: string;
  readonly kind: 'request' | 'event';
}

/** 读取文件（不存在时抛错） */
function readSource(relativePath: string): string {
  const abs = path.join(REPO_ROOT, relativePath);
  if (!existsSync(abs)) {
    throw new Error(`目标文件不存在：${relativePath}`);
  }
  return readFileSync(abs, 'utf8');
}

/** 校验 + 组装方法描述 */
function buildMethodSpec(parsedArgs: ParsedArgs): MethodSpec {
  const domain = requireValue(parsedArgs, 'domain');
  const method = requireValue(parsedArgs, 'method');
  const kind = optionalValue(parsedArgs, 'kind', 'request');

  if (!isValidDomain(domain)) {
    throw new Error(
      `非法 domain：${domain}（要求 camelCase，小写字母开头，如 session / codebase）`,
    );
  }
  if (!isValidMethod(method)) {
    throw new Error(
      `非法 method：${method}（要求 camelCase，小写字母开头，如 getStatus / listRecentDirs）`,
    );
  }
  if (kind !== 'request' && kind !== 'event') {
    throw new Error(`非法 kind：${kind}（仅支持 request / event）`);
  }
  return { domain, method, kind };
}

/** 幂等校验：以通道字符串形式检查是否已存在（防止重复运行覆盖已有方法） */
function assertChannelAbsent(
  source: string,
  fileLabel: string,
  needle: string,
  channel: string,
): void {
  if (source.includes(needle)) {
    throw new Error(`通道已存在（${fileLabel}）：${channel}，请勿重复脚手架`);
  }
}

/** 生成 meta.ts 的方法行 */
function metaEntryLine(spec: MethodSpec): string {
  const { domain, method, kind } = spec;
  const channel = `${domain}:${method}`;
  return kind === 'request'
    ? `    ${method}: request('${channel}'),`
    : `    ${method}: event('${channel}'),`;
}

/** 生成域定义文件的占位条目（含 TODO 注释，多行） */
function definitionsEntryBlock(spec: MethodSpec): string {
  const { domain, method, kind } = spec;
  if (kind === 'request') {
    // 第 4 参 resSchema 必填：register.ts 启动期断言响应契约存在，缺失直接抛错拒启
    return [
      '    // TODO: 替换 null schema / OkResSchema 与 {} as { ok: boolean } 为真实契约',
      `    ${method}: withSchema(IPC_META.${domain}.${method}, null, {} as { ok: boolean }, OkResSchema),`,
    ].join('\n');
  }
  return [
    '    // TODO: 替换 {} as Record<string, never> 为真实 payload 类型',
    `    ${method}: withPayload(IPC_META.${domain}.${method}, {} as Record<string, never>),`,
  ].join('\n');
}

/** 新域块（meta.ts 用，块前空行与上一域分隔） */
function metaDomainBlock(spec: MethodSpec): string {
  return `\n  ${spec.domain}: {\n${metaEntryLine(spec)}\n  },\n`;
}

/** 新域文件内容（domains/<domain>.ts，新建域时生成） */
function buildDomainFile(spec: MethodSpec): string {
  const { domain, kind } = spec;
  const withLine =
    kind === 'request'
      ? "import { withSchema } from '../with-schema';"
      : "import { withPayload } from '../with-schema';";
  return [
    `// domains/${domain}.ts：${domain} 域 IPC 定义（channel 元数据见 ../meta.ts，聚合见 ../definitions.ts）`,
    '// 边界：只声明本域方法与 schema 绑定；删除一个域 = 删本文件 + ../meta.ts 域块 + ../domains/index.ts 登记',
    '',
    "import { OkResSchema } from '../../schemas/app';",
    "import { IPC_META } from '../meta';",
    withLine,
    '',
    `export const ${domain}Domain = {`,
    definitionsEntryBlock(spec),
    '} as const;',
    '',
  ].join('\n');
}

/** handler 骨架文件内容 */
function buildHandlerFile(spec: MethodSpec): string {
  const { domain, method, kind } = spec;
  const Domain = camelToPascal(domain);
  const channelsLine =
    kind === 'request'
      ? `// - ${domain}:${method}：TODO: 一句话职责`
      : `// - ${domain}:${method}（event，主进程主动推送，无需 handler 实现）`;
  const impl =
    kind === 'request'
      ? [
          '  // TODO: 实现业务逻辑；服务依赖通过工厂函数注入（参考 file.handler.ts / session.handler.ts）',
          `  ${method}: async (input) => {`,
          '    void input;',
          '    // TODO: 返回类型需与 definitions.ts 的 res 占位一致',
          '    return { ok: true };',
          '  },',
        ].join('\n')
      : '  // TODO: 定义表新增 request 方法后在此实现（缺失会编译期报错）';

  return [
    `// src/main/ipc/${domain}.handler.ts`,
    `// ${Domain} 域 IPC handler（定义表驱动，注册由 registerIpcHandlers 统一执行）`,
    '//',
    `// 当前实现 1 个 channel：`,
    channelsLine,
    '//',
    '// 说明：handler 对象形状受 InferHandlers 约束（缺方法编译期报错）；',
    '// channel / schema 由 IPC_DEFINITIONS 提供，本文件只写业务实现。',
    '',
    `import type { InferHandlers, IPC_DEFINITIONS } from '@code-agent/shared/main';`,
    '',
    "import type { IpcHandlerContext } from '../utils/wrap';",
    '',
    `/** ${Domain} 域 handler 实现（${domain} 域） */`,
    `export const ${domain}Handlers: InferHandlers<`,
    '  typeof IPC_DEFINITIONS,',
    '  IpcHandlerContext',
    `>['${domain}'] = {`,
    impl,
    '};',
    '',
  ].join('\n');
}

/** 写入 handler 骨架（已存在时仅提示） */
function writeHandlerSkeleton(spec: MethodSpec): void {
  const relative = `src/main/ipc/${spec.domain}.handler.ts`;
  const abs = path.join(REPO_ROOT, relative);
  if (existsSync(abs)) {
    console.log(`[跳过] handler 已存在：${relative}`);
    if (spec.kind === 'request') {
      console.log(`  → 请在该文件补实现 ${spec.domain}.${spec.method}（缺失会编译期报错）`);
    }
    return;
  }
  writeFileSync(abs, buildHandlerFile(spec), 'utf8');
  console.log(`[生成] ${relative}`);
}

/**
 * 新域 handler 注册到 src/main/index.ts（import + registerIpcHandlers 条目）
 *
 * 只在新域首次生成时执行；已存在的域由使用者自行改注册方式（工厂注入等）。
 */
function registerHandlerInIndex(spec: MethodSpec): void {
  const relative = 'src/main/index.ts';
  const abs = path.join(REPO_ROOT, relative);
  let source = readFileSync(abs, 'utf8');
  const { domain } = spec;

  const importLine = `import { ${domain}Handlers } from './ipc/${domain}.handler';`;
  const withImport = insertSortedLine(
    source,
    /^import \{ [a-zA-Z]+ \} from '\.\/ipc\/[a-zA-Z-]+\.handler';$/m,
    importLine,
    (line) =>
      line.replace(/^import \{ [a-zA-Z]+ \} from '\.\/ipc\//, '').replace(/\.handler';$/, ''),
  );
  if (withImport === null) {
    throw new Error('src/main/index.ts 插入 handler import 失败：未找到同形 import 行');
  }
  source = withImport;

  const withEntry = insertIntoObjectBlock(
    source,
    '    registerIpcHandlers({',
    `      ${domain}: ${domain}Handlers,`,
    '    });',
  );
  if (withEntry === null) {
    throw new Error('src/main/index.ts 插入 registerIpcHandlers 条目失败：未找到调用块');
  }
  source = withEntry;
  writeFileSync(abs, source, 'utf8');
  console.log(`[更新] ${relative}（注册 ${domain} handler）`);
}

/** 排序键：取行内 from './<name>' 的 name（无则回退整行） */
function domainKeyOf(line: string): string {
  const m = /from '\.\/([a-zA-Z]+)'/.exec(line);
  return m?.[1] ?? line;
}

/** 新域登记到 domains/index.ts（import + 域册条目 + 再导出三处） */
function registerDomainInIndex(spec: MethodSpec): void {
  const relative = 'packages/shared/src/ipc/domains/index.ts';
  const abs = path.join(REPO_ROOT, relative);
  let source = readFileSync(abs, 'utf8');
  const { domain } = spec;

  const withImport = insertSortedLine(
    source,
    /^import \{ [a-zA-Z]+Domain \} from '\.\/[a-zA-Z]+';$/m,
    `import { ${domain}Domain } from './${domain}';`,
    domainKeyOf,
  );
  if (withImport === null) {
    throw new Error('domains/index.ts 插入 import 失败：未找到同形 import 行');
  }
  source = withImport;
  const withRegistry = insertIntoObjectBlock(
    source,
    'export const IPC_DOMAINS = {',
    `  ${domain}: ${domain}Domain,`,
    '} as const;',
  );
  if (withRegistry === null) {
    throw new Error('domains/index.ts 插入域册条目失败：未找到 IPC_DOMAINS 对象块');
  }
  source = withRegistry;
  const withExport = insertSortedLine(
    source,
    /^export \{ [a-zA-Z]+Domain \} from '\.\/[a-zA-Z]+';$/m,
    `export { ${domain}Domain } from './${domain}';`,
    domainKeyOf,
  );
  if (withExport === null) {
    throw new Error('domains/index.ts 插入 export 失败：未找到同形 export 行');
  }
  source = withExport;
  writeFileSync(abs, source, 'utf8');
  console.log(`[更新] ${relative}（登记 ${domain} 域）`);
}

/** 打印手动步骤指引 */
function printManualSteps(spec: MethodSpec): void {
  const { domain, kind } = spec;
  const Domain = camelToPascal(domain);
  console.log('');
  console.log('手动完成（脚手架无法机械推断的部分）：');
  if (kind === 'request') {
    console.log(`  1. 实现 handler：src/main/ipc/${domain}.handler.ts 的 ${spec.method}`);
    console.log(
      `  2. 把 packages/shared/src/ipc/domains/${domain}.ts 的占位契约替换为真实 schema（建议新建 schemas/${domain}.ts）`,
    );
    console.log(
      `  3. 补测试：src/main/ipc/${domain}.handler.test.ts（参考 dialog.handler.test.ts）`,
    );
  } else {
    console.log(
      `  1. 在需要的地方推送事件：emitEvent(webContents, IPC_DEFINITIONS.${domain}.${spec.method}, payload)`,
    );
    console.log(
      `  2. 把 packages/shared/src/ipc/domains/${domain}.ts 的占位 payload 替换为真实类型`,
    );
  }
  console.log(
    `  如需工厂注入服务，参考 createProxyHandlers() / createUpdateHandlers({ updateService }) 的写法`,
  );
  console.log('');
  console.log('红利已自动生效（无需手写）：');
  console.log('  - IPC_CHANNELS 常量 / window.api（preload createIpcApi）/ IpcApi 类型');
  console.log(`  - ${Domain} 域已登记进 domains/index.ts，handler 已注册进 src/main/index.ts`);
}

/** 主流程 */
function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  rejectPositionals(parsed);
  const spec = buildMethodSpec(parsed);
  const channel = `${spec.domain}:${spec.method}`;
  const domainHeader = `  ${spec.domain}: {`;

  const metaPath = 'packages/shared/src/ipc/meta.ts';
  const metaSource = readSource(metaPath);
  assertChannelAbsent(metaSource, metaPath, `('${channel}')`, channel);
  const metaUpdated = metaSource.includes(domainHeader)
    ? insertIntoObjectBlock(metaSource, domainHeader, metaEntryLine(spec))
    : insertBeforeAnchor(metaSource, '} as const;', metaDomainBlock(spec));
  if (metaUpdated === null) {
    throw new Error(`meta.ts 插入失败：未找到块 ${domainHeader} 或锚点 '} as const;'`);
  }
  writeFileSync(path.join(REPO_ROOT, metaPath), metaUpdated, 'utf8');
  console.log(`[更新] ${metaPath}（${channel}）`);

  // 域定义：已存在则块内追加，新域则建文件并登记域册
  const domainPath = `packages/shared/src/ipc/domains/${spec.domain}.ts`;
  const domainAbs = path.join(REPO_ROOT, domainPath);
  if (existsSync(domainAbs)) {
    const domainSource = readFileSync(domainAbs, 'utf8');
    assertChannelAbsent(
      domainSource,
      domainPath,
      `IPC_META.${spec.domain}.${spec.method}`,
      channel,
    );
    const updated = insertIntoObjectBlock(
      domainSource,
      `export const ${spec.domain}Domain = {`,
      definitionsEntryBlock(spec),
      '} as const;',
    );
    if (updated === null) {
      throw new Error(`${domainPath} 插入失败：未找到 ${spec.domain}Domain 对象块`);
    }
    writeFileSync(domainAbs, updated, 'utf8');
    console.log(`[更新] ${domainPath}（占位 schema，TODO 待替换）`);
  } else {
    writeFileSync(domainAbs, buildDomainFile(spec), 'utf8');
    console.log(`[生成] ${domainPath}`);
    registerDomainInIndex(spec);
    registerHandlerInIndex(spec);
  }

  writeHandlerSkeleton(spec);

  printManualSteps(spec);
}

try {
  main();
} catch (error: unknown) {
  console.error(`[失败] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
