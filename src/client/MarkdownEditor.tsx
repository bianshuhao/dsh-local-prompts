import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import hljs from 'highlight.js/lib/core'
import markdown from 'highlight.js/lib/languages/markdown'
import { cursorPosition } from './format'

hljs.registerLanguage('markdown', markdown)

export interface EditorHandle {
  focus: () => void
  scrollToLine: (line: number) => void
  wrapSelection: (before: string, after: string, placeholder: string) => void
  prefixLine: (prefix: string) => void
  insertBlock: (text: string, cursorOffset?: number) => void
}

interface MarkdownEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
  wrap?: boolean
}

export const MarkdownEditor = forwardRef<EditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { content, onChange, placeholder = '开始编写 Markdown…', wrap = false },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [activeLine, setActiveLine] = useState(1)
  const [wrapLines, setWrapLines] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)')
    const handleChange = () => setWrapLines(query.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const wrapped = wrapLines || wrap
  const lineCount = Math.max(1, content.split('\n').length)
  const highlighted = useMemo(() => {
    if (!content) return ''
    try {
      const html = hljs.highlight(content, { language: 'markdown', ignoreIllegals: true }).value
      // 区分行内代码与围栏代码块，分别使用不同颜色
      return html.replace(/<span class="hljs-code">([\s\S]*?)<\/span>/g, (match, inner: string) =>
        inner.includes('\n') ? `<span class="hljs-code hljs-code-block">${inner}</span>` : match,
      )
    } catch {
      return ''
    }
  }, [content])

  const syncScroll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-textarea.scrollTop}px)`
    }
  }

  const syncCursor = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const position = cursorPosition(textarea.value, textarea.selectionStart)
    setActiveLine(position.line)
  }

  useEffect(() => {
    syncScroll()
    syncCursor()
    // 内容切换时同步一次滚动与光标显示
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const applyEdit = (
    nextContent: string,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    onChange(nextContent)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
      syncCursor()
      syncScroll()
    })
  }

  const wrapSelection = (before: string, after: string, placeholderText: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = content.slice(start, end) || placeholderText
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`
    applyEdit(next, start + before.length, start + before.length + selected.length)
  }

  const prefixLine = (prefix: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const next = `${content.slice(0, lineStart)}${prefix}${content.slice(lineStart)}`
    const position = start + prefix.length
    applyEdit(next, position, position)
  }

  const scrollToLine = (line: number) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const lines = content.split('\n')
    const target = Math.min(Math.max(1, line), Math.max(1, lines.length))
    let offset = 0
    for (let index = 0; index < target - 1; index += 1) offset += lines[index].length + 1
    const end = offset + (lines[target - 1]?.length ?? 0)
    textarea.focus()
    textarea.setSelectionRange(offset, end)
    const computed = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(computed.lineHeight) || 26
    textarea.scrollTop = Math.max(0, (target - 1) * lineHeight - textarea.clientHeight / 3)
    syncScroll()
    syncCursor()
  }

  const insertBlock = (block: string, cursorOffset?: number) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const needsLeadingNewline = start > 0 && content[start - 1] !== '\n'
    const needsTrailingNewline = end < content.length && content[end] !== '\n'
    const prefix = needsLeadingNewline ? '\n' : ''
    const suffix = needsTrailingNewline ? '\n' : ''
    const inserted = `${prefix}${block}${suffix}`
    const next = `${content.slice(0, start)}${inserted}${content.slice(end)}`
    const position = start + prefix.length + (cursorOffset ?? inserted.length)
    applyEdit(next, position, position)
  }

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    scrollToLine,
    wrapSelection,
    prefixLine,
    insertBlock,
  }))

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const textarea = event.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const next = `${content.slice(0, start)}  ${content.slice(end)}`
      applyEdit(next, start + 2, start + 2)
      return
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const textarea = event.currentTarget
      const start = textarea.selectionStart
      if (start !== textarea.selectionEnd) return
      const lineStart = content.lastIndexOf('\n', start - 1) + 1
      const currentLine = content.slice(lineStart, start)
      const listMatch = currentLine.match(/^(\s*)([-*+]|(\d+)\.)\s+(.*)$/)
      if (!listMatch) return
      event.preventDefault()
      const indent = listMatch[1]
      const marker = listMatch[2]
      const rest = listMatch[4]
      if (!rest.trim()) {
        const next = `${content.slice(0, lineStart)}${indent}${content.slice(start)}`
        applyEdit(next, lineStart + indent.length, lineStart + indent.length)
        return
      }
      const nextMarker = /\d+\./.test(marker) ? `${Number(listMatch[3]) + 1}.` : marker
      const insertion = `\n${indent}${nextMarker} `
      const next = `${content.slice(0, start)}${insertion}${content.slice(start)}`
      const position = start + insertion.length
      applyEdit(next, position, position)
    }
  }

  return (
    <div className={`markdown-editor${wrapped ? ' is-wrapped' : ''}`}>
      <div className="line-gutter" aria-hidden="true">
        <div className="line-gutter-inner" ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, index) => (
            <div
              key={index}
              className={`line-number${index + 1 === activeLine ? ' is-active' : ''}`}
            >
              {index + 1}
            </div>
          ))}
        </div>
      </div>

      <div className="editor-canvas">
        <pre className="highlight-layer" ref={highlightRef} aria-hidden="true">
          <code
            className="hljs language-markdown"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          value={content}
          onChange={(event) => {
            onChange(event.target.value)
            const position = cursorPosition(event.target.value, event.target.selectionStart)
            setActiveLine(position.line)
          }}
          onScroll={syncScroll}
          onSelect={syncCursor}
          onClick={syncCursor}
          onKeyUp={syncCursor}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Markdown 编辑器"
          spellCheck={false}
          wrap={wrapped ? 'soft' : 'off'}
        />
        {!content && <div className="editor-placeholder">{placeholder}</div>}
      </div>
    </div>
  )
})
