import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { mergeAttributes } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
import type { DocAsset, Prompt } from './types'
import { categoryDir, dirname, resolveAssetUrl } from './assetPath'

export interface RichEditorLabels {
  bold: string
  italic: string
  strike: string
  inlineCode: string
  h1: string
  h2: string
  h3: string
  bulletList: string
  orderedList: string
  blockquote: string
  codeBlock: string
  table: string
  tableActions: string
  addRow: string
  addColumn: string
  deleteRow: string
  deleteColumn: string
  deleteTable: string
  undo: string
  redo: string
  reference: string
  referenceSearch: string
  referencePrompts: string
  referenceFiles: string
  referenceEmpty: string
  chooseFile: string
  uploading: string
  uploadHint: string
  uploadFailed: string
}

export interface ReferencePickerData {
  prompts: Prompt[]
  assets: DocAsset[]
  currentFilePath?: string
  currentCategoryId: string
}

export interface RichEditorHandle {
  scrollToHeading: (index: number) => void
}

interface RichMarkdownEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder: string
  labels: RichEditorLabels
  references?: ReferencePickerData
  onUploadAsset?: (file: File) => Promise<DocAsset>
}

function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.split('/').filter(Boolean)
  const to = toPath.replace(/\\/g, '/').split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1
  return [...Array.from({ length: from.length - common }, () => '..'), ...to.slice(common)].join('/') || toPath
}

