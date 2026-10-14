import { describe, expect, it } from 'vitest'
import { actions } from '../../src/renderer/src/data/home-fixture'

const canonicalTemplates = ['数码长视频', '数码短视频', '手机系统测评', 'AI教学', '商单']

describe('stage-one fixtures', () => {
  it('shows project workflow templates instead of content direction aliases on home actions', () => {
    for (const action of actions) expect(canonicalTemplates).toContain(action.type)
  })

  it('does not display content directions where a workflow template is required', () => {
    expect(actions.map((item) => item.type)).not.toContain('数码')
    expect(actions.map((item) => item.type)).not.toContain('手机系统')
    expect(actions.map((item) => item.type)).not.toContain('AI')
  })
})
