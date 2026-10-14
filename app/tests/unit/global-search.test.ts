import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { buildGlobalSearchIndex, searchGlobalDocuments, searchGlobalIndex, type GlobalSearchDocument } from '../../src/shared/global-search'

const documents: GlobalSearchDocument[] = [
  {
    kind: 'project', id: 'project-new', title: '自媒体系统App', subtitle: 'AI · 内容项目',
    searchableText: '用Creator工作流管理视频', updatedAt: '2026-07-24T10:00:00.000Z', projectId: 'project-new'
  },
  {
    kind: 'project', id: 'project-old', title: '桌面改造', subtitle: '数码 · 内容项目',
    searchableText: '显示器和桌面布置', updatedAt: '2026-07-20T10:00:00.000Z', projectId: 'project-old'
  },
  {
    kind: 'topic', id: 'topic-1', title: 'AI浏览器入门', subtitle: 'AI · 筹备',
    searchableText: '面向第一次接触AI工具的人', updatedAt: '2026-07-23T10:00:00.000Z', projectId: null
  },
  {
    kind: 'inspiration', id: 'capture-1', title: '剪辑流程可以更简单', subtitle: '内容灵感',
    searchableText: '先做粗剪，再校对字幕', updatedAt: '2026-07-22T10:00:00.000Z', projectId: null
  },
  {
    kind: 'account', id: 'account-1', title: '科技频道', subtitle: 'B站账号',
    searchableText: '长视频主账号', updatedAt: '2026-07-21T10:00:00.000Z', projectId: null
  }
]

describe('global local search', () => {
  it('returns recent projects only before a query is entered', () => {
    expect(searchGlobalDocuments(documents, '').map((result) => result.id)).toEqual(['project-new', 'project-old'])
  })

  it('matches Chinese, English and pinyin initials without network or AI', () => {
    expect(searchGlobalDocuments(documents, '字幕')[0]).toMatchObject({ kind: 'inspiration', id: 'capture-1' })
    expect(searchGlobalDocuments(documents, 'creator')[0]).toMatchObject({ kind: 'project', id: 'project-new' })
    expect(searchGlobalDocuments(documents, 'zmtxt')[0]).toMatchObject({ kind: 'project', id: 'project-new' })
  })

  it('supports full pinyin and restrained typo matching', () => {
    expect(searchGlobalDocuments(documents, 'jianjiliucheng')[0]).toMatchObject({ id: 'capture-1' })
    expect(searchGlobalDocuments(documents, 'creatr')[0]).toMatchObject({ id: 'project-new' })
    expect(searchGlobalDocuments(documents, '完全无关')).toEqual([])
  })

  it('keeps grouped result order and ranks recent projects first inside the project group', () => {
    const results = searchGlobalDocuments(documents, '内容')
    expect(results.map((result) => result.kind)).toEqual(['project', 'project', 'inspiration'])
    expect(results.filter((result) => result.kind === 'project').map((result) => result.id)).toEqual(['project-new', 'project-old'])
  })

  it('reserves result capacity for every matching group instead of letting projects starve exact matches', () => {
    const crowded: GlobalSearchDocument[] = Array.from({ length: 60 }, (_, index) => ({
      kind: 'project',
      id: `project-${index}`,
      title: `科技项目${index}`,
      subtitle: '科技内容项目',
      searchableText: '科技',
      updatedAt: `2026-07-${String((index % 24) + 1).padStart(2, '0')}T10:00:00.000Z`,
      projectId: `project-${index}`
    }))
    crowded.push(
      { kind: 'script', id: 'script-exact', title: '科技文案', subtitle: '定稿文案', searchableText: '科技', updatedAt: '2026-07-24T12:00:00.000Z', projectId: 'project-1' },
      { kind: 'account', id: 'account-exact', title: '科技账号', subtitle: 'B站账号', searchableText: '科技', updatedAt: '2026-07-24T12:00:00.000Z', projectId: null }
    )
    const results = searchGlobalDocuments(crowded, '科技', 10)
    expect(searchGlobalDocuments(crowded, '科技', 1)).toHaveLength(1)
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'script', id: 'script-exact' }),
      expect.objectContaining({ kind: 'account', id: 'account-exact' })
    ]))
  })

  it('keeps repeated search responsive after a large local projection is built', () => {
    const largeDocuments: GlobalSearchDocument[] = Array.from({ length: 500 }, (_, index) => ({
      kind: 'project',
      id: `large-${index}`,
      title: index === 321 ? '效率中心' : `长文项目${index}`,
      subtitle: '本机内容项目',
      searchableText: '这是很长的中文正文'.repeat(2_500),
      updatedAt: '2026-07-24T10:00:00.000Z',
      projectId: `large-${index}`
    }))
    const index = buildGlobalSearchIndex(largeDocuments)
    const startedAt = performance.now()
    for (let count = 0; count < 5; count += 1) {
      expect(searchGlobalIndex(index, 'xlzx', 50)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'large-321' })
      ]))
    }
    expect(performance.now() - startedAt).toBeLessThan(1_500)
  })
})
