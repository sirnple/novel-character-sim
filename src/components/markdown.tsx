"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const tableComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 w-full overflow-x-auto rounded border border-border/50">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-secondary/80 text-foreground/90">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-neutral-800/60">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="border-b border-border/60 last:border-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-2 py-1.5 font-mono font-medium text-foreground/90 whitespace-nowrap border-r border-border/40 last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-2 py-1.5 text-muted-foreground align-top border-r border-border/60 last:border-r-0">
      {children}
    </td>
  ),
};

interface MarkdownProps {
  children: string;
  className?: string;
}

/** GFM markdown (tables, strikethrough, task lists, autolinks). */
export default function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("prose prose-invert prose-xs max-w-none [&_pre]:whitespace-pre-wrap", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={tableComponents as any}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
