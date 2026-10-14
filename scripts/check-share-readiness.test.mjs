import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { checkShareTree } from './check-share-readiness.mjs'

const parent = resolve('tmp/share-check-tests')
async function isolated(run) {
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'case-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}
test('rejects secrets and data while retaining harmless source', () => isolated(async root => {
  await writeFile(join(root, 'safe.ts'), 'export const version = 1')
  assert.equal((await checkShareTree(root)).issues.length, 0)
  await writeFile(join(root, '.env'), 'TOKEN=' + 'ghp_' + 'x'.repeat(30))
  await writeFile(join(root, 'data.sqlite3'), Buffer.from([0, 1]))
  assert.equal((await checkShareTree(root)).issues.length, 3)
}))
test('rejects historic screenshots and unreviewed large files', () => isolated(async root => {
  await mkdir(join(root, 'screenshots'))
  await writeFile(join(root, 'screenshots/old.png'), Buffer.from([0]))
  await writeFile(join(root, 'large.bin'), Buffer.alloc(10 * 1024 * 1024 + 1))
  assert.equal((await checkShareTree(root)).issues.length, 2)
}))
test('does not follow symbolic links outside the snapshot', () => isolated(async root => {
  await symlink(parent, join(root, 'outside'))
  await assert.rejects(checkShareTree(root), /符号链接/)
}))
test('permits reviewed empty release placeholders, never APK files', () => isolated(async root => {
  await mkdir(join(root, 'app/.private-release/android'), { recursive: true })
  await writeFile(join(root, 'app/.private-release/android/.gitkeep'), '')
  assert.equal((await checkShareTree(root)).issues.length, 0)
  await writeFile(join(root, 'app/.private-release/android/private.apk'), Buffer.from([0]))
  assert.ok((await checkShareTree(root)).issues.length > 0)
}))
