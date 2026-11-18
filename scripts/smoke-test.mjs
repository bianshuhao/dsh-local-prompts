import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDocsServer } from '../server.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-local-prompts-smoke-'))
const headers = { Origin: 'dsh-app://desktop', 'Content-Type': 'application/json' }
let server

try {
  server = await startDocsServer({ root, port: 0 })
  const base = `http://127.0.0.1:${server.port}/api/docs`

  let response = await fetch(base)
  assert.equal(response.status, 200)
  let snapshot = await response.json()
  assert.equal(snapshot.root, await realpath(root))
  assert.ok(Array.isArray(snapshot.prompts))
  assert.ok(Array.isArray(snapshot.assets))

  response = await fetch(`${base}/file`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Smoke test', content: '# Hello\n\nfirst', categoryId: 'dir:__root__' }),
  })
  assert.equal(response.status, 201)
  snapshot = await response.json()
  const created = snapshot.prompts.find((prompt) => prompt.title === 'Smoke test')
  assert.ok(created?.filePath)
  assert.equal(created.content, '# Hello\n\nfirst')

  response = await fetch(`${base}/file`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      path: created.filePath,
      title: 'Smoke test renamed',
      content: '# Hello\n\nsecond',
      categoryId: 'dir:__root__',
      expectedUpdatedAt: created.updatedAt,
    }),
  })
  assert.equal(response.status, 200)
  snapshot = await response.json()
  const renamed = snapshot.prompts.find((prompt) => prompt.title === 'Smoke test renamed')
  assert.ok(renamed?.filePath)
  assert.equal(renamed.content, '# Hello\n\nsecond')
  assert.equal(snapshot.savedPath, renamed.filePath)

  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  response = await fetch(`${base}/asset?name=smoke.png`, {
    method: 'POST',
    headers: { Origin: 'dsh-app://desktop', 'Content-Type': 'image/png' },
    body: image,
  })
  assert.equal(response.status, 201)
  const uploaded = await response.json()
  assert.equal(uploaded.asset.path, 'assets/smoke.png')
  assert.equal(uploaded.asset.kind, 'image')

  response = await fetch(`${base}/asset?path=assets/smoke.png`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)

  response = await fetch(`${base}/trash`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: renamed.filePath }),
  })
  assert.equal(response.status, 200)
  snapshot = await response.json()
  assert.equal(snapshot.prompts.length, 0)
  assert.equal(snapshot.trash.length, 1)

  response = await fetch(`${base}/restore`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: snapshot.trash[0].filePath }),
  })
  assert.equal(response.status, 200)
  snapshot = await response.json()
  assert.equal(snapshot.trash.length, 0)
  assert.equal(snapshot.prompts.length, 1)

  console.log('smoke test passed')
} finally {
  if (server) await server.close()
  await rm(root, { recursive: true, force: true })
}
