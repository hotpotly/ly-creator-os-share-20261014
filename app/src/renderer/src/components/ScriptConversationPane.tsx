import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Crosshair, History, Plus, RefreshCw, RotateCcw, Sparkles, TriangleAlert, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContentFactAnnotation, ProviderCapability, ScriptRevisionConversation, ScriptRevisionMessage, ScriptRevisionProvider, TaskRun } from '../../../shared/domain'
import { groupCandidateMessages, messageTargetId, type CandidateMessageGroup } from '../../../shared/script-conversation'
import { ReadableMarkdown } from './ReadableMarkdown'

type ApplyAction = 'replace' | 'insert_after'

const providerLabels: Record<ScriptRevisionProvider, string> = {
  codex_cli: 'Codex',
  claude_cli: 'Claude'
}

function readableFactAnnotations(annotations: ContentFactAnnotation[]) {
  return annotations.map((annotation) => ({
    start: annotation.start,
    end: annotation.end,
    provenance: annotation.provenance,
    label: `${annotation.provenance === 'needs_confirmation' ? '需要你补充' : annotation.provenance === 'web_supplement' ? '联网核验' : 'AI补写'}：${annotation.note}`
  }))
}

function FactEvidenceLinks({ annotations }: { annotations: ContentFactAnnotation[] }): React.JSX.Element | null {
  const sources = [...new Map(annotations.flatMap((annotation) => annotation.webSources).map((source) => [source.url, source])).values()]
  if (!sources.length) return null
  return <div className="content-fact-sources" aria-label="联网事实来源">{sources.map((source) => <button
    type="button"
    key={source.url}
    title={source.url}
    onClick={() => void window.creatorOS?.openExternalLink(source.url)}
  >{source.title}</button>)}</div>
}

