import type {
  ResolvedStructuredReferenceRole,
  StructuredReferenceRuleEvidence,
  StructuredReferenceUse
} from './structured-reference'

export interface StructuredReferenceRoleRule {
  id: string
  role: ResolvedStructuredReferenceRole
  cues: RegExp[]
  exclusions: RegExp[]
  priority: number
  aspect: string | null
}

export interface StructuredReferenceRoleResolution {
  reference: StructuredReferenceUse
  matchedEvidence: StructuredReferenceRuleEvidence[]
  conflict: boolean
}

export const STRUCTURED_REFERENCE_ROLE_RULES: readonly StructuredReferenceRoleRule[] = [
  {
    id: 'style-explicit-v1',
    role: 'style_reference',
    cues: [/(?:语气|风格|节奏|表达方式|行文结构|排版结构).{0,18}(?:参考|模仿|学习|学|照着|按照|按)/u, /(?:参考|模仿|学习|学|照着|按照|按).{0,18}(?:语气|风格|节奏|表达方式|行文结构|排版结构)/u],
    exclusions: [],
    priority: 90,
    aspect: '风格'
  },
  {
    id: 'hard-negative-v1',
    role: 'hard_constraint',
    cues: [/(?:不要|不得|不准|不能|禁止|别)(?:在文中)?(?:使用|采用|出现|引用|照搬|写入)/u, /(?:不要|不得|不准|不能|禁止|别)(?:按|按照|根据)/u],
    exclusions: [],
    priority: 85,
    aspect: '否定要求'
  },
  {
    id: 'hard-mandatory-v1',
    role: 'hard_constraint',
    cues: [/(?:必须|务必|严格|一定要|需要遵守|作为硬性要求)/u],
    exclusions: [],
    priority: 85,
    aspect: null
  },
  {
    id: 'hard-fact-v1',
    role: 'hard_constraint',
    cues: [/(?:按|按照|根据|依照|以).{0,24}(?:参数|规格|价格|日期|型号|要求|限制|交付规则|为准)/u],
    exclusions: [],
    priority: 80,
    aspect: null
  },
  {
    id: 'hard-follow-v1',
    role: 'hard_constraint',
    cues: [/(?:按|按照|根据|依照).{0,24}(?:来写|执行|完成)/u],
    exclusions: [/(?:语气|风格|节奏|表达方式|行文结构|排版结构)/u],
    priority: 75,
    aspect: null
  },
  {
    id: 'key-adoption-v1',
    role: 'key_adoption',
    cues: [/(?:重点|主要|优先|核心)(?:采用|参考|围绕|体现|突出|写入|结合)/u, /(?:重点围绕|主要围绕|核心采用|优先体现)/u, /(?:作为|当作).{0,18}(?:主线|核心素材|重点)/u],
    exclusions: [],
    priority: 70,
    aspect: null
  },
  {
    id: 'ordinary-reference-v1',
    role: 'ordinary_reference',
    cues: [/(?:参考一下|参考|结合|借鉴|作为资料|必要时.{0,8}(?:看看|查看))/u],
    exclusions: [/(?:必须|务必|严格|重点|主要|核心|只参考风格|仅参考风格)/u],
    priority: 40,
    aspect: null
  }
] as const

function sentenceRange(text: string, mentionFrom: number, mentionTo: number): { from: number; to: number; text: string } {
  const left = Math.max(
    text.lastIndexOf('\n', Math.max(0, mentionFrom - 1)),
    text.lastIndexOf('。', Math.max(0, mentionFrom - 1)),
    text.lastIndexOf('！', Math.max(0, mentionFrom - 1)),
    text.lastIndexOf('？', Math.max(0, mentionFrom - 1)),
    text.lastIndexOf(';', Math.max(0, mentionFrom - 1)),
    text.lastIndexOf('；', Math.max(0, mentionFrom - 1))
  ) + 1
  const rightCandidates = ['\n', '。', '！', '？', ';', '；']
    .map((boundary) => text.indexOf(boundary, mentionTo))
    .filter((index) => index >= 0)
  const right = rightCandidates.length ? Math.min(...rightCandidates) + 1 : text.length
  return { from: left, to: right, text: text.slice(left, right) }
}

