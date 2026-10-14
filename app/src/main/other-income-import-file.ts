import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { parsePdfInUtilityProcess } from './pdf-parser-client'

const decodeXml = (value: string): string => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const columnIndex = (reference: string): number => {
  const letters = reference.match(/[A-Z]+/)?.[0] ?? 'A'
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

async function extractXlsxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('text') ?? ''
  if (sharedXml.length > 5_000_000) throw new Error('Excel共享文本过大，无法安全解析')
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => (
    decodeXml([...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join(''))
  ))
  const sheetNames = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()
  if (!sheetNames.length) throw new Error('Excel文件中没有可读取的工作表')
  const sheetXml = await zip.file(sheetNames[0]!)!.async('text')
  if (sheetXml.length > 20_000_000) throw new Error('Excel工作表解压后过大，无法安全解析')
  const rows: string[] = []
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1]!
      const body = cellMatch[2]!
      const reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? `A${rows.length + 1}`
      const index = columnIndex(reference)
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? ''
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        ?? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join('')
      const value = type === 's' ? sharedStrings[Number(raw)] ?? '' : decodeXml(raw ?? '')
      while (cells.length <= index) cells.push('')
      cells[index] = value
    }
    if (cells.some((cell) => cell.trim())) rows.push(cells.join('\t'))
  }
  if (!rows.length) throw new Error('Excel工作表没有可识别内容')
  const cells = rows.map((row) => row.split('\t'))
  const headerRowIndex = cells.findIndex((row) => row.some((header) => /日期|时间/.test(header)) && row.some((header) => /金额|收益|收支/.test(header)))
  const dateColumns = (cells[headerRowIndex < 0 ? 0 : headerRowIndex] ?? []).flatMap((header, index) => /日期|时间/.test(header) ? [index] : [])
  cells.slice(Math.max(0, headerRowIndex) + 1).forEach((row) => dateColumns.forEach((index) => {
    const serial = Number(row[index])
    if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return
    row[index] = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10)
  }))
  return cells.map((row) => row.join('\t')).join('\n')
}

async function extractPdfText(name: string, bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'creator-os-income-pdf-'))
  const safeName = basename(name).slice(0, 180) || 'income.pdf'
  const path = join(directory, safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`)
  try {
    await writeFile(path, bytes, { mode: 0o600 })
    const parsed = await parsePdfInUtilityProcess(path)
    if (!parsed.text.trim()) throw new Error('PDF没有可提取的文字，请改用截图导入')
    return parsed.text
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function extractOtherIncomeImportText(name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const extension = extname(name).toLowerCase()
  if (extension === '.xlsx' || mimeType.includes('spreadsheetml')) return extractXlsxText(bytes)
  if (extension === '.pdf' || mimeType === 'application/pdf') return extractPdfText(name, bytes)
  if (['.csv', '.tsv', '.txt'].includes(extension) || mimeType.startsWith('text/')) return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  throw new Error('暂不支持该收入导入文件格式')
}
