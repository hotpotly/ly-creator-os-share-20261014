import { useCallback, useEffect, useRef, useState } from 'react'
import type { TodoDay } from '../../../shared/todo-day'
import { useWorkspaceStore } from '../store/workspace'

type SaveStep = (patch: Partial<Omit<TodoDay, 'day' | 'revision'>>, expectedRevision?: number) => Promise<boolean>
type Presentation = { entry: TodoDay; phase: 'saving' | 'celebrating' }

export function useSmallStepCelebration(entry: TodoDay) {
  const [presentation, setPresentation] = useState<Presentation | null>(null)
  const sequence = useRef(0)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = useCallback(() => {
    sequence.current += 1
    pending.current = false
    clearTimeout(timer.current)
    setPresentation(null)
  }, [])
  useEffect(() => cancel, [entry.day, cancel])
  const save = async (patch: Partial<Omit<TodoDay, 'day' | 'revision'>>, revision: number | undefined, update: SaveStep): Promise<boolean> => {
    if (patch.smallCompleted !== true || entry.smallCompleted) return update(patch, revision)
    if (pending.current) return false
    pending.current = true
    const request = ++sequence.current
    setPresentation({ entry, phase: 'saving' })
    let saved = false
    try { saved = await update(patch, revision ?? entry.revision) } catch { saved = false }
    if (request !== sequence.current) return saved
    const current = useWorkspaceStore.getState().snapshot.todoDays?.find(value => value.day === entry.day)
    if (!saved || !current?.smallCompleted || current.smallStep !== entry.smallStep || current.view !== 'regular') {
      cancel()
      return saved
    }
    setPresentation({ entry: current, phase: 'celebrating' })
    timer.current = setTimeout(cancel, matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 900)
    return true
  }
  const active = presentation?.entry.day === entry.day && (presentation.phase === 'saving' || (entry.smallCompleted && entry.smallStep === presentation.entry.smallStep && entry.view === 'regular')) ? presentation : null
  return { presentation: active, cancel, save }
}
