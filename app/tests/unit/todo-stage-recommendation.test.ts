import { describe, expect, it } from 'vitest'
import { recommendTodoStage } from '../../src/shared/todo-stage-recommendation'

describe('conservative stage recommendations', () => {
  it.each([
    ['19 DemoOS17录音+剪 (1)', 'editing'], ['录音＋剪（2）', 'editing'], ['OPPO粗剪(5)', 'editing'],
    ['精剪', 'editing'], ['剪辑', 'editing'], ['补拍镜头', 'shooting'], ['拍摄素材', 'shooting'],
    ['录屏(1)', 'shooting'], ['修改文案(0.5)', 'script'], ['写稿', 'script'], ['列大纲', 'outline'],
    ['整理资料', 'materials'], ['做字幕和封面', 'postproduction'], ['上传视频', 'publishing']
  ])('%s recommends %s', (title, stageKey) => {
    expect(recommendTodoStage(title)).toEqual({ stageKey, reason: 'text' })
  })
  it.each(['拍摄＋剪辑', '写文案、补拍', '剪辑加字幕'])('does not guess across stages: %s', title => {
    expect(recommendTodoStage(title)).toEqual({ stageKey: null, reason: 'ambiguous' })
  })
  it.each(['继续弄一下(2)', 'OPPO(1)', '录音', '研究剪映', '跑步(0.5)'])('does not guess generic titles: %s', title => {
    expect(recommendTodoStage(title)).toEqual({ stageKey: null, reason: 'unknown' })
  })
  it('ignores full project name and always uses the current title', () => {
    expect(recommendTodoStage('剪辑教程拍摄素材(1)', '剪辑教程').stageKey).toBe('shooting')
    expect(recommendTodoStage('OPPO拍摄(1)').stageKey).toBe('shooting')
    expect(recommendTodoStage('OPPO精剪(3)').stageKey).toBe('editing')
  })
})
