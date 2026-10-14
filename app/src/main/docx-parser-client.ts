import { utilityProcess } from 'electron'
import { join } from 'node:path'

interface ParserResponse { ok: boolean; text?: string; error?: string }
const MAX_IMPORTED_TEXT_LENGTH = 1_000_000

export function parseDocxInUtilityProcess(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(join(__dirname, 'docx-parser.js'), [], {
      serviceName: 'Word文案解析', execArgv: ['--max-old-space-size=128'], stdio: 'ignore', allowLoadingUnsignedLibraries: false
    })
    let settled = false
    const finish = (error?: Error, text?: string): void => {
      if (settled) return
      settled = true; clearTimeout(timeout); child.kill()
      if (error) reject(error); else resolve(text ?? '')
    }
    const timeout = setTimeout(() => finish(new Error('Word解析超时，请检查文件后重试')), 15_000)
    child.on('message', (message: ParserResponse) => {
      if (!message.ok) { finish(new Error(message.error || 'Word解析失败')); return }
      if (typeof message.text !== 'string' || message.text.length > MAX_IMPORTED_TEXT_LENGTH) { finish(new Error('Word文案正文不能超过100万字')); return }
      finish(undefined, message.text)
    })
    child.once('exit', (code) => { if (!settled) finish(new Error(`Word解析进程异常退出（${code ?? 'unknown'}）`)) })
    child.postMessage({ path })
  })
}
