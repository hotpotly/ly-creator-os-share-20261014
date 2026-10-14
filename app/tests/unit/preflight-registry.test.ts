import { describe, expect, it } from 'vitest'
import { PreflightRegistry } from '../../src/main/preflight-registry'

describe('single-use preflight registry', () => {
  it('atomically gives one concurrent start ownership before either caller awaits', async () => {
    const registry = new PreflightRegistry<{ createdAt: number; target: string }>()
    registry.set('preflight-1', { createdAt: Date.now(), target: 'frozen-provider' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const start = async (): Promise<string> => {
      const claimed = registry.consume('preflight-1')
      if (!claimed) throw new Error('发送前检查已过期，请重新检查')
      await gate
      return claimed.target
    }
    const first = start()
    const second = start()
    release()
    const results = await Promise.allSettled([first, second])
    expect(results).toEqual([
      { status: 'fulfilled', value: 'frozen-provider' },
      { status: 'rejected', reason: expect.objectContaining({ message: '发送前检查已过期，请重新检查' }) }
    ])
  })
})
