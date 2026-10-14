import { Mark, mergeAttributes } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'

export const ScriptTargetHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-color') || element.style.backgroundColor,
        renderHTML: (attributes) => attributes.color ? { 'data-color': attributes.color, style: `background-color: ${String(attributes.color)}; color: inherit` } : {}
      },
      linkIndex: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-link-index'),
        renderHTML: (attributes) => attributes.linkIndex ? { 'data-link-index': String(attributes.linkIndex) } : {}
      },
      targetSelectionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target-selection-id'),
        renderHTML: (attributes) => attributes.targetSelectionId ? { 'data-target-selection-id': String(attributes.targetSelectionId) } : {}
      }
    }
  }
})

export const ScriptMarker = Mark.create({
  name: 'scriptMarker',
  inclusive: false,
  addAttributes() {
    return {
      markerId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-marker-id'),
        renderHTML: (attributes) => attributes.markerId ? { 'data-script-marker-id': String(attributes.markerId) } : {}
      },
      markerNote: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-marker-note'),
        renderHTML: (attributes) => attributes.markerNote ? { 'data-script-marker-note': String(attributes.markerNote) } : {}
      },
      markerBlockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-marker-block-id'),
        renderHTML: (attributes) => attributes.markerBlockId ? { 'data-script-marker-block-id': String(attributes.markerBlockId) } : {}
      }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-script-marker-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  }
})

export const ScriptMaterialRelation = Mark.create({
  name: 'scriptMaterialRelation',
  inclusive: true,
  addAttributes() {
    return {
      relationId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-material-relation-id'),
        renderHTML: (attributes) => attributes.relationId ? { 'data-script-material-relation-id': String(attributes.relationId) } : {}
      },
      draftId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-material-draft-id'),
        renderHTML: (attributes) => attributes.draftId ? { 'data-script-material-draft-id': String(attributes.draftId) } : {}
      },
      draftParagraphIds: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-script-material-draft-paragraph-ids') ?? '',
        renderHTML: (attributes) => attributes.draftParagraphIds ? { 'data-script-material-draft-paragraph-ids': String(attributes.draftParagraphIds) } : {}
      },
      sourcePointIds: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-script-material-source-point-ids') ?? '',
        renderHTML: (attributes) => attributes.sourcePointIds ? { 'data-script-material-source-point-ids': String(attributes.sourcePointIds) } : {}
      },
      sourcePointVersion: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-material-source-point-version'),
        renderHTML: (attributes) => attributes.sourcePointVersion ? { 'data-script-material-source-point-version': String(attributes.sourcePointVersion) } : {}
      },
      relationBlockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-material-relation-block-id'),
        renderHTML: (attributes) => attributes.relationBlockId ? { 'data-script-material-relation-block-id': String(attributes.relationBlockId) } : {}
      },
      sourceRelationsJson: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-script-source-relations'),
        renderHTML: (attributes) => attributes.sourceRelationsJson ? { 'data-script-source-relations': String(attributes.sourceRelationsJson) } : {}
      }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-script-material-relation-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  }
})
