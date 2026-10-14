import { create } from 'zustand'
import type { WorkspacePreferences, WorkspaceSnapshot } from '../../../shared/domain'
import { fallbackWorkspace } from '../data/fallback-workspace'

interface WorkspaceState {
  snapshot: WorkspaceSnapshot
  hydrated: boolean
  loading: boolean
  error: string
  hydrate(): Promise<WorkspaceSnapshot>
  refresh(): Promise<WorkspaceSnapshot>
  setPreferences(patch: Partial<WorkspacePreferences>): Promise<WorkspacePreferences>
}

async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  if (!window.creatorOS) return fallbackWorkspace
  return window.creatorOS.getWorkspace()
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  snapshot: fallbackWorkspace,
  hydrated: false,
  loading: false,
  error: '',
  async hydrate() {
    if (get().hydrated || get().loading) return get().snapshot
    set({ loading: true, error: '' })
    try {
      const snapshot = await fetchWorkspace()
      set({ snapshot, hydrated: true, loading: false })
      return snapshot
    } catch (error) {
      set({ hydrated: true, loading: false, error: error instanceof Error ? error.message : '工作区加载失败' })
      return get().snapshot
    }
  },
  async refresh() {
    try {
      const snapshot = await fetchWorkspace()
      set({ snapshot, hydrated: true, loading: false, error: '' })
      return snapshot
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '工作区刷新失败' })
      return get().snapshot
    }
  },
  async setPreferences(patch) {
    const current = get().snapshot.preferences
    const preferences = window.creatorOS ? await window.creatorOS.setPreferences(patch) : { ...current, ...patch }
    set((state) => ({ snapshot: { ...state.snapshot, preferences } }))
    return preferences
  }
}))

