import { WORKSPACE_V2_LIMITS, type WorkspaceV2Record } from '../../shared/workspace-sync-v2'
import { WorkspaceSyncError } from './workspace-sync-repository'

export const WORKSPACE_V2_PAGE_JSON_BYTES = WORKSPACE_V2_LIMITS.deviceTemporaryBytes / 2

export class WorkspaceV2PageBudget {
  private readonly lengths = new Map<string, number>()
  private bytes = 0

  add(record: WorkspaceV2Record): boolean {
    if (record.payload.encoding !== 'blob') return true
    const { sha256, byteLength } = record.payload.ref
    const previous = this.lengths.get(sha256)
    if (previous !== undefined) {
      if (previous !== byteLength) throw new WorkspaceSyncError('record_reference_mismatch', '正文引用长度不一致', 409)
      return true
    }
    if (this.bytes + byteLength > WORKSPACE_V2_PAGE_JSON_BYTES) return false
    this.lengths.set(sha256, byteLength)
    this.bytes += byteLength
    return true
  }
}
