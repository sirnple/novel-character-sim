"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const tableComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 w-full overflow-x-auto rounded border border-neutral-700/50">
      <table className="w-full border-collapse text-left text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-neutral-800/80 text-neutral-300">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-neutral-800/60">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="border-b border-neutral-800/40 last:border-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-2 py-1.5 font-mono font-medium text-neutral-300 whitespace-nowrap border-r border-neutral-700/40 last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-2 py-1.5 text-neutral-400 align-top border-r border-neutral-800/40 last:border-r-0">
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
