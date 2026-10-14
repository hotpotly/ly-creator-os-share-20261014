import { spawn } from 'node:child_process'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

async function acquireLock(): Promise<() => Promise<void>> {
  const root = resolve(import.meta.dirname, '../../../test-results/integration')
  const lock = resolve(root, 'flutter-fixture.lock')
  await mkdir(root, { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, id: randomUUID() })
  const deadline = Date.now() + 180_000
  while (true) {
    try {
      const file = await open(lock, 'wx')
      try { await file.writeFile(owner) } catch (error) { await rm(lock, { force: true }); throw error } finally { await file.close() }
      return async () => {
        if (await readFile(lock, 'utf8').catch(() => '') === owner) await rm(lock, { force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let metadata: { pid?: number } | undefined
      try { metadata = JSON.parse(await readFile(lock, 'utf8')) as { pid?: number } } catch { metadata = undefined }
      if (metadata && Number.isSafeInteger(metadata.pid) && metadata.pid! > 0) {
        try { process.kill(metadata.pid!, 0) } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code === 'ESRCH') throw new Error(`Stale Flutter fixture lock requires inspection: ${lock}`)
        }
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Flutter fixture lock: ${lock}`)
      await sleep(150)
    }
  }
}

export async function runFlutterFixture(testPath: string, defineName: string, fixture: string): Promise<{ code: number | null; output: string }> {
  const release = await acquireLock()
  try {
    return await new Promise((resolveResult, reject) => {
      const detached = process.platform !== 'win32'
      const child = spawn(process.env.CREATOR_OS_FLUTTER ?? 'flutter', ['test', '--no-pub', '--concurrency=1', '--reporter=expanded', `--dart-define=${defineName}=${fixture}`, testPath], {
        cwd: resolve(import.meta.dirname, '../../../../mobile'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached
      })
      let output = '', timedOut = false, forceTimer: NodeJS.Timeout | undefined
      const stop = (signal: NodeJS.Signals): void => {
        try {
          if (detached && child.pid) process.kill(-child.pid, signal)
          else child.kill(signal)
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal) }
      }
      const timer = setTimeout(() => { timedOut = true; stop('SIGTERM'); forceTimer = setTimeout(() => stop('SIGKILL'), 5_000) }, 150_000)
      child.stdout.on('data', chunk => { output += String(chunk) })
      child.stderr.on('data', chunk => { output += String(chunk) })
      child.once('error', error => { clearTimeout(timer); clearTimeout(forceTimer); reject(error) })
      child.once('close', code => {
        clearTimeout(timer); clearTimeout(forceTimer)
        if (timedOut) reject(new Error(`Flutter integration timed out\n${output}`))
        else resolveResult({ code, output })
      })
    })
  } finally { await release() }
}
