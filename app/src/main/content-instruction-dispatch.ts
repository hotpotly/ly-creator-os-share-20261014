import { BUILTIN_TEXT_PROVIDER_CONFIG_IDS } from '../shared/domain'
import type { ContentInstructionDispatchPayload } from '../shared/ipc'

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`结构化请求与实际任务不一致：${message}`)
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right)
}

function selectedCurrentText(target: Extract<ContentInstructionDispatchPayload['instruction']['target'], { kind: 'current_script' }>): string {
  return target.blockSelections.map((selection) => selection.text).join(' ').replace(/\s+/gu, ' ').trim()
}

export function assertContentInstructionDispatchMatchesExecution(input: ContentInstructionDispatchPayload): void {
  const { instruction } = input
  if (input.operation === 'script_revision') {
    const versionRequest = input.requests.some((request) => request.surface === 'version_compare')
    invariant(input.requests.every((request) => (request.surface === 'version_compare') === versionRequest), '一次发送不能混用版本对比与普通对话')
    invariant(input.requests.every((request) => request.message === instruction.displayText), '记录的指令文字与实际消息不同')
    invariant(input.requests.every((request) => request.includeProjectContext === instruction.includeProjectContext), '项目上下文开关不同')
    invariant(input.requests.every((request) => request.webSearchMode === instruction.webSearchMode), '联网模式不同')
    input.requests.forEach((request, index) => {
      const target = instruction.targets[index]
      invariant(target, '缺少Provider目标')
      const expectedConfigId = request.provider === 'codex_cli'
        ? BUILTIN_TEXT_PROVIDER_CONFIG_IDS.codex
        : BUILTIN_TEXT_PROVIDER_CONFIG_IDS.claude
      invariant(target.providerConfigId === expectedConfigId, 'Provider配置不同')
      invariant((target.historyThreadId ?? null) === (request.threadId ?? null), '本地历史线程不同')
      invariant(target.requestedModel === (request.preferredModel ?? 'auto'), '请求模型不同')
      invariant((target.requestedReasoningEffort ?? null) === (request.preferredReasoningEffort ?? null), '推理档位不同')
    })
    if (versionRequest) {
      invariant(instruction.surface === 'script_version_comparison', '版本对比surface不同')
      const versionTarget = instruction.target
      invariant(versionTarget?.kind === 'version_comparison', '版本对比目标类型不同')
      input.requests.forEach((request) => {
        invariant(same(versionTarget.sourceSelections, request.sourceSelections ?? []), '版本对比冻结来源不同')
        invariant(request.selection.applicationTarget?.surface === 'version_compare', '版本候选缺少应用目标')
        const sourceSelections = request.sourceSelections ?? []
        const combinedText = sourceSelections.length === 1
          ? sourceSelections[0]!.selectedText
          : sourceSelections.map((selection) => `[来源：${selection.sourceLabel}]\n${selection.selectedText}`).join('\n\n')
        invariant(request.threadId ? Boolean(request.selection.selectedText) : request.selection.selectedText === combinedText, '版本对比选区文字不同')
      })
      return
    }
    invariant(instruction.surface === 'script_conversation' || instruction.surface === 'current_script_rewrite', '普通文案surface不同')
    const hasSelection = input.requests.some((request) => Boolean(request.selection.selectedText))
    invariant(input.requests.every((request) => Boolean(request.selection.selectedText) === hasSelection), '双AI不能混用不同选区状态')
    if (!hasSelection) {
      invariant(instruction.surface === 'script_conversation', '普通对话surface不同')
      if (instruction.includeProjectContext) {
        invariant(instruction.target?.kind === 'current_script' && instruction.target.blockSelections.length === 0, '带项目上下文的普通对话必须冻结实际当前文案')
      } else invariant(instruction.target === null, '不带项目上下文的普通对话不应伪造当前文案目标')
      return
    }
    const currentTarget = instruction.target
    invariant(currentTarget?.kind === 'current_script', '当前文案选区缺少冻结目标')
    if (instruction.surface === 'script_conversation') {
      invariant(input.requests.every((request) => request.selection.selectedText === selectedCurrentText(currentTarget)), '对话选区与冻结目标不同')
    } else {
      invariant(input.requests.length === 1, '局部修改只能建立一个候选目标')
      invariant(input.requests[0]!.selection.targetSelectionId, '局部修改缺少稳定选区身份')
      if (!instruction.supersedesRequestId) {
        invariant(input.requests[0]!.selection.selectedText === selectedCurrentText(currentTarget), '局部修改选区与冻结目标不同')
      }
    }
    return
  }

  invariant(input.request.includeProjectContext === instruction.includeProjectContext, '项目上下文开关不同')
  if (input.operation === 'script_material_chat') {
    invariant(instruction.surface === 'script_material_first_draft' || instruction.surface === 'script_material_chat', '素材成稿surface不同')
    invariant(instruction.displayText === input.request.message, '素材成稿指令文字不同')
    invariant(same(instruction.currentDocumentParagraphs, input.request.currentDocumentParagraphs), '素材成稿当前文案段落不同')
    input.request.requests.forEach((request, index) => {
      const target = instruction.targets[index]
      invariant(target?.providerConfigId === request.providerConfigId, '素材成稿Provider不同')
      invariant(target.requestedModel === (request.preferredModel ?? 'auto'), '素材成稿模型不同')
      invariant((target.historyThreadId ?? null) === null, '素材成稿不应混用文案历史线程')
    })
    return
  }
  if (input.operation === 'script_material_rewrite') {
    invariant(instruction.surface === 'script_material_rewrite', '素材局部修改surface不同')
    invariant(instruction.displayText === input.request.requirement, '素材局部修改要求不同')
    const materialTarget = instruction.target
    invariant(materialTarget?.kind === 'material_draft', '素材局部修改缺少稿件目标')
    invariant(materialTarget.draftId === input.request.draftId, '素材局部修改稿件不同')
    invariant(same(materialTarget.applicationTarget ?? null, input.request.applicationTarget ?? null), '素材局部修改应用目标不同')
    invariant(instruction.targets[0]?.providerConfigId === input.request.providerConfigId, '素材局部修改Provider不同')
    invariant(new Set(input.request.paragraphIds).size === input.request.paragraphIds.length, '素材局部修改段落重复')
    if (input.request.selectedText) {
      invariant(input.request.paragraphIds.length === 1 && input.request.paragraphIds[0] === input.request.selectedParagraphId, '素材局部选区目标段落不同')
      invariant(materialTarget.paragraphSelections.length === 1, '素材局部选区数量不同')
      invariant(materialTarget.paragraphSelections[0]?.paragraphId === input.request.selectedParagraphId, '素材局部选区段落不同')
      invariant(materialTarget.paragraphSelections[0]?.from === input.request.selectedStart, '素材局部选区起点不同')
      invariant(materialTarget.paragraphSelections[0]?.to === input.request.selectedEnd, '素材局部选区终点不同')
      invariant(materialTarget.paragraphSelections[0]?.text === input.request.selectedText.trim(), '素材局部选区文字不同')
    } else {
      invariant(same(materialTarget.paragraphSelections.map((selection) => selection.paragraphId), input.request.paragraphIds), '素材局部修改段落不同')
      invariant(materialTarget.paragraphSelections.every((selection) => selection.from === 0 && selection.to === selection.text.length), '素材整段修改范围不同')
    }
    return
  }
  invariant(instruction.surface === 'script_draft_comparison', '成稿对比surface不同')
  invariant(instruction.target === null, '成稿对比目标应由Main从实际任务结果冻结')
  invariant(instruction.targets[0]?.providerConfigId === input.request.providerConfigId, '成稿对比Provider不同')
}

