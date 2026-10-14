import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as wire from '../../src/shared/workspace-sync-v2'

const fixture = JSON.parse(readFileSync(resolve('../shared-fixtures/workspace-sync-v2.json'), 'utf8'))
const schemas: Record<string, z.ZodType> = {
  envelope: wire.workspaceV2EnvelopeSchema, inline: wire.workspaceV2InlineSchema,
  metadata: wire.workspaceV2MetadataSchema, record: wire.workspaceV2RecordSchema, receipt: wire.workspaceV2ReceiptSchema,
  operation: wire.workspaceV2OperationSchema, syncRequest: wire.workspaceV2SyncRequestSchema,
  syncResponse: wire.workspaceV2SyncResponseSchema, capabilitiesRequest: wire.workspaceV2CapabilitiesRequestSchema,
  capabilitiesResponse: wire.workspaceV2CapabilitiesResponseSchema, manifest: wire.workspaceV2ManifestSchema,
  snapshotStart: wire.workspaceV2SnapshotStartRequestSchema, snapshotPageRequest: wire.workspaceV2SnapshotPageRequestSchema,
  snapshotPageResponse: wire.workspaceV2SnapshotPageResponseSchema, blobStart: wire.workspaceV2BlobStartRequestSchema,
  blobSession: wire.workspaceV2BlobSessionSchema, blobStatus: wire.workspaceV2BlobStatusRequestSchema,
  blobChunk: wire.workspaceV2BlobChunkRequestSchema, blobChunkAck: wire.workspaceV2BlobChunkAckSchema,
  blobCommitRequest: wire.workspaceV2BlobCommitRequestSchema, blobCommitResponse: wire.workspaceV2BlobCommitResponseSchema,
  blobReadRequest: wire.workspaceV2BlobReadRequestSchema, blobReadResponse: wire.workspaceV2BlobReadResponseSchema
}
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)
const sample = (name: string): Record<string, unknown> => structuredClone(fixture.cases.find((value: { name: string }) => value.name === name).value)
const payload = async (json: string) => ({ encoding: 'json' as const, json, byteLength: utf8(json).length, sha256: await wire.workspaceV2Sha256(utf8(json)) })

