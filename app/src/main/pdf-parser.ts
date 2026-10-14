import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const parentPort = process.parentPort
if (!parentPort) throw new Error('PDF解析进程缺少父进程端口')

interface PdfLoadingTask {
  promise: Promise<{ numPages: number; getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }> }>
  destroy(): Promise<void>
}

function installTextOnlyPdfGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    DOMMatrix?: new () => object
    Path2D?: new () => object
    ImageData?: new () => object
  }
  globals.DOMMatrix ??= class DOMMatrix {}
  globals.Path2D ??= class Path2D {}
  globals.ImageData ??= class ImageData {}
}

function normalizePageText(items: unknown[]): string {
  let text = ''
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') continue
    text += item.str
    text += 'hasEOL' in item && item.hasEOL ? '\n' : ' '
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
}

parentPort.once('message', async (event: { data?: { path?: unknown } }) => {
  let loadingTask: PdfLoadingTask | null = null
  try {
    const path = event.data?.path
    if (typeof path !== 'string' || !path) throw new Error('PDF解析路径无效')
    const buffer = await readFile(path)
    if (buffer.subarray(0, Math.min(buffer.length, 1024)).indexOf('%PDF-') < 0) throw new Error('所选文件不是有效PDF')
    installTextOnlyPdfGlobals()
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const require = createRequire(__filename)
    GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    loadingTask = getDocument({
      data: new Uint8Array(buffer), disableAutoFetch: true, disableStream: true, useSystemFonts: true, verbosity: 0
    })
    const document = await loadingTask.promise
    if (document.numPages < 1 || document.numPages > 500) throw new Error('PDF页数必须在1—500页之间')
    const pages: string[] = []
    let length = 0
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      const pageText = normalizePageText(content.items)
      length += pageText.length
      if (length > 1_000_000) throw new Error('PDF可提取文字不能超过100万字')
      if (pageText) pages.push(pageText)
      page.cleanup()
    }
    const text = pages.join('\n\n').trim()
    if (text.length < 2) throw new Error('PDF没有可提取文字，请粘贴文字或导出可搜索PDF')
    parentPort.postMessage({ ok: true, text, pageCount: document.numPages })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const message = name === 'PasswordException' ? 'PDF有密码保护，请解除密码后再导入' : error instanceof Error ? error.message : 'PDF解析失败'
    parentPort.postMessage({ ok: false, error: message })
  } finally {
    await loadingTask?.destroy().catch(() => undefined)
  }
})
