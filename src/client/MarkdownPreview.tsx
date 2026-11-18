import { useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, FileText } from 'lucide-react'

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const text = preRef.current?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="code-block">
      <button
        type="button"
        className="code-copy-button"
        onClick={copy}
        title={copied ? '已复制' : '复制代码'}
        aria-label="复制代码"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

interface MarkdownPreviewProps {
  content: string
  resolveImage?: (src: string) => string
}

export function MarkdownPreview({ content, resolveImage }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return (
      <div className="markdown-empty">
        <FileText size={28} strokeWidth={1.4} />
        <p>还没有正文</p>
        <span>用 Markdown 写下提示词内容，这里会实时预览。</span>
      </div>
    )
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => {
            void _node
            return <a {...props} target="_blank" rel="noopener noreferrer" />
          },
          pre: ({ node: _node, ...props }) => {
            void _node
            return <CodeBlock {...props} />
          },
          table: ({ node: _node, ...props }) => {
            void _node
            return (
              <div className="table-wrap">
                <table {...props} />
              </div>
            )
          },
          img: ({ node: _node, src, ...props }) => {
            void _node
            const resolved = src && resolveImage ? resolveImage(src) : src
            return <img {...props} src={resolved} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
