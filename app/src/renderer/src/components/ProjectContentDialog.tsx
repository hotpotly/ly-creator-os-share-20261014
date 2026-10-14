import { useEffect, useRef, type ReactNode } from 'react'
import type { ProjectModuleKey } from '../../../shared/domain'
import { ProjectStageIcon } from './ProjectStageIcon'
import { X } from 'lucide-react'

/** One native modal layer; existing editors and their persistence stay unchanged. */
export function ProjectContentDialog({ title, stageKey, children, onClose }: { title: string; stageKey: ProjectModuleKey; children: ReactNode; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className="project-content-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}><header><h2><ProjectStageIcon stageKey={stageKey} />{title}</h2><button aria-label="返回项目阶段" onClick={onClose}><X size={17} /></button></header><div className="project-content-dialog-body">{children}</div></dialog>
}
