import type { CreatorOSApi } from '../shared/ipc'

declare global {
  interface Window {
    creatorOS?: CreatorOSApi
  }
}

export {}
