import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'visual-baseline/v8-manifest.json'), 'utf8'))
const bytes = await readFile(resolve(root, manifest.baseline))
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== manifest.sha256) {
  console.error(`v8 baseline changed\nexpected: ${manifest.sha256}\nactual:   ${actual}`)
  process.exit(1)
}
console.log(`v8 baseline verified: ${actual}`)