export function assertMaterialInstructionMatchesWorkspace(
  input: Extract<ContentInstructionDispatchPayload, { operation: 'script_material_chat' | 'script_material_rewrite' }>,
  workspace: {
    webSearchMode: 'automatic' | 'required' | 'disabled'
    activeRevision: { id: string } | null
    selectedCodexDraftId: string | null
    selectedClaudeDraftId: string | null
    drafts: Array<{ id: string; side: 'codex' | 'claude'; contentHash: string }>
  }
): void {
  invariant(instructionRevisionMatches(input.instruction.materialRevisionId ?? null, workspace.activeRevision?.id ?? null), '素材修订与实际工作区不同')
  invariant(input.instruction.webSearchMode === workspace.webSearchMode, '素材联网模式与实际工作区不同')
  if (input.operation === 'script_material_rewrite') {
    invariant(workspace.drafts.some((draft) => draft.id === input.request.draftId), '素材局部修改稿件不属于当前修订')
    return
  }
  const firstForEverySide = input.request.requests.every((request) => !workspace.drafts.some((draft) => draft.side === request.side))
  const expectedSurface = firstForEverySide ? 'script_material_first_draft' : 'script_material_chat'
  invariant(input.instruction.surface === expectedSurface, '素材首稿与连续对话判定不同')
  if (firstForEverySide) invariant(input.instruction.target === null, '素材首稿不应引用旧AI稿')
  else {
    const target = input.instruction.target
    invariant(input.request.requests.length === 1, '素材连续对话一次只能修改当前AI侧')
    const side = input.request.requests[0]!.side
    const selectedId = side === 'codex' ? workspace.selectedCodexDraftId : workspace.selectedClaudeDraftId
    const activeDraft = workspace.drafts.find((draft) => draft.id === selectedId && draft.side === side)
      ?? workspace.drafts.filter((draft) => draft.side === side).at(-1)
    invariant(target?.kind === 'material_draft' && activeDraft !== undefined, '素材连续对话缺少当前AI稿目标')
    invariant(target.draftId === activeDraft.id && target.contentHash === activeDraft.contentHash, '素材连续对话目标不是实际选中AI稿')
  }
}

function instructionRevisionMatches(left: string | null, right: string | null): boolean {
  return left !== null && left === right
}
