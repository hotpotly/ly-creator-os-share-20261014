import { createReadStream } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const source = resolve(process.env.LY_CREATOR_APP_SOURCE ?? join(appRoot, 'dist/mac-arm64/LY Creator OS.app'))
const installed = resolve(process.env.LY_CREATOR_INSTALLED_APP ?? '/Applications/LY Creator OS.app')

async function fileHash(path) {
  const hash = createHash('sha256')
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', rejectHash)
    stream.once('end', resolveHash)
  })
  return hash.digest('hex')
}

const sourceAsar = join(source, 'Contents/Resources/app.asar')
const installedAsar = join(installed, 'Contents/Resources/app.asar')
const sourceBuildInfoPath = join(source, 'Contents/Resources/build-info.json')
const installedBuildInfoPath = join(installed, 'Contents/Resources/build-info.json')
await Promise.all([access(installedAsar), access(installedBuildInfoPath)])
const [installedHash, installedBuildInfo] = await Promise.all([
  fileHash(installedAsar),
  readFile(installedBuildInfoPath, 'utf8').then(JSON.parse)
])
if (!installedBuildInfo.buildId || installedBuildInfo.asarSha256 !== installedHash) {
  throw new Error('Applications中的构建清单与App内容不一致')
}

const sourceExists = await access(sourceAsar).then(() => true).catch(() => false)
if (process.env.LY_CREATOR_APP_SOURCE && !sourceExists) throw new Error('指定的待安装App不存在')
if (sourceExists) {
  await access(sourceBuildInfoPath)
  const [sourceHash, sourceBuildInfo] = await Promise.all([
    fileHash(sourceAsar),
    readFile(sourceBuildInfoPath, 'utf8').then(JSON.parse)
  ])
  if (sourceHash !== installedHash) throw new Error('Applications中的App不是本次构建')
  if (!sourceBuildInfo.buildId || sourceBuildInfo.buildId !== installedBuildInfo.buildId) {
    throw new Error('Applications中的构建身份与本次构建不一致')
  }
  if (sourceBuildInfo.asarSha256 !== sourceHash) throw new Error('待安装App的构建清单与内容不一致')
}
console.log(`installed app verified: build=${installedBuildInfo.buildId} asar=${installedHash}`)
