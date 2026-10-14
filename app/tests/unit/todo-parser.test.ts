import { describe, expect, it } from 'vitest'
import { parseTodoBatch } from '../../src/shared/todo-parser'

describe('todo batch parser', () => {
  it('splits inherited Chinese date and segment context into editable todo inputs', () => {
    const result = parseTodoBatch(
      '今天上午整理测试项目甲文案，下午整理测试项目乙拍摄素材和研究AI工作流，晚上买洗衣液',
      {
        today: '2026-07-27',
        projects: [{ id: 'project-aofeng', title: '测试项目甲' }, { id: 'project-oppo', title: '测试项目乙' }]
      }
    )

    expect(result).toHaveLength(4)
    expect(result.map(({ title, plannedDate, segment, category, projectId, trackingMode }) => ({
      title, plannedDate, segment, category, projectId, trackingMode
    }))).toEqual([
      { title: '整理测试项目甲文案', plannedDate: '2026-07-27', segment: 'morning', category: 'self_media', projectId: 'project-aofeng', trackingMode: 'checklist' },
      { title: '整理测试项目乙拍摄素材', plannedDate: '2026-07-27', segment: 'afternoon', category: 'self_media', projectId: 'project-oppo', trackingMode: 'checklist' },
      { title: '研究AI工作流', plannedDate: '2026-07-27', segment: 'afternoon', category: 'ai', projectId: null, trackingMode: 'checklist' },
      { title: '买洗衣液', plannedDate: '2026-07-27', segment: 'evening', category: 'life', projectId: null, trackingMode: 'checklist' }
    ])
  })

  it('only enables progress when the text contains an explicit progress meaning', () => {
    const result = parseTodoBatch('明天上午写脚本40%，下午准备资料；后天研究Codex做到一半', {
      today: '2026-07-27'
    })
    expect(result).toMatchObject([
      { title: '写脚本', plannedDate: '2026-07-28', segment: 'morning', trackingMode: 'progress', progress: 40, category: 'self_media' },
      { title: '准备资料', plannedDate: '2026-07-28', segment: 'afternoon', trackingMode: 'checklist', progress: 0, category: 'self_media' },
      { title: '研究Codex', plannedDate: '2026-07-29', segment: 'afternoon', trackingMode: 'progress', progress: 50, category: 'ai' }
    ])
  })

  it('matches a unique project by its compact title prefix and leaves time unspecified', () => {
    const result = parseTodoBatch('蓝鲸键盘给意见2，青鸟鼠标拍摄2小时，NAS写2小时', {
      today: '2026-07-27',
      projects: [
        { id: 'honor', title: '演示·蓝鲸键盘深度体验' },
        { id: 'aofeng', title: '青鸟鼠标体验' },
        { id: 'nas', title: 'NAS自动备份教程' }
      ]
    })
    expect(result).toMatchObject([
      { projectId: 'honor', segment: null },
      { projectId: 'aofeng', segment: null },
      { projectId: 'nas', segment: null }
    ])
  })

  it('does not associate a todo with a matching project in the recycle bin', () => {
    expect(parseTodoBatch('OPPO报销路费', {
      today: '2026-08-13',
      projects: [{ id: 'oppo', title: 'OPPO', trashedAt: '2026-08-12T08:00:00.000Z' }]
    })).toMatchObject([{
      title: 'OPPO报销路费',
      projectId: null
    }])
  })

  it('uses the viewed date as the default while keeping explicit relative dates anchored to today', () => {
    const result = parseTodoBatch('整理明日素材，今天回复甲方，明天拍摄', {
      today: '2026-07-27',
      defaultDate: '2026-07-28'
    })
    expect(result).toMatchObject([
      { title: '整理明日素材', plannedDate: '2026-07-28' },
      { title: '回复甲方', plannedDate: '2026-07-27' },
      { title: '拍摄', plannedDate: '2026-07-28' }
    ])
  })

  it('classifies health separately from life and uses self media as the general work fallback', () => {
    expect(parseTodoBatch('今天跑步30分钟，买洗衣液，整理桌面', {
      today: '2026-07-28'
    })).toMatchObject([
      { title: '跑步30分钟', category: 'other_work' },
      { title: '买洗衣液', category: 'life' },
      { title: '整理桌面', category: 'self_media' }
    ])
  })

  it('recognizes a customized category name as an explicit prefix', () => {
    expect(parseTodoBatch('频道制作：写脚本，运动：跑步30分钟', {
      today: '2026-07-28',
      categoryLabels: {
        self_media: '频道制作',
        ai: 'AI研究',
        life: '生活',
        other_work: '运动'
      }
    })).toMatchObject([
      { title: '写脚本', category: 'self_media' },
      { title: '跑步30分钟', category: 'other_work' }
    ])
  })

  it('reuses a manual category correction for the same and strongly similar todo wording', () => {
    const categoryMemories = [{
      title: 'NAS人像拍完',
      normalizedTitle: 'nas人像拍完',
      category: 'life' as const,
      projectId: 'nas',
      updatedAt: '2026-08-05T08:00:00.000Z'
    }]
    const options = {
      today: '2026-08-05',
      projects: [{ id: 'nas', title: 'NAS' }],
      categoryMemories
    }

    expect(parseTodoBatch('NAS人像拍完，NAS人像剪', options)).toMatchObject([
      { category: 'life', categorySource: 'memory', suggestedCategory: 'life', projectId: 'nas' },
      { category: 'life', categorySource: 'memory', suggestedCategory: 'life', projectId: 'nas' }
    ])
  })

  it('keeps an explicit category prefix above learned corrections', () => {
    expect(parseTodoBatch('自媒体：NAS人像拍完', {
      today: '2026-08-05',
      categoryLabels: { self_media: '自媒体', ai: 'AI', life: '生活', other_work: '健康' },
      categoryMemories: [{
        title: 'NAS人像拍完',
        normalizedTitle: 'nas人像拍完',
        category: 'life',
        projectId: null,
        updatedAt: '2026-08-05T08:00:00.000Z'
      }]
    })).toMatchObject([{ category: 'self_media', categorySource: 'explicit' }])
  })

  it('falls back to deterministic rules when equally strong memories disagree', () => {
    expect(parseTodoBatch('整理桌面', {
      today: '2026-08-05',
      categoryMemories: [
        { title: '整理桌面', normalizedTitle: '整理桌面', category: 'life', projectId: null, updatedAt: '2026-08-05T08:00:00.000Z' },
        { title: '整理桌面', normalizedTitle: '整理桌面', category: 'ai', projectId: null, updatedAt: '2026-08-04T08:00:00.000Z' }
      ]
    })).toMatchObject([{ category: 'self_media', categorySource: 'rule' }])
  })
})
