import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BusinessLedgerLockStatus } from '../shared/domain'
import type { SecretProtector } from './mobile-sync-service'

interface StoredLockFile {
  version: 1
  encryptedVerifier: string
}

interface PasswordVerifier {
  salt: string
  hash: string
}

export interface TouchIdAuthenticator {
  isAvailable(): boolean
  authenticate(reason: string): Promise<void>
}

function passwordHash(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, 64)
}

function parseLockFile(raw: string): StoredLockFile {
  const parsed = JSON.parse(raw) as Partial<StoredLockFile>
  if (parsed.version !== 1 || typeof parsed.encryptedVerifier !== 'string' || !parsed.encryptedVerifier) throw new Error('收入台账隐私锁配置损坏')
  return parsed as StoredLockFile
}

export class BusinessLedgerLockService {
  private enabled = false
  private unlocked = true
  private encryptedVerifier: string | null = null

  constructor(
    private readonly configPath: string,
    private readonly secretProtector: SecretProtector,
    private readonly touchId: TouchIdAuthenticator
  ) {}

  async initialize(): Promise<void> {
    try {
      const stored = parseLockFile(await readFile(this.configPath, 'utf8'))
      this.encryptedVerifier = stored.encryptedVerifier
      this.enabled = true
      this.unlocked = false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.encryptedVerifier = null
      this.enabled = false
      this.unlocked = true
    }
  }

  getStatus(): BusinessLedgerLockStatus {
    return {
      enabled: this.enabled,
      unlocked: this.unlocked,
      securityAvailable: this.secretProtector.isAvailable(),
      touchIdAvailable: this.touchId.isAvailable()
    }
  }

  async enable(password: string): Promise<BusinessLedgerLockStatus> {
    if (this.enabled) throw new Error('收入台账隐私锁已经开启')
    if (!this.secretProtector.isAvailable()) throw new Error('系统安全存储不可用，无法开启隐私锁')
    if (password.normalize('NFKC').length < 4) throw new Error('密码至少需要4个字符')
    const salt = randomBytes(16)
    const verifier: PasswordVerifier = {
      salt: salt.toString('base64'),
      hash: passwordHash(password, salt).toString('base64')
    }
    const encryptedVerifier = this.secretProtector.encrypt(JSON.stringify(verifier))
    const payload: StoredLockFile = { version: 1, encryptedVerifier }
    await mkdir(dirname(this.configPath), { recursive: true })
    const temporaryPath = `${this.configPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.configPath)
    this.encryptedVerifier = encryptedVerifier
    this.enabled = true
    this.unlocked = true
    return this.getStatus()
  }

  async disable(password: string): Promise<BusinessLedgerLockStatus> {
    if (!this.enabled) return this.getStatus()
    if (!this.verifyPassword(password)) throw new Error('密码不正确')
    await rm(this.configPath, { force: true })
    this.encryptedVerifier = null
    this.enabled = false
    this.unlocked = true
    return this.getStatus()
  }

  unlockWithPassword(password: string): BusinessLedgerLockStatus {
    if (!this.enabled) return this.getStatus()
    if (!this.verifyPassword(password)) throw new Error('密码不正确')
    this.unlocked = true
    return this.getStatus()
  }

  async unlockWithTouchId(): Promise<BusinessLedgerLockStatus> {
    if (!this.enabled) return this.getStatus()
    if (!this.touchId.isAvailable()) throw new Error('这台Mac当前无法使用Touch ID')
    await this.touchId.authenticate('解锁收入台账')
    this.unlocked = true
    return this.getStatus()
  }

  lock(): BusinessLedgerLockStatus {
    if (this.enabled) this.unlocked = false
    return this.getStatus()
  }

  private verifyPassword(password: string): boolean {
    if (!this.encryptedVerifier || !this.secretProtector.isAvailable()) return false
    try {
      const verifier = JSON.parse(this.secretProtector.decrypt(this.encryptedVerifier)) as Partial<PasswordVerifier>
      if (typeof verifier.salt !== 'string' || typeof verifier.hash !== 'string') return false
      const salt = Buffer.from(verifier.salt, 'base64')
      const expected = Buffer.from(verifier.hash, 'base64')
      const actual = passwordHash(password, salt)
      return expected.length === actual.length && timingSafeEqual(expected, actual)
    } catch {
      return false
    }
  }
}
