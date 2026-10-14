import { BookOpen, AtSign, FileText, FolderKanban, Lightbulb, Search, StickyNote, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalSearchKind, GlobalSearchResult } from '../../../shared/global-search'
import { navigate } from '../utils/router'

const GROUP_LABELS: Record<GlobalSearchKind, string> = {
  project: '项目',
  topic: '选题',
  inspiration: '灵感',
  script: '文案',
  account: '账号',
  review: '复盘记录'
}

const GROUP_ICONS = {
  project: FolderKanban,
  topic: Lightbulb,
  inspiration: StickyNote,
  script: FileText,
  account: AtSign,
  review: BookOpen
} satisfies Record<GlobalSearchKind, typeof Search>

function openResult(result: GlobalSearchResult): void {
  if (result.kind === 'project') navigate({ page: 'project', projectId: result.id, moduleKey: 'overview' })
  else if (result.kind === 'topic') navigate({ page: 'topics', topicId: result.id })
  else if (result.kind === 'inspiration') navigate({ page: 'ideas', captureId: result.id })
  else if (result.kind === 'script' && result.projectId) navigate({ page: 'workbench', projectId: result.projectId, draftVersionId: result.id })
  else if (result.kind === 'review') {
    if (result.id.startsWith('period:')) {
      const [, kind, anchor] = result.id.split(':')
      navigate({ page: 'reviews', reportKind: kind === 'weekly' ? 'weekly' : 'monthly', anchorDate: anchor })
    } else navigate({ page: 'reviews', reviewEntryId: result.id })
  }
  else if (result.kind === 'account') navigate({ page: 'resources', resourceId: result.id })
}

export function GlobalSearchDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const requestRef = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const close = useCallback((): void => {
    onClose()
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }, [onClose])

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    const layer = dialogRef.current?.parentElement
    const parent = layer?.parentElement
    if (!layer || !parent) return
    const siblings = Array.from(parent.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== layer)
      .map((element) => ({ element, inert: element.inert }))
    siblings.forEach(({ element }) => { element.inert = true })
    return () => siblings.forEach(({ element, inert }) => { element.inert = inert })
  }, [])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [close])

  useEffect(() => {
    if (!window.creatorOS) return
    let active = true
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    const timer = window.setTimeout(() => {
      void window.creatorOS!.searchGlobal(query, 50)
        .then((items) => {
          if (!active || requestRef.current !== requestId) return
          setResults(items)
          setSelectedIndex(0)
        })
        .catch((cause: unknown) => {
          if (!active || requestRef.current !== requestId) return
          setResults([])
          setError(cause instanceof Error ? cause.message : '搜索暂时不可用')
        })
        .finally(() => {
          if (active && requestRef.current === requestId) setLoading(false)
        })
    }, query ? 90 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])

  const grouped = useMemo(() => {
    const groups = new Map<GlobalSearchKind, Array<{ result: GlobalSearchResult; index: number }>>()
    results.forEach((result, index) => groups.set(result.kind, [...(groups.get(result.kind) ?? []), { result, index }]))
    return groups
  }, [results])
  useEffect(() => {
    optionRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const select = (result: GlobalSearchResult): void => {
    openResult(result)
    onClose()
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      setSelectedIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      setSelectedIndex((index) => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && results[selectedIndex]) {
      event.preventDefault()
      select(results[selectedIndex])
    }
  }
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) => !element.hidden)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return <div className="global-search-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="global-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" tabIndex={-1} onKeyDown={trapFocus}>
      <header>
        <Search size={18} />
        <input
          ref={inputRef}
          role="combobox"
          aria-controls="global-search-results"
          aria-expanded="true"
          aria-activedescendant={results[selectedIndex] ? `global-search-result-${selectedIndex}` : undefined}
          value={query}
          maxLength={120}
          placeholder="搜索项目、选题、灵感、文案、账号或复盘"
          onChange={(event) => { setQuery(event.currentTarget.value); setLoading(true); setError('') }}
          onKeyDown={onKeyDown}
        />
        {query ? <button aria-label="清空搜索" onClick={() => { setQuery(''); setLoading(true); setError('') }}><X size={15} /></button> : <kbd>ESC</kbd>}
      </header>
      <div id="global-search-results" className="global-search-results" role="listbox" aria-label={query ? '搜索结果' : '最近项目'}>
        {!query && results.length ? <p className="global-search-hint">最近打开的项目</p> : null}
        {Array.from(grouped.entries()).map(([kind, items]) => {
          const Icon = GROUP_ICONS[kind]
          return <section className="global-search-group" key={kind}>
            <h2><Icon size={13} />{GROUP_LABELS[kind]}<span>{items.length}</span></h2>
            {items.map(({ result, index }) => <button
              ref={(element) => { optionRefs.current[index] = element }}
              id={`global-search-result-${index}`}
              role="option"
              aria-selected={selectedIndex === index}
              className={selectedIndex === index ? 'active' : ''}
              key={`${result.kind}:${result.id}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => select(result)}
            >
              <span><b>{result.title}</b><small>{result.subtitle}</small></span>
              <p>{result.preview || result.subtitle}</p>
              <kbd>↵</kbd>
            </button>)}
          </section>
        })}
        {!loading && !error && results.length === 0 ? <div className="global-search-empty"><Search size={22} /><b>{query ? '没有找到相关内容' : '还没有最近项目'}</b><span>{query ? '试试标题、正文关键词或拼音首字母' : '打开项目后会显示在这里'}</span></div> : null}
        {loading ? <div className="global-search-status">正在搜索本机内容…</div> : null}
        {error ? <div className="global-search-status error" role="alert">{error}</div> : null}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>打开</span><span>纯本机搜索，不调用AI</span></footer>
    </section>
  </div>
}
