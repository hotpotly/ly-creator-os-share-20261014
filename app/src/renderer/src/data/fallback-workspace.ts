import { createDefaultSidebarLayout, DEFAULT_TODO_CATEGORY_COLORS, DEFAULT_TODO_CATEGORY_LABELS, DEFAULT_TODO_CATEGORY_WEIGHTS, type WorkspaceSnapshot } from '../../../shared/domain'

const fallbackDate = new Date()
const fallbackToday = `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}-${String(fallbackDate.getDate()).padStart(2, '0')}`
const fallbackTimestamp = `${fallbackToday}T08:00:00.000+08:00`

export const fallbackWorkspace: WorkspaceSnapshot = {
  today: fallbackToday,
  contentTypes: [
    { id: 'type-digital', name: '数码', description: '数码产品、配件、硬件和真实使用体验；不包含单纯的手机系统功能。', sortOrder: 10, isActive: true, defaultProjectTemplateId: 'template-digital-review' },
    { id: 'type-system', name: '手机系统', description: 'iOS、Android、手机系统功能、系统更新和长期体验。', sortOrder: 30, isActive: true, defaultProjectTemplateId: 'template-system-experience' },
    { id: 'type-ai', name: 'AI', description: 'AI工具、模型、自动化、生成式创作和AI实战过程。', sortOrder: 40, isActive: true, defaultProjectTemplateId: 'template-ai-tutorial' },
    { id: 'type-unboxing', name: '开箱', description: '产品开箱与初次体验。', sortOrder: 45, isActive: true, defaultProjectTemplateId: 'template-digital-review' },
    { id: 'type-undetermined', name: '待定方向', description: '题材尚未明确。', sortOrder: 90, isActive: true, defaultProjectTemplateId: null }
  ],
  generalRecordCategories: [
    { id: 'general-daily-reflection', name: '日常感悟', description: '个人生活感受、随想、情绪和日常观察。', sortOrder: 10, isActive: true },
    { id: 'general-investment-observation', name: '投资观察', description: '股票、基金、财报、估值和市场变化的个人观察；不表示投资建议。', sortOrder: 20, isActive: true },
    { id: 'general-work-method', name: '工作方法', description: '工作流、效率方法、任务管理和做事复盘。', sortOrder: 30, isActive: true }
  ],
  projectTemplates: [
    { id: 'template-digital-review', name: '数码长视频', description: '适合自用数码体验与横评。', moduleKeys: ['materials', 'script', 'shooting', 'editing', 'postproduction', 'publishing'], recommendedContentTypeIds: ['type-digital', 'type-unboxing'], recommendedVideoFormats: ['long'], sortOrder: 10, isActive: true },
    { id: 'template-commercial', name: '商单', description: '包含商单商务与完整送审流程。', moduleKeys: ['materials', 'outline', 'script', 'shooting', 'editing', 'postproduction', 'publishing', 'business'], recommendedContentTypeIds: [], recommendedProjectKinds: ['commercial'], sortOrder: 20, isActive: true },
    { id: 'template-system-experience', name: '手机系统测评', description: '适合手机系统长期体验。', moduleKeys: ['materials', 'script', 'shooting', 'editing', 'postproduction', 'publishing'], recommendedContentTypeIds: ['type-system'], sortOrder: 30, isActive: true },
    { id: 'template-ai-tutorial', name: 'AI教学', description: '从资料和大纲进入AI视频制作。', moduleKeys: ['materials', 'outline', 'script', 'shooting', 'editing', 'postproduction', 'publishing'], recommendedContentTypeIds: ['type-ai'], sortOrder: 40, isActive: true },
    { id: 'template-quick-content', name: '数码短视频', description: '轻量起步，只预选文案和发布。', moduleKeys: ['script', 'publishing'], recommendedContentTypeIds: [], recommendedVideoFormats: ['short'], sortOrder: 50, isActive: true }
  ],
  resources: [],
  projects: [],
  businessLedger: [],
  otherIncomeCategories: [
    { id: 'income-consulting', name: '顾问服务', description: '顾问、咨询和专业服务收入', sortOrder: 10, isActive: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'income-course', name: '课程讲座', description: '课程、培训和讲座收入', sortOrder: 20, isActive: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'income-licensing', name: '内容授权', description: '内容、素材和版权授权收入', sortOrder: 30, isActive: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'income-platform-share', name: '平台分成', description: '平台激励、创作分成和流量收益', sortOrder: 40, isActive: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'income-launch-event', name: '发布会', description: '品牌发布会、活动出席和现场内容合作收入', sortOrder: 50, isActive: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'income-other', name: '其他', description: '暂时无法归入其他已确认类型的收入', sortOrder: 60, isActive: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp }
  ],
  otherIncomeRecords: [],
  otherIncomeImportRules: [],
  otherIncomeCompanyAliases: [],
  incomeLedgerSummary: {
    combined: { totalIncomeCents: 0, actualNetIncomeCents: 0, actualNetKnownCount: 0, actualNetEligibleCount: 0, expectedIncomeCents: 0, expectedNetKnownCount: 0, expectedNetEligibleCount: 0, receivedCents: 0, pendingCents: 0, recordCount: 0 },
    business: { totalIncomeCents: 0, actualNetIncomeCents: 0, actualNetKnownCount: 0, actualNetEligibleCount: 0, expectedIncomeCents: 0, expectedNetKnownCount: 0, expectedNetEligibleCount: 0, receivedCents: 0, pendingCents: 0, recordCount: 0 },
    other: { totalIncomeCents: 0, actualNetIncomeCents: 0, actualNetKnownCount: 0, actualNetEligibleCount: 0, expectedIncomeCents: 0, expectedNetKnownCount: 0, expectedNetEligibleCount: 0, receivedCents: 0, pendingCents: 0, recordCount: 0 }
  },
  captures: [],
  captureSummary: { creativeDay: fallbackToday, newRecords: 0, pendingReview: 0, todayAutoProcessed: 0 },
  topics: [],
  topicStages: [
    { id: 'topic-stage-new', name: '新候选', nextActionLabel: '进入待评估', position: 10, role: 'standard', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-stage-evaluation', name: '待评估', nextActionLabel: '决定是否制作', position: 20, role: 'standard', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-stage-decided', name: '已决定制作', nextActionLabel: '建立内容项目', position: 30, role: 'standard', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-stage-created', name: '已立项', nextActionLabel: null, position: 40, role: 'project_created', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-stage-completed', name: '已完成', nextActionLabel: null, position: 50, role: 'completed', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-stage-archived', name: '已归档', nextActionLabel: null, position: 60, role: 'archived', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-stage-shelved', name: '已搁置', nextActionLabel: null, position: 70, role: 'shelved', createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp }
  ],
  topicColumns: [
    { id: 'topic-column-title', name: '选题名称', position: 10, dataType: 'text', builtinKey: 'title', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-importance', name: '重要程度', position: 20, dataType: 'number', builtinKey: 'importance', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-direction', name: '内容方向', position: 30, dataType: 'relation', builtinKey: 'direction', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-stage', name: '阶段', position: 40, dataType: 'relation', builtinKey: 'stage', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-start', name: '开始时间', position: 50, dataType: 'date', builtinKey: 'start', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-expected', name: '目标日', position: 60, dataType: 'date', builtinKey: 'expected', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-actual', name: '实际完成', position: 70, dataType: 'date', builtinKey: 'actual', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-variance', name: '提前/延迟', position: 80, dataType: 'number', builtinKey: 'variance', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-next', name: '下一步', position: 90, dataType: 'action', builtinKey: 'next', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-inspirations', name: '关联灵感', position: 100, dataType: 'relation', builtinKey: 'inspirations', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-video', name: '视频形式', position: 110, dataType: 'relation', builtinKey: 'video', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp },
    { id: 'topic-column-kind', name: '项目类型', position: 120, dataType: 'relation', builtinKey: 'kind', isVisible: true, createdAt: fallbackTimestamp, updatedAt: fallbackTimestamp }
  ],
  discardedFilterCandidates: [],
  schedules: [],
  todos: [],
  dailyWorkLog: { day: fallbackToday, selfMediaMinutes: 0, aiMinutes: 0, otherWorkMinutes: 0, updatedAt: '' },
  productionChecklist: [],
  tasks: [],
  providerCapabilities: [],
  preferences: {
    theme: 'light', visualStyle: 'warm', homeSplit: 63, homeTodoView: 'time', lastProjectModuleById: {},
    workbenchLayout: 'equal', workbenchModelSplit: 50, workbenchMergedSplit: 67, workbenchMergedVisible: true,
    workbenchView: 'dual', workbenchSingleProvider: 'codex', workbenchDualActiveProvider: 'claude', workbenchConversationTab: 'claude', workbenchHiddenProviders: [], workbenchConversationScrollTops: { claude: 0, codex: 0, current: 0 }, workbenchComparisonSide: 'claude',
    workbenchComparisonSplit: 50, workbenchComparisonPreviewSplit: 29, workbenchComparisonScrollTop: 0,
    workbenchComparisonColorMode: 'all', workbenchComparisonDocumentMode: 'groups', workbenchComparisonUseOutline: true, workbenchComparisonSplitScope: 'current', workbenchDraftCurrentScrollTop: 0,
    workbenchPrimaryView: 'conversation', workbenchComparisonKind: 'drafts', workbenchDraftSurface: 'organize',
    workbenchVersionSurface: 'compare', workbenchVersionMobileSide: 'left', workbenchVersionSourcePanelOpen: true, workbenchVersionDiffVisible: true, workbenchVersionScrollTops: { left: 0, right: 0 }, workbenchVersionCurrentScrollTop: 0,
    workbenchMaterialTab: 'ai', workbenchMaterialScrollTops: { source: 0, ai: 0, current: 0 }, workbenchCodexModel: null,
    sidebarCollapsed: false, sidebarWidth: 220, sidebarPinnedExpanded: true, sidebarStageShortcutsExpanded: true, pinnedProjectOrder: [], pinnedProjectStages: [], inspectorWidth: 310,
    scheduleUnscheduledWidth: 176, scheduleUnscheduledCollapsed: false, scheduleInspectorCollapsed: false,
    sidebarLayout: createDefaultSidebarLayout(),
    workspaceTabs: [{ id: 'workspace-home', history: ['#/home'], historyIndex: 0, lastUsedAt: '' }], activeWorkspaceTabId: 'workspace-home',
    defaultPlatforms: ['B站', '小红书', '抖音', '头条', '微博'], businessPlatforms: ['B站', '小红书', '抖音', '油管', '线下直签', '其他'], otherIncomeSourceTemplates: [], defaultContentTypeId: null, autoClassifyNewProject: true,
    computerUsePublishBilibili: false,
    weatherCity: '',
    weatherPreviewCondition: null,
    weatherPreviewPeriod: null,
    todoCategoryColors: { ...DEFAULT_TODO_CATEGORY_COLORS },
    todoCategoryLabels: { ...DEFAULT_TODO_CATEGORY_LABELS },
    todoCategoryWeights: { ...DEFAULT_TODO_CATEGORY_WEIGHTS },
    todoCategoryMemories: []
  }
}
