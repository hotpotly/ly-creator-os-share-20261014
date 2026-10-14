import { utilityProcess } from 'electron'
import { join } from 'node:path'

export interface ParsedPdf { text: string; pageCount: number }
interface ParserResponse { ok: boolean; text?: string; pageCount?: number; error?: string }
const MAX_IMPORTED_TEXT_LENGTH = 1_000_000

export function parsePdfInUtilityProcess(path: string): Promise<ParsedPdf> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(join(__dirname, 'pdf-parser.js'), [], {
      serviceName: 'PDF资料解析', execArgv: ['--max-old-space-size=256'], stdio: 'ignore', allowLoadingUnsignedLibraries: false
    })
    let settled = false
    const finish = (error?: Error, result?: ParsedPdf): void => {
      if (settled) return
      settled = true; clearTimeout(timeout); child.kill()
      if (error) reject(error); else if (result) resolve(result); else reject(new Error('PDF解析没有返回结果'))
    }
    const timeout = setTimeout(() => finish(new Error('PDF解析超时，请检查文件后重试')), 30_000)
    child.on('message', (message: ParserResponse) => {
      if (!message.ok) { finish(new Error(message.error || 'PDF解析失败')); return }
      if (typeof message.text !== 'string' || message.text.length > MAX_IMPORTED_TEXT_LENGTH || !Number.isInteger(message.pageCount) || (message.pageCount ?? 0) < 1) {
        finish(new Error('PDF解析结果无效')); return
      }
      finish(undefined, { text: message.text, pageCount: message.pageCount! })
    })
    child.once('exit', (code) => { if (!settled) finish(new Error(`PDF解析进程异常退出（${code ?? 'unknown'}）`)) })
    child.postMessage({ path })
  })
}
