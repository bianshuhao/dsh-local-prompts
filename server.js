import { promises as fs, watch } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_DOCS_ROOT = path.join(homedir(), 'Documents', 'DSH Prompts')
export const LOCAL_DOCS_PORT = 45127
const TRASH_DIR = '.trash'
const ASSET_DIR = 'assets'
const ROOT_CATEGORY_ID = 'dir:__root__'
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_BODY_BYTES = 8 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', ''])
const PALETTE = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#64748b']

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function isHidden(name) {
  return name.startsWith('.') || name === 'node_modules'
}

function isAllowedFile(name) {
  return ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function normalizeRel(input) {
  return String(input ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function resolveInside(root, rel) {
  const normalized = normalizeRel(rel)
  if (!normalized || normalized.split('/').includes('..')) throw new ApiError(400, '非法路径')
  const absolute = path.resolve(root, normalized)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new ApiError(400, '非法路径')
  return absolute
}

async function assertNoSymlinks(root, rel) {
  const normalized = normalizeRel(rel)
  let current = root
  for (const part of normalized.split('/')) {
    if (!part) continue
    current = path.join(current, part)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new ApiError(400, '不允许符号链接')
    } catch (error) {
      if (error && error.code === 'ENOENT') return
      throw error
    }
  }
}

function resolveTrash(root, rel) {
  const normalized = normalizeRel(rel)
  if (!normalized.startsWith(`${TRASH_DIR}/`)) throw new ApiError(400, '不是回收站文件')
  return resolveInside(root, normalized)
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function toError(error) {
  if (error instanceof ApiError) return error
  if (error instanceof Error) {
    if (error.code === 'ENOENT') return new ApiError(404, '文件或目录不存在')
    if (error.code === 'EEXIST') return new ApiError(409, '同名文件已存在')
    return new ApiError(500, error.message)
  }
  return new ApiError(500, '未知错误')
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new ApiError(413, '请求内容过大')
    chunks.push(buffer)
  }
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid')
    return payload
  } catch {
    throw new ApiError(400, '请求 JSON 格式错误')
  }
}

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
}

