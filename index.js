import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DOCS_ROOT, LOCAL_DOCS_PORT, startDocsServer } from './server.js'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))

function resolveDocsRoot() {
  const fromEnv = String(process.env.LOCAL_DOCS_ROOT ?? '').trim()
  if (fromEnv) return fromEnv
  const configPath = path.join(pluginDir, 'local.config.json')
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      if (typeof config.root === 'string' && config.root.trim()) return config.root.trim()
    } catch (error) {
      console.warn('[local-docs] ignoring invalid local.config.json:', error)
    }
  }
  return DEFAULT_DOCS_ROOT
}

let activeServer = null
let generation = 0

export function apply(ctx) {
  const current = ++generation
  let disposed = false
  let handle = null

  startDocsServer({ root: resolveDocsRoot(), port: LOCAL_DOCS_PORT })
    .then((server) => {
      if (disposed || current !== generation) {
        void server.close()
        return
      }
      handle = server
      activeServer = server
      console.log(`[local-docs] serving ${server.root} at http://127.0.0.1:${server.port}`)
    })
    .catch((error) => {
      console.error('[local-docs] failed to start local API:', error)
    })

  ctx.effect(() => () => {
    disposed = true
    if (handle) {
      if (activeServer === handle) activeServer = null
      void handle.close()
    }
  }, 'local-docs: local API server')
}
