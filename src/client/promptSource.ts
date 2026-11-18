import type { Category, Prompt } from './types'

const API = 'http://127.0.0.1:45127/api/docs'
const SOURCE_NAME = 'local-prompts'
const CACHE_MS = 1200

interface Snapshot {
  root: string
  categories: Category[]
  prompts: Prompt[]
}

interface CacheEntry {
  at: number
  snapshot: Snapshot
}

let cache: CacheEntry | null = null

function formatMention(path: string): string {
  const escaped = path.replace(/"/g, '\\"')
  return /\s/.test(path) ? `@"${escaped}"` : `@${path}`
}

function sourceLabel(category: Category | undefined, rootLabel: string): string {
  if (!category) return rootLabel
  return category.id === 'dir:__root__' ? rootLabel : category.name
}

export function createPromptMentionSource(t: (key: string) => string) {
  const rootLabel = t('root') || '根目录'
  const section = t('promptSection') || '本地提示词'
  const untitled = t('untitled') || '未命名提示词'

  async function load(signal: AbortSignal): Promise<Snapshot | null> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot
    try {
      const response = await fetch(API, { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) return cache?.snapshot ?? null
      const snapshot = (await response.json()) as Snapshot
      if (!Array.isArray(snapshot.prompts) || !Array.isArray(snapshot.categories) || typeof snapshot.root !== 'string') {
        return cache?.snapshot ?? null
      }
      cache = { at: Date.now(), snapshot }
      return snapshot
    } catch {
      return cache?.snapshot ?? null
    }
  }

  return {
    trigger: '@' as const,
    name: SOURCE_NAME,
    order: -10,
    showGroupTitle: false,

    async candidates(_session: unknown, request: { query?: string; signal?: AbortSignal; quoted?: boolean }) {
      const signal = request.signal ?? new AbortController().signal
      const snapshot = await load(signal)
      if (!snapshot) return []
      const query = String(request.query ?? '').trim().toLowerCase().replace(/^"|"$/g, '')
      const categoryMap = new Map(snapshot.categories.map((category) => [category.id, category]))
      const root = snapshot.root.replace(/\/+$/, '')

      const scored = snapshot.prompts
        .filter((prompt) => !prompt.deletedAt && prompt.filePath)
        .map((prompt) => {
          const title = prompt.title || untitled
          const category = categoryMap.get(prompt.categoryId)
          const categoryName = sourceLabel(category, rootLabel)
          const absolutePath = `${root}/${prompt.filePath}`
          const label = title
          const haystack = `${title}\n${prompt.summary}\n${prompt.content}\n${categoryName}\n${prompt.filePath}`.toLowerCase()
          let score = 0
          if (query) {
            if (title.toLowerCase().startsWith(query)) score = 0
            else if (title.toLowerCase().includes(query)) score = 1
            else if (haystack.includes(query)) score = 2
            else return null
          }
          return { prompt, title, categoryName, absolutePath, label, score }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.score - b.score || b.prompt.updatedAt - a.prompt.updatedAt || a.title.localeCompare(b.title, 'zh-CN'))
        .slice(0, 20)

      return scored.map((item) => ({
        name: item.title,
        label: item.label,
        description: item.categoryName,
        icon: 'file' as const,
        section,
        value: item.absolutePath,
      }))
    },

    onPick(pick: { candidate: { name: string; label?: string; value?: string } }) {
      const ref = pick.candidate.value
      if (!ref) return undefined
      return {
        insert: {
          source: SOURCE_NAME,
          ref,
          label: pick.candidate.label ?? pick.candidate.name,
          appearance: 'file' as const,
          clipboardText: formatMention(ref),
        },
      }
    },

    codec: {
      clipboardText(ref: string) {
        return formatMention(ref)
      },
      async serialize(ref: string) {
        return formatMention(ref)
      },
    },
  }
}
