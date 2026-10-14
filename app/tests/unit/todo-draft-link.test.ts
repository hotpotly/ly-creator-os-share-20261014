import { expect, test } from 'vitest'
import { draftProjectPatch, retainDraftOverrides } from '../../src/shared/todo-draft-link'

test('draft project bulk patch preserves only a same-project stage', () => {
 const draft = { projectId: 'a', stageKey: 'editing' as const }
 expect(draftProjectPatch(draft, 'a')).toEqual(draft)
 expect(draftProjectPatch(draft, 'b')).toEqual({ projectId: 'b', stageKey: null })
 expect(draftProjectPatch(draft, null)).toEqual({ projectId: null, stageKey: null })
 expect(draftProjectPatch({ projectId: null }, 'b')).toEqual({ projectId: 'b', stageKey: null })
 expect(draft).toEqual({ projectId: 'a', stageKey: 'editing' })
})
test('edited/deleted draft rows cannot revive an old override; explicit unlinked remains', () => {
 const overrides = { '0:剪辑': 'a', '1:字幕': null, '2:封面': 'b' }
 const kept = retainDraftOverrides(overrides, ['0:剪辑', '1:字幕', '2:买菜'])
 expect(kept).toEqual({ '0:剪辑': 'a', '1:字幕': null })
 expect(retainDraftOverrides(kept, ['2:封面'])).toEqual({})
 expect(retainDraftOverrides(overrides, ['1:剪辑'])).toEqual({})
})
