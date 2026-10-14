import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import { dailyWorkLogAdjustPayloadSchema } from '../../src/shared/ipc'
let store: WorkspaceStore
let directory: string
const day = '2026-09-12'
const zero = { selfMediaMinutes: 0, aiMinutes: 0, otherWorkMinutes: 0 }
afterEach(async () => { store?.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
async function setup(): Promise<void> {
  const root = join(import.meta.dirname, '../../test-results/unit')
  await mkdir(root, { recursive: true }); directory = await mkdtemp(join(root, 'work-log-'))
  store = await openWorkspaceStore(directory)
}
test('accumulates on current values, undoes only the delta and persists separate days', async () => {
  await setup()
  store.repository.adjustDailyWorkLog(day, 'selfMediaMinutes', 15)
  store.repository.adjustDailyWorkLog(day, 'selfMediaMinutes', 30)
  store.repository.adjustDailyWorkLog(day, 'aiMinutes', 60)
  expect(store.repository.adjustDailyWorkLog(day, 'selfMediaMinutes', -15)).toMatchObject({ selfMediaMinutes: 30, aiMinutes: 60, otherWorkMinutes: 0 })
  expect(store.repository.getDailyWorkLog('2026-09-13')).toMatchObject(zero)
  store.close(); store = await openWorkspaceStore(directory)
  expect(store.repository.getDailyWorkLog(day)).toMatchObject({ selfMediaMinutes: 30, aiMinutes: 60 })
})
test('rejects limits, bad dates and stale manual edits without overwriting other windows', async () => {
  await setup()
  store.repository.adjustDailyWorkLog(day, 'aiMinutes', 1440)
  for (const delta of [1, -1441, 0, 0.5, NaN]) expect(() => store.repository.adjustDailyWorkLog(day, 'aiMinutes', delta)).toThrow()
  expect(() => store.repository.adjustDailyWorkLog(day, 'selfMediaMinutes', -15)).toThrow()
  expect(() => store.repository.adjustDailyWorkLog('2026-02-30', 'aiMinutes', 30)).toThrow()
  expect(() => store.repository.setDailyWorkLog(day, zero, zero)).toThrow('其他窗口更新')
  expect(store.repository.getDailyWorkLog(day).aiMinutes).toBe(1440)
  expect(store.repository.setDailyWorkLog(day, zero, { ...zero, aiMinutes: 1440 })).toMatchObject(zero)
})
test('validates adjustment IPC category, integer bounds and strict payload', () => {
  const input = { day, field: 'aiMinutes', deltaMinutes: 15 }
  expect(dailyWorkLogAdjustPayloadSchema.safeParse(input).success).toBe(true)
  for (const patch of [{ field: 'life' }, { deltaMinutes: 0 }, { deltaMinutes: 1441 }, { deltaMinutes: .5 }, { extra: true }]) expect(dailyWorkLogAdjustPayloadSchema.safeParse({ ...input, ...patch }).success).toBe(false)
})
test('total-only mode keeps classified history without double counting and detects cross-mode conflicts', async () => {
  await setup()
  const classified = store.repository.setDailyWorkLog(day, { selfMediaMinutes: 120, aiMinutes: 60, otherWorkMinutes: 0 })
  const total = store.repository.setDailyWorkLogTotal(day, 240, { ...classified, totalMinutes: null })
  expect(total).toMatchObject({ totalMinutes: 240, selfMediaMinutes: 120, aiMinutes: 60 })
  expect(() => store.repository.setDailyWorkLog(day, zero, { ...classified, totalMinutes: null })).toThrow('其他窗口更新')
  expect(() => store.repository.setDailyWorkLogTotal(day, 1441, total)).toThrow()
  store.close(); store = await openWorkspaceStore(directory)
  expect(store.repository.getDailyWorkLog(day).totalMinutes).toBe(240)
  expect(store.repository.setDailyWorkLog(day, zero, total)).toMatchObject({ ...zero, totalMinutes: null })
})
