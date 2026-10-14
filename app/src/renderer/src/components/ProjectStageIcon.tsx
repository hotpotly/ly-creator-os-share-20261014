import { Camera, Captions, Clapperboard, FilePenLine, FolderOpen, GitBranch, LayoutList, ListTree, MessageSquare, Scissors, Send, Wallet, type LucideIcon } from 'lucide-react'
import { projectStageColorTokens } from '../utils/project-stage-appearance'
import type { ProjectModuleKey } from '../../../shared/domain'

const icons: Record<ProjectModuleKey, LucideIcon> = {
  overview: LayoutList, materials: FolderOpen, outline: ListTree, script: FilePenLine,
  production: Clapperboard, shooting: Camera, editing: Scissors, postproduction: Captions,
  publishing: Send, versions: GitBranch, business: Wallet, feedback: MessageSquare
}
export function ProjectStageIcon({ stageKey, size = 16 }: { stageKey: ProjectModuleKey; size?: number }): React.JSX.Element {
  const Icon = icons[stageKey]
  return <Icon className="project-stage-icon" data-stage-icon={stageKey} style={{ color: `var(--${projectStageColorTokens[stageKey]}-text)` }} size={size} aria-hidden="true" />
}