function mentionRange(text: string, reference: StructuredReferenceUse, consumed: Map<string, number>): { from: number; to: number } | null {
  const explicitFrom = reference.sourceLocator.mentionFrom
  const explicitTo = reference.sourceLocator.mentionTo
  const token = `@${reference.label}`
  if (explicitFrom !== undefined || explicitTo !== undefined) {
    if (typeof explicitFrom !== 'number' || typeof explicitTo !== 'number' || explicitFrom < 0 || explicitTo <= explicitFrom || explicitTo > text.length) {
      throw new Error(`引用“${reference.label}”的提及位置无效`)
    }
    if (text.slice(explicitFrom, explicitTo) !== token) throw new Error(`引用“${reference.label}”的提及位置已变化`)
    return { from: explicitFrom, to: explicitTo }
  }
  const startAt = consumed.get(token) ?? 0
  const from = text.indexOf(token, startAt)
  if (from < 0) throw new Error(`引用“${reference.label}”已不在最终输入中`)
  consumed.set(token, from + token.length)
  return { from, to: from + token.length }
}

function mentionContext(
  text: string,
  range: { from: number; to: number },
  allRanges: Array<{ from: number; to: number } | null>
): { from: number; to: number; text: string } {
  const sentence = sentenceRange(text, range.from, range.to)
  const inSentence = allRanges.filter((candidate): candidate is { from: number; to: number } => Boolean(
    candidate && candidate.from >= sentence.from && candidate.to <= sentence.to
  )).sort((left, right) => left.from - right.from)
  const index = inSentence.findIndex((candidate) => candidate.from === range.from && candidate.to === range.to)
  if (index < 0 || inSentence.length < 2) return sentence
  const previous = inSentence[index - 1]
  const next = inSentence[index + 1]
  let from = sentence.from
  let to = sentence.to
  if (previous) {
    const boundaries = [...text.slice(previous.to, range.from).matchAll(/[，,]/gu)]
    const last = boundaries.at(-1)
    if (last?.index !== undefined) from = previous.to + last.index + last[0].length
  }
  if (next) {
    const boundary = /[，,]/u.exec(text.slice(range.to, next.from))
    if (boundary?.index !== undefined) to = range.to + boundary.index + boundary[0].length
  }
  return { from, to, text: text.slice(from, to) }
}

function evidenceFor(rule: StructuredReferenceRoleRule, sentence: { from: number; to: number; text: string }): StructuredReferenceRuleEvidence | null {
  if (rule.exclusions.some((pattern) => pattern.test(sentence.text))) return null
  const match = rule.cues.map((pattern) => pattern.exec(sentence.text)).find(Boolean)
  if (!match || match.index === undefined) return null
  return {
    ruleId: rule.id,
    text: match[0],
    from: sentence.from + match.index,
    to: sentence.from + match.index + match[0].length,
    resolvedRole: rule.role
  }
}

function aspectFor(rule: StructuredReferenceRoleRule, evidence: StructuredReferenceRuleEvidence): string | null {
  if (rule.id !== 'hard-fact-v1') return rule.aspect
  return /(?:交付规则|参数|规格|价格|日期|型号|要求|限制)/u.exec(evidence.text)?.[0] ?? '事实'
}

function isQuotedMetaInstruction(text: string, range: { from: number; to: number }): boolean {
  const leftQuote = Math.max(text.lastIndexOf('“', range.from), text.lastIndexOf('"', range.from))
  if (leftQuote < 0) return false
  const chineseRight = text.indexOf('”', range.to)
  const asciiRight = text.indexOf('"', range.to)
  const rightQuote = [chineseRight, asciiRight].filter((index) => index >= 0).sort((left, right) => left - right)[0]
  if (rightQuote === undefined) return false
  return /(?:这句话|这段话|引号里).{0,12}(?:删除|删掉|改掉|替换|不要)/u.test(text.slice(rightQuote + 1, Math.min(text.length, rightQuote + 40)))
}