describe('workspace v2 shared wire contract', () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, async () => {
      const schema = schemas[testCase.schema]
      expect(schema, testCase.schema).toBeDefined()
      const result = await schema!.safeParseAsync(testCase.value)
      expect(result.success, !result.success ? JSON.stringify(result.error.issues) : testCase.name).toBe(testCase.valid)
    })
  }

  for (const vector of fixture.contextCases) {
    it(`correlates request context: ${vector.name}`, async () => {
      const run = async () => {
        if (vector.helper === 'responseEnvelope') return wire.workspaceV2AssertResponseEnvelope(vector.request, vector.response)
        if (vector.helper === 'capabilities') return wire.workspaceV2AssertCapabilities(vector.request, vector.response, vector.approvedPermissions)
        if (vector.helper === 'syncResponse') return wire.workspaceV2AssertSyncResponse(vector.request, vector.response)
        throw new Error('未知上下文校验器')
      }
      if (vector.valid) await expect(run()).resolves.toBeUndefined()
      else await expect(run()).rejects.toThrow()
    })
  }

  for (const vector of fixture.aadCases) {
    it(`normalizes AAD numeric counter: ${vector.name}`, () => {
      expect(wire.workspaceV2Aad(JSON.parse(vector.identityJson), vector.direction)).toBe(vector.expected)
    })
  }

  it('freezes every capability limit without enabling any runtime scope', () => {
    expect(wire.WORKSPACE_V2_LIMITS).toEqual(fixture.limits)
    expect(wire.workspaceV2LimitsSchema.parse(fixture.limits)).toEqual(fixture.limits)
    expect(wire.WORKSPACE_V2_SCOPES).toEqual([...wire.WORKSPACE_V2_SCOPES].sort())
    expect(new Set(Object.values(wire.WORKSPACE_V2_KIND_SCOPE))).toEqual(new Set(wire.WORKSPACE_V2_SCOPES))
  })

  for (const vector of fixture.canonicalCases) {
    it(`${vector.name} uses exact UTF-16 order and UTF-8 hash`, async () => {
      const actual = wire.workspaceV2CanonicalJson(JSON.parse(vector.inputJson))
      expect(actual).toBe(vector.canonical)
      expect(await wire.workspaceV2Sha256(utf8(actual))).toBe(vector.sha256)
    })
  }

  it('rejects non-JSON values and non-safe numeric metadata', () => {
    for (const value of [undefined, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, new Date(), new Map(), { x: undefined }, [undefined], Array(2)]) {
      expect(() => wire.workspaceV2CanonicalJson(value)).toThrow()
    }
    expect(wire.workspaceV2CanonicalJson({ z: -0, a: 1.0 })).toBe('{"a":1,"z":0}')
  })

  for (const vector of fixture.rawHashCases) {
    it('hashes original inline JSON, not a reserialized body', async () => {
      expect(utf8(vector.json).length).toBe(vector.byteLength)
      expect(await wire.workspaceV2Sha256(utf8(vector.json))).toBe(vector.sha256)
      const canonical = wire.workspaceV2CanonicalJson(JSON.parse(vector.json))
      expect(await wire.workspaceV2Sha256(utf8(canonical))).toBe(vector.canonicalSha256)
      expect(vector.sha256).not.toBe(vector.canonicalSha256)
    })
  }

  for (const vector of fixture.scopeDigests) {
    it(`binds scope set ${vector.scopes.join(',')}`, async () => {
      expect(await wire.workspaceV2ScopeDigest(vector.scopes)).toBe(vector.scopeDigest)
    })
  }

  for (const vector of fixture.manifestCases) {
    it(`verifies ${vector.name} manifest exact entry bytes, count and digest`, async () => {
      const actual = await wire.workspaceV2ManifestText(vector.records)
      expect(actual).toBe(vector.entriesUtf8)
      expect(Buffer.from(actual).toString('base64')).toBe(vector.entriesBase64)
      expect(await wire.workspaceV2ManifestDigest(vector.records)).toBe(vector.sha256)
      await expect(wire.workspaceV2VerifyManifest(vector.manifest, vector.records)).resolves.toBeUndefined()
    })
  }

  it('rejects reordered, duplicate, omitted, unauthorized and changed manifest entries', async () => {
    const vector = fixture.manifestCases.find((value: { name: string }) => value.name === 'two')
    await expect(wire.workspaceV2ManifestText([...vector.records].reverse())).rejects.toThrow()
    await expect(wire.workspaceV2ManifestText([vector.records[0], vector.records[0]])).rejects.toThrow()
    await expect(wire.workspaceV2VerifyManifest(vector.manifest, [vector.records[0]])).rejects.toThrow()
    await expect(wire.workspaceV2VerifyManifest({ ...vector.manifest, through: 1 }, vector.records)).rejects.toThrow()
    const scopes = ['todo.full'] as const
    await expect(wire.workspaceV2VerifyManifest({ ...vector.manifest, scopes: [...scopes], scopeDigest: await wire.workspaceV2ScopeDigest(scopes) }, vector.records)).rejects.toThrow()
    const changed = structuredClone(vector.records)
    changed[0].metadata.editableFields.reverse()
    await expect(wire.workspaceV2VerifyManifest(vector.manifest, changed)).rejects.toThrow()
  })

  it('enforces original UTF-8 inline bytes at 16KiB and pages at 256KiB', async () => {
    const exact = '{"s":"' + 'x'.repeat(16376) + '"}'
    expect(utf8(exact).length).toBe(16384)
    expect((await wire.workspaceV2InlineSchema.safeParseAsync(await payload(exact))).success).toBe(true)
    expect((await wire.workspaceV2InlineSchema.safeParseAsync(await payload(exact.replace('x', '中')))).success).toBe(false)
    expect((await wire.workspaceV2InlineSchema.safeParseAsync(await payload(exact + ' '))).success).toBe(false)
    const response = sample('snapshotPageResponse.valid')
    const original = await wire.workspaceV2RecordSchema.parseAsync(sample('record.valid'))
    const records = Array.from({ length: 17 }, (_, index) => ({ ...original, id: `task-${index}`, sequence: index + 1 }))
    for (const record of records) record.payload = await payload(exact)
    expect((await wire.workspaceV2SnapshotPageResponseSchema.safeParseAsync({ ...response, records })).success).toBe(false)
    expect((await wire.workspaceV2SnapshotPageResponseSchema.safeParseAsync({ ...response, records: records.slice(0, 10) })).success).toBe(true)
    expect(wire.workspaceV2JsonRefSchema.safeParse({ sha256: 'a'.repeat(64), byteLength: 16777216, mediaType: 'application/json' }).success).toBe(true)
    expect(wire.workspaceV2JsonRefSchema.safeParse({ sha256: 'a'.repeat(64), byteLength: 16777217, mediaType: 'application/json' }).success).toBe(false)
  })

  it('caps batches at 100 and does not let metadata carry arbitrary document text', async () => {
    const request = sample('syncRequest.valid')
    const operation = fixture.cases.find((value: { name: string }) => value.name === 'operation.valid').value
    const operations = Array.from({ length: 101 }, (_, index) => ({ ...operation, id: `task-${index}`, operationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }))
    expect((await wire.workspaceV2SyncRequestSchema.safeParseAsync({ ...request, operations: operations.slice(0, 100) })).success).toBe(true)
    expect((await wire.workspaceV2SyncRequestSchema.safeParseAsync({ ...request, operations })).success).toBe(false)
    const metadata = sample('metadata.valid')
    expect(wire.workspaceV2MetadataSchema.safeParse({ ...metadata, todo: { body: 'x'.repeat(16384) } }).success).toBe(false)
    expect(wire.workspaceV2MetadataSchema.safeParse({ ...metadata, editableFields: ['x'.repeat(65)] }).success).toBe(false)
  })

  for (const vector of fixture.chunkCases) {
    it(`bounds exact chunk ${vector.byteLength}:${vector.index}`, () => {
      if (vector.expectedLength === null) {
        expect(() => wire.workspaceV2ChunkLength(vector.byteLength, vector.index)).toThrow()
      } else {
        expect(wire.workspaceV2ChunkLength(vector.byteLength, vector.index)).toBe(vector.expectedLength)
        expect(() => wire.workspaceV2AssertChunk(vector.byteLength, vector.index, new Uint8Array(vector.expectedLength))).not.toThrow()
        expect(() => wire.workspaceV2AssertChunk(vector.byteLength, vector.index, new Uint8Array(vector.expectedLength - 1))).toThrow()
      }
    })
  }

  it('verifies the whole JSON blob and its one-byte final chunk', async () => {
    const vector = fixture.blobDocument
    const json = vector.recipe.prefix + vector.recipe.repeat.repeat(vector.recipe.repeatCount) + vector.recipe.suffix
    const bytes = utf8(json)
    expect(bytes.length).toBe(vector.byteLength)
    expect(await wire.workspaceV2Sha256(bytes)).toBe(vector.sha256)
    expect(Buffer.from(bytes.slice(131072)).toString('base64')).toBe(vector.tailBase64)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  for (const vector of fixture.budgetCases) {
    it(`reserves declared upload bytes: ${vector.name}`, () => {
      const { declaredBytes, deviceReservedBytes, workspaceReservedBytes, activeUploads } = vector
      expect(wire.workspaceV2CheckUploadBudget({ declaredBytes, deviceReservedBytes, workspaceReservedBytes, activeUploads })).toBe(vector.allowed)
    })
  }

  for (const vector of fixture.sessionCases) {
    it(`limits idle and absolute expiry at ${vector.lastActivityMs}`, () => {
      expect(wire.workspaceV2SessionExpiry(vector.createdAtMs, vector.lastActivityMs)).toBe(vector.expiresAtMs)
    })
  }

  it('rejects invalid reserved byte counters and backwards session time', () => {
    expect(() => wire.workspaceV2CheckUploadBudget({ declaredBytes: 1, deviceReservedBytes: -1, workspaceReservedBytes: 0, activeUploads: 0 })).toThrow()
    expect(() => wire.workspaceV2SessionExpiry(1, 0)).toThrow()
    expect(() => wire.workspaceV2SessionExpiry(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow()
  })

  for (const vector of fixture.identityCases) {
    it(`binds decrypted body identity: ${vector.name}`, () => {
      if (vector.valid) expect(() => wire.workspaceV2AssertEnvelopeBody(vector.envelope, vector.body)).not.toThrow()
      else expect(() => wire.workspaceV2AssertEnvelopeBody(vector.envelope, vector.body)).toThrow()
    })
  }

  it('freezes HKDF/AES-GCM vectors separately from v1 and each purpose', () => {
    const vector = fixture.crypto
    expect(wire.WORKSPACE_V2_KEY_INFO).toBe(vector.info)
    const key = Buffer.from(hkdfSync('sha256', Buffer.from(vector.fakeSecretBase64, 'base64'), Buffer.from(fixture.identity.serviceId), wire.WORKSPACE_V2_KEY_INFO, 32))
    expect(key.toString('base64')).toBe(vector.keyBase64)
    expect(Buffer.from(hkdfSync('sha256', Buffer.from(vector.fakeSecretBase64, 'base64'), Buffer.from(fixture.identity.serviceId), 'ly-creator-workspace-v1', 32)).equals(key)).toBe(false)
    for (const direction of ['request', 'response'] as const) {
      const { aad, plaintext, envelope } = vector[direction]
      expect(wire.workspaceV2Aad(envelope, direction)).toBe(aad)
      const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
      cipher.setAAD(Buffer.from(aad))
      expect(Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64')).toBe(envelope.ciphertext)
      expect(cipher.getAuthTag().toString('base64')).toBe(envelope.tag)
      for (const replacement of [{ purpose: 'capabilities' }, { counter: 8 }, { requestId: fixture.identity.deviceId }, { deviceId: fixture.identity.workspaceId }, { workspaceId: fixture.identity.deviceId }, { serviceId: fixture.identity.deviceId }]) {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
        decipher.setAAD(Buffer.from(wire.workspaceV2Aad({ ...envelope, ...replacement }, direction)))
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
        decipher.update(Buffer.from(envelope.ciphertext, 'base64'))
        expect(() => decipher.final()).toThrow()
      }
      const opposite = direction === 'request' ? 'response' : 'request'
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
      decipher.setAAD(Buffer.from(wire.workspaceV2Aad(envelope, opposite)))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
      decipher.update(Buffer.from(envelope.ciphertext, 'base64'))
      expect(() => decipher.final()).toThrow()
    }
    expect(new Set(wire.WORKSPACE_V2_PURPOSES.map(purpose => wire.workspaceV2Aad({ ...fixture.identity, purpose }, 'request'))).size).toBe(9)
    for (const purpose of wire.WORKSPACE_V2_PURPOSES) expect(wire.workspaceV2Path(purpose)).toBe(`/workspace/v2/${purpose.replace('.', '/')}`)
  })
})
