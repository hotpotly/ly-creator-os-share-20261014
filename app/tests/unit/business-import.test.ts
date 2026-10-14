import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBusinessFolderCandidates, scanBusinessFolderPath } from '../../src/main/business-folder-scan'
import { parseBilibiliHuahuoRows } from '../../src/shared/business-import'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('商务批量导入', () => {
  it('解析B站花火复制表格，并允许只有收益月份没有下单日期', () => {
    const parsed = parseBilibiliHuahuoRows([
      '订单名称\t订单收益\t收益月份\t账单状态\t订单号',
      '测试合作项目\t61,200\t2026-03\t已结算\torder-1',
      'Reno合作\t61200\t2026-06\t待结算\torder-2'
    ].join('\n'), {
      revenueMonth: null,
      rebateRequirement: 'not_required',
      invoiceRequirement: 'required'
    })
    expect(parsed.errors).toEqual([])
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[0]).toMatchObject({
      title: '测试合作项目',
      record: {
        orderPlatform: 'B站花火',
        orderDate: null,
        revenueMonth: '2026-03',
        platformOrderAmountCents: 6_120_000,
        paymentStatus: 'received',
        invoiceRequirement: 'required'
      }
    })
    expect(parsed.items[1]?.record).toMatchObject({ paymentStatus: 'pending', revenueMonth: '2026-06' })
  })

  it('本地扫描只返回合同、发票和返点候选，且不向Renderer暴露绝对路径', async () => {
    await mkdir(unitRoot, { recursive: true })
    const root = await mkdtemp(join(unitRoot, 'business-folder-'))
    roots.push(root)
    await mkdir(join(root, '发票'), { recursive: true })
    await writeFile(join(root, '发票', '2026年发票.pdf'), '%PDF-1.7\ninvoice')
    await writeFile(join(root, '返点转账截图.png'), Buffer.alloc(64, 1))
    await writeFile(join(root, '普通照片.jpg'), Buffer.alloc(64, 1))
    const result = await scanBusinessFolderPath(root)
    expect(result.canceled).toBe(false)
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: '2026年发票.pdf', suggestedRole: 'invoice_file' }),
      expect.objectContaining({ fileName: '返点转账截图.png', suggestedRole: 'rebate_payment_proof' })
    ]))
    expect(JSON.stringify(result)).not.toContain(root)
    const resolved = await resolveBusinessFolderCandidates(result.scanId!, result.candidates.map((candidate) => candidate.id))
    expect(resolved.every((candidate) => candidate.sourcePath.startsWith(root))).toBe(true)
  })
})
