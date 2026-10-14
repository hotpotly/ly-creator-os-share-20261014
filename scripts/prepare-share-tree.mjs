import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function prepareShareTree(root) {
  const seedPath = join(root, 'app/src/main/db/seed.ts')
  const source = await readFile(seedPath, 'utf8')
  const start = source.indexOf('const scriptSeeds:')
  const end = source.indexOf('\nconst ', start + 1)
  if (start < 0 || end < 0) throw new Error('演示文案边界已变化，停止生成分享包')
  let replacements = 0
  const seed = source.slice(start, end).replace(/(claude|codex|merged): '<p>[^\n]*'/g, (_match, key) => {
    replacements += 1
    return `${key}: '<p>虚构演示文案：这是一段用于验证编辑、比较与定稿的${key}版本测试文字，不包含真实项目内容。</p><p>虚构测试任务：找到资料、核对来源，结果能追溯。</p>'`
  })
  if (replacements !== 3) throw new Error('演示文案数量不符，停止生成分享包')
  await writeFile(seedPath, source.slice(0, start) + seed + source.slice(end), 'utf8')
}
