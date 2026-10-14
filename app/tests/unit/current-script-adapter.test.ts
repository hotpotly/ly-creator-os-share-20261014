import { describe, expect, it } from 'vitest'
import type { ProjectCurrentScriptSnapshot } from '../../src/shared/domain'
import {
  buildCurrentScriptFacts,
  currentScriptMarkProjections,
  currentScriptSnapshotInputs,
  projectCurrentScriptFactsToEditorDocument
} from '../../src/renderer/src/features/script/current-document/current-script-adapter'

function snapshot(editorDocument: Record<string, unknown>): ProjectCurrentScriptSnapshot {
  return {
    document: {
      projectId: 'project-1',
      workingDocumentId: 'working-1',
      schemaVersion: 1,
      revision: 2,
      editorDocument,
      contentHash: 'a'.repeat(64),
      lastSavedVersionId: null,
      updatedAt: '2026-08-02T00:00:00.000Z'
    },
    blocks: [{ blockId: 'block-1', kind: 'paragraph', parentBlockIds: [], text: '甲\n乙' }],
    sourceRelations: [],
    annotations: []
  }
}

describe('current script Renderer adapter', () => {
  it('merges the same persistent mark across ordinary formatting and hard breaks', () => {
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] },
        content: [
          { type: 'text', text: '甲', marks: [{ type: 'underline', attrs: { annotationId: 'annotation-1' } }] },
          { type: 'hardBreak', marks: [{ type: 'underline', attrs: { annotationId: 'annotation-1' } }] },
          { type: 'text', text: '乙', marks: [{ type: 'underline', attrs: { annotationId: 'annotation-1' } }, { type: 'bold' }] }
        ]
      }]
    }
    expect(currentScriptMarkProjections(document)).toEqual([expect.objectContaining({
      type: 'underline', blockId: 'block-1', start: 0, end: 3, selectedText: '甲\n乙'
    })])
    const facts = buildCurrentScriptFacts(document, {
      previous: null,
      materialRevisionId: null,
      createId: () => 'generated-id',
      generatedIds: new Map()
    })
    expect(facts.annotations).toEqual([{
      id: 'annotation-1', blockId: 'block-1', blockStart: 0, blockEnd: 3,
      selectedText: '甲\n乙', style: 'underline', note: '', evidenceIds: [], status: 'active'
    }])
  })

  it('does not promote temporary target highlights into persistent annotations', () => {
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] },
        content: [{
          type: 'text', text: '临时选区', marks: [{ type: 'highlight', attrs: { targetSelectionId: 'selection-1', color: '#F3D9A3' } }]
        }]
      }]
    }
    expect(currentScriptMarkProjections(document)).toEqual([])
    expect(buildCurrentScriptFacts(document, {
      previous: null,
      materialRevisionId: null,
      createId: () => 'generated-id',
      generatedIds: new Map()
    })).toEqual({ sourceRelations: [], annotations: [] })
  })

  it('keeps ordinary body formatting separate from workbench annotations', () => {
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] },
        content: [{
          type: 'text', text: '正文格式', marks: [
            { type: 'highlight', attrs: { color: '#F3D9A3' } },
            { type: 'underline', attrs: {} },
            { type: 'strike', attrs: {} }
          ]
        }]
      }]
    }
    expect(currentScriptMarkProjections(document)).toEqual([])
    expect(buildCurrentScriptFacts(document, {
      previous: null,
      materialRevisionId: null,
      createId: () => 'generated-id',
      generatedIds: new Map()
    })).toEqual({ sourceRelations: [], annotations: [] })
  })

  it('moves the complete independent source-relation cohort with its editor mark', () => {
    const previousDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] },
        content: [{
          type: 'text', text: '原文', marks: [{
            type: 'scriptMaterialRelation',
            attrs: { relationId: 'relation-primary', draftId: 'draft-1', draftParagraphIds: 'paragraph-1', sourcePointIds: 'point-1' }
          }]
        }]
      }]
    }
    const previous = snapshot(previousDocument)
    previous.blocks[0]!.text = '原文'
    previous.sourceRelations = [
      {
        id: 'relation-primary', workingDocumentId: 'working-1', targetBlockId: 'block-1', targetStart: 0, targetEnd: 2,
        sourceKind: 'material_draft_paragraph', sourceId: 'paragraph-1', sourceVersion: 'draft-1',
        createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z'
      },
      {
        id: 'relation-point', workingDocumentId: 'working-1', targetBlockId: 'block-1', targetStart: 0, targetEnd: 2,
        sourceKind: 'material_point', sourceId: 'point-1', sourceVersion: 'revision-1',
        createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z'
      }
    ]
    const movedDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] },
        content: [
          { type: 'text', text: '新' },
          {
            type: 'text', text: '原文', marks: [{
              type: 'scriptMaterialRelation',
              attrs: { relationId: 'relation-primary', draftId: 'draft-1', draftParagraphIds: 'paragraph-1', sourcePointIds: 'point-1' }
            }]
          }
        ]
      }]
    }
    const facts = buildCurrentScriptFacts(movedDocument, {
      previous,
      materialRevisionId: 'revision-2',
      createId: () => 'generated-id',
      generatedIds: new Map()
    })
    expect(facts.sourceRelations).toEqual([
      expect.objectContaining({ id: 'relation-point', targetStart: 1, targetEnd: 3, sourceId: 'point-1', sourceVersion: 'revision-1' }),
      expect.objectContaining({ id: 'relation-primary', targetStart: 1, targetEnd: 3, sourceId: 'paragraph-1', sourceVersion: 'draft-1' })
    ])
  })

  it('projects only transport-safe inputs from a persisted snapshot', () => {
    const previous = snapshot({ type: 'doc', content: [] })
    previous.annotations = [{
      id: 'annotation-1', projectId: 'project-1', sourceKind: 'current_script', sourceId: 'working-1', sourceVersion: '2',
      coordinateSpace: 'block_text', blockId: 'block-1', blockStart: 0, blockEnd: 1, selectedText: '甲',
      style: 'flag', note: '备注', status: 'position_changed', createdAt: 'before', updatedAt: 'after'
    }]
    expect(currentScriptSnapshotInputs(previous)).toEqual({
      editorDocument: previous.document.editorDocument,
      sourceRelations: [],
      annotations: [{
        id: 'annotation-1', blockId: 'block-1', blockStart: 0, blockEnd: 1, selectedText: '甲',
        style: 'flag', note: '备注', status: 'position_changed'
      }]
    })
  })

  it('projects independent facts into stable marks so edits move exact IDs and source versions', () => {
    const previous = snapshot({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] }, content: [{ type: 'text', text: '甲\n乙' }] }]
    })
    previous.annotations = [{
      id: 'annotation-independent', projectId: 'project-1', sourceKind: 'current_script', sourceId: 'working-1', sourceVersion: '2',
      coordinateSpace: 'block_text', blockId: 'block-1', blockStart: 0, blockEnd: 1, selectedText: '甲',
      style: 'underline', note: '独立备注', evidenceIds: ['evidence-1'], status: 'active', createdAt: 'before', updatedAt: 'after'
    }]
    previous.sourceRelations = [{
      id: 'relation-independent', workingDocumentId: 'working-1', targetBlockId: 'block-1', targetStart: 0, targetEnd: 1,
      sourceKind: 'material_point', sourceId: 'point-old', sourceVersion: 'revision-old', createdAt: 'before', updatedAt: 'after'
    }]
    const projected = projectCurrentScriptFactsToEditorDocument(previous)
    const paragraph = (projected.content as Array<Record<string, unknown>>)[0]!
    paragraph.content = [{ type: 'text', text: '新' }, ...(paragraph.content as Array<Record<string, unknown>>)]
    const facts = buildCurrentScriptFacts(projected, {
      previous,
      materialRevisionId: 'revision-new',
      createId: () => 'generated-id',
      generatedIds: new Map()
    })
    expect(facts.annotations).toEqual([expect.objectContaining({
      id: 'annotation-independent', blockStart: 1, blockEnd: 2, selectedText: '甲', note: '独立备注', evidenceIds: ['evidence-1']
    })])
    expect(facts.sourceRelations).toEqual([expect.objectContaining({
      id: 'relation-independent', targetStart: 1, targetEnd: 2, sourceId: 'point-old', sourceVersion: 'revision-old'
    })])
  })

  it('treats clearing a hydrated fact mark as an explicit removal while retaining inactive history', () => {
    const previous = snapshot({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { blockId: 'block-1', parentBlockIds: [] }, content: [{ type: 'text', text: '甲\n乙' }] }]
    })
    previous.annotations = [{
      id: 'annotation-active', projectId: 'project-1', sourceKind: 'current_script', sourceId: 'working-1', sourceVersion: '2',
      coordinateSpace: 'block_text', blockId: 'block-1', blockStart: 0, blockEnd: 1, selectedText: '甲',
      style: 'highlight', note: '', status: 'active', createdAt: 'before', updatedAt: 'after'
    }, {
      id: 'annotation-history', projectId: 'project-1', sourceKind: 'current_script', sourceId: 'working-1', sourceVersion: '2',
      coordinateSpace: 'block_text', blockId: 'missing-block', blockStart: 0, blockEnd: 1, selectedText: '旧',
      style: 'flag', note: '', status: 'position_changed', createdAt: 'before', updatedAt: 'after'
    }]
    const facts = buildCurrentScriptFacts(previous.document.editorDocument, {
      previous,
      materialRevisionId: null,
      createId: () => 'generated-id',
      generatedIds: new Map()
    })
    expect(facts.annotations.map((annotation) => annotation.id)).toEqual(['annotation-history'])
  })

  it('round-trips a source fact targeted at an outer list-item block', () => {
    const previous = snapshot({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem', attrs: { blockId: 'item-1', parentBlockIds: [] },
          content: [{ type: 'paragraph', attrs: { blockId: 'item-paragraph-1', parentBlockIds: [] }, content: [{ type: 'text', text: '列表文字' }] }]
        }]
      }]
    })
    previous.blocks = [
      { blockId: 'item-1', kind: 'list_item', parentBlockIds: [], text: '列表文字' },
      { blockId: 'item-paragraph-1', kind: 'paragraph', parentBlockIds: [], text: '列表文字' }
    ]
    previous.sourceRelations = [{
      id: 'relation-list', workingDocumentId: 'working-1', targetBlockId: 'item-1', targetStart: 0, targetEnd: 4,
      sourceKind: 'brief_point', sourceId: 'brief-1', sourceVersion: 'brief-v1', createdAt: 'before', updatedAt: 'after'
    }]
    const projected = projectCurrentScriptFactsToEditorDocument(previous)
    expect(currentScriptMarkProjections(projected)).toEqual([expect.objectContaining({
      type: 'scriptMaterialRelation', blockId: 'item-1', start: 0, end: 4, selectedText: '列表文字'
    })])
    expect(buildCurrentScriptFacts(projected, {
      previous: null,
      materialRevisionId: 'unrelated-current-revision',
      createId: () => 'generated-id',
      generatedIds: new Map()
    }).sourceRelations).toEqual([expect.objectContaining({
      id: 'relation-list', targetBlockId: 'item-1', sourceKind: 'brief_point', sourceVersion: 'brief-v1'
    })])
  })

  it('gives a split relation mark a matching primary fact even when embedded sources still carry old IDs', () => {
    const embedded = JSON.stringify([
      { id: 'relation-primary', sourceKind: 'brief_point', sourceId: 'brief-1', sourceVersion: 'brief-v1' },
      { id: 'relation-secondary', sourceKind: 'outline_point', sourceId: 'outline-1', sourceVersion: 'outline-v1' }
    ])
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph', attrs: { blockId: 'block-a', parentBlockIds: ['block-origin'] },
        content: [{ type: 'text', text: '甲', marks: [{ type: 'scriptMaterialRelation', attrs: { relationId: 'relation-primary', sourceRelationsJson: embedded } }] }]
      }, {
        type: 'paragraph', attrs: { blockId: 'block-b', parentBlockIds: ['block-origin'] },
        content: [{ type: 'text', text: '乙', marks: [{ type: 'scriptMaterialRelation', attrs: { relationId: 'relation-split', sourceRelationsJson: embedded } }] }]
      }]
    }
    let generated = 0
    const facts = buildCurrentScriptFacts(document, {
      previous: null,
      materialRevisionId: null,
      createId: () => `generated-${++generated}`,
      generatedIds: new Map()
    }).sourceRelations
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'relation-primary', targetBlockId: 'block-a', sourceKind: 'brief_point' }),
      expect.objectContaining({ id: 'relation-split', targetBlockId: 'block-b', sourceKind: 'brief_point' })
    ]))
    expect(new Set(facts.map((relation) => relation.id)).size).toBe(facts.length)
  })
})
