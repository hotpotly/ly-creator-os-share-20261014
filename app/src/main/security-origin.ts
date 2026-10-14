export function urlWithoutHash(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hash = ''
  return url.toString()
}

export function isSameRendererDocument(candidateUrl: string, documentUrl: string): boolean {
  try {
    return urlWithoutHash(candidateUrl) === urlWithoutHash(documentUrl)
  } catch {
    return false
  }
}
