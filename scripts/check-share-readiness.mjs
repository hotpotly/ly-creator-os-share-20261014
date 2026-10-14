#!/usr/bin/env node

import { prepareShareTree } from './prepare-share-tree.mjs'

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const privateMarkers = [
  ['荣', '耀'].join(''),
  ['傲', '风'].join(''),
  ['OPPO Find', ' X9'].join(''),
  ['Color', 'OS'].join(''),
  ['DX', '4600'].join(''),
  ['/Users', '/ly'].join(''),
  ['Codex Project', '/自媒体系统app'].join(''),
  ['真实用户', '账单'].join('')
]

const allowedFakeSecrets = new Set([
  'sk-abcdefghijklmnopqrstuvwxyz123456',
  'sk-test_12345678901234567890',
  'sk-super-sensitive-value',
  'sk-abcdefghijklmnopqrstuv'
])

const allowedCredentialUrls = new Set([
  'https://user:pass@my.feishu.cn/docx/abc'
])

const forbiddenBasenames = new Set([
  '.env',
  'key.properties',
  'local.properties',
  '.flutter-plugins-dependencies'
])

const forbiddenExtensions = new Set([
  '.apk', '.aab', '.jks', '.keystore', '.p12', '.pfx', '.pem', '.key',
  '.sqlite', '.sqlite3', '.db'
])

async function walk(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isSymbolicLink()) throw new Error(`分享包不允许符号链接：${relative(root, path)}`)
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function looksBinary(buffer) {
  const probeLength = Math.min(buffer.length, 8192)
  for (let index = 0; index < probeLength; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}

function inspectPath(relativePath, issues) {
  const name = basename(relativePath)
  const extension = extname(name).toLowerCase()
  if (!['app/.private-release/.gitignore', 'app/.private-release/android/.gitkeep'].includes(relativePath) && (/(^|\/)(?:\.git|node_modules|\.private[^/]*|\.runtime|test-results|backups?|user-data)(?:\/|$)/.test(relativePath) || /(?:screenshots|visual-baseline)/.test(relativePath))) issues.push(`${relativePath}：不允许分享历史截图、用户数据或本机目录`)
  if (forbiddenBasenames.has(name) || (name.startsWith('.env.') && name !== '.env.example')) {
    issues.push(`${relativePath}：不应进入源码分享包的本机配置文件`)
  }
  if (forbiddenExtensions.has(extension) || extension.startsWith('.sqlite3-')) {
    issues.push(`${relativePath}：不应进入源码分享包的数据库、签名或构建文件`)
  }
}

function inspectText(relativePath, text, issues) {
  for (const marker of privateMarkers) {
    if (text.includes(marker)) issues.push(`${relativePath}：仍包含私人标记“${marker}”`)
  }

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    issues.push(`${relativePath}：包含私钥头`)
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) {
    issues.push(`${relativePath}：包含疑似AWS访问密钥`)
  }
  if (/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/.test(text)) {
    issues.push(`${relativePath}：包含疑似GitHub令牌`)
  }
  if (/\b(?:github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,}|ntn_[A-Za-z0-9]{20,})\b/.test(text)) issues.push(`${relativePath}：包含疑似服务访问令牌`)
  if (/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(text)) {
    issues.push(`${relativePath}：包含疑似Slack令牌`)
  }

  for (const match of text.matchAll(/\bsk-[A-Za-z0-9_-]{20,}\b/g)) {
    const value = match[0]
    if (!allowedFakeSecrets.has(value)) {
      issues.push(`${relativePath}：包含疑似AI服务密钥`)
    }
  }

  for (const match of text.matchAll(/https?:\/\/[^/\s:@]+:[^/@\s]+@[^\s"'<>]+/g)) {
    if (!allowedCredentialUrls.has(match[0])) issues.push(`${relativePath}：包含带账号密码的URL`)
  }
}

export async function checkShareTree(root) {
  const issues = []
  const files = await walk(root)
  let bytes = 0

  for (const path of files) {
    const relativePath = relative(root, path).replaceAll('\\', '/')
    inspectPath(relativePath, issues)
    const info = await stat(path)
    bytes += info.size
    if (info.size > 10 * 1024 * 1024) { issues.push(`${relativePath}：超过10MiB，需单独审核而非跳过扫描`); continue }
    const buffer = await readFile(path)
    if (!looksBinary(buffer)) inspectText(relativePath, buffer.toString('utf8'), issues)
  }

  return { issues: [...new Set(issues)].sort(), fileCount: files.length, bytes }
}

async function createHeadSnapshot() {
  const temporaryRoot = join(projectRoot, '.share-output', 'checks')
  await mkdir(temporaryRoot, { recursive: true })
  const root = await mkdtemp(join(temporaryRoot, 'check-'))
  const archive = join(root, 'source.tar')
  const extracted = join(root, 'source')
  await mkdir(extracted)
  execFileSync('git', ['archive', '--format=tar', '--output', archive, 'HEAD'], { cwd: projectRoot })
  execFileSync('tar', ['-xf', archive, '-C', extracted])
  await prepareShareTree(extracted)
  return { root, extracted }
}

export async function runShareCheck() {
  const snapshot = await createHeadSnapshot()
  try {
    const result = await checkShareTree(snapshot.extracted)
    if (result.issues.length) {
      console.error(`源码分享检查失败，共${result.issues.length}项：`)
      for (const issue of result.issues) console.error(`- ${issue}`)
      return false
    }
    console.log(`源码分享检查通过：${result.fileCount}个文件，${(result.bytes / 1024 / 1024).toFixed(2)} MiB。`)
    return true
  } finally {
    await rm(snapshot.root, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const passed = await runShareCheck()
  if (!passed) process.exitCode = 1
}