function ToolButton(props: {
  active?: boolean
  disabled?: boolean
  title: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`ld-rich-tool${props.active ? ' is-active' : ''}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  )
}

function createAssetImage(resolve: (src: string) => string) {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const src = String(HTMLAttributes.src ?? '')
      return ['img', mergeAttributes(HTMLAttributes, { src: resolve(src) })]
    },
  })
}

function ReferencePicker({
  t,
  references,
  query,
  onQueryChange,
  onClose,
  onPickPrompt,
  onPickAsset,
  onChooseFile,
  uploading,
  uploadError,
}: {
  t: RichEditorLabels
  references?: ReferencePickerData
  query: string
  onQueryChange: (value: string) => void
  onClose: () => void
  onPickPrompt: (prompt: Prompt) => void
  onPickAsset: (asset: DocAsset) => void
  onChooseFile: () => void
  uploading: boolean
  uploadError: string
}) {
  const q = query.trim().toLowerCase()
  const current = references?.currentFilePath
  const prompts = (references?.prompts ?? []).filter((prompt) =>
    !prompt.deletedAt &&
    prompt.filePath !== current &&
    (!q || `${prompt.title} ${prompt.filePath ?? ''}`.toLowerCase().includes(q)),
  ).slice(0, 30)
  const assets = (references?.assets ?? []).filter((asset) =>
    !q || `${asset.name} ${asset.path}`.toLowerCase().includes(q),
  ).slice(0, 30)

  return (
    <div className="ld-ref-picker" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div className="ld-ref-head">
        <span>{t.reference}</span>
        <button type="button" className="ld-ref-close" onClick={onClose} aria-label="close">×</button>
      </div>
      <input
        className="ld-ref-search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t.referenceSearch}
        autoFocus
      />
      <div className="ld-ref-list">
        {prompts.length > 0 && <div className="ld-ref-section">{t.referencePrompts}</div>}
        {prompts.map((prompt) => (
          <button
            key={`prompt:${prompt.id}`}
            type="button"
            className="ld-ref-item"
            onClick={() => onPickPrompt(prompt)}
          >
            <span className="ld-ref-kind">提示词</span>
            <span className="ld-ref-text">
              <strong>{prompt.title}</strong>
              <small>{prompt.filePath}</small>
            </span>
          </button>
        ))}
        {assets.length > 0 && <div className="ld-ref-section">{t.referenceFiles}</div>}
        {assets.map((asset) => (
          <button
            key={`asset:${asset.path}`}
            type="button"
            className="ld-ref-item"
            onClick={() => onPickAsset(asset)}
          >
            <span className="ld-ref-kind">{asset.kind === 'image' ? '图片' : '文件'}</span>
            <span className="ld-ref-text">
              <strong>{asset.name}</strong>
              <small>{asset.path}</small>
            </span>
          </button>
        ))}
        {prompts.length === 0 && assets.length === 0 && (
          <div className="ld-ref-empty">{t.referenceEmpty}</div>
        )}
      </div>
      <div className="ld-ref-upload">
        <button type="button" onClick={onChooseFile} disabled={uploading}>
          {uploading ? t.uploading : t.chooseFile}
        </button>
        <span>{t.uploadHint}</span>
      </div>
      {uploadError && <div className="ld-ref-error">{t.uploadFailed}：{uploadError}</div>}
    </div>
  )
}

export const RichMarkdownEditor = forwardRef<RichEditorHandle, RichMarkdownEditorProps>(function RichMarkdownEditor({ content, onChange, placeholder, labels, references, onUploadAsset }, ref) {
  const onChangeRef = useRef(onChange)
  const lastMarkdownRef = useRef(content)
  onChangeRef.current = onChange
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentDir = references?.currentFilePath
    ? dirname(references.currentFilePath)
    : categoryDir(references?.currentCategoryId ?? '')
  const currentDirRef = useRef(currentDir)
  currentDirRef.current = currentDir
  const imageExtension = useMemo(
    () => createAssetImage((src: string) => resolveAssetUrl(src, currentDirRef.current)),
    [],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false },
      }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
      Placeholder.configure({ placeholder }),
      TableKit,
      imageExtension,
    ],
    content,
    contentType: 'markdown',
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: 'ld-tiptap',
        spellcheck: 'false',
      },
    },
    onUpdate({ editor: current }) {
      const markdown = current.getMarkdown()
      lastMarkdownRef.current = markdown
      onChangeRef.current(markdown)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (content === lastMarkdownRef.current) return
    lastMarkdownRef.current = content
    editor.commands.setContent(content, { contentType: 'markdown' })
  }, [content, editor])

  // Subscribe to selection/transaction changes. Without this, toggling a mark
  // with a collapsed caret changes the stored mark but not the document, so
  // the toolbar would never re-render and its active state would stick.
  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      h1: current.isActive('heading', { level: 1 }),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'),
      table: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    } : null,
  })

  useImperativeHandle(ref, () => ({
    scrollToHeading(index: number) {
      if (!editor) return
      const headings = editor.view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6')
      const target = headings[index]
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
    },
  }), [editor])

  if (!editor) return <div className="ld-rich-loading">正在加载编辑器…</div>

  const undo = () => editor.chain().focus().undo().run()
  const redo = () => editor.chain().focus().redo().run()

  function insertLink(text: string, href: string) {
    if (!href.trim()) return
    editor.chain().focus().insertContent({
      type: 'text',
      text: text || href,
      marks: [{ type: 'link', attrs: { href } }],
    }).run()
    setPickerOpen(false)
    setPickerQuery('')
  }

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length === 0 || !onUploadAsset) return
    setUploading(true)
    setUploadError('')
    try {
      for (const file of files) {
        const asset = await onUploadAsset(file)
        const href = relativePath(currentDir, asset.path)
        if (asset.kind === 'image') {
          editor.chain().focus().setImage({ src: href, alt: asset.name }).run()
        } else {
          editor.chain().focus().insertContent({
            type: 'text',
            text: asset.name,
            marks: [{ type: 'link', attrs: { href } }],
          }).run()
        }
      }
      setPickerOpen(false)
      setPickerQuery('')
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : '复制文件失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="ld-rich-editor">
      <div className="ld-rich-toolbar" role="toolbar" aria-label={labels.bold}>
        <ToolButton title={labels.h1} active={toolbar?.h1} onPress={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolButton>
        <ToolButton title={labels.h2} active={toolbar?.h2} onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
        <ToolButton title={labels.h3} active={toolbar?.h3} onPress={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
        <span className="ld-rich-sep" />
        <ToolButton title={labels.bold} active={toolbar?.bold} onPress={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolButton>
        <ToolButton title={labels.italic} active={toolbar?.italic} onPress={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolButton>
        <ToolButton title={labels.strike} active={toolbar?.strike} onPress={() => editor.chain().focus().toggleStrike().run()}><span style={{ textDecoration: 'line-through' }}>S</span></ToolButton>
        <ToolButton title={labels.inlineCode} active={toolbar?.code} onPress={() => editor.chain().focus().toggleCode().run()}><span className="ld-rich-code-glyph">{'<>'}</span></ToolButton>
        <span className="ld-rich-sep" />
        <ToolButton title={labels.bulletList} active={toolbar?.bulletList} onPress={() => editor.chain().focus().toggleBulletList().run()}>•</ToolButton>
        <ToolButton title={labels.orderedList} active={toolbar?.orderedList} onPress={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolButton>
        <ToolButton title={labels.blockquote} active={toolbar?.blockquote} onPress={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolButton>
        <ToolButton title={labels.codeBlock} active={toolbar?.codeBlock} onPress={() => editor.chain().focus().toggleCodeBlock().run()}>{'{ }'}</ToolButton>
        <ToolButton title={labels.table} active={toolbar?.table} onPress={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</ToolButton>
        <span className="ld-rich-sep" />
        <ToolButton title={labels.undo} disabled={!toolbar?.canUndo} onPress={undo}>↶</ToolButton>
        <ToolButton title={labels.redo} disabled={!toolbar?.canRedo} onPress={redo}>↷</ToolButton>
        <span className="ld-rich-sep" />
        <ToolButton
          title={labels.reference}
          active={pickerOpen}
          onPress={() => setPickerOpen((value) => !value)}
        >
          {labels.reference}
        </ToolButton>
      </div>
      {toolbar?.table && (
        <div className="ld-table-tools" role="toolbar" aria-label={labels.tableActions}>
          <span className="ld-table-tools-label">{labels.tableActions}</span>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>{labels.addRow}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>{labels.addColumn}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>{labels.deleteRow}</button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>{labels.deleteColumn}</button>
          <button type="button" className="danger" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}>{labels.deleteTable}</button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
      {pickerOpen && (
        <ReferencePicker
          t={labels}
          references={references}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          onClose={() => setPickerOpen(false)}
          onPickPrompt={(prompt) => {
            const target = prompt.filePath
            if (!target) return
            insertLink(prompt.title || target, relativePath(currentDir, target))
          }}
          onPickAsset={(asset) => {
            const href = relativePath(currentDir, asset.path)
            if (asset.kind === 'image') {
              editor.chain().focus().setImage({ src: href, alt: asset.name }).run()
              setPickerOpen(false)
              setPickerQuery('')
              return
            }
            insertLink(asset.name, href)
          }}
          onChooseFile={() => fileInputRef.current?.click()}
          uploading={uploading}
          uploadError={uploadError}
        />
      )}
      <div className="ld-rich-scroll">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
})
