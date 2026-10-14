import { describe, expect, it } from 'vitest'
import { buildImmediateScriptMaterialMapping, splitImmediateScriptMaterialSource } from '../../src/shared/script-material-local-map'

describe('immediate script material mapping', () => {
  it('keeps source order while mapping reordered draft paragraphs immediately', () => {
    const source = '先试了键盘。\n后来换成触控板。'
    const points = buildImmediateScriptMaterialMapping(source, [{
      id: 'draft-touchpad',
      text: '后来我换成了触控板。'
    }, {
      id: 'draft-keyboard',
      text: '在那之前，我先试过键盘。'
    }])

    expect(points.map((point) => point.sourceText)).toEqual(['先试了键盘。', '后来换成触控板。'])
    expect(points.map((point) => point.paragraphIds)).toEqual([['draft-keyboard'], ['draft-touchpad']])
    expect(source.slice(points[0]!.sourceStart, points[0]!.sourceEnd)).toBe(points[0]!.sourceText)
  })

  it('reuses persisted stable point ids and prefers the matching body over a broad Markdown heading', () => {
    const source = '手机端支持自动备份。\n电脑端目前功能比较少。'
    const persisted = splitImmediateScriptMaterialSource(source).map((point, index) => ({
      ...point,
      id: `stable-${index + 1}`
    }))
    const points = buildImmediateScriptMaterialMapping(source, [{
      id: 'heading',
      text: '## 电脑端体验'
    }, {
      id: 'desktop',
      text: '电脑端现在的功能还是比较少。'
    }, {
      id: 'mobile',
      text: '手机端可以自动备份。'
    }], persisted)

    expect(points.map((point) => point.id)).toEqual(['stable-1', 'stable-2'])
    expect(points[0]!.paragraphIds).toEqual(['mobile'])
    expect(points[1]!.paragraphIds[0]).toBe('desktop')
    expect(points[1]!.paragraphIds).toContain('heading')
  })

  it('adds a reverse match so a rewritten draft paragraph can locate its closest source position', () => {
    const points = buildImmediateScriptMaterialMapping('手机端已经能自动备份照片和文档。', [{
      id: 'overview',
      text: '## 手机端使用体验'
    }, {
      id: 'photos',
      text: '照片备份现在用起来已经很顺手。'
    }, {
      id: 'documents',
      text: '文档也可以交给手机自动备份。'
    }])

    expect(points[0]!.paragraphIds).toEqual(expect.arrayContaining(['photos', 'documents']))
  })
})