export function resolveStructuredReferenceRoles(text: string, references: StructuredReferenceUse[]): StructuredReferenceRoleResolution[] {
  const consumed = new Map<string, number>()
  const ranges = references.map((reference) => mentionRange(text, reference, consumed))
  return references.map((reference, referenceIndex) => {
    const projectMemory = reference.projectMemory
      ?? (reference.roleOrigin === 'project_memory' && reference.role !== 'pending'
        ? { role: reference.role, aspect: reference.aspect, scope: reference.scope }
        : null)
    const range = ranges[referenceIndex]
    if (!range) return { reference: { ...reference, ruleEvidence: null, ruleConflicts: [] }, matchedEvidence: [], conflict: false }
    if (isQuotedMetaInstruction(text, range)) {
      const retainedRole = reference.roleOrigin === 'manual' ? reference.role : projectMemory?.role ?? 'pending'
      const retainedFallback = reference.roleOrigin === 'runtime_fallback'
      return {
        reference: {
          ...reference,
          role: retainedRole,
          roleOrigin: retainedFallback ? 'runtime_fallback' : retainedRole === 'pending' ? 'pending' : reference.roleOrigin === 'manual' ? 'manual' : 'project_memory',
          runtimeRole: retainedRole === 'pending' ? (retainedFallback ? 'ordinary_reference' : null) : retainedRole,
          projectMemory,
          aspect: retainedRole === 'pending' ? null : reference.roleOrigin === 'manual' ? reference.aspect : projectMemory?.aspect ?? null,
          scope: reference.roleOrigin === 'manual' ? reference.scope : projectMemory?.scope ?? reference.scope,
          ruleEvidence: null,
          ruleConflicts: []
        },
        matchedEvidence: [],
        conflict: false
      }
    }
    const sentence = mentionContext(text, range, ranges)
    const matches = STRUCTURED_REFERENCE_ROLE_RULES
      .map((rule) => ({ rule, evidence: evidenceFor(rule, sentence) }))
      .filter((item): item is { rule: StructuredReferenceRoleRule; evidence: StructuredReferenceRuleEvidence } => Boolean(item.evidence))
      .sort((left, right) => right.rule.priority - left.rule.priority || (left.rule.id < right.rule.id ? -1 : left.rule.id > right.rule.id ? 1 : 0))
    const roles = new Set(matches.map((match) => match.rule.role))
    const firstMatch = matches[0]
    const secondMatch = matches[1]
    const explicitConflict = roles.size > 1 && Boolean(firstMatch && secondMatch)
      && firstMatch!.rule.priority - secondMatch!.rule.priority < 20
    const best = explicitConflict ? null : matches[0] ?? null
    const evidence = best?.evidence ?? null
    const matchedEvidence = matches.map((match) => match.evidence)
    const manual = reference.roleOrigin === 'manual'
    const memory = projectMemory !== null
    const runtimeFallback = reference.roleOrigin === 'runtime_fallback'
    const manualRuleConflict = manual && Boolean(best && reference.role !== best.rule.role)
    const acceptedRule = manualRuleConflict && reference.manualConflictResolution === 'accept_rule'
    const retainedManual = manual && !acceptedRule
    const nextRole = acceptedRule
      ? best!.rule.role
      : retainedManual
        ? reference.role
        : best?.rule.role ?? projectMemory?.role ?? 'pending'
    const nextOrigin = retainedManual
      ? 'manual' as const
      : acceptedRule || best
        ? 'deterministic_rule' as const
        : memory
          ? 'project_memory' as const
          : runtimeFallback
            ? 'runtime_fallback' as const
            : 'pending' as const
    const manualConflictUnresolved = manualRuleConflict && reference.manualConflictResolution !== 'keep_manual' && reference.manualConflictResolution !== 'accept_rule'
    const explicitConflictUnresolved = explicitConflict && !(manual && reference.manualConflictResolution === 'keep_manual')
    const matchedAspect = best
      ? matches.filter((match) => match.rule.role === best.rule.role)
        .map((match) => aspectFor(match.rule, match.evidence))
        .find((aspect) => aspect !== null) ?? null
      : null
    return {
      reference: {
        ...reference,
        role: nextRole,
        roleOrigin: nextOrigin,
        runtimeRole: nextRole === 'pending' ? (runtimeFallback && !best ? 'ordinary_reference' : null) : nextRole,
        projectMemory,
        aspect: retainedManual || (memory && !best)
          ? retainedManual ? reference.aspect : projectMemory?.aspect ?? null
          : matchedAspect,
        scope: !best && !retainedManual && projectMemory ? projectMemory.scope : reference.scope,
        ruleEvidence: evidence,
        ruleConflicts: explicitConflictUnresolved ? matchedEvidence : [],
        manualConflictResolution: manualRuleConflict ? reference.manualConflictResolution ?? 'unresolved' : reference.manualConflictResolution
      },
      matchedEvidence,
      conflict: explicitConflictUnresolved || manualConflictUnresolved
    }
  })
}

