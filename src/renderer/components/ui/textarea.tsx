import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 基础多行文本域
 *
 * 包装原生 <textarea>，套用 Input 相同的边框/焦点/禁用态令牌。
 *
 * @example
 * <Textarea aria-label="正文" value={body} onChange={...} />
 */
export function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>): React.ReactElement {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
