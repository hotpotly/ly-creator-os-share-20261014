import { describe, expect, it } from 'vitest'
import { isSameRendererDocument, urlWithoutHash } from '../../src/main/security-origin'

describe('renderer document validation', () => {
  it('accepts only hash changes within the registered document', () => {
    const documentUrl = 'file:///Applications/LY%20Creator%20OS.app/Contents/Resources/app.asar/out/renderer/index.html'
    expect(isSameRendererDocument(`${documentUrl}#/capture`, documentUrl)).toBe(true)
    expect(urlWithoutHash(`${documentUrl}#/capture`)).toBe(documentUrl)
  })

  it('rejects another file, loopback endpoint, remote origin and malformed URL', () => {
    const documentUrl = 'file:///Applications/LY%20Creator%20OS.app/Contents/Resources/app.asar/out/renderer/index.html'
    expect(isSameRendererDocument('file:///tmp/index.html', documentUrl)).toBe(false)
    expect(isSameRendererDocument('http://127.0.0.1:5173/', documentUrl)).toBe(false)
    expect(isSameRendererDocument('https://example.com', documentUrl)).toBe(false)
    expect(isSameRendererDocument('not-a-url', documentUrl)).toBe(false)
  })
})
