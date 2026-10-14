#!/usr/bin/env node

import { prepareShareTree } from './prepare-share-tree.mjs'

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runShareCheck, checkShareTree } from './check-share-readiness.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputRoot = join(projectRoot, '.share-output')
const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
const output = join(outputRoot, `ly-creator-os-source-${revision}`)
const archive = join(outputRoot, `ly-creator-os-source-${revision}.tar`)

if (!await runShareCheck()) process.exit(1)

await mkdir(outputRoot, { recursive: true })
try {
  await mkdir(output, { recursive: false })
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    console.error(`输出目录已经存在：${output}`)
    console.error('为避免覆盖已有分享包，本次没有改动该目录。')
    process.exit(1)
  }
  throw error
}

execFileSync('git', ['archive', '--format=tar', '--output', archive, 'HEAD'], { cwd: projectRoot })
execFileSync('tar', ['-xf', archive, '-C', output])
await prepareShareTree(output)
await rm(archive)

await writeFile(join(output, 'SOURCE_SNAPSHOT.md'), `# 源码快照\n\n- 来源提交：\`${revision}\`\n- 生成方式：\`npm run share:source\`\n- 说明：本目录不含原仓库Git历史、内部协作文档、签名文件、用户数据库、API密钥和本机构建产物。演示seed中的三段文案已替换为明确标注的虚构测试文字；功能逻辑保持来源提交版本。\n`, 'utf8')

const finalCheck = await checkShareTree(output)
if (finalCheck.issues.length) throw new Error(`最终分享目录检查失败：${finalCheck.issues.join('；')}`)

console.log(`源码快照已生成：${output}`)
console.log('请在这个目录中新建Git仓库，再上传到一个新的GitHub私有仓库。')
