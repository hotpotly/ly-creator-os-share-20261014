import { FolderOpen } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { ProjectDetail } from '../../../shared/domain'

/** Show only an explicitly selected cover. Never substitute another project's image. */
export function ProjectIdentityVisual({ project }: { project: ProjectDetail }): React.JSX.Element {
  const selected = project.coverCandidates.filter(cover => cover.isSelected)
  const cover = selected.find(item => item.platform === project.platformTargets[0]) ?? selected[0]
  const coverId = cover?.id
  const key = `${project.id}:${coverId ?? ''}`
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!coverId || !window.creatorOS) return
    let active = true
    void window.creatorOS.getCoverCandidatePreview(project.id, coverId).then(url => {
      if (active) setPreview({ key, url })
    }).catch(() => { /* Missing/unavailable cover keeps the project identity fallback. */ })
    return () => { active = false }
  }, [project.id, coverId, key])
  const url = preview?.key === key ? preview.url : null
  return <div className="project-identity-visual" style={{ '--identity-surface': `var(--${project.colorToken}-soft)`, '--identity-ink': `var(--${project.colorToken}-text)` } as CSSProperties}>
    {url ? <img src={url} alt={`${project.title}已选封面`} onError={() => setPreview(null)} /> : <FolderOpen size={26} aria-hidden="true" />}
  </div>
}
