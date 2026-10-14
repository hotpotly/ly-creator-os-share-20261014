import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { playTodoCompletionFeedback } from '../../src/main/todo-completion-feedback'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('CREATOR_OS_TEST_BACKGROUND', '0'); vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin') })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.mocked(execFile).mockReset() })
const finish = () => { const call = vi.mocked(execFile).mock.calls.at(-1); const callback = call?.[3] as (() => void) | undefined; callback?.() }

describe('small-step physical feedback', () => {
  it('only requests a single bounded fixed native action for a newly saved completion', () => {
    playTodoCompletionFeedback(false, true, true)
    playTodoCompletionFeedback(false, true, true)
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(execFile).toHaveBeenCalledWith('/usr/bin/osascript', ['-l', 'JavaScript', '-e', expect.stringContaining('NSHapticFeedbackManager')], { timeout: 1200, maxBuffer: 1024 }, expect.any(Function))
    expect(vi.mocked(execFile).mock.calls[0]?.[1]?.at(-1)).toContain('accessibilityDisplayShouldReduceMotion')
    finish()
  })
  it('does not replay on completed snapshots, undo, hidden windows, tests or unsupported systems', () => {
    playTodoCompletionFeedback(true, true, true)
    playTodoCompletionFeedback(true, false, true)
    playTodoCompletionFeedback(false, true, false)
    vi.stubEnv('CREATOR_OS_TEST_BACKGROUND', '1'); playTodoCompletionFeedback(false, true, true)
    vi.stubEnv('CREATOR_OS_TEST_BACKGROUND', '0'); vi.stubEnv('NODE_ENV', 'test'); playTodoCompletionFeedback(false, true, true)
    vi.stubEnv('NODE_ENV', 'production'); vi.spyOn(process, 'platform', 'get').mockReturnValue('linux'); playTodoCompletionFeedback(false, true, true)
    expect(execFile).not.toHaveBeenCalled()
  })
  it('native failure is nonfatal and does not lock future attempts', () => {
    vi.mocked(execFile).mockImplementationOnce(() => { throw new Error('unavailable') })
    expect(() => playTodoCompletionFeedback(false, true, true)).not.toThrow()
    playTodoCompletionFeedback(false, true, true)
    expect(execFile).toHaveBeenCalledTimes(2)
    finish()
  })
})
