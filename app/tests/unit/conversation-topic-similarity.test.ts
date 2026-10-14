import { describe, expect, it } from 'vitest'
import { findConversationTopicSimilarities, textSimilarity } from '../../src/main/conversation-topic-similarity'

describe('AI选题相似提示', () => {
  it('finds close Chinese directions without treating unrelated topics as duplicates', () => {
    expect(textSimilarity('用AI做App的踩坑总结', '我用AI开发App时踩过的坑')).toBeGreaterThan(0.3)
    expect(textSimilarity('用AI做App的踩坑总结', '机械键盘轴体横评')).toBeLessThan(0.2)
  })

  it('returns at most three sorted lifecycle-aware suggestions', () => {
    const result = findConversationTopicSimilarities(
      { title: '用AI开发App的踩坑总结', content: '总结我用AI开发App时遇到的真实问题和解决方法。' },
      [
        { id: 'published', title: 'AI开发App踩坑', text: 'AI开发App踩坑总结', kind: 'published_project' },
        { id: 'active', title: '用AI做App', text: '正在制作的AI App开发过程', kind: 'active_project' },
        { id: 'topic', title: 'AI App教程', text: '用AI做App的教程和问题', kind: 'existing_topic' },
        { id: 'parked', title: 'AI App失败复盘', text: 'AI开发App失败和踩坑', kind: 'parked_direction' }
      ],
      0.2
    )
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ kind: 'published_project', targetId: 'published' })
    expect(result.map((item) => item.score)).toEqual([...result.map((item) => item.score)].sort((left, right) => right - left))
  })
})
