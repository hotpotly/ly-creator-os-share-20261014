import type { ProjectModuleKey, ProjectStatus } from '../../../shared/domain'

export const projectModuleLabels: Record<ProjectModuleKey, string> = {
  overview: '概览', materials: '资料', outline: '大纲', script: '文案', production: '拍摄剪辑（旧）', shooting: '拍摄', editing: '剪辑', postproduction: '后期', publishing: '发布', business: '金额', feedback: '反馈（旧）', versions: '版本'
}

const scheduleActionModules: Partial<Record<string, ProjectModuleKey>> = {
  materials: 'materials',
  outline: 'outline',
  script: 'script',
  production: 'production',
  shooting: 'shooting',
  editing: 'editing',
  postproduction: 'postproduction',
  publishing: 'publishing',
  business: 'business',
  feedback: 'outline'
}

export function projectModuleForScheduleAction(actionType: string): ProjectModuleKey {
  return scheduleActionModules[actionType] ?? 'overview'
}

export const projectStatusLabels: Record<ProjectStatus, string> = {
  candidate: '候选',
  preparing: '筹备',
  producing: '制作',
  paused: '暂停',
  published: '已发布',
  archived: '已归档'
}

const workflowTemplateLabels: Record<string, string> = {
  'template-digital-review': '数码长视频',
  'template-quick-content': '数码短视频',
  'template-system-experience': '手机系统测评',
  'template-ai-tutorial': 'AI教学',
  'template-commercial': '商单'
}

export function workflowTemplateLabel(templateId: string | null, templateName: string | null): string {
  if (templateId && workflowTemplateLabels[templateId]) return workflowTemplateLabels[templateId]
  return templateName ?? '未选模板'
}
