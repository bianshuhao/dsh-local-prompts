import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, DocAsset, Prompt, Workspace } from './types'

const API_ORIGIN = 'http://127.0.0.1:45127'
const API = `${API_ORIGIN}/api`

interface DocsSnapshot {
  root: string
  categories: Category[]
  prompts: Prompt[]
  trash: Prompt[]
  assets?: DocAsset[]
}

export interface MutationSnapshot extends DocsSnapshot {
  savedPath?: string
}

export interface DocValues {
  title: string
  content: string
  categoryId: string
}

type LoadStatus = 'loading' | 'ready' | 'error'

function assertSnapshot(value: DocsSnapshot): DocsSnapshot {
  if (
    !value ||
    typeof value.root !== 'string' ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.prompts) ||
    !Array.isArray(value.trash)
  ) {
    throw new Error('本地提示词服务返回的数据格式不正确')
  }
  return { ...value, assets: Array.isArray(value.assets) ? value.assets : [] }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `请求失败（${response.status}）`)
  }
  return payload as T
}

export function useDocsData() {
  const [workspace, setWorkspace] = useState<Workspace>({ categories: [], prompts: [] })
  const [trash, setTrash] = useState<Prompt[]>([])
  const [assets, setAssets] = useState<DocAsset[]>([])
  const [root, setRoot] = useState('')
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const sequence = useRef(0)

  const apply = useCallback((snapshot: DocsSnapshot) => {
    const checked = assertSnapshot(snapshot)
    setWorkspace({ categories: checked.categories, prompts: checked.prompts })
    setTrash(checked.trash)
    setAssets(checked.assets ?? [])
    setRoot(checked.root)
    setStatus('ready')
    setError('')
  }, [])

  const reload = useCallback(
    async (showLoading = false) => {
      const seq = ++sequence.current
      if (showLoading) setStatus('loading')
      try {
        const snapshot = await request<DocsSnapshot>(`${API}/docs`)
        if (seq === sequence.current) apply(snapshot)
      } catch (cause) {
        if (seq !== sequence.current) return
        setStatus('error')
        setError(cause instanceof Error ? cause.message : '读取本地目录失败')
      }
    },
    [apply],
  )

  useEffect(() => {
    void reload(true)
    const handleFocus = () => { void reload() }
    window.addEventListener('focus', handleFocus)
    let source: EventSource | null = null
    try {
      source = new EventSource(`${API}/docs/events`)
      source.onmessage = () => { void reload() }
    } catch {
      source = null
    }
    return () => {
      window.removeEventListener('focus', handleFocus)
      source?.close()
    }
  }, [reload])

  const mutate = useCallback(
    async (endpoint: string, method: string, body: unknown): Promise<MutationSnapshot> => {
      const seq = ++sequence.current
      const snapshot = await request<MutationSnapshot>(`${API}${endpoint}`, {
        method,
        body: JSON.stringify(body),
      })
      if (seq === sequence.current) apply(snapshot)
      return snapshot
    },
    [apply],
  )

  const createPrompt = useCallback(
    (values: DocValues) => mutate('/docs/file', 'POST', values),
    [mutate],
  )
  const updatePrompt = useCallback(
    (filePath: string, values: DocValues, expectedUpdatedAt?: number) =>
      mutate('/docs/file', 'PUT', { ...values, path: filePath, expectedUpdatedAt }),
    [mutate],
  )
  const trashPrompt = useCallback(
    (filePath: string) => mutate('/docs/trash', 'POST', { path: filePath }),
    [mutate],
  )
  const uploadAsset = useCallback(
    async (file: File): Promise<DocAsset> => {
      const response = await fetch(
        `${API}/docs/asset?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        },
      )
      const payload = (await response.json().catch(() => ({}))) as { asset?: DocAsset; error?: string }
      if (!response.ok) {
        throw new Error(payload.error || `上传失败（${response.status}）`)
      }
      if (!payload.asset || typeof payload.asset.path !== 'string' || typeof payload.asset.name !== 'string') {
        throw new Error('上传接口返回格式错误')
      }
      void reload()
      return payload.asset
    },
    [reload],
  )

  const createFolder = useCallback(
    (name: string, parentId: string) => mutate('/docs/folder', 'POST', { name, parentId }),
    [mutate],
  )
  const renameFolder = useCallback(
    (id: string, name: string) => mutate('/docs/folder', 'PUT', { id, name }),
    [mutate],
  )
  const deleteFolder = useCallback(
    (id: string) => mutate('/docs/folder', 'DELETE', { id }),
    [mutate],
  )

  const updateRoot = useCallback(
    (nextRoot: string) => mutate('/docs/config', 'PUT', { root: nextRoot }),
    [mutate],
  )

  const restorePrompt = useCallback(
    (filePath: string) => mutate('/docs/restore', 'POST', { path: filePath }),
    [mutate],
  )
  const purgePrompt = useCallback(
    (filePath: string) => mutate('/docs/purge', 'POST', { path: filePath }),
    [mutate],
  )
  const emptyTrash = useCallback(() => mutate('/docs/empty-trash', 'POST', {}), [mutate])

  return {
    workspace, trash, assets, root, status, error, reload, uploadAsset, updateRoot,
    createFolder, renameFolder, deleteFolder,
    createPrompt, updatePrompt, trashPrompt, restorePrompt, purgePrompt, emptyTrash,
  }
}
