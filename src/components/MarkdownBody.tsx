"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownBody({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`markdown-body max-w-none text-[17px] leading-7 text-ink ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mt-4 font-serif text-2xl first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 font-serif text-xl first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 font-serif text-lg first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="mt-2 font-serif first:mt-0">{children}</p>,
          ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5 font-serif">{children}</ul>,
          ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 font-serif">{children}</ol>,
          li: ({ children }) => <li className="leading-7">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ className: cn, children }) => {
            const inline = !cn;
            if (inline) {
              return (
                <code className="border border-ink/15 bg-paper-2 px-1 py-0.5 font-mono text-[0.85em]">
                  {children}
                </code>
              );
            }
            return (
              <code className="block overflow-x-auto border border-ink/15 bg-paper-2 p-3 font-mono text-sm leading-6">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mt-3 overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="mt-3 border-l-2 border-ink/30 pl-3 text-ink-mute">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[20rem] border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-ink/25">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-ink/10">{children}</tr>,
          th: ({ children }) => (
            <th className="px-2 py-1.5 font-sans text-xs tracking-wide text-ink-mute uppercase">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="px-2 py-1.5 font-serif align-top">{children}</td>,
          hr: () => <hr className="my-4 border-ink/15" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
