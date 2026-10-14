export function layoutReviewChartDates(tones: Array<string | undefined>, width: number, active: number | null): Array<{ index: number; center: number }> {
  if (!tones.length || width < 22) return []
  const center = (index: number): number => Math.max(11, Math.min(width - 11, (index + .5) * width / tones.length))
  const boundaries = tones.flatMap((tone, index) => tone && (tones[index - 1] !== tone || tones[index + 1] !== tone) ? [index] : [])
  const ticks = tones.length <= 7 ? tones.map((_, index) => index) : [1, 2, 3].map(quarter => Math.round((tones.length - 1) * quarter / 4))
  const candidates = [...new Set([...(active !== null && active >= 0 && active < tones.length ? [active] : []), 0, tones.length - 1, ...boundaries, ...ticks, ...tones.flatMap((tone, index) => tone ? [index] : [])])]
  const dates: Array<{ index: number; center: number }> = []
  for (const index of candidates) {
    const position = center(index)
    if (dates.every(date => Math.abs(date.center - position) >= 26)) dates.push({ index, center: position })
  }
  return dates.sort((a, b) => a.index - b.index)
}
