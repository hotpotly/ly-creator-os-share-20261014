import { describe, expect, it } from 'vitest'
import { countAttentionTasks, taskNeedsAttention } from '../../src/shared/task-visibility'

describe('run task entry visibility', () => {
  it('only counts tasks that still need attention', () => {
    const statuses = [
      'queued',
      'running',
      'waiting_confirmation',
      'failed',
      'succeeded',
      'canceled'
    ] as const
    expect(statuses.map((status) => taskNeedsAttention({ status }))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false
    ])
    expect(countAttentionTasks(statuses.map((status) => ({ status })))).toBe(4)
  })

  it('hides the entry when there is no unfinished or failed task', () => {
    expect(countAttentionTasks([{ status: 'succeeded' }, { status: 'canceled' }])).toBe(0)
  })
})