export function ScriptConversationPane({
  provider,
  conversation,
  capability,
  tasks,
  loading,
  activeTargetId,
  mobileActive,
  locatorOpen,
  selectedCandidateIds,
  appliedMessageId,
  scrollTop,
  onActivate,
  onLocatorClose,
  onLocate,
  onToggleCompare,
  onApply,
  onUndo,
  onCopy,
  onDiscard,
  onAppendMessage,
  onCopyMessage,
  onRetry,
  onVerify,
  onScrollTopChange
}: {
  provider: ScriptRevisionProvider
  conversation: ScriptRevisionConversation | null
  capability: ProviderCapability | undefined
  tasks: TaskRun[]
  loading: boolean
  activeTargetId: string | null
  mobileActive: boolean
  locatorOpen: boolean
  selectedCandidateIds: Set<string>
  appliedMessageId: string | null
  scrollTop: number
  onActivate(): void
  onLocatorClose(): void
  onLocate(message: ScriptRevisionMessage): void
  onToggleCompare(message: ScriptRevisionMessage): void
  onApply(message: ScriptRevisionMessage, action: ApplyAction): Promise<void>
  onUndo(message: ScriptRevisionMessage): Promise<void>
  onCopy(message: ScriptRevisionMessage): Promise<void>
  onDiscard(message: ScriptRevisionMessage): Promise<void>
  onAppendMessage(message: ScriptRevisionMessage): void
  onCopyMessage(message: ScriptRevisionMessage): Promise<void>
  onRetry(task: TaskRun): Promise<void>
  onVerify(provider: ScriptRevisionProvider): Promise<void>
  onScrollTopChange(scrollTop: number): void
}): React.JSX.Element {
  const historyRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingScrollRef = useRef<number | null>(null)
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [revisionIndexes, setRevisionIndexes] = useState<Record<string, number>>({})
  const [cardNotice, setCardNotice] = useState<Record<string, string>>({})
  const [narrowWindow, setNarrowWindow] = useState(false)
  const [locatorIndex, setLocatorIndex] = useState(0)
  const locatorRef = useRef<HTMLDivElement>(null)
  const pendingTargetRef = useRef<string | null>(null)
  const messages = useMemo(() => conversation?.messages ?? [], [conversation?.messages])
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const { latestIds, groupByMessageId } = useMemo(() => groupCandidateMessages(messages), [messages])
  const runtimeLabel = providerRuntimeLabel(provider, conversation, capability)
  const visibleMessages = useMemo(() => messages.filter((message) => (
    message.role !== 'assistant' || !message.suggestion || latestIds.has(message.id)
  )), [latestIds, messages])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)')
    const update = (): void => setNarrowWindow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => { onScrollTopChangeRef.current = onScrollTopChange }, [onScrollTopChange])
  useEffect(() => () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    if (pendingScrollRef.current !== null) onScrollTopChangeRef.current(pendingScrollRef.current)
  }, [])
  useEffect(() => {
    const target = historyRef.current
    if (!target || (narrowWindow && !mobileActive)) return
    if (Math.abs(target.scrollTop - scrollTop) > 2) target.scrollTop = scrollTop
  }, [mobileActive, narrowWindow, provider, scrollTop])

  const rememberScroll = (value: number): void => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    pendingScrollRef.current = Math.max(0, Math.round(value))
    scrollTimerRef.current = setTimeout(() => {
      const pending = pendingScrollRef.current
      pendingScrollRef.current = null
      if (pending !== null) onScrollTopChangeRef.current(pending)
    }, 160)
  }

  useEffect(() => {
    if (!activeTargetId || !historyRef.current) return
    if (!visibleMessages.some((message) => messageTargetId(message) === activeTargetId)) return
    if (narrowWindow && !mobileActive) {
      pendingTargetRef.current = activeTargetId
      return
    }
    const requestedTarget = pendingTargetRef.current ?? activeTargetId
    const target = Array.from(historyRef.current.querySelectorAll<HTMLElement>('[data-target-selection-id]'))
      .find((element) => element.dataset.targetSelectionId === requestedTarget)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (target) pendingTargetRef.current = null
  }, [activeTargetId, mobileActive, narrowWindow, visibleMessages])

  const jumpToMessage = (message: ScriptRevisionMessage): void => {
    const anchor = document.getElementById(`script-message-${message.id}`)
    anchor?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    anchor?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!locatorOpen) return
    const activeIndex = activeTargetId
      ? visibleMessages.findIndex((message) => messageTargetId(message) === activeTargetId)
      : -1
    setLocatorIndex(activeIndex >= 0 ? activeIndex : 0)
    requestAnimationFrame(() => locatorRef.current?.focus())
  }, [activeTargetId, locatorOpen, visibleMessages])

  useEffect(() => {
    if (!locatorOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (!visibleMessages.length) return
      if (event.key === 'ArrowDown') setLocatorIndex((current) => (current + 1) % visibleMessages.length)
      else if (event.key === 'ArrowUp') setLocatorIndex((current) => (current - 1 + visibleMessages.length) % visibleMessages.length)
      else {
        const message = visibleMessages[locatorIndex]
        if (message) jumpToMessage(message)
        onLocatorClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [locatorIndex, locatorOpen, onLocatorClose, visibleMessages])

  useEffect(() => {
    if (!locatorOpen) return
    locatorRef.current?.querySelector<HTMLElement>(`[data-locator-index="${locatorIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [locatorIndex, locatorOpen])

  const apply = async (message: ScriptRevisionMessage, action: ApplyAction): Promise<void> => {
    setCardNotice((current) => ({ ...current, [message.id]: '' }))
    try { await onApply(message, action) }
    catch (reason) {
      setCardNotice((current) => ({
        ...current,
        [message.id]: reason instanceof Error ? reason.message : '候选应用失败'
      }))
    }
  }

  return <section
    className={`script-conversation-pane ${provider === 'claude_cli' ? 'claude-pane' : 'codex-pane'}`}
    aria-label={`${providerLabels[provider]}对话`}
    onFocusCapture={onActivate}
    onPointerDown={onActivate}
  >
    <header className="script-conversation-header">
      <div><span>AI对话</span><h2>{providerLabels[provider]}</h2></div>
      <div className="script-provider-state">
        <span className={capability?.available ? 'available' : ''} title={runtimeLabel}>{runtimeLabel}</span>
        {!capability?.available && capability?.status !== 'not_installed' ? <button onClick={() => void onVerify(provider)}>验证</button> : null}
      </div>
    </header>
    {visibleMessages.length ? <div className="conversation-locator" aria-label={`${providerLabels[provider]}快速定位`}>
      {visibleMessages.map((message) => {
        const group = groupByMessageId.get(message.id)
        const targetId = messageTargetId(message)
        return <button
          key={message.id}
          className={`${message.suggestion ? 'candidate' : ''}${targetId && targetId === activeTargetId ? ' active' : ''}`}
          aria-label={group ? `候选${group.number}` : message.role === 'user' ? '我的要求' : `${providerLabels[provider]}回答`}
          title={group ? `候选${group.number}` : message.content.slice(0, 40)}
          onClick={() => jumpToMessage(message)}
        >{group ? group.number : null}</button>
      })}
    </div> : null}
    {locatorOpen ? <div className="conversation-locator-popover" role="dialog" aria-modal="true" aria-label={`${providerLabels[provider]}快速定位列表`}>
      <header><div><span>快速定位</span><b>{providerLabels[provider]}消息</b></div><kbd>⌘J</kbd></header>
      <div className="conversation-locator-list" ref={locatorRef} tabIndex={-1} aria-activedescendant={visibleMessages[locatorIndex] ? `locator-${provider}-${visibleMessages[locatorIndex]!.id}` : undefined}>
        {visibleMessages.length ? visibleMessages.map((message, index) => {
          const group = groupByMessageId.get(message.id)
          const title = group ? `候选${group.number}` : message.role === 'user' ? '我的要求' : `${providerLabels[provider]}回答`
          const detail = group
            ? message.candidateInstruction || message.selectedText || message.content
            : message.content
          return <button
            id={`locator-${provider}-${message.id}`}
            data-locator-index={index}
            className={index === locatorIndex ? 'active' : ''}
            key={message.id}
            onMouseEnter={() => setLocatorIndex(index)}
            onClick={() => { jumpToMessage(message); onLocatorClose() }}
          >
            <span>{group ? group.number : message.role === 'user' ? '我' : 'AI'}</span>
            <div><b>{title}</b><small>{detail.slice(0, 54)}{detail.length > 54 ? '…' : ''}</small></div>
            <time>{formatTime(message.createdAt)}</time>
          </button>
        }) : <p>当前AI栏还没有可定位的消息</p>}
      </div>
      <footer>↑↓选择 · Enter跳转 · Esc关闭</footer>
    </div> : null}
    <div className="script-conversation-history" ref={historyRef} aria-live="polite" onScroll={(event) => rememberScroll(event.currentTarget.scrollTop)}>
      {loading && !messages.length ? <div className="script-conversation-empty"><RefreshCw size={17} className="is-spinning" />正在读取{providerLabels[provider]}对话…</div> : null}
      {!loading && !messages.length ? <div className="script-conversation-empty"><Bot size={19} /><b>还没有{providerLabels[provider]}对话</b><span>在下方输入要求，可只发这一边或同时发给两个AI。</span></div> : null}
      {visibleMessages.map((message) => {
        const task = message.taskId ? taskById.get(message.taskId) : undefined
        const group = groupByMessageId.get(message.id)
        if (message.role === 'assistant' && message.suggestion && group) {
          const currentIndex = Math.min(revisionIndexes[group.key] ?? group.revisions.length - 1, group.revisions.length - 1)
          const current = group.revisions[currentIndex] ?? message
          const targetId = messageTargetId(current)
          const expanded = expandedGroups.has(group.key)
          const active = Boolean(targetId && targetId === activeTargetId)
          return <CandidateMessageCard
            key={message.id}
            group={group}
            message={current}
            expanded={expanded}
            active={active}
            selected={selectedCandidateIds.has(current.id)}
            notice={cardNotice[current.id] ?? ''}
            canUndo={appliedMessageId === current.id}
            onToggleExpanded={() => setExpandedGroups((currentGroups) => {
              const next = new Set(currentGroups)
              if (next.has(group.key)) next.delete(group.key)
              else next.add(group.key)
              return next
            })}
            onPrevious={() => setRevisionIndexes((currentIndexes) => ({ ...currentIndexes, [group.key]: Math.max(0, currentIndex - 1) }))}
            onNext={() => setRevisionIndexes((currentIndexes) => ({ ...currentIndexes, [group.key]: Math.min(group.revisions.length - 1, currentIndex + 1) }))}
            onLocate={() => onLocate(current)}
            onToggleCompare={() => onToggleCompare(current)}
            onApply={(action) => apply(current, action)}
            onUndo={() => onUndo(current)}
            onCopy={() => onCopy(current)}
            onDiscard={() => onDiscard(current)}
            anchorMessageId={message.id}
          />
        }
        return <article className={`script-conversation-message ${message.role}`} id={`script-message-${message.id}`} key={message.id} tabIndex={-1}>
          <span className="script-message-avatar">{message.role === 'assistant' ? <Bot size={13} /> : '我'}</span>
          <div>
            <header><b>{message.role === 'assistant' ? providerLabels[provider] : '我'}</b><small>{formatTime(message.createdAt)}</small>{message.role === 'assistant' && message.model ? <small>{message.model}</small> : null}{message.contextSnapshot?.resourceSnapshot ? <small className="script-context-used">项目上下文</small> : null}</header>
            {message.role === 'assistant' ? <ReadableMarkdown content={message.content} annotations={message.suggestion ? [] : readableFactAnnotations(message.factAnnotations)} /> : <p>{message.content}</p>}
            {message.role === 'assistant' && !message.suggestion ? <FactEvidenceLinks annotations={message.factAnnotations} /> : null}
            {message.role === 'assistant' && message.webSearches.length > 0 ? <details className="script-message-searches">
              <summary>已联网查证{message.webSearches.length}步</summary>
              <ul>{message.webSearches.map((search, index) => <li key={`${search.type}-${index}`}>{search.query ?? search.url ?? '网页查证'}</li>)}</ul>
            </details> : null}
            {message.role === 'assistant' ? <div className="script-message-actions"><button onClick={() => onAppendMessage(message)}><Plus size={11} />加入文案</button><button onClick={() => void onCopyMessage(message)}><Copy size={11} />复制</button></div> : null}
            {message.role === 'user' && task && ['queued', 'running', 'waiting_confirmation'].includes(task.status) ? <span className="script-message-task"><RefreshCw size={11} className="is-spinning" />{task.status === 'queued' ? '等待Provider' : `${providerLabels[provider]}正在回复`}</span> : null}
            {message.role === 'user' && task?.status === 'failed' ? <span className="script-message-task failed"><TriangleAlert size={11} />{task.errorMessage ?? '生成失败'}<button onClick={() => void onRetry(task)}><RotateCcw size={11} />重试</button></span> : null}
          </div>
        </article>
      })}
    </div>
  </section>
}

function CandidateMessageCard({
  group,
  message,
  expanded,
  active,
  selected,
  notice,
  canUndo,
  anchorMessageId,
  onToggleExpanded,
  onPrevious,
  onNext,
  onLocate,
  onToggleCompare,
  onApply,
  onUndo,
  onCopy,
  onDiscard
}: {
  group: CandidateMessageGroup
  message: ScriptRevisionMessage
  expanded: boolean
  active: boolean
  selected: boolean
  notice: string
  canUndo: boolean
  anchorMessageId: string
  onToggleExpanded(): void
  onPrevious(): void
  onNext(): void
  onLocate(): void
  onToggleCompare(): void
  onApply(action: ApplyAction): Promise<void>
  onUndo(): Promise<void>
  onCopy(): Promise<void>
  onDiscard(): Promise<void>
}): React.JSX.Element {
  const suggestion = message.suggestion!
  const targetId = messageTargetId(message)
  const revisionIndex = group.revisions.findIndex((item) => item.id === message.id)
  const decided = Boolean(message.suggestionStatus && message.suggestionStatus !== 'pending')
  return <article
    className={`candidate-message-card${active ? ' active' : ''}${selected ? ' selected' : ''}${message.suggestionStatus === 'discarded' ? ' discarded' : ''}`}
    id={`script-message-${anchorMessageId}`}
    data-target-selection-id={targetId ?? undefined}
    tabIndex={-1}
  >
    <header>
      <div><span className="candidate-number">{group.number}</span><div><b>候选{group.number}</b><small>针对“{(message.selectedText ?? '整篇文案').slice(0, 28)}{(message.selectedText?.length ?? 0) > 28 ? '…' : ''}”</small></div></div>
      <button className="candidate-expand" aria-expanded={expanded} onClick={onToggleExpanded}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
    </header>
    <div className="candidate-audit-row">
      <span>{providerLabels[message.provider]}</span>
      {message.model ? <span>{message.model}</span> : null}
      <span>第{message.generationRound ?? revisionIndex + 1}轮</span>
      {message.contextSnapshot?.resourceSnapshot ? <span>项目上下文</span> : null}
    </div>
    <ReadableMarkdown className="candidate-summary" content={suggestion.replacementText} annotations={readableFactAnnotations(message.factAnnotations)} />
    <FactEvidenceLinks annotations={message.factAnnotations} />
    {expanded ? <div className="candidate-expanded">
      {message.candidateInstruction ? <span>要求：{message.candidateInstruction}</span> : null}
      <p>{message.content}</p>
      <div className="candidate-diff"><div><small>原文</small><p>{suggestion.originalText}</p></div><div><small>候选</small><ReadableMarkdown content={suggestion.replacementText} annotations={readableFactAnnotations(message.factAnnotations)} /></div></div>
      {suggestion.rationale ? <span>{suggestion.rationale}</span> : null}
    </div> : null}
    {group.revisions.length > 1 ? <div className="candidate-history">
      <button aria-label="上一个历史候选" disabled={revisionIndex <= 0} onClick={onPrevious}><ChevronLeft size={12} /></button>
      <span><History size={11} />{revisionIndex + 1}/{group.revisions.length}·查看历史生成</span>
      <button aria-label="下一个历史候选" disabled={revisionIndex >= group.revisions.length - 1} onClick={onNext}><ChevronRight size={12} /></button>
    </div> : null}
    {notice ? <span className="candidate-card-notice">{notice}</span> : null}
    <footer>
      <button onClick={onLocate}><Crosshair size={12} />定位</button>
      <button className={selected ? 'selected' : ''} onClick={onToggleCompare}>{selected ? <Check size={12} /> : <Sparkles size={12} />}{selected ? '已选' : '加入对比'}</button>
      {canUndo ? <button onClick={() => void onUndo()}><Undo2 size={12} />撤销</button> : !decided ? <button className="primary-action" onClick={() => void onApply('replace')}>应用</button> : null}
      <button className="candidate-more-action" onClick={() => void onCopy()}><Copy size={12} />复制</button>
      {!decided ? <button className="candidate-more-action" onClick={() => void onDiscard()}>放弃</button> : null}
    </footer>
  </article>
}

export function CandidateComparisonOverlay({
  candidates,
  onApply,
  onClose
}: {
  candidates: ScriptRevisionMessage[]
  onApply(message: ScriptRevisionMessage): Promise<void>
  onClose(): void
}): React.JSX.Element | null {
  if (candidates.length < 2) return null
  return <div className="candidate-comparison-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="candidate-comparison-overlay" role="dialog" aria-modal="true" aria-labelledby="candidate-comparison-title">
      <header><div><span>临时比较</span><h2 id="candidate-comparison-title">比较{candidates.length}个候选</h2></div><button onClick={onClose}>关闭</button></header>
      <div className="candidate-comparison-grid">{candidates.map((message) => <article key={message.id}>
        <header><b>{message.candidateNumber ? `候选${message.candidateNumber}·` : ''}{providerLabels[message.provider]}</b><span>{message.suggestion?.summary}</span></header>
        <ReadableMarkdown content={message.suggestion?.replacementText ?? ''} annotations={readableFactAnnotations(message.factAnnotations)} />
        <FactEvidenceLinks annotations={message.factAnnotations} />
        <small>{message.suggestion?.replacementText.length ?? 0}字·第{message.generationRound ?? 1}轮·{new Date(message.createdAt).toLocaleDateString('zh-CN')}</small>
        <button className="primary-action" onClick={() => void onApply(message)}>应用这个候选</button>
      </article>)}</div>
    </section>
  </div>
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function providerCapabilityLabel(capability: ProviderCapability | undefined): string {
  if (!capability) return '正在检测'
  if (capability.available) return '可用'
  if (capability.status === 'not_installed') return '未安装'
  if (capability.status === 'verifying') return '验证中'
  if (capability.status === 'verification_failed') return '验证失败'
  return '待验证'
}

function providerRuntimeLabel(
  provider: ScriptRevisionProvider,
  conversation: ScriptRevisionConversation | null,
  capability: ProviderCapability | undefined
): string {
  if (!capability?.available || provider !== 'codex_cli') return providerCapabilityLabel(capability)
  const model = conversation?.model
  if (!model) return '自动选择最高可用模型 · 联网自动'
  const effort = conversation.reasoningEffort === 'max'
    ? '最高推理'
    : conversation.reasoningEffort === 'xhigh' ? '超高推理'
      : conversation.reasoningEffort === 'high' ? '高推理'
        : conversation.reasoningEffort === 'medium' ? '中等推理'
          : conversation.reasoningEffort === 'low' ? '轻推理' : '自动推理'
  const web = conversation.webSearchMode === 'disabled'
    ? '关闭联网'
    : conversation.webSearchMode === 'required' ? '本轮必须查证' : '联网自动'
  return `${model.toUpperCase()} · ${effort} · ${web}`
}
