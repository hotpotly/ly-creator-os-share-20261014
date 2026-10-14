import { useCallback, useEffect, useRef, useState } from 'react'
import { todoVisibleOnDate } from '../../../shared/todo-date'
import { defaultTodoDay, type TodoDay } from '../../../shared/todo-day'
import { useWorkspaceStore } from '../store/workspace'

export function useTodoDay(day: string, activate = false) {
  const snapshot = useWorkspaceStore(state => state.snapshot)
  const hydrated = useWorkspaceStore(state => state.hydrated)
  const refresh = useWorkspaceStore(state => state.refresh)
  const entry = snapshot.todoDays?.find(value => value.day === day) ?? defaultTodoDay(day)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const attempted = useRef('')
  const regularAttempted = useRef('')
  const update = useCallback(async (patch: Partial<Omit<TodoDay, 'day' | 'revision'>>, expectedRevision?: number, silent = false, targetDay = day): Promise<boolean> => {
    if (!window.creatorOS || pending.current) return false
    pending.current = true; setSaving(true); if (!silent) setError('')
    try {
      const live = useWorkspaceStore.getState().snapshot.todoDays?.find(value => value.day === targetDay) ?? defaultTodoDay(targetDay)
      const initialView = live.revision === 0 && targetDay !== useWorkspaceStore.getState().snapshot.today ? { view: 'regular' as const } : {}
      await window.creatorOS.writeTodoDay({ day: targetDay, expectedRevision: expectedRevision ?? live.revision, patch: { ...initialView, ...patch } })
      await refresh()
      return true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败，请重试'
      if (!silent || !message.includes('其他窗口更新')) setError(message)
      await refresh()
      return false
    } finally { pending.current = false; setSaving(false) }
  }, [day, refresh])
  useEffect(() => {
    const key = `${day}:${entry.revision}`
    if (saving || !activate || !hydrated || day !== snapshot.today || entry.entered || attempted.current === key) return
    attempted.current = key
    void update({ entered: true, view: entry.smallCompleted ? 'regular' : 'small' }, undefined, true)
  }, [saving, activate, day, entry.entered, entry.revision, entry.smallCompleted, hydrated, snapshot.today, update])
  const regular = snapshot.todos.filter(todo => todo.source === 'manual' && !todo.isExtra && todoVisibleOnDate(todo, day, snapshot.today))
  const regularDone = regular.length > 0 && regular.every(todo => todo.status === 'completed')
  useEffect(() => {
    const key = `${day}:${entry.revision}:${regularDone}`
    if (!hydrated || saving || regularDone === entry.regularDone || regularAttempted.current === key) return
    regularAttempted.current = key
    void update({ regularDone, ...(regularDone ? { showExtra: true } : {}) }, undefined, true)
  }, [day, entry.revision, hydrated, saving, regularDone, entry.regularDone, update])
  const view = day === snapshot.today && !entry.entered ? 'small' : entry.revision === 0 && day !== snapshot.today ? 'regular' : entry.view
  return { entry, view, update, saving, error }
}
