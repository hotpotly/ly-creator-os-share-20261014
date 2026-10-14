import { Node, mergeAttributes } from '@tiptap/core'
import type { StructuredReferenceUse } from '../../../../../shared/domain'
import { referenceRoleLabel } from './structured-reference-composer-state'

function decodeReference(value: unknown): StructuredReferenceUse | null {
  if (typeof value !== 'string' || !value) return null
  try { return JSON.parse(decodeURIComponent(value)) as StructuredReferenceUse } catch { return null }
}

export const StructuredReferenceMention = Node.create({
  name: 'structuredReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      reference: {
        default: null,
        parseHTML: (element) => decodeReference(element.getAttribute('data-structured-reference')),
        renderHTML: (attributes) => attributes.reference
          ? { 'data-structured-reference': encodeURIComponent(JSON.stringify(attributes.reference)) }
          : {}
      }
    }
  },
  parseHTML() { return [{ tag: 'span[data-structured-reference]' }] },
  renderHTML({ HTMLAttributes, node }) {
    const reference = node.attrs.reference as StructuredReferenceUse | null
    const role = reference?.role ?? 'pending'
    const conflict = Boolean(reference?.ruleConflicts?.length || reference?.manualConflictResolution === 'unresolved')
    return ['span', mergeAttributes(HTMLAttributes, {
      class: `structured-reference-chip role-${role}${conflict ? ' has-conflict' : ''}`,
      contenteditable: 'false',
      'data-reference-occurrence-id': reference?.occurrenceId ?? '',
      'data-reference-role': role,
      'aria-label': reference ? `引用${reference.label}，用途${referenceRoleLabel(role)}${conflict ? '，存在冲突' : ''}` : '无效引用',
      title: reference ? `${reference.label}·${referenceRoleLabel(role)}` : '无效引用'
    }), ['span', { class: 'structured-reference-chip-at', 'aria-hidden': 'true' }, '@'], ['span', { class: 'structured-reference-chip-label' }, reference?.label ?? '引用'], ['span', { class: 'structured-reference-chip-state', 'aria-hidden': 'true' }, conflict ? '!' : role === 'pending' ? '?' : '✓']]
  },
  renderText({ node }) {
    const reference = node.attrs.reference as StructuredReferenceUse | null
    return `@${reference?.label ?? '引用'}`
  }
})