export interface StructuredReferenceGoldenCorpusCase {
  id: string
  text: string
  label: string
  expectedRole: StructuredReferenceUse['role']
  expectedAspect?: string | null
  expectedConflict?: boolean
}

export const STRUCTURED_REFERENCE_GOLDEN_CORPUS: readonly StructuredReferenceGoldenCorpusCase[] = [
  { id: 'hard-brief-parameters', text: '按@Brief的参数来写，价格和容量不能改。', label: 'Brief', expectedRole: 'hard_constraint', expectedAspect: '参数' },
  { id: 'hard-brief-generic', text: '按照@Brief来写。', label: 'Brief', expectedRole: 'hard_constraint' },
  { id: 'style-history', text: '只参考@历史稿的语气和节奏，不带入旧参数。', label: '历史稿', expectedRole: 'style_reference' },
  { id: 'key-experience', text: '重点围绕@真实体验展开。', label: '真实体验', expectedRole: 'key_adoption' },
  { id: 'ordinary-material', text: '可以结合@项目资料参考一下。', label: '项目资料', expectedRole: 'ordinary_reference' },
  { id: 'pending-look', text: '请看看@Brief。', label: 'Brief', expectedRole: 'pending' },
  { id: 'pending-ambiguous', text: '@Brief', label: 'Brief', expectedRole: 'pending' },
  { id: 'negative-requirement', text: '不要使用@旧稿里的品牌结论。', label: '旧稿', expectedRole: 'hard_constraint' },
  { id: 'hard-feedback-forbidden', text: '必须遵守@甲方反馈中的禁用词。', label: '甲方反馈', expectedRole: 'hard_constraint' },
  { id: 'hard-image-group-all', text: '@图片组里的每张图都必须看。', label: '图片组', expectedRole: 'hard_constraint' },
  { id: 'key-test-mainline', text: '把@测试笔记作为这一段的主线。', label: '测试笔记', expectedRole: 'key_adoption' },
  { id: 'key-appearance', text: '主要结合@产品外观图来讲做工。', label: '产品外观图', expectedRole: 'key_adoption' },
  { id: 'ordinary-conditional', text: '必要时看看@资料A。', label: '资料A', expectedRole: 'ordinary_reference' },
  { id: 'style-learn-rhythm', text: '只学@旧稿的节奏，不要带入它的型号和参数。', label: '旧稿', expectedRole: 'style_reference' },
  { id: 'pending-maybe-useful', text: '这个@资料可能有用。', label: '资料', expectedRole: 'pending' },
  { id: 'pending-handle', text: '你处理一下@旧稿。', label: '旧稿', expectedRole: 'pending' },
  { id: 'negative-follow', text: '不要按@旧稿的参数来写。', label: '旧稿', expectedRole: 'hard_constraint' },
  { id: 'quoted-meta', text: '把“按@Brief的参数来写”这句话删掉。', label: 'Brief', expectedRole: 'pending' },
  { id: 'conflicting-cues', text: '必须按@旧稿的参数写，同时只参考风格。', label: '旧稿', expectedRole: 'pending', expectedConflict: true }
] as const
