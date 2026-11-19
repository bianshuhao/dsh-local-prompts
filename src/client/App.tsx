import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Category, DocAsset, Prompt } from './types'
import { useDocsData, type DocValues } from './useDocsData'
import { MarkdownEditor, type EditorHandle } from './MarkdownEditor'
import { RichMarkdownEditor, type RichEditorHandle } from './RichMarkdownEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { buildTocTree, extractToc, type TocEntry, type TocNode } from './toc'
import { countChars, formatDateTime, relativeTime } from './format'
import { docDir, resolveAssetUrl } from './assetPath'

import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  GridIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  SortIcon,
  TocIcon,
  TrashIcon,
  XIcon,
} from './icons'
import styles from './styles.css'

type Translate = (key: string) => string
type View = 'all' | 'trash' | string
type SortKey = 'updated' | 'created' | 'title'
type EditorState = { mode: 'create' } | { mode: 'edit'; prompt: Prompt }
type FolderDialogState = { mode: 'create' } | { mode: 'rename'; category: Category }

const ROOT_CATEGORY_ID = 'dir:__root__'
const ALL = 'all'
const TRASH = 'trash'

function tr(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

function joinCount(count: number, noun: string): string {
  return `${count} ${noun}`
}

/** Keep the client's filename in sync with the server's title sanitizer. */
function folderLeafName(category: Category): string {
  return category.id.startsWith('dir:') ? (category.id.slice(4).split('/').pop() ?? '') : ''
}

function normalizeTitle(value: string): string {
  return value
    .replace(/\.(md|markdown|txt)$/i, '')
    .replace(/[\\/:*?"<>|\u0000]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
}

interface AppProps {
  t: Translate
}

export function LocalDocsApp({ t }: AppProps) {
  const {
    workspace, trash, assets, root, status, error, reload, uploadAsset, updateRoot,
    createFolder, renameFolder, deleteFolder,
    createPrompt, updatePrompt, trashPrompt, restorePrompt, purgePrompt, emptyTrash,
  } = useDocsData()
  const { prompts } = workspace
  const categories = useMemo(
    () => workspace.categories.filter((category) =>
      category.id !== 'dir:assets' && !category.id.startsWith('dir:assets/')),
    [workspace.categories],
  )

  const [view, setView] = useState<View>(ALL)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [editing, setEditing] = useState<EditorState | null>(null)
  const [localOpen, setLocalOpen] = useState(false)
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null)
  const [folderToDelete, setFolderToDelete] = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<Prompt | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: 'success' | 'error' | 'info' }>>([])
  const [compact, setCompact] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const toastId = useRef(0)

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const activePrompts = useMemo(
    () => prompts.filter((prompt) => !prompt.deletedAt),
    [prompts],
  )
  const totalCount = activePrompts.length
  const trashCount = trash.length
  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const prompt of activePrompts) {
      result[prompt.categoryId] = (result[prompt.categoryId] ?? 0) + 1
    }
    return result
  }, [activePrompts])

  const editingPrompt = editing?.mode === 'edit' ? editing.prompt : null
  const activeCategory = categories.find((category) => category.id === view)
  const categoryLabel = (category?: Category) =>
    category ? (category.id === ROOT_CATEGORY_ID ? tr(t, 'root', '根目录') : category.name) : ''
  const title =
    view === ALL
      ? tr(t, 'allDocs', '全部提示词')
      : view === TRASH
        ? tr(t, 'trash', '回收站')
        : (categoryLabel(activeCategory) || tr(t, 'allDocs', '全部提示词'))
  const viewCount =
    view === ALL ? totalCount : view === TRASH ? trashCount : (counts[view] ?? 0)
  const subtitle =
    view === ALL
      ? tr(t, 'appSub', '直接读写本地目录中的 Markdown 提示词。')
      : view === TRASH
        ? tr(t, 'trashSub', '删除的提示词会保留在这里，可以随时恢复。')
        : joinCount(viewCount, tr(t, 'docs', '个提示词'))

  const visiblePrompts = useMemo(() => {
    let list = view === TRASH ? trash : activePrompts
    if (view !== ALL && view !== TRASH) {
      list = list.filter((prompt) => prompt.categoryId === view)
    }
    const needle = query.trim().toLowerCase()
    if (needle) {
      list = list.filter((prompt) => {
        const categoryName = prompt.categoryId ? (categoryMap.get(prompt.categoryId)?.name ?? '') : ''
        return (
          prompt.title.toLowerCase().includes(needle) ||
          prompt.summary.toLowerCase().includes(needle) ||
          prompt.content.toLowerCase().includes(needle) ||
          categoryName.toLowerCase().includes(needle)
        )
      })
    }
    const sorted = [...list]
    if (view === TRASH) {
      sorted.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
    } else if (sort === 'title') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'))
    } else if (sort === 'created') {
      sorted.sort((a, b) => b.createdAt - a.createdAt)
    } else {
      sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    }
    return sorted
  }, [activePrompts, trash, view, query, sort, categoryMap])

  const defaultCategoryId = categories.some((category) => category.id === view)
    ? view
    : (categories.find((category) => category.id === ROOT_CATEGORY_ID)?.id ?? categories[0]?.id ?? '')
  const canCreate = view !== TRASH && categories.length > 0

  const pushToast = useCallback(
    (message: string, tone: 'success' | 'error' | 'info' = 'success') => {
      const id = (toastId.current += 1)
      setToasts((current) => [...current, { id, message, tone }].slice(-3))
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, 2800)
    },
    [],
  )

  const changeRoot = useCallback(async (nextRoot: string) => {
    try {
      await updateRoot(nextRoot)
      pushToast(tr(t, 'dirChanged', '已切换目录'))
      return true
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '切换目录失败', 'error')
      return false
    }
  }, [updateRoot, pushToast, t])

  const saveFolder = useCallback(async (name: string) => {
    if (!folderDialog) return false
    try {
      if (folderDialog.mode === 'create') {
        await createFolder(name, ROOT_CATEGORY_ID)
        pushToast(tr(t, 'folderCreated', '已新建目录'))
      } else {
        await renameFolder(folderDialog.category.id, name)
        if (view === folderDialog.category.id) setView(ALL)
        pushToast(tr(t, 'folderRenamed', '已重命名目录'))
      }
      setFolderDialog(null)
      return true
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '目录操作失败', 'error')
      return false
    }
  }, [createFolder, folderDialog, pushToast, renameFolder, t, view])

  const removeFolder = useCallback(async () => {
    if (!folderToDelete) return
    try {
      await deleteFolder(folderToDelete.id)
      if (view === folderToDelete.id) setView(ALL)
      setFolderToDelete(null)
      pushToast(tr(t, 'folderDeleted', '已删除目录'))
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '删除目录失败', 'error')
    }
  }, [deleteFolder, folderToDelete, pushToast, t, view])

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setCompact(width < 760)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (view !== ALL && view !== TRASH && !categories.some((category) => category.id === view)) {
      setView(ALL)
    }
  }, [categories, view])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editing || localOpen || deleteTarget || purgeTarget || emptyOpen) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const target = event.target as HTMLElement | null
      const typing = target !== null && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable
      )
      if (mod && key === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (mod && key === 'n' && canCreate) {
        event.preventDefault()
        setEditing({ mode: 'create' })
        return
      }
      if (!mod && key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (key === 'escape' && query) setQuery('')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canCreate, deleteTarget, editing, emptyOpen, localOpen, purgeTarget, query])

  const selectView = (next: View) => {
    setView(next)
    setQuery('')
  }

  const openCreate = () => {
    if (!canCreate) return
    setEditing({ mode: 'create' })
  }

  const openEdit = (prompt: Prompt) => {
    setEditing({ mode: 'edit', prompt })
  }

  const persistPrompt = async (values: DocValues, auto: boolean): Promise<boolean> => {
    if (!editing) return false
    try {
      const snapshot = editing.mode === 'create'
        ? await createPrompt(values)
        : editingPrompt?.filePath
          ? await updatePrompt(editingPrompt.filePath, values, editingPrompt.updatedAt)
          : (() => { throw new Error('文件路径不存在') })()
      const saved = snapshot.savedPath
        ? snapshot.prompts.find((prompt) => prompt.filePath === snapshot.savedPath)
        : editingPrompt?.filePath
          ? snapshot.prompts.find((prompt) => prompt.filePath === editingPrompt.filePath)
            ?? snapshot.prompts.find((prompt) => prompt.title === values.title && prompt.categoryId === values.categoryId)
          : snapshot.prompts.find((prompt) => prompt.title === values.title && prompt.categoryId === values.categoryId)
      if (saved) setEditing({ mode: 'edit', prompt: saved })
      if (view !== ALL && view !== TRASH && values.categoryId !== view) {
        setView(values.categoryId)
      }
      if (!auto) {
        pushToast(editing.mode === 'create'
          ? tr(t, 'createdDoc', '已新建提示词')
          : tr(t, 'savedDoc', '已保存修改'))
        setEditing(null)
      }
      return Boolean(saved)
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '保存失败', 'error')
      return false
    }
  }

  const savePrompt = (values: DocValues) => persistPrompt(values, false)
  const autoSavePrompt = (values: DocValues) => persistPrompt(values, true)

  const deleteDoc = async () => {
    if (!deleteTarget?.filePath) return
    try {
      await trashPrompt(deleteTarget.filePath)
      setDeleteTarget(null)
      pushToast(`已移到回收站：${deleteTarget.title}`)
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '删除失败', 'error')
    }
  }

  const restoreDoc = async (prompt: Prompt) => {
    if (!prompt.filePath) return
    try {
      await restorePrompt(prompt.filePath)
      pushToast(tr(t, 'restoredDoc', '已恢复提示词'))
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '恢复失败', 'error')
    }
  }

  const purgeDoc = async () => {
    if (!purgeTarget?.filePath) return
    try {
      await purgePrompt(purgeTarget.filePath)
      setPurgeTarget(null)
      pushToast(tr(t, 'purgedDoc', '已彻底删除'))
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '删除失败', 'error')
    }
  }

  const emptyAll = async () => {
    try {
      const count = trashCount
      await emptyTrash()
      setEmptyOpen(false)
      pushToast(`已清空回收站（${count}）`)
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : '清空失败', 'error')
    }
  }

  const copyDoc = async (prompt: Prompt) => {
    try {
      await navigator.clipboard.writeText(prompt.content)
      pushToast(tr(t, 'copiedDoc', '已复制提示词全文'))
    } catch {
      pushToast(tr(t, 'copyFailed', '复制失败'), 'error')
    }
  }

  const copyPath = async (prompt: Prompt) => {
    if (!prompt.filePath) {
      pushToast(tr(t, 'copyPathMissing', '这个提示词还没有本地文件路径'), 'error')
      return
    }
    const fullPath = `${root.replace(/\/+$/, '')}/${prompt.filePath}`
    try {
      await navigator.clipboard.writeText(fullPath)
      pushToast(tr(t, 'copiedPath', '已复制完整路径'))
    } catch {
      pushToast(tr(t, 'copyPathFailed', '复制路径失败'), 'error')
    }
  }

  const rootClasses = `ld-root${compact ? ' is-compact' : ''}`

  if (status === 'loading' && categories.length === 0) {
    return (
      <div className={rootClasses} ref={rootRef}>
        <style>{styles}</style>
        <div className="ld-state">
          <span className="ld-state-icon"><FolderIcon size={28} /></span>
          <h2>{tr(t, 'loading', '正在读取本地提示词…')}</h2>
          <p>{root || '127.0.0.1:45127'}</p>
        </div>
      </div>
    )
  }

  if (status === 'error' && categories.length === 0) {
    return (
      <div className={rootClasses} ref={rootRef}>
        <style>{styles}</style>
        <div className="ld-state is-error">
          <span className="ld-state-icon"><FolderIcon size={28} /></span>
          <h2>{tr(t, 'loadError', '无法连接本地提示词服务')}</h2>
          <p>{error}</p>
          <p className="ld-hint">本地服务应运行在 http://127.0.0.1:45127</p>
          <button type="button" className="ld-btn primary" onClick={() => void reload(true)}>
            {tr(t, 'retry', '重试')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={rootClasses} ref={rootRef}>
      <style>{styles}</style>

      {editing ? (
        <EditorPage
          t={t}
          prompt={editingPrompt}
          categories={categories}
          prompts={prompts}
          assets={assets}
          defaultCategoryId={defaultCategoryId}
          onSave={savePrompt}
          onAutoSave={autoSavePrompt}
          onCopyPath={() => { if (editingPrompt) void copyPath(editingPrompt) }}
          onUploadAsset={(file) => uploadAsset(file)}
          onBack={() => setEditing(null)}
        />
      ) : (
        <div className="ld-app">
          <aside className="ld-rail">
            <div className="ld-brand">
              <span className="ld-logo"><FolderIcon size={20} /></span>
              <span className="ld-brand-text">
                <strong>{tr(t, 'app', '提示词')}</strong>
                <small>{tr(t, 'appSubShort', '直接读写本地目录')}</small>
              </span>
            </div>

            <div className="ld-rail-section">
              <span>{tr(t, 'directories', '目录')}</span>
              <div className="ld-rail-head-actions">
                <button
                  type="button"
                  className="ld-icon-button"
                  title={tr(t, 'newFolder', '新建目录')}
                  aria-label={tr(t, 'newFolder', '新建目录')}
                  onClick={() => setFolderDialog({ mode: 'create' })}
                >
                  <PlusIcon size={14} />
                </button>
                <button
                  type="button"
                  className={`ld-icon-button${status === 'loading' ? ' is-spinning' : ''}`}
                  title={tr(t, 'refresh', '重新读取')}
                  aria-label={tr(t, 'refresh', '重新读取')}
                  onClick={() => void reload(true)}
                >
                  <RefreshIcon size={14} />
                </button>
              </div>
            </div>

            <nav className="ld-nav-list">
              <button
                type="button"
                className={`ld-nav-item${view === ALL ? ' is-active' : ''}`}
                onClick={() => selectView(ALL)}
              >
                <GridIcon size={16} />
                <span className="ld-nav-label">{tr(t, 'allDocs', '全部提示词')}</span>
                <span className="ld-count">{totalCount}</span>
              </button>
              <div className="ld-separator" />
              {categories.map((category) => (
                <div key={category.id} className={`ld-nav-row${view === category.id ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className={`ld-nav-item${view === category.id ? ' is-active' : ''}`}
                    onClick={() => selectView(category.id)}
                    title={category.name}
                  >
                    <span className="ld-dot" style={{ background: category.color }} />
                    <span className="ld-nav-label">{categoryLabel(category)}</span>
                    <span className="ld-count">{counts[category.id] ?? 0}</span>
                  </button>
                  {category.id !== ROOT_CATEGORY_ID && (
                    <span className="ld-nav-actions">
                      <button
                        type="button"
                        className="ld-nav-action"
                        title={tr(t, 'renameFolder', '重命名目录')}
                        aria-label={tr(t, 'renameFolder', '重命名目录')}
                        onClick={(event) => {
                          event.stopPropagation()
                          setFolderDialog({ mode: 'rename', category })
                        }}
                      >
                        <PencilIcon size={13} />
                      </button>
                      <button
                        type="button"
                        className="ld-nav-action danger"
                        title={tr(t, 'deleteFolderTitle', '删除目录')}
                        aria-label={tr(t, 'deleteFolderTitle', '删除目录')}
                        onClick={(event) => {
                          event.stopPropagation()
                          setFolderToDelete(category)
                        }}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </nav>

            <div className="ld-rail-bottom">
              <button
                type="button"
                className={`ld-nav-item${view === TRASH ? ' is-active' : ''}`}
                onClick={() => selectView(TRASH)}
              >
                <TrashIcon size={16} />
                <span className="ld-nav-label">{tr(t, 'trash', '回收站')}</span>
                {trashCount > 0 && <span className="ld-count">{trashCount}</span>}
              </button>
              <button type="button" className="ld-nav-item" onClick={() => setLocalOpen(true)}>
                <SettingsIcon size={16} />
                <span className="ld-nav-label">{tr(t, 'localDir', '本地目录')}</span>
              </button>
              <div className={`ld-status is-${status}`} title={root}>
                <span className="ld-status-dot" />
                {status === 'loading'
                  ? tr(t, 'reading', '读取中…')
                  : status === 'error'
                    ? tr(t, 'readFailed', '读取失败')
                    : tr(t, 'connected', '已连接本地目录')}
              </div>
            </div>
          </aside>

          <main className="ld-main">
            <header className="ld-header">
              <div className="ld-heading">
                <div className="ld-title-row">
                  <h1>{title}</h1>
                  <span className="ld-count-pill">{viewCount}</span>
                </div>
                <p>{subtitle}</p>
              </div>
              <div className="ld-actions">
                <label className="ld-search">
                  <SearchIcon size={15} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setQuery('')
                        event.currentTarget.blur()
                      }
                    }}
                    placeholder={tr(t, 'search', '搜索标题、摘要或正文')}
                    aria-label={tr(t, 'search', '搜索标题、摘要或正文')}
                    spellCheck={false}
                  />
                  {query && (
                    <button type="button" className="ld-clear" onClick={() => setQuery('')} aria-label="清除搜索">
                      <XIcon size={13} />
                    </button>
                  )}
                </label>
                {canCreate && (
                  <button type="button" className="ld-btn primary" onClick={openCreate}>
                    <PlusIcon size={15} />
                    {tr(t, 'newDoc', '新建')}
                  </button>
                )}
              </div>
            </header>

            {compact && (
              <div className="ld-compact-filter">
                <SelectMenu
                  className="ld-compact-select"
                  value={view}
                  onChange={selectView}
                  ariaLabel={tr(t, 'directory', '目录')}
                  options={[
                    { value: ALL, label: tr(t, 'allDocs', '全部提示词'), icon: <GridIcon size={13} /> },
                    ...categories.map((category) => ({
                      value: category.id,
                      label: categoryLabel(category),
                      color: category.color,
                    })),
                    { value: TRASH, label: tr(t, 'trash', '回收站'), icon: <TrashIcon size={13} /> },
                  ]}
                />
                <button
                  type="button"
                  className={`ld-icon-button${status === 'loading' ? ' is-spinning' : ''}`}
                  title={tr(t, 'refresh', '重新读取')}
                  aria-label={tr(t, 'refresh', '重新读取')}
                  onClick={() => void reload(true)}
                >
                  <RefreshIcon size={15} />
                </button>
                <button
                  type="button"
                  className="ld-icon-button"
                  title={tr(t, 'localDir', '本地目录')}
                  aria-label={tr(t, 'localDir', '本地目录')}
                  onClick={() => setLocalOpen(true)}
                >
                  <SettingsIcon size={15} />
                </button>
              </div>
            )}

            <div className="ld-toolbar">
              <span className="ld-toolbar-count">
                {query.trim() ? `${visiblePrompts.length} ${tr(t, 'results', '个结果')}` : ''}
              </span>
              {view === TRASH ? (
                trashCount > 0 ? (
                  <button type="button" className="ld-text-button danger" onClick={() => setEmptyOpen(true)}>
                    <TrashIcon size={13} />
                    {tr(t, 'emptyTrash', '清空回收站')}
                  </button>
                ) : null
              ) : (
                <div className="ld-sort">
                  <SelectMenu
                    className="ld-sort-select"
                    value={sort}
                    onChange={(value) => setSort(value as SortKey)}
                    ariaLabel={tr(t, 'sortLabel', '排序')}
                    leading={<SortIcon size={13} />}
                    align="right"
                    options={[
                      { value: 'updated', label: tr(t, 'updatedSort', '最近更新') },
                      { value: 'created', label: tr(t, 'createdSort', '创建时间') },
                      { value: 'title', label: tr(t, 'titleSort', '标题') },
                    ]}
                  />
                </div>
              )}
            </div>

            <div className="ld-list">
              {visiblePrompts.length === 0 ? (
                <div className="ld-empty">
                  <span className="ld-empty-icon"><FileIcon size={28} /></span>
                  <h2>
                    {query.trim()
                      ? tr(t, 'noResults', '没有找到匹配的提示词')
                      : view === TRASH
                        ? tr(t, 'trashEmpty', '回收站是空的')
                        : tr(t, 'emptyTitle', '这个目录下还没有提示词')}
                  </h2>
                  <p>
                    {query.trim()
                      ? tr(t, 'noResultsHint', '换个关键词试试，或者清空搜索。')
                      : view === TRASH
                        ? tr(t, 'emptyTrashHint', '删除的提示词会先放到回收站。')
                        : tr(t, 'emptyHint', '把 Markdown 提示词放到这个目录里，应用会自动读取。')}
                  </p>
                  {query.trim() ? (
                    <button type="button" className="ld-btn secondary" onClick={() => setQuery('')}>
                      {tr(t, 'clearSearch', '清空搜索')}
                    </button>
                  ) : view !== TRASH && canCreate ? (
                    <button type="button" className="ld-btn primary" onClick={openCreate}>
                      <PlusIcon size={15} />
                      {tr(t, 'newDoc', '新建提示词')}
                    </button>
                  ) : null}
                </div>
              ) : (
                visiblePrompts.map((prompt) => {
                  const category = categoryMap.get(prompt.categoryId)
                  const tagColor = category?.color ?? 'var(--ld-muted)'
                  const when = view === TRASH ? prompt.deletedAt ?? prompt.updatedAt : prompt.updatedAt
                  return (
                    <article
                      key={prompt.id}
                      className={`ld-row${view === TRASH ? ' is-trash' : ''}`}
                      {...(view !== TRASH
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => openEdit(prompt),
                            onKeyDown: (event: React.KeyboardEvent) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                openEdit(prompt)
                              }
                            },
                          }
                        : {})}
                    >
                      <span
                        className="ld-row-icon"
                        style={{
                          color: tagColor,
                          background: `color-mix(in srgb, ${tagColor} 11%, transparent)`,
                        }}
                      >
                        <FileIcon size={14} />
                      </span>
                      <div className="ld-row-main">
                        <div className="ld-row-title">
                          <h3>{prompt.title || tr(t, 'untitled', '未命名提示词')}</h3>
                          <span
                            className="ld-tag"
                            style={{
                              color: tagColor,
                              backgroundColor: `color-mix(in srgb, ${tagColor} 10%, transparent)`,
                              borderColor: `color-mix(in srgb, ${tagColor} 22%, transparent)`,
                            }}
                          >
                            <span className="ld-tag-dot" style={{ background: category?.color }} />
                            {categoryLabel(category) || tr(t, 'root', '根目录')}
                          </span>
                        </div>
                      </div>
                      <span className="ld-row-time" title={formatDateTime(when)}>
                        {view === TRASH ? `${tr(t, 'deletedAt', '删除于')} ` : ''}
                        {relativeTime(when)}
                      </span>
                      <div className="ld-row-actions">
                        {view === TRASH ? (
                          <>
                            <button
                              type="button"
                              className="ld-icon-button"
                              title={tr(t, 'copyPath', '复制完整路径')}
                              aria-label={tr(t, 'copyPath', '复制完整路径')}
                              onClick={(event) => {
                                event.stopPropagation()
                                void copyPath(prompt)
                              }}
                            >
                              <FolderIcon size={15} />
                            </button>
                            <button
                              type="button"
                              className="ld-icon-button"
                              title={tr(t, 'restore', '恢复')}
                              aria-label={tr(t, 'restore', '恢复')}
                              onClick={(event) => {
                                event.stopPropagation()
                                void restoreDoc(prompt)
                              }}
                            >
                              <RefreshIcon size={15} />
                            </button>
                            <button
                              type="button"
                              className="ld-icon-button danger"
                              title={tr(t, 'purge', '彻底删除')}
                              aria-label={tr(t, 'purge', '彻底删除')}
                              onClick={(event) => {
                                event.stopPropagation()
                                setPurgeTarget(prompt)
                              }}
                            >
                              <TrashIcon size={15} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ld-icon-button"
                              title={tr(t, 'copyPath', '复制完整路径')}
                              aria-label={tr(t, 'copyPath', '复制完整路径')}
                              onClick={(event) => {
                                event.stopPropagation()
                                void copyPath(prompt)
                              }}
                            >
                              <FolderIcon size={15} />
                            </button>
                            <button
                              type="button"
                              className="ld-icon-button"
                              title={tr(t, 'copy', '复制全文')}
                              aria-label={tr(t, 'copy', '复制全文')}
                              onClick={(event) => {
                                event.stopPropagation()
                                void copyDoc(prompt)
                              }}
                            >
                              <CopyIcon size={15} />
                            </button>
                            <button
                              type="button"
                              className="ld-icon-button"
                              title={tr(t, 'edit', '编辑')}
                              aria-label={tr(t, 'edit', '编辑')}
                              onClick={(event) => {
                                event.stopPropagation()
                                openEdit(prompt)
                              }}
                            >
                              <PencilIcon size={15} />
                            </button>
                            <button
                              type="button"
                              className="ld-icon-button danger"
                              title={tr(t, 'delete', '删除')}
                              aria-label={tr(t, 'delete', '删除')}
                              onClick={(event) => {
                                event.stopPropagation()
                                setDeleteTarget(prompt)
                              }}
                            >
                              <TrashIcon size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </main>
        </div>
      )}

      {localOpen && (
        <LocalDialog
          t={t}
          root={root}
          status={status}
          error={error}
          categoryCount={categories.length}
          promptCount={totalCount}
          trashCount={trashCount}
          onClose={() => setLocalOpen(false)}
          onReload={() => void reload(true)}
          onChangeRoot={changeRoot}
        />
      )}

      {folderDialog && (
        <FolderDialog
          t={t}
          mode={folderDialog.mode}
          initialName={folderDialog.mode === 'rename' ? folderLeafName(folderDialog.category) : ''}
          onSave={saveFolder}
          onClose={() => setFolderDialog(null)}
        />
      )}

      {folderToDelete && (
        <ConfirmDialog
          t={t}
          title={tr(t, 'deleteFolderTitle', '删除目录')}
          message={<>{tr(t, 'deleteFolderBody', '只能删除空目录，目录内的提示词需要先移走。')}<strong>{folderToDelete.name}</strong></>}
          confirmLabel={tr(t, 'deleteFolder', '删除目录')}
          danger
          onConfirm={() => void removeFolder()}
          onCancel={() => setFolderToDelete(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          t={t}
          title={tr(t, 'deleteTitle', '移到回收站')}
          message={<>{tr(t, 'deleteBody', '确定要删除这条提示词吗？')}<strong>{deleteTarget.title}</strong></>}
          confirmLabel={tr(t, 'delete', '移到回收站')}
          danger
          onConfirm={() => void deleteDoc()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {purgeTarget && (
        <ConfirmDialog
          t={t}
          title={tr(t, 'purgeTitle', '彻底删除')}
          message={<>{tr(t, 'purgeBody', '本地文件会被删除，无法撤销。')}<strong>{purgeTarget.title}</strong></>}
          confirmLabel={tr(t, 'purge', '彻底删除')}
          danger
          onConfirm={() => void purgeDoc()}
          onCancel={() => setPurgeTarget(null)}
        />
      )}

      {emptyOpen && (
        <ConfirmDialog
          t={t}
          title={tr(t, 'emptyTrash', '清空回收站')}
          message={tr(t, 'emptyTrashBody', '确定要删除回收站中的全部本地文件吗？此操作无法撤销。')}
          confirmLabel={tr(t, 'emptyTrash', '清空回收站')}
          danger
          onConfirm={() => void emptyAll()}
          onCancel={() => setEmptyOpen(false)}
        />
      )}

      <ToastStack t={t} toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  )
}

function TocTree({
  nodes,
  depth,
  t,
  activeIndex,
  collapsed,
  onToggle,
  onNavigate,
}: {
  nodes: TocNode[]
  depth: number
  t: Translate
  activeIndex: number | null
  collapsed: Set<number>
  onToggle: (index: number) => void
  onNavigate: (entry: TocEntry) => void
}) {
  return (
    <ul className="ld-toc-list">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isCollapsed = collapsed.has(node.entry.index)
        const isActive = activeIndex === node.entry.index
        return (
          <li key={node.entry.index}>
            <div
              className={`ld-toc-row${isActive ? ' is-active' : ''}`}
              style={{ paddingLeft: `${4 + depth * 10}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="ld-toc-chevron"
                  title={isCollapsed ? tr(t, 'expandToc', '展开') : tr(t, 'collapseToc', '收起')}
                  aria-label={isCollapsed ? tr(t, 'expandToc', '展开') : tr(t, 'collapseToc', '收起')}
                  onClick={() => onToggle(node.entry.index)}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="ld-toc-spacer" />
              )}
              <button
                type="button"
                className="ld-toc-label"
                title={node.entry.text}
                onClick={() => onNavigate(node.entry)}
              >
                {node.entry.text}
              </button>
            </div>
            {hasChildren && !isCollapsed && (
              <TocTree
                nodes={node.children}
                depth={depth + 1}
                t={t}
                activeIndex={activeIndex}
                collapsed={collapsed}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function TocPanel({
  t,
  tree,
  activeIndex,
  collapsed,
  onToggle,
  onNavigate,
  onClose,
}: {
  t: Translate
  tree: TocNode[]
  activeIndex: number | null
  collapsed: Set<number>
  onToggle: (index: number) => void
  onNavigate: (entry: TocEntry) => void
  onClose: () => void
}) {
  return (
    <aside className="ld-toc">
      <div className="ld-toc-head">
        <span>{tr(t, 'toc', '目录')}</span>
        <button
          type="button"
          className="ld-toc-close"
          title={tr(t, 'closeToc', '收起目录')}
          aria-label={tr(t, 'closeToc', '收起目录')}
          onClick={onClose}
        >
          <ArrowLeftIcon size={13} />
        </button>
      </div>
      <div className="ld-toc-scroll">
        <TocTree
          nodes={tree}
          depth={0}
          t={t}
          activeIndex={activeIndex}
          collapsed={collapsed}
          onToggle={onToggle}
          onNavigate={onNavigate}
        />
      </div>
    </aside>
  )
}

interface EditorPageProps {
  t: Translate
  prompt: Prompt | null
  categories: Category[]
  prompts: Prompt[]
  assets: DocAsset[]
  defaultCategoryId: string
  onSave: (values: DocValues) => Promise<boolean>
  onAutoSave: (values: DocValues) => Promise<boolean>
  onCopyPath: () => void
  onUploadAsset: (file: File) => Promise<DocAsset>
  onBack: () => void
}

function EditorPage({ t, prompt, categories, prompts, assets, defaultCategoryId, onSave, onAutoSave, onCopyPath, onUploadAsset, onBack }: EditorPageProps) {
  const diskInitial = {
    title: prompt?.title ?? '',
    content: prompt?.content ?? '',
    categoryId: prompt?.categoryId ?? defaultCategoryId,
  }
  const draftKey = `local-docs-draft:${prompt?.filePath ?? 'new'}`
  const [restoredDraft] = useState(() => {
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (!raw) return null
      const draft = JSON.parse(raw) as { title?: unknown; content?: unknown; categoryId?: unknown; base?: unknown; savedAt?: unknown }
      if (typeof draft.savedAt === 'number' && Date.now() - draft.savedAt > 12 * 60 * 60 * 1000) return null
      if (prompt && draft.base !== prompt.updatedAt) return null
      if (typeof draft.title !== 'string' || typeof draft.content !== 'string' || typeof draft.categoryId !== 'string') return null
      return draft
    } catch {
      return null
    }
  })
  const initial = restoredDraft
    ? { title: restoredDraft.title as string, content: restoredDraft.content as string, categoryId: restoredDraft.categoryId as string }
    : diskInitial
  const [title, setTitle] = useState(initial.title)
  const [content, setContent] = useState(initial.content)
  const [categoryId, setCategoryId] = useState(initial.categoryId)
  const [restoredNotice] = useState(Boolean(restoredDraft))
  const [tab, setTab] = useState<'source' | 'rich' | 'preview'>('rich')
  const [wrap, setWrap] = useState(true)
  const [tocOpen, setTocOpen] = useState(false)
  const [collapsedToc, setCollapsedToc] = useState<Set<number>>(() => new Set())
  const [activeToc, setActiveToc] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null)
  const [autoSaveError, setAutoSaveError] = useState(false)
  const [autoSaveTick, setAutoSaveTick] = useState(0)
  const [discardOpen, setDiscardOpen] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const richEditorRef = useRef<RichEditorHandle>(null)
  const sourceEditorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const toc = useMemo(() => extractToc(content), [content])
  const tocTree = useMemo(() => buildTocTree(toc), [toc])

  const navigateToc = (entry: TocEntry) => {
    setActiveToc(entry.index)
    if (tab === 'rich') {
      richEditorRef.current?.scrollToHeading(entry.index)
      return
    }
    if (tab === 'source') {
      sourceEditorRef.current?.scrollToLine(entry.line)
      return
    }
    const headings = previewRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')
    const target = headings?.[entry.index]
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  const toggleTocNode = (index: number) => {
    setCollapsedToc((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const dirty =
    title !== diskInitial.title ||
    content !== diskInitial.content ||
    categoryId !== diskInitial.categoryId

  useEffect(() => {
    try {
      if (!dirty) {
        sessionStorage.removeItem(draftKey)
        return
      }
      sessionStorage.setItem(draftKey, JSON.stringify({
        title,
        content,
        categoryId,
        base: prompt?.updatedAt ?? null,
        savedAt: Date.now(),
      }))
    } catch {
      // Draft persistence is best-effort.
    }
  }, [categoryId, content, dirty, draftKey, prompt?.updatedAt, title])
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const requestBack = () => {
    if (saving) return
    if (dirty) setDiscardOpen(true)
    else onBack()
  }

  const handleSave = async () => {
    if (savingRef.current) return
    const cleanTitle = normalizeTitle(title)
    if (!cleanTitle) {
      setError(tr(t, 'titleRequired', '请填写提示词标题'))
      titleRef.current?.focus()
      return
    }
    savingRef.current = true
    setSaving(true)
    const ok = await onSave({ title: cleanTitle, content, categoryId })
    savingRef.current = false
    if (ok) {
      try { sessionStorage.removeItem(draftKey) } catch {}
    } else {
      setSaving(false)
    }
  }
  saveRef.current = handleSave

  const handleAutoSave = async () => {
    if (savingRef.current || discardOpen || !dirty) return
    const cleanTitle = normalizeTitle(title)
    if (!cleanTitle) return
    if (cleanTitle !== title) setTitle(cleanTitle)
    savingRef.current = true
    setSaving(true)
    setAutoSaveError(false)
    const ok = await onAutoSave({ title: cleanTitle, content, categoryId })
    savingRef.current = false
    setSaving(false)
    if (ok) {
      try { sessionStorage.removeItem(draftKey) } catch {}
      setAutoSavedAt(Date.now())
      setAutoSaveTick((value) => value + 1)
    } else {
      setAutoSaveError(true)
    }
  }
  const autoSaveRef = useRef<() => Promise<void>>(async () => {})
  autoSaveRef.current = handleAutoSave

  useEffect(() => {
    if (!dirty || discardOpen || !normalizeTitle(title)) return
    const timer = window.setTimeout(() => { void autoSaveRef.current() }, 1200)
    return () => window.clearTimeout(timer)
  }, [autoSaveTick, categoryId, content, dirty, discardOpen, title])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  return (
    <div className="ld-editor-page">
      <header className="ld-editor-top">
        <div className="ld-editor-top-left">
          <button type="button" className="ld-back" onClick={requestBack} disabled={saving}>
            <ArrowLeftIcon size={16} />
            {tr(t, 'back', '返回列表')}
          </button>
          <span className="ld-editor-divider" />
          <div className="ld-top-title-wrap">
            <div className={`ld-top-title${error ? ' has-error' : ''}`}>
              <input
                ref={titleRef}
                className="ld-top-title-input"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  if (error) setError('')
                }}
                placeholder={tr(t, 'titlePlaceholder', '给提示词起个清晰的名字')}
                autoFocus
                spellCheck={false}
                aria-label={tr(t, 'titleLabel', '标题')}
              />
              {!/\.(md|markdown|txt)$/i.test(title.trim()) && <span className="ld-top-title-ext">.md</span>}
            </div>
            {error && <span className="ld-top-title-error">{error}</span>}
          </div>
        </div>
        <div className="ld-editor-actions">
          {autoSaveError && dirty ? (
            <span className="ld-auto-save is-error">{tr(t, 'autoSaveFailed', '自动保存失败')}</span>
          ) : autoSavedAt && !dirty ? (
            <span className="ld-auto-save">{tr(t, 'autoSaved', '已自动保存')}</span>
          ) : null}
          <span className="ld-char-count">{countChars(content)} {tr(t, 'chars', '字')}</span>
          <button type="button" className="ld-btn secondary" onClick={requestBack} disabled={saving}>
            {tr(t, 'cancel', '取消')}
          </button>
          <button type="button" className="ld-btn primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? tr(t, 'saving', '保存中…') : tr(t, 'save', '保存')}
          </button>
        </div>
      </header>

      <main className="ld-editor-main">
        <div className="ld-editor-inner">
          {restoredNotice && (
            <div className="ld-draft-banner">
              {tr(t, 'restoredDraft', '已恢复上次未保存的草稿')}
            </div>
          )}
          <div className="ld-editor-content-head">
            <div className="ld-editor-head-left">
              <div className="ld-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'source'}
                  className={tab === 'source' ? 'is-active' : ''}
                  onClick={() => setTab('source')}
                >
                  <FileIcon size={14} />
                  {tr(t, 'sourceTab', '原文本')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'rich'}
                  className={tab === 'rich' ? 'is-active' : ''}
                  onClick={() => setTab('rich')}
                >
                  <PencilIcon size={14} />
                  {tr(t, 'richTab', '富文本')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'preview'}
                  className={tab === 'preview' ? 'is-active' : ''}
                  onClick={() => setTab('preview')}
                >
                  <EyeIcon size={14} />
                  {tr(t, 'previewTab', '预览')}
                </button>
              </div>
              <div className="ld-inline-dir">
                <span>{tr(t, 'directory', '目录')}</span>
                <SelectMenu
                  className="ld-inline-dir-select"
                  value={categoryId}
                  onChange={setCategoryId}
                  ariaLabel={tr(t, 'directory', '目录')}
                  options={categories.map((category) => ({
                    value: category.id,
                    label: category.id === ROOT_CATEGORY_ID ? tr(t, 'root', '根目录') : category.name,
                    color: category.color,
                  }))}
                />
              </div>
            </div>
            <div className="ld-content-options">
              {tab === 'source' && (
                <label className="ld-wrap-toggle">
                  <input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />
                  {tr(t, 'wrap', '自动换行')}
                </label>
              )}
              <span className="ld-md-hint">{tr(t, 'markdown', '支持 Markdown')}</span>
            </div>
          </div>

          <div className="ld-editor-filebar">
            {prompt?.filePath ? (
              <>
                <span className="ld-editor-filebar-path">
                  {tr(t, 'fileLabel', '文件')}：<code>{prompt.filePath}</code>
                </span>
                <span className="ld-editor-filebar-hint">{tr(t, 'renameHint', '标题修改后会同步重命名文件')}</span>
                <button type="button" className="ld-copy-path-button" onClick={onCopyPath}>
                  <CopyIcon size={12} />
                  {tr(t, 'copyPath', '复制完整路径')}
                </button>
              </>
            ) : (
              <span className="ld-editor-filebar-hint">{tr(t, 'createHint', '保存后会在所选目录创建 .md 文件')}</span>
            )}
          </div>

          <div className="ld-editor-canvas">
            {tocOpen && toc.length > 0 && (
              <TocPanel
                t={t}
                tree={tocTree}
                activeIndex={activeToc}
                collapsed={collapsedToc}
                onToggle={toggleTocNode}
                onNavigate={navigateToc}
                onClose={() => setTocOpen(false)}
              />
            )}
            <div className={`ld-editor-pane${toc.length > 0 && !tocOpen ? ' has-toc-button' : ''}`}>
              {tab === 'source' ? (
                <MarkdownEditor
                  ref={sourceEditorRef}
                  content={content}
                  onChange={setContent}
                  placeholder={tr(t, 'editorPlaceholder', '在这里编写提示词正文…')}
                  wrap={wrap}
                />
              ) : tab === 'rich' ? (
                <RichMarkdownEditor
                  ref={richEditorRef}
                  content={content}
                  onChange={setContent}
                  placeholder={tr(t, 'editorPlaceholder', '在这里编写提示词正文…')}
                  onUploadAsset={onUploadAsset}
                  references={{
                    prompts,
                    assets,
                    currentFilePath: prompt?.filePath,
                    currentCategoryId: categoryId,
                  }}
                  labels={{
                    bold: tr(t, 'bold', '加粗'),
                    italic: tr(t, 'italic', '斜体'),
                    strike: tr(t, 'strike', '删除线'),
                    inlineCode: tr(t, 'inlineCode', '行内代码'),
                    h1: tr(t, 'h1', '一级标题'),
                    h2: tr(t, 'h2', '二级标题'),
                    h3: tr(t, 'h3', '三级标题'),
                    bulletList: tr(t, 'bulletList', '无序列表'),
                    orderedList: tr(t, 'orderedList', '有序列表'),
                    blockquote: tr(t, 'blockquote', '引用'),
                    codeBlock: tr(t, 'codeBlock', '代码块'),
                    table: tr(t, 'table', '插入表格'),
                    tableActions: tr(t, 'tableActions', '表格'),
                    addRow: tr(t, 'addRow', '下方插入行'),
                    addColumn: tr(t, 'addColumn', '右侧插入列'),
                    deleteRow: tr(t, 'deleteRow', '删除行'),
                    deleteColumn: tr(t, 'deleteColumn', '删除列'),
                    deleteTable: tr(t, 'deleteTable', '删除表格'),
                    undo: tr(t, 'undo', '撤销'),
                    redo: tr(t, 'redo', '重做'),
                    reference: tr(t, 'reference', '引用'),
                    referenceSearch: tr(t, 'referenceSearch', '搜索提示词或文件…'),
                    referencePrompts: tr(t, 'referencePrompts', '提示词'),
                    referenceFiles: tr(t, 'referenceFiles', '图片 / 文档'),
                    referenceEmpty: tr(t, 'referenceEmpty', '没有匹配项'),
                    chooseFile: tr(t, 'chooseFile', '插入图片'),
                    uploading: tr(t, 'uploading', '复制中…'),
                    uploadHint: tr(t, 'uploadHint', '会复制到 assets/ 目录'),
                    uploadFailed: tr(t, 'uploadFailed', '复制失败'),
                  }}
                />
              ) : (
                <div className="ld-preview" ref={previewRef}>
                  <MarkdownPreview
                    content={content}
                    resolveImage={(src) => resolveAssetUrl(src, docDir(prompt?.filePath, categoryId))}
                  />
                </div>
              )}
              {toc.length > 0 && !tocOpen && (
                <button
                  type="button"
                  className="ld-toc-float"
                  title={tr(t, 'openToc', '打开目录')}
                  aria-label={tr(t, 'openToc', '打开目录')}
                  onClick={() => setTocOpen(true)}
                >
                  <TocIcon size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {discardOpen && (
        <ConfirmDialog
          t={t}
          title={tr(t, 'discardTitle', '放弃未保存的修改？')}
          message={tr(t, 'discardBody', '当前提示词的修改还没有保存，离开后这些修改会丢失。')}
          confirmLabel={tr(t, 'discard', '放弃修改')}
          danger
          onConfirm={() => {
            try { sessionStorage.removeItem(draftKey) } catch {}
            setDiscardOpen(false)
            onBack()
          }}
          onCancel={() => setDiscardOpen(false)}
        />
      )}
    </div>
  )
}

interface LocalDialogProps {
  t: Translate
  root: string
  status: 'loading' | 'ready' | 'error'
  error: string
  categoryCount: number
  promptCount: number
  trashCount: number
  onClose: () => void
  onReload: () => void
  onChangeRoot: (root: string) => Promise<boolean>
}

function LocalDialog({ t, root, status, error, categoryCount, promptCount, trashCount, onClose, onReload, onChangeRoot }: LocalDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [draftRoot, setDraftRoot] = useState(root)
  const [changing, setChanging] = useState(false)
  const [pathError, setPathError] = useState('')
  useEffect(() => {
    setDraftRoot(root)
  }, [root])
  useEffect(() => {
    closeRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function applyRoot() {
    const next = draftRoot.trim()
    if (!next || next === root || changing) return
    setChanging(true)
    setPathError('')
    const ok = await onChangeRoot(next)
    setChanging(false)
    if (!ok) setPathError(tr(t, 'dirChangeFailed', '切换目录失败'))
  }

  return (
    <div
      className="ld-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={tr(t, 'localDir', '本地目录')}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="ld-dialog">
        <div className="ld-dialog-head">
          <span className="ld-dialog-title"><FolderIcon size={17} />{tr(t, 'localDir', '本地目录')}</span>
          <button ref={closeRef} type="button" className="ld-icon-button" onClick={onClose} aria-label={tr(t, 'close', '关闭')}>
            <XIcon size={15} />
          </button>
        </div>
        <div className="ld-dialog-body">
          <p className="ld-field-label">{tr(t, 'pathLabel', '提示词目录')}</p>
          <input
            className={`ld-path-input${pathError ? ' has-error' : ''}`}
            value={draftRoot}
            onChange={(event) => {
              setDraftRoot(event.target.value)
              if (pathError) setPathError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draftRoot.trim() && draftRoot.trim() !== root && !changing) {
                event.preventDefault()
                void applyRoot()
              }
            }}
            placeholder={tr(t, 'rootPlaceholder', '~/Documents/DSH Prompts')}
            spellCheck={false}
            disabled={changing}
            aria-label={tr(t, 'pathLabel', '提示词目录')}
          />
          <div className={`ld-local-status is-${status}`}>
            <span className="ld-status-dot" />
            {status === 'loading'
              ? tr(t, 'reading', '读取中…')
              : status === 'error'
                ? tr(t, 'readFailed', '读取失败')
                : tr(t, 'connected', '已连接本地目录')}
          </div>
          {error && <p className="ld-error-text">{error}</p>}
          <div className="ld-stats">
            <div><strong>{promptCount}</strong><span>{tr(t, 'docs', '个提示词')}</span></div>
            <div><strong>{categoryCount}</strong><span>{tr(t, 'directories', '目录')}</span></div>
            <div><strong>{trashCount}</strong><span>{tr(t, 'trash', '回收站')}</span></div>
          </div>
          <p className="ld-note">
            {tr(t, 'localNote', '左侧目录由本地文件夹自动生成。本地新增文件夹后，刷新或等待自动同步即可。保存会直接写回原文件。')}
          </p>
          <p className="ld-note ld-dir-hint">
            {tr(t, 'dirConfigHint', '切换会立即生效并写入 local.config.json；如果设置了 LOCAL_DOCS_ROOT，环境变量优先。')}
          </p>
          {pathError && <p className="ld-error-text">{pathError}</p>}
        </div>
        <div className="ld-dialog-foot">
          <button type="button" className="ld-btn secondary" onClick={onReload} disabled={changing}>
            <RefreshIcon size={14} />
            {tr(t, 'refresh', '重新读取')}
          </button>
          <button
            type="button"
            className="ld-btn primary"
            onClick={() => void applyRoot()}
            disabled={changing || !draftRoot.trim() || draftRoot.trim() === root}
          >
            {changing ? tr(t, 'switching', '切换中…') : tr(t, 'switchDir', '切换目录')}
          </button>
          <button type="button" className="ld-btn secondary" onClick={onClose} disabled={changing}>
            {tr(t, 'done', '完成')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface SelectOption {
  value: string
  label: string
  color?: string
  icon?: ReactNode
}

interface SelectMenuProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
  align?: 'left' | 'right'
  leading?: ReactNode
}

function SelectMenu({ value, options, onChange, ariaLabel, className, align = 'left', leading }: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    const selectedButton = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    ;(selectedButton ?? menuRef.current?.querySelector<HTMLButtonElement>('.ld-select-option'))?.focus()
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const focusOption = (index: number) => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('.ld-select-option')
    if (!buttons?.length) return
    const next = (index + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div className={`ld-select ${className ?? ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ld-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {selected?.color
          ? <span className="ld-select-dot" style={{ background: selected.color }} />
          : (selected?.icon ?? leading)}
        <span className="ld-select-label">{selected?.label ?? '—'}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div ref={menuRef} className={`ld-select-menu${align === 'right' ? ' align-right' : ''}`} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="ld-select-option"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
                triggerRef.current?.focus()
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  focusOption(index + 1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  focusOption(index - 1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  focusOption(0)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  focusOption(options.length - 1)
                }
              }}
            >
              <span className="ld-select-option-mark">
                {option.color ? <span className="ld-select-dot" style={{ background: option.color }} /> : option.icon}
              </span>
              <span className="ld-select-option-label">{option.label}</span>
              {option.value === value && <CheckIcon size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface FolderDialogProps {
  t: Translate
  mode: 'create' | 'rename'
  initialName: string
  onSave: (name: string) => Promise<boolean>
  onClose: () => void
}

function FolderDialog({ t, mode, initialName, onSave, onClose }: FolderDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (!saving) onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, saving])

  const submit = async () => {
    if (saving) return
    const value = name.trim()
    if (!value) {
      setError(tr(t, 'folderNameRequired', '请输入目录名'))
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    const ok = await onSave(value)
    setSaving(false)
    if (!ok) setError(tr(t, 'folderSaveFailed', '目录操作失败'))
  }

  return (
    <div
      className="ld-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'create' ? tr(t, 'newFolder', '新建目录') : tr(t, 'renameFolder', '重命名目录')}
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}
    >
      <div className="ld-dialog ld-folder-dialog">
        <div className="ld-dialog-head">
          <span className="ld-dialog-title">
            <FolderIcon size={17} />
            {mode === 'create' ? tr(t, 'newFolder', '新建目录') : tr(t, 'renameFolder', '重命名目录')}
          </span>
          <button type="button" className="ld-icon-button" onClick={onClose} disabled={saving} aria-label={tr(t, 'close', '关闭')}>
            <XIcon size={15} />
          </button>
        </div>
        <div className="ld-dialog-body">
          <label className="ld-field">
            <span className="ld-field-label">{tr(t, 'folderName', '目录名')}</span>
            <input
              ref={inputRef}
              className={error ? 'has-error' : ''}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder={tr(t, 'folderNamePlaceholder', '例如：运维操作')}
              disabled={saving}
            />
          </label>
          {error && <p className="ld-error-text">{error}</p>}
          <p className="ld-note">
            {mode === 'create'
              ? tr(t, 'newFolderHint', '会直接在提示词根目录下创建本地文件夹。')
              : tr(t, 'renameFolderHint', '会重命名本地文件夹；里面的提示词会一起移动。')}
          </p>
        </div>
        <div className="ld-dialog-foot">
          <button type="button" className="ld-btn secondary" onClick={onClose} disabled={saving}>
            {tr(t, 'cancel', '取消')}
          </button>
          <button type="button" className="ld-btn primary" onClick={() => void submit()} disabled={saving}>
            {saving
              ? tr(t, 'saving', '保存中…')
              : mode === 'create'
                ? tr(t, 'createFolder', '创建')
                : tr(t, 'renameFolderAction', '重命名')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmDialogProps {
  t: Translate
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ t, title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="ld-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}
    >
      <div className="ld-dialog ld-confirm">
        <div className="ld-dialog-head">
          <span className="ld-dialog-title">{title}</span>
          <button type="button" className="ld-icon-button" onClick={onCancel} aria-label={tr(t, 'cancel', '取消')}>
            <XIcon size={15} />
          </button>
        </div>
        <div className="ld-dialog-body">
          <p className="ld-confirm-text">{message}</p>
        </div>
        <div className="ld-dialog-foot">
          <button ref={cancelRef} type="button" className="ld-btn secondary" onClick={onCancel}>
            {tr(t, 'cancel', '取消')}
          </button>
          <button type="button" className={`ld-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ToastStackProps {
  t: Translate
  toasts: Array<{ id: number; message: string; tone: 'success' | 'error' | 'info' }>
  onDismiss: (id: number) => void
}

function ToastStack({ t, toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null
  return (
    <div className="ld-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ld-toast is-${toast.tone}`}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label={tr(t, 'close', '关闭')}>
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
