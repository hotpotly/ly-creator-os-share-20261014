import { execFile } from 'node:child_process'

const feedbackScript = 'ObjC.import("AppKit"); if (!$.NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) $.NSHapticFeedbackManager.defaultPerformer.performFeedbackPatternPerformanceTime($.NSHapticFeedbackPatternGeneric, $.NSHapticFeedbackPerformanceTimeNow);'
let pending = false

export function playTodoCompletionFeedback(wasCompleted: boolean, completed: boolean, visible: boolean): void {
  if (wasCompleted || !completed || !visible || pending || process.platform !== 'darwin' || process.env.NODE_ENV === 'test' || process.env.CREATOR_OS_TEST_BACKGROUND === '1') return
  pending = true
  try {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', feedbackScript], { timeout: 1200, maxBuffer: 1024 }, () => { pending = false })
  } catch { pending = false }
}
