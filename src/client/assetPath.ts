const API_ORIGIN = 'http://127.0.0.1:45127'

export function dirname(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

export function categoryDir(categoryId: string): string {
  return categoryId.startsWith('dir:') ? categoryId.slice(4) : ''
}

export function docDir(filePath: string | undefined, categoryId: string): string {
  return filePath ? dirname(filePath) : categoryDir(categoryId)
}

export function normalizeDocPath(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** Resolve a Markdown-relative image path to the local asset endpoint. */
export function resolveAssetUrl(src: string, currentDir: string): string {
  const value = String(src ?? '').trim()
  if (!value || value.startsWith('#') || /^(https?:|data:|blob:|\/\/)/i.test(value)) return value
  if (value.startsWith('/')) return value
  const rootPath = normalizeDocPath(`${currentDir}/${value}`)
  return `${API_ORIGIN}/api/docs/asset?path=${encodeURIComponent(rootPath)}`
}
