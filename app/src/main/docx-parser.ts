import * as mammoth from 'mammoth'
import { readFile } from 'node:fs/promises'
import { assertActuallySafeDocxArchive } from './docx-archive-safety'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Word解析进程缺少父进程端口')

parentPort.once('message', async (event: { data?: { path?: unknown } }) => {
  try {
    const path = event.data?.path
    if (typeof path !== 'string' || !path) throw new Error('Word解析路径无效')
    assertActuallySafeDocxArchive(await readFile(path))
    const text = (await mammoth.extractRawText({ path })).value
    parentPort.postMessage({ ok: true, text })
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Word解析失败' })
  }
})