async function readBody(request, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new ApiError(413, '文件过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function sanitizeAssetName(value) {
  const raw = path.basename(String(value ?? '').replace(/\\/g, '/'))
  const ext = path.extname(raw).toLowerCase()
  const stem = raw.slice(0, raw.length - ext.length)
    .replace(/[\\/:*?"<>|\u0000]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  if (!stem) throw new ApiError(400, '文件名不能为空')
  return `${stem}${ext}`.slice(0, 180)
}

async function saveAsset(root, name, data) {
  const assetDir = path.join(root, ASSET_DIR)
  try {
    const current = await fs.lstat(assetDir)
    if (current.isSymbolicLink() || !current.isDirectory()) throw new ApiError(400, 'assets 目录无效')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await fs.mkdir(assetDir, { recursive: true })
  }
  await assertNoSymlinks(root, ASSET_DIR)

  const safeName = sanitizeAssetName(name)
  const ext = path.extname(safeName)
  const stem = safeName.slice(0, safeName.length - ext.length)
  let fileName = safeName
  let target = path.join(assetDir, fileName)
  let index = 2
  while (await exists(target)) {
    fileName = `${stem}-${index}${ext}`
    target = path.join(assetDir, fileName)
    index += 1
  }
  const targetRel = `${ASSET_DIR}/${fileName}`
  await assertNoSymlinks(root, targetRel)
  await fs.writeFile(target, data, { flag: 'wx' })
  const stat = await fs.stat(target)
  return {
    path: targetRel,
    name: fileName,
    kind: IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file',
    size: stat.size,
    updatedAt: stat.mtimeMs,
  }
}

function sanitizeTitle(value) {
  if (typeof value !== 'string') throw new ApiError(400, '文件名不能为空')
  const title = value
    .replace(/\.(md|markdown|txt)$/i, '')
    .replace(/[\\/:*?"<>|\u0000]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  if (!title) throw new ApiError(400, '文件名不能为空')
  return title
}

function categoryIdForDir(rel) {
  return rel === '' ? ROOT_CATEGORY_ID : `dir:${rel}`
}

function dirForCategoryId(root, categoryId) {
  if (typeof categoryId !== 'string' || !categoryId) throw new ApiError(400, '缺少分类')
  if (categoryId === ROOT_CATEGORY_ID) return root
  if (!categoryId.startsWith('dir:')) throw new ApiError(400, '分类不存在')
  return resolveInside(root, categoryId.slice(4))
}

async function ensureDirectory(root, categoryId) {
  const dir = dirForCategoryId(root, categoryId)
  const stat = await fs.lstat(dir)
  if (stat.isSymbolicLink()) throw new ApiError(400, '不允许符号链接')
  if (!stat.isDirectory()) throw new ApiError(400, '分类不是目录')
  const real = await fs.realpath(dir)
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new ApiError(400, '非法路径')
  return real
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function walk(root, dir, rel, dirs, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (isHidden(entry.name)) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    const childAbsolute = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (childRel === ASSET_DIR || childRel.startsWith(`${ASSET_DIR}/`)) continue
      const stat = await fs.stat(childAbsolute)
      dirs.push({ rel: childRel, stat })
      await walk(root, childAbsolute, childRel, dirs, files)
      continue
    }
    if (!entry.isFile() || !isAllowedFile(entry.name)) continue
    const stat = await fs.stat(childAbsolute)
    if (stat.size > MAX_FILE_BYTES) continue
    files.push({ rel: childRel, absolute: childAbsolute, stat })
  }
}

async function readTextFile(absolute) {
  const buffer = await fs.readFile(absolute)
  if (buffer.includes(0)) return null
  return buffer.toString('utf8')
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif', '.ico'])
const MAX_ASSET_BYTES = 25 * 1024 * 1024

async function walkAssets(dir, rel, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (isHidden(entry.name)) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    const childAbsolute = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await walkAssets(childAbsolute, childRel, files)
      continue
    }
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (ext === '.md' || ext === '.markdown' || ext === '' || ext === '.txt') continue
    const stat = await fs.stat(childAbsolute)
    if (stat.size > MAX_ASSET_BYTES) continue
    files.push({ rel: childRel, stat })
  }
}

function deriveSummary(content, fallback) {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  for (const rawLine of withoutFrontmatter.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (
      line.startsWith('#') || line.startsWith('```') || line.startsWith('|') ||
      line.startsWith('>') || /^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line) ||
      line.startsWith('<!--') || /^[-*_]{3,}$/.test(line)
    ) continue
    const clean = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (clean) return clean.slice(0, 120)
  }
  return fallback
}

function promptFromFile(file, trash) {
  const ext = path.extname(file.rel)
  const title = path.basename(file.rel, ext)
  const originalRel = trash ? normalizeRel(file.rel).slice(TRASH_DIR.length + 1) : file.rel
  const parentRel = path.posix.dirname(originalRel)
  const categoryId = categoryIdForDir(parentRel === '.' ? '' : parentRel)
  const createdAt = file.stat.birthtimeMs || file.stat.ctimeMs || file.stat.mtimeMs
  const updatedAt = file.stat.mtimeMs || createdAt
  return {
    id: trash ? `trash:${normalizeRel(file.rel)}` : `file:${file.rel}`,
    title,
    summary: title,
    content: '',
    categoryId,
    createdAt,
    updatedAt,
    deletedAt: trash ? updatedAt : null,
    filePath: trash ? normalizeRel(file.rel) : file.rel,
  }
}

async function buildSnapshot(root) {
  const rootStat = await fs.stat(root)
  if (!rootStat.isDirectory()) throw new ApiError(500, '本地提示词目录不是目录')
  const dirs = []
  const files = []
  await walk(root, root, '', dirs, files)
  const assetFiles = []
  await walkAssets(root, '', assetFiles)

  const categories = [{
    id: ROOT_CATEGORY_ID,
    name: '根目录',
    color: '#64748b',
    createdAt: rootStat.birthtimeMs || rootStat.mtimeMs,
    updatedAt: rootStat.mtimeMs,
  }]
  const sortedDirs = [...dirs].sort((a, b) => a.rel.localeCompare(b.rel, 'zh-CN'))
  sortedDirs.forEach((dir, index) => {
    categories.push({
      id: categoryIdForDir(dir.rel),
      name: dir.rel.split('/').join(' / '),
      color: PALETTE[index % PALETTE.length],
      createdAt: dir.stat.birthtimeMs || dir.stat.mtimeMs,
      updatedAt: dir.stat.mtimeMs,
    })
  })

  const prompts = []
  for (const file of [...files].sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)) {
    const content = await readTextFile(file.absolute)
    if (content === null) continue
    const prompt = promptFromFile(file, false)
    prompt.content = content
    prompt.summary = deriveSummary(content, prompt.title)
    prompts.push(prompt)
  }

  const trashFiles = []
  const trashRoot = path.join(root, TRASH_DIR)
  try {
    if ((await fs.stat(trashRoot)).isDirectory()) {
      await walk(root, trashRoot, TRASH_DIR, [], trashFiles)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const trash = []
  for (const file of trashFiles.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)) {
    const content = await readTextFile(file.absolute)
    if (content === null) continue
    const prompt = promptFromFile(file, true)
    prompt.content = content
    prompt.summary = deriveSummary(content, prompt.title)
    trash.push(prompt)
  }

  const assets = assetFiles.map((file) => {
    const ext = path.extname(file.rel).toLowerCase()
    return {
      path: file.rel,
      name: path.basename(file.rel),
      kind: IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file',
      size: file.stat.size,
      updatedAt: file.stat.mtimeMs,
    }
  })

  return { root, categories, prompts, trash, assets }
}

function snapshotWithSavedPath(root, absolutePath) {
  return buildSnapshot(root).then((snapshot) => ({
    ...snapshot,
    savedPath: path.relative(root, absolutePath).split(path.sep).join('/'),
  }))
}

async function createFile(root, payload) {
  const dir = await ensureDirectory(root, payload.categoryId)
  const title = sanitizeTitle(payload.title)
  const content = typeof payload.content === 'string' ? payload.content : ''
  const target = path.join(dir, `${title}.md`)
  await assertNoSymlinks(root, path.relative(root, target))
  if (await exists(target)) throw new ApiError(409, `文件已存在：${path.basename(target)}`)
  await fs.writeFile(target, content, 'utf8')
  return snapshotWithSavedPath(root, target)
}

async function saveFile(root, payload) {
  const rel = normalizeRel(payload.path)
  if (!rel || rel.startsWith(`${TRASH_DIR}/`)) throw new ApiError(400, '文件路径无效')
  const oldAbsolute = resolveInside(root, rel)
  await assertNoSymlinks(root, rel)
  const oldStat = await fs.lstat(oldAbsolute)
  if (oldStat.isSymbolicLink()) throw new ApiError(400, '不允许符号链接')
  if (!oldStat.isFile()) throw new ApiError(400, '不是文件')
  if (typeof payload.expectedUpdatedAt === 'number' && Math.abs(oldStat.mtimeMs - payload.expectedUpdatedAt) > 1) {
    throw new ApiError(409, '文件已在本地被修改，请重新打开后再保存')
  }
  const ext = path.extname(rel)
  const title = sanitizeTitle(payload.title)
  const dir = await ensureDirectory(root, payload.categoryId)
  const content = typeof payload.content === 'string' ? payload.content : ''
  const newAbsolute = path.join(dir, `${title}${ext}`)
  await assertNoSymlinks(root, path.relative(root, newAbsolute))
  if (newAbsolute !== oldAbsolute && (await exists(newAbsolute))) {
    const newStat = await fs.lstat(newAbsolute)
    if (!newStat.isSymbolicLink() && newStat.dev === oldStat.dev && newStat.ino === oldStat.ino) {
      const temporary = `${oldAbsolute}.ld-rename-${Date.now()}`
      await fs.rename(oldAbsolute, temporary)
      await fs.rename(temporary, newAbsolute)
      await fs.writeFile(newAbsolute, content, 'utf8')
      return snapshotWithSavedPath(root, newAbsolute)
    }
    throw new ApiError(409, `文件已存在：${path.basename(newAbsolute)}`)
  }
  if (newAbsolute === oldAbsolute) {
    await fs.writeFile(oldAbsolute, content, 'utf8')
  } else {
    await fs.writeFile(newAbsolute, content, 'utf8')
    await fs.unlink(oldAbsolute)
  }
  return snapshotWithSavedPath(root, newAbsolute)
}

async function moveToTrash(root, payload) {
  const rel = normalizeRel(payload.path)
  if (!rel || rel.startsWith(`${TRASH_DIR}/`)) throw new ApiError(400, '文件路径无效')
  const source = resolveInside(root, rel)
  await assertNoSymlinks(root, rel)
  if (!(await fs.lstat(source)).isFile()) throw new ApiError(400, '不是文件')
  await assertNoSymlinks(root, TRASH_DIR)
  const trashPath = path.join(root, TRASH_DIR, rel)
  await fs.mkdir(path.dirname(trashPath), { recursive: true })
  await assertNoSymlinks(root, `${TRASH_DIR}/${rel}`)
  let target = trashPath
  if (await exists(target)) {
    const parsed = path.parse(trashPath)
    target = path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`)
  }
  await fs.rename(source, target)
  return buildSnapshot(root)
}

async function restoreFile(root, payload) {
  const rel = normalizeRel(payload.path)
  await assertNoSymlinks(root, TRASH_DIR)
  const source = resolveTrash(root, rel)
  await assertNoSymlinks(root, rel)
  if (!(await fs.lstat(source)).isFile()) throw new ApiError(400, '不是文件')
  const originalRel = rel.slice(TRASH_DIR.length + 1)
  const target = resolveInside(root, originalRel)
  await assertNoSymlinks(root, originalRel)
  if (await exists(target)) throw new ApiError(409, '原位置已有同名文件')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await assertNoSymlinks(root, originalRel)
  await fs.rename(source, target)
  return buildSnapshot(root)
}

async function purgeFile(root, payload) {
  await assertNoSymlinks(root, TRASH_DIR)
  const rel = normalizeRel(payload.path)
  await assertNoSymlinks(root, rel)
  const target = resolveTrash(root, payload.path)
  await fs.unlink(target)
  return buildSnapshot(root)
}

async function emptyTrash(root) {
  const trashPath = path.join(root, TRASH_DIR)
  try {
    const stat = await fs.lstat(trashPath)
    if (stat.isSymbolicLink()) throw new ApiError(400, '不允许符号链接')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  await fs.rm(trashPath, { recursive: true, force: true })
  return buildSnapshot(root)
}

function isAllowedOrigin(origin) {
  return origin === 'null' ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ||
    /^dsh-app:\/\//.test(origin)
}

function applyCors(request, response) {
  const origin = request.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
}

export async function startDocsServer(options = {}) {
  const requestedRoot = String(options.root ?? process.env.LOCAL_DOCS_ROOT ?? DEFAULT_DOCS_ROOT).trim() || DEFAULT_DOCS_ROOT
  const requestedAbsolute = path.resolve(requestedRoot)
  await fs.mkdir(requestedAbsolute, { recursive: true, mode: 0o755 })
  const root = await fs.realpath(requestedAbsolute)
  const port = Number(options.port ?? LOCAL_DOCS_PORT)
  let boundPort = port
  const clients = new Set()
  let watcher = null
  let broadcastTimer = null

  function ensureWatcher() {
    if (watcher) return
    try {
      watcher = watch(root, { recursive: true }, broadcastChange)
      watcher.on('error', () => {
        try { watcher.close() } catch {}
        watcher = null
      })
    } catch {
      watcher = null
    }
  }

  function broadcastChange() {
    if (broadcastTimer) clearTimeout(broadcastTimer)
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null
      for (const client of clients) {
        try { client.write('data: change\n\n') } catch { clients.delete(client) }
      }
    }, 180)
  }

  ensureWatcher()

  async function handle(request, response) {
    applyCors(request, response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const host = request.headers.host
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) {
      throw new ApiError(403, '不允许的 Host')
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/docs')) {
      sendJson(response, 404, { error: '接口不存在' })
      return
    }
    const method = request.method ?? 'GET'
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const origin = request.headers.origin
      const contentType = String(request.headers['content-type'] ?? '').toLowerCase()
      const fetchSite = String(request.headers['sec-fetch-site'] ?? '')
      if (!origin || !isAllowedOrigin(origin)) throw new ApiError(403, '不允许的来源')
      const tabOrigin = origin === 'null' || origin.startsWith('dsh-app://')
      if (!tabOrigin && fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
        throw new ApiError(403, '不允许的跨站请求')
      }
      const assetUpload = url.pathname === '/api/docs/asset' && method === 'POST'
      if (!assetUpload && !contentType.startsWith('application/json')) throw new ApiError(415, '只接受 JSON 请求')
    }

    if (url.pathname === '/api/docs/events' && method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      response.write('retry: 2000\n\n')
      clients.add(response)
      const keepAlive = setInterval(() => {
        try { response.write(': ping\n\n') } catch { clients.delete(response) }
      }, 20_000)
      request.on('close', () => {
        clearInterval(keepAlive)
        clients.delete(response)
        response.end()
      })
      return
    }

    if (url.pathname === '/api/docs' && method === 'GET') {
      ensureWatcher()
      sendJson(response, 200, await buildSnapshot(root))
      return
    }
    if (url.pathname === '/api/docs/asset' && method === 'GET') {
      const rel = normalizeRel(url.searchParams.get('path') ?? '')
      if (!rel || rel.startsWith(`${TRASH_DIR}/`)) throw new ApiError(400, '文件路径无效')
      const ext = path.extname(rel).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) throw new ApiError(415, '只支持图片资源')
      const absolute = resolveInside(root, rel)
      await assertNoSymlinks(root, rel)
      const stat = await fs.lstat(absolute)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new ApiError(404, '图片不存在')
      const data = await fs.readFile(absolute)
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
      })
      response.end(data)
      return
    }
    if (url.pathname === '/api/docs/asset' && method === 'POST') {
      const dirRel = url.searchParams.get('dir') ?? ''
      const name = url.searchParams.get('name') ?? ''
      const data = await readBody(request, MAX_ASSET_BYTES)
      if (data.length === 0) throw new ApiError(400, '文件内容为空')
      const asset = await saveAsset(root, name, data)
      ensureWatcher()
      sendJson(response, 201, { asset })
      return
    }
    if (url.pathname === '/api/docs/file' && method === 'POST') {
      sendJson(response, 201, await createFile(root, await readJson(request)))
      return
    }
    if (url.pathname === '/api/docs/file' && method === 'PUT') {
      sendJson(response, 200, await saveFile(root, await readJson(request)))
      return
    }
    if (url.pathname === '/api/docs/trash' && method === 'POST') {
      sendJson(response, 200, await moveToTrash(root, await readJson(request)))
      return
    }
    if (url.pathname === '/api/docs/restore' && method === 'POST') {
      sendJson(response, 200, await restoreFile(root, await readJson(request)))
      return
    }
    if (url.pathname === '/api/docs/purge' && method === 'POST') {
      sendJson(response, 200, await purgeFile(root, await readJson(request)))
      return
    }
    if (url.pathname === '/api/docs/empty-trash' && method === 'POST') {
      sendJson(response, 200, await emptyTrash(root))
      return
    }
    sendJson(response, 404, { error: '接口不存在' })
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      const apiError = toError(error)
      if (apiError.status >= 500) console.error('[local-docs]', error)
      if (!response.headersSent) sendJson(response, apiError.status, { error: apiError.message })
      else response.end()
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  boundPort = actualPort

  return {
    root,
    port: actualPort,
    close: async () => {
      for (const client of clients) {
        try { client.end() } catch {}
      }
      clients.clear()
      if (broadcastTimer) clearTimeout(broadcastTimer)
      if (watcher) {
        try { watcher.close() } catch {}
        watcher = null
      }
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
