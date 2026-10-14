export function locateUniqueRawSelection(
  rawSource: string | undefined,
  selectedText: string | undefined,
  baseOffset = 0
): { start: number; end: number } | null {
  if (!rawSource || !selectedText) return null
  const localStart = rawSource.indexOf(selectedText)
  if (localStart < 0 || localStart !== rawSource.lastIndexOf(selectedText)) return null
  return {
    start: baseOffset + localStart,
    end: baseOffset + localStart + selectedText.length
  }
}
