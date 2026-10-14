import type { WORKSPACE_V2_REJECTION_CODES } from '../../shared/workspace-sync-v2'

export class WorkspaceV2DomainRejection extends Error {
  constructor(readonly code: typeof WORKSPACE_V2_REJECTION_CODES[number]) { super(code) }
}
