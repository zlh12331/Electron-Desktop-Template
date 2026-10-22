import { type ReactElement, type ReactNode, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/use-translation';
import { cn } from '@/lib/utils';

/**
 * 更新说明排版映射
 *
 * 内容来自 electron-updater 的 releaseNotes，交付格式有两种：latest.yml 内嵌
 * notes 时是真 Markdown；GitHub provider 的 latest.yml 无内嵌时回退 releases.atom
 * 订阅源——那里是 GitHub **渲染后的 HTML**（blockquote/g-emoji/hovercard 属性），
 * 不是 Markdown。渲染走 remark-gfm（Markdown 结构）+ rehype-raw（把内嵌 HTML
 * 解析回元素，两种格式同一条管线）+ rehype-sanitize（raw HTML 进渲染层的纵深
 * 防御，默认 schema 足够：丢 g-emoji/hovercard 属性，保结构与链接）。
 * components 映射为设置面板的紧凑排版；不用 shiki（更新日志无代码块场景）。
 */
const NOTES_MARKDOWN_COMPONENTS = {
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-foreground/20 border-l-2 pl-2 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <p className="text-foreground text-xs font-medium">{children}</p>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <p className="text-foreground text-xs font-medium">{children}</p>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <p className="text-foreground mt-2 text-xs font-medium">{children}</p>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-muted-foreground text-xs leading-[1.6]">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => <ul className="ml-4 list-disc">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="ml-4 list-decimal">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => (
    <li className="text-muted-foreground text-xs leading-[1.6]">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-foreground/90 font-medium">{children}</strong>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string | undefined }) => (
    <a
      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="bg-foreground/5 rounded px-1 font-mono text-xs">{children}</code>
  ),
} satisfies Components;

/** 更新说明折叠区（仅在有 releaseNotes 时渲染） */
export function ReleaseNotes({ notes }: { readonly notes: string }): ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex w-full flex-col items-start gap-1">
      <span className="text-muted-foreground text-xs">{t('update.notesTitle')}</span>
      <div
        className={cn(
          'w-full overflow-hidden transition-[max-height]',
          expanded ? 'max-h-none' : 'max-h-32',
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
          components={NOTES_MARKDOWN_COMPONENTS}
        >
          {notes}
        </ReactMarkdown>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setExpanded((prev) => !prev)}>
        {expanded ? t('update.notesCollapse') : t('update.notesExpand')}
      </Button>
    </div>
  );
}
