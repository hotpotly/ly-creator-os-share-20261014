import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessLedgerLockService, type TouchIdAuthenticator } from '../../src/main/business-ledger-lock-service'
import type { SecretProtector } from '../../src/main/mobile-sync-service'

const directories: string[] = []

async function createService(touchIdAvailable = false): Promise<{ service: BusinessLedgerLockService; path: string; touchId: TouchIdAuthenticator }> {
  const directory = await mkdtemp(join(tmpdir(), 'creator-os-ledger-lock-'))
  directories.push(directory)
  const path = join(directory, 'business-ledger-lock.json')
  const protector: SecretProtector = {
    isAvailable: () => true,
    encrypt: (secret) => `encrypted:${Buffer.from(secret).toString('base64')}`,
    decrypt: (encrypted) => Buffer.from(encrypted.slice('encrypted:'.length), 'base64').toString('utf8')
  }
  const touchId = {
    isAvailable: vi.fn(() => touchIdAvailable),
    authenticate: vi.fn(async () => undefined)
  }
  const service = new BusinessLedgerLockService(path, protector, touchId)
  await service.initialize()
  return { service, path, touchId }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('business ledger lock service', () => {
  it('stores only a safeStorage ciphertext and requires the correct password after restart', async () => {
    const { service, path, touchId } = await createService()
    await service.enable('商务密码123')
    const stored = await readFile(path, 'utf8')
    expect(stored).not.toContain('商务密码123')
    expect(stored).not.toContain('"salt"')
    expect(stored).toContain('encryptedVerifier')

    const restarted = new BusinessLedgerLockService(path, {
      isAvailable: () => true,
      encrypt: (secret) => `encrypted:${Buffer.from(secret).toString('base64')}`,
      decrypt: (encrypted) => Buffer.from(encrypted.slice('encrypted:'.length), 'base64').toString('utf8')
    }, touchId)
    await restarted.initialize()
    expect(restarted.getStatus()).toMatchObject({ enabled: true, unlocked: false })
    expect(() => restarted.unlockWithPassword('错误密码')).toThrow('密码不正确')
    expect(restarted.unlockWithPassword('商务密码123')).toMatchObject({ unlocked: true })
    expect(restarted.lock()).toMatchObject({ unlocked: false })
  })

  it('supports Touch ID session unlock and password-confirmed disabling', async () => {
    const { service, touchId } = await createService(true)
    await service.enable('1234')
    service.lock()
    await expect(service.unlockWithTouchId()).resolves.toMatchObject({ unlocked: true, touchIdAvailable: true })
    expect(touchId.authenticate).toHaveBeenCalledWith('解锁收入台账')
    await expect(service.disable('0000')).rejects.toThrow('密码不正确')
    await expect(service.disable('1234')).resolves.toMatchObject({ enabled: false, unlocked: true })
  })

  it('refuses weak passwords and unavailable secure storage', async () => {
    const { service, path, touchId } = await createService()
    await expect(service.enable('123')).rejects.toThrow('至少需要4个字符')
    const unavailable = new BusinessLedgerLockService(path, {
      isAvailable: () => false,
      encrypt: () => { throw new Error('unavailable') },
      decrypt: () => { throw new Error('unavailable') }
    }, touchId)
    await unavailable.initialize()
    await expect(unavailable.enable('1234')).rejects.toThrow('系统安全存储不可用')
  })
})
