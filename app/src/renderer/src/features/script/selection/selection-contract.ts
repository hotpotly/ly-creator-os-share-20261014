import type { CodexWritingModelOption, ContentSelectionConflict, ContentSourceSelectionSnapshot } from '../../../../../shared/domain'
import type { StructuredComposerSnapshot } from '../shared/structured-reference-composer-state'

export type RewriteQuickIntent = 'regenerate' | 'polish' | 'concise' | 'conversational' | 'expand' | 'humorous'

export interface RewriteRequest {
  quickIntent: RewriteQuickIntent | null
  requirement: string
  preferredModel: string | null
  preferredReasoningEffort: string | null
  structuredInstruction?: StructuredComposerSnapshot
}

export interface RewriteCandidateViewModel {
  id: string
  originalText: string
  candidateText: string
  providerLabel: string
  requestedModel: string | null
  actualModel: string | null
  actualReasoningEffort: string | null
  generationRound: number
  sourceSelections: ContentSourceSelectionSnapshot[]
  conflicts: ContentSelectionConflict[]
  mode?: 'rewrite' | 'fusion'
  targetChanged?: boolean
  replaceUnavailableReason?: string
}

export interface RewriteModelControlProps {
  models: CodexWritingModelOption[]
  preferredModel: string | null
  preferredReasoningEffort: string | null
}

export const REWRITE_QUICK_ACTIONS: ReadonlyArray<{ id: RewriteQuickIntent; label: string }> = [
  { id: 'regenerate', label: '重新生成' },
  { id: 'polish', label: '润色' },
  { id: 'concise', label: '更精简' },
  { id: 'conversational', label: '更口语' },
  { id: 'expand', label: '扩写' },
  { id: 'humorous', label: '更有趣' }
]
