import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const appRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appRoot, '..')
const source = resolve(process.env.LY_CREATOR_APP_SOURCE ?? join(appRoot, 'dist/mac-arm64/LY Creator OS.app'))
const installDirectory = resolve(process.env.LY_CREATOR_INSTALL_DIR ?? '/Applications')
const destination = join(installDirectory, basename(source))
const shouldLaunch = !process.argv.includes('--no-launch')
const shouldRemoveSource = process.argv.includes('--remove-source')
const skipSystemRegistration = process.env.LY_CREATOR_SKIP_SYSTEM_REGISTRATION === '1'
const bundleIdentifier = 'com.ly.creatoros'
const launchServices = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

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

async function commandOutput(command, args, options = {}) {
  const result = await execute(command, args, { encoding: 'utf8', ...options })
  return result.stdout.trim()
}

async function optionalCommandOutput(command, args, options = {}) {
  try {
    return await commandOutput(command, args, options)
  } catch {
    return ''
  }
}

async function assertBundle(path) {
  const plist = join(path, 'Contents/Info.plist')
  const asar = join(path, 'Contents/Resources/app.asar')
  await Promise.all([access(plist), access(asar)])
  const identifier = await commandOutput('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
  if (identifier !== bundleIdentifier) throw new Error(`拒绝安装未知App：${identifier || '缺少Bundle ID'}`)
  return { plist, asar }
}

async function setPlistValue(plist, key, value) {
  const type = key === 'CFBundleVersion' ? 'string' : 'string'
  try {
    await execute('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
  } catch {
    await execute('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist])
  }
}

async function writeBuildIdentity(sourceBundle, plist, sourceAsar) {
  const commit = await optionalCommandOutput('/usr/bin/git', ['rev-parse', '--short=12', 'HEAD'], { cwd: repositoryRoot }) || 'unknown'
  const commitCount = await optionalCommandOutput('/usr/bin/git', ['rev-list', '--count', 'HEAD'], { cwd: repositoryRoot }) || '0'
  const now = new Date()
  const builtAt = now.toISOString()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const buildVersion = `${date}.${commitCount}`
  const asarSha256 = await fileHash(sourceAsar)
  const buildId = `${asarSha256.slice(0, 12)}-${date}.${commitCount}`
  const buildInfo = { buildId, commit, builtAt, buildVersion, asarSha256 }
  // PlistBuddy rewrites the whole plist, so these updates must stay sequential.
  await setPlistValue(plist, 'CFBundleVersion', buildVersion)
  await setPlistValue(plist, 'LYBuildID', buildId)
  await setPlistValue(plist, 'LYBuildCommit', commit)
  await writeFile(join(sourceBundle, 'Contents/Resources/build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, { mode: 0o644 })
  return buildInfo
}

async function runningAppPids() {
  const output = await optionalCommandOutput('/usr/bin/pgrep', ['-f', '/LY Creator OS\\.app/Contents/MacOS/LY Creator OS$'])
  return output.split(/\s+/).filter(Boolean).map(Number).filter((pid) => Number.isInteger(pid) && pid !== process.pid)
}

async function stopRunningCopies() {
  let pids = await runningAppPids()
  pids.forEach((pid) => {
    try { process.kill(pid, 'SIGTERM') } catch { /* App may have already exited. */ }
  })
  for (let attempt = 0; attempt < 80 && pids.length; attempt += 1) {
    await delay(125)
    pids = await runningAppPids()
  }
  pids.forEach((pid) => {
    try { process.kill(pid, 'SIGKILL') } catch { /* App may have already exited. */ }
  })
  if (pids.length) await delay(250)
}

async function replaceInstalledBundle(sourceBundle, targetBundle, sourceHash) {
  await mkdir(installDirectory, { recursive: true })
  const temporary = join(installDirectory, `.LY Creator OS.installing-${process.pid}.app`)
  const backup = join(installDirectory, `.LY Creator OS.previous-${process.pid}.app`)
  await Promise.all([
    rm(temporary, { recursive: true, force: true }),
    rm(backup, { recursive: true, force: true })
  ])
  await execute('/usr/bin/ditto', ['--rsrc', '--extattr', sourceBundle, temporary])
  const temporaryBundle = await assertBundle(temporary)
  const copiedHash = await fileHash(temporaryBundle.asar)
  if (copiedHash !== sourceHash) {
    await rm(temporary, { recursive: true, force: true })
    throw new Error('安装副本校验失败，旧App保持不变')
  }
  let hadPrevious = false
  try {
    await rename(targetBundle, backup)
    hadPrevious = true
  } catch (reason) {
    if (!(reason instanceof Error && 'code' in reason && reason.code === 'ENOENT')) throw reason
  }
  try {
    await rename(temporary, targetBundle)
    if (hadPrevious) await rm(backup, { recursive: true, force: true })
  } catch (reason) {
    await rm(temporary, { recursive: true, force: true })
    if (hadPrevious) await rename(backup, targetBundle)
    throw reason
  }
}

async function registerOnlyInstalledCopy() {
  if (skipSystemRegistration) return
  // Keep generated directory bundles out of Spotlight so only /Applications
  // remains a user-launchable copy after the explicit unregister below.
  await writeFile(join(appRoot, 'dist/.metadata_never_index'), '').catch(() => undefined)
  const indexed = await optionalCommandOutput('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleIdentifier}'`])
  const registryDump = await optionalCommandOutput(launchServices, ['-dump'])
  const registered = [...registryDump.matchAll(/^path:\s+(.+?LY Creator OS\.app)(?:\s+\(0x[0-9a-f]+\))?$/gmu)]
    .map((match) => match[1])
    .filter(Boolean)
  const knownCopies = new Set([...indexed.split('\n'), ...registered].map((value) => value.trim()).filter(Boolean))
  for (const path of knownCopies) {
    if (resolve(path) !== resolve(destination)) await optionalCommandOutput(launchServices, ['-u', path])
  }
  await commandOutput(launchServices, ['-f', destination])
  await execute('/usr/bin/touch', [destination])
}

async function removeTemporaryBuildCopy() {
  if (!shouldRemoveSource || resolve(source) === resolve(destination)) return
  if (!skipSystemRegistration) await optionalCommandOutput(launchServices, ['-u', source])
  await rm(source, { recursive: true, force: true })
}

async function launchInstalledCopy() {
  if (!shouldLaunch) return
  await execute('/usr/bin/open', [destination])
  const expectedSuffix = `${destination}/Contents/MacOS/LY Creator OS`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const output = await optionalCommandOutput('/usr/bin/pgrep', ['-f', `${expectedSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`])
    if (output) return
    await delay(125)
  }
  throw new Error('新App已经安装，但没有成功启动')
}

if (process.platform !== 'darwin') throw new Error('Mac App安装脚本只能在macOS运行')

const sourceBundle = await assertBundle(source)
const buildInfo = await writeBuildIdentity(source, sourceBundle.plist, sourceBundle.asar)
const sourceHash = await fileHash(sourceBundle.asar)
await stopRunningCopies()
await replaceInstalledBundle(source, destination, sourceHash)
const installedBundle = await assertBundle(destination)
const installedHash = await fileHash(installedBundle.asar)
if (installedHash !== sourceHash) throw new Error('安装完成后的App与本次构建不一致')
const installedBuildInfo = JSON.parse(await readFile(join(destination, 'Contents/Resources/build-info.json'), 'utf8'))
if (installedBuildInfo.buildId !== buildInfo.buildId) throw new Error('安装完成后的构建身份不一致')
await removeTemporaryBuildCopy()
await registerOnlyInstalledCopy()
await launchInstalledCopy()

console.log(`installed latest LY Creator OS: ${destination}`)
console.log(`build=${buildInfo.buildId} asar=${sourceHash}`)
