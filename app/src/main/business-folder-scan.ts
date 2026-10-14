import { randomUUID } from 'node:crypto'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import type { BusinessFileRole, BusinessFolderScanCandidate, BusinessFolderScanResult } from '../shared/domain'

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'])
const MAX_SCAN_FILES = 2_000
const MAX_IMPORT_CANDIDATES = 100
const SCAN_TTL_MS = 30 * 60 * 1_000

interface StoredCandidate extends BusinessFolderScanCandidate {
  sourcePath: string
}

const scans = new Map<string, { rootPath: string; expiresAt: number; candidates: StoredCandidate[] }>()

function suggestedRole(relativePath: string): { role: BusinessFileRole; reason: string } | null {
  const text = relativePath.toLowerCase()
  if (/(聊天|沟通|对话|chat|screenshot|screen.?shot)/i.test(text)) return { role: 'chat_screenshot', reason: '文件名或文件夹包含聊天截图关键词' }
  if (/(发票|开票|invoice)/i.test(text)) return { role: 'invoice_file', reason: '文件名或文件夹包含发票关键词' }
  if (/(返点合同|返款合同|返点协议|返款协议|合作合同|商务合同|contract|agreement)/i.test(text)) return { role: 'rebate_contract', reason: '文件名或文件夹包含合同关键词' }
  if (/(返点|返款|转账|付款|支付|回款|流水|payment|transfer)/i.test(text)) return { role: 'rebate_payment_proof', reason: '文件名或文件夹包含返点或转账关键词' }
  return null
}

function cleanupExpired(): void {
  const timestamp = Date.now()
  for (const [scanId, scan] of scans) if (scan.expiresAt <= timestamp) scans.delete(scanId)
}

export async function scanBusinessFolderPath(sourceRoot: string): Promise<BusinessFolderScanResult> {
  cleanupExpired()
  const rootPath = await realpath(sourceRoot)
  const candidates: StoredCandidate[] = []
  const warnings: string[] = []
  let visitedFiles = 0
  let ignoredCount = 0

  const visit = async (directory: string): Promise<void> => {
    if (visitedFiles >= MAX_SCAN_FILES) return
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (visitedFiles >= MAX_SCAN_FILES) break
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) { ignoredCount += 1; continue }
      if (entry.isDirectory()) { await visit(path); continue }
      if (!entry.isFile()) continue
      visitedFiles += 1
      if (!SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) { ignoredCount += 1; continue }
      const relativePath = relative(rootPath, path)
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) { ignoredCount += 1; continue }
      const suggestion = suggestedRole(relativePath)
      if (!suggestion) { ignoredCount += 1; continue }
      const fileStat = await stat(path)
      if (fileStat.size <= 0 || fileStat.size > 25 * 1024 * 1024) { ignoredCount += 1; continue }
      candidates.push({
        id: randomUUID(),
        relativePath,
        fileName: entry.name,
        suggestedRole: suggestion.role,
        reason: suggestion.reason,
        sizeBytes: fileStat.size,
        sourcePath: path
      })
    }
  }
  await visit(rootPath)
  if (visitedFiles >= MAX_SCAN_FILES) warnings.push(`文件较多，本次只检查前${MAX_SCAN_FILES}个文件`)
  if (candidates.length > MAX_IMPORT_CANDIDATES) warnings.push(`识别到${candidates.length}个候选，单次最多导入${MAX_IMPORT_CANDIDATES}个`)
  const scanId = randomUUID()
  scans.set(scanId, { rootPath, expiresAt: Date.now() + SCAN_TTL_MS, candidates })
  return {
    canceled: false,
    scanId,
    rootName: basename(rootPath),
    candidates: candidates.slice(0, MAX_IMPORT_CANDIDATES).map((candidate) => ({
      id: candidate.id,
      relativePath: candidate.relativePath,
      fileName: candidate.fileName,
      suggestedRole: candidate.suggestedRole,
      reason: candidate.reason,
      sizeBytes: candidate.sizeBytes
    })),
    ignoredCount,
    warnings
  }
}

export async function resolveBusinessFolderCandidates(scanId: string, candidateIds: string[]): Promise<Array<StoredCandidate>> {
  cleanupExpired()
  const scan = scans.get(scanId)
  if (!scan) throw new Error('文件夹扫描结果已过期，请重新扫描')
  const uniqueIds = [...new Set(candidateIds)]
  if (uniqueIds.length < 1 || uniqueIds.length > MAX_IMPORT_CANDIDATES) throw new Error(`单次最多导入${MAX_IMPORT_CANDIDATES}个文件`)
  const byId = new Map(scan.candidates.map((candidate) => [candidate.id, candidate]))
  const selected = uniqueIds.map((id) => {
    const candidate = byId.get(id)
    if (!candidate) throw new Error('文件夹候选已变化，请重新扫描')
    return candidate
  })
  for (const candidate of selected) {
    const current = await realpath(candidate.sourcePath)
    const relativePath = relative(scan.rootPath, current)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) throw new Error('文件已移出所选文件夹，请重新扫描')
  }
  scans.delete(scanId)
  return selected
}
