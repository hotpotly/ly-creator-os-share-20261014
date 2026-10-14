import type BetterSqlite3 from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type {
  ContentConstraint,
  ContentInstructionRequest,
  ContentInstructionRequestRecord,
  ContentInstructionRequestTarget,
  ContentInstructionRequestTargetEvent,
  ContentInstructionSurface,
  ContentInstructionTargetPreparation,
  ContentSourceSelectionSnapshot,
  ContentTargetSnapshot,
  FileReferenceInput,
  FrozenStructuredReference,
  ProjectDetail,
  ProjectReferenceRolePreference,
  ScriptMaterialWorkspace,
  StructuredReferenceCatalogItem,
  StructuredReferenceSourceKind,
  StructuredReferenceScope,
  ResolvedStructuredReferenceRole,
  StructuredReferenceUse,
  TaskResourceSnapshot
} from '../../shared/domain'
import {
  PROJECT_FRAMEWORK_MATERIAL_ID_PREFIX,
  PROJECT_SCRATCH_NOTE_MATERIAL_ID_PREFIX,
  resolveStructuredReferenceRoles
} from '../../shared/domain'
import { richTextHtmlToPlainText, sourceContentToRichTextHtml } from '../../shared/script-version-content'
import {
  contentInstructionRequestSchema,
  contentInstructionRequestTargetEventSchema,
  contentInstructionRequestTargetSchema
} from '../../shared/structured-reference-schema'
import {
  assertContentInstructionTargetsMatchRequest,
  buildContentInstructionRequest,
  canonicalSha256,
  contentInstructionCommonFingerprint,
  deepFreeze,
  estimateContentTokens,
  freezeStructuredReference,
  sha256,
  structuredReferenceSourceKey
} from '../content-instruction-request'
import {
  buildContentProviderInput,
  contentProviderInputFingerprint,
  parseContentProviderInput,
  type ContentProviderImageAsset,
  type ContentProviderInputSnapshot
} from '../content-provider-input'
import {
  availabilityForFile,
  availabilityForMaterial,
  resolveStructuredReferenceFact,
  toStructuredReferenceCatalogItem,
  type StructuredReferenceFact
} from '../content-reference-resolver'
import { allowedStructuredReferenceScopes } from '../../shared/structured-reference-composer'
import { extractCurrentScriptBlocks, extractCurrentScriptMarkProjections } from './current-script-document'
import * as schema from './schema'

export interface PrepareContentInstructionRequestInput {
  projectId: string
  sessionScope: string
  surface: ContentInstructionSurface
  supersedesRequestId?: string | null
  generationId?: string | null
  target: ContentTargetSnapshot | null
  materialRevisionId?: string | null
  briefVersionId?: string | null
  outlineVersionId?: string | null
  adoptedOpeningSnapshots?: Array<Record<string, unknown>>
  displayText: string
  editorDocument: Record<string, unknown>
  currentDocumentParagraphs?: Array<{ id: string; position: number; text: string }>
  references: StructuredReferenceUse[]
  constraints: ContentConstraint[]
  includeProjectContext: boolean
  resourceSelection?: {
    taskContentTypeId?: string
    taskTemplateId?: string | null
    excludedRecommendedResourceIds?: string[]
    manualResourceIds?: string[]
    supportingMaterialIds?: string[]
  }
  webSearchMode: ContentInstructionRequest['webSearchMode']
  factRegion: string
  factAsOf: string
  aiCount: 1 | 2
  targets: ContentInstructionTargetPreparation[]
}

export interface CreateContentReferenceGroupInput {
  projectId: string
  sessionScope: string
  name: string
  members: Array<Pick<StructuredReferenceUse, 'sourceKind' | 'sourceId' | 'sourceLocator'>>
}

interface Dependencies {
  getProject: (projectId: string) => ProjectDetail
  getMaterialWorkspace: (projectId: string) => ScriptMaterialWorkspace
  validateSourceSelection: (projectId: string, selection: ContentSourceSelectionSnapshot) => void
  buildTaskResourceSnapshot: (
    projectId: string,
    options: NonNullable<PrepareContentInstructionRequestInput['resourceSelection']> & { preserveFullContext: true }
  ) => TaskResourceSnapshot
}

interface ParsedOutlineReference {
  outlineId: string | null
  name: string | null
  items: Array<{ id: string; text: string }>
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function parseOutlineReference(value: string): ParsedOutlineReference {
  const parsed = parseJson<unknown>(value, null)
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { outlineId?: unknown; name?: unknown; items?: unknown }
    : null
  const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(record?.items) ? record.items : []
  return {
    outlineId: typeof record?.outlineId === 'string' && record.outlineId.trim() ? record.outlineId.trim() : null,
    name: typeof record?.name === 'string' && record.name.trim() ? record.name.trim() : null,
    items: rawItems.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as { id?: unknown; text?: unknown }
      const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
      const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
      return id && text ? [{ id, text }] : []
    })
  }
}

function timestamp(): string { return new Date().toISOString() }

const CONTENT_INSTRUCTION_MAX_INPUT_TOKENS = 120_000

export class ContentReferenceRepository {
  private readonly orm

  constructor(private readonly native: BetterSqlite3.Database, private readonly dependencies: Dependencies) {
    this.orm = drizzle(native, { schema })
  }

  private requireProject(projectId: string): ProjectDetail {
    return this.dependencies.getProject(projectId)
  }

  private facts(projectId: string, sessionScope?: string): StructuredReferenceFact[] {
    this.requireProject(projectId)
    const facts: StructuredReferenceFact[] = []
    const workspace = this.dependencies.getMaterialWorkspace(projectId)
    const revision = workspace.activeRevision
    if (revision) {
      facts.push({
        projectId, sourceKind: 'material_revision', sourceId: revision.id, label: `当前素材v${revision.revision}`,
        summary: `当前素材原稿·${revision.content.length}字`, group: 'current_material',
        sourceVersion: `${revision.revision}:${revision.contentHash}`, availability: 'ready', mimeType: 'text/plain',
        textContent: revision.content, managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      })
      workspace.points.forEach((point, index) => facts.push({
        projectId, sourceKind: 'material_point', sourceId: `${revision.id}:${point.id}`, label: `素材点${index + 1}`,
        summary: `素材要点·${point.sourceText.length}字`, group: 'current_material',
        sourceVersion: `${revision.contentHash}:${point.updatedAt}`, availability: 'ready', mimeType: 'text/plain',
        textContent: [point.summary, point.requirement, point.sourceText].filter(Boolean).join('\n'), managedAssetId: null,
        binarySha256: null, visualCapability: null, visualSummaryVersion: null
      }))
      workspace.drafts.forEach((draft) => draft.paragraphs.forEach((paragraph, index) => facts.push({
        projectId, sourceKind: 'material_draft_paragraph', sourceId: `${draft.id}:${paragraph.id}`,
        label: `${draft.side === 'codex' ? 'Codex' : 'Claude'}素材稿第${index + 1}段`,
        summary: `素材AI稿段落·${paragraph.text.length}字`, group: 'current_material',
        sourceVersion: `${draft.contentHash}:${draft.draftVersion}`, availability: 'ready', mimeType: 'text/plain',
        textContent: paragraph.text, managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      })))
    }

    const materials = this.orm.select().from(schema.projectMaterials)
      .where(eq(schema.projectMaterials.projectId, projectId)).orderBy(asc(schema.projectMaterials.createdAt), asc(schema.projectMaterials.id)).all()
    materials.forEach((material) => {
      const sourceKind = material.role === 'brief'
        ? 'brief' as const
        : material.id.startsWith(PROJECT_SCRATCH_NOTE_MATERIAL_ID_PREFIX) || material.id.startsWith(PROJECT_FRAMEWORK_MATERIAL_ID_PREFIX)
          ? 'scratch_note' as const : 'project_material' as const
      const file = material.fileId
        ? this.orm.select().from(schema.fileReferences).where(eq(schema.fileReferences.id, material.fileId)).get() ?? null
        : null
      const imageFile = file?.mimeType.startsWith('image/') ? file : null
      const parsedText = material.textContent?.trim() || null
      const text = parsedText
      const sourceVersion = `${material.updatedAt}:${sha256(text ?? '')}`
      const imageAvailability = imageFile ? availabilityForFile(imageFile.availability, imageFile.processState) : null
      facts.push({
        projectId, sourceKind, sourceId: material.id, label: material.title,
        summary: `${sourceKind === 'brief' ? 'Brief' : sourceKind === 'scratch_note' ? '随手笔记' : '项目资料'}·${text?.length ?? 0}字`,
        group: sourceKind === 'brief' ? 'brief' : 'project_material', sourceVersion,
        availability: imageAvailability ?? availabilityForMaterial(material.parseStatus, Boolean(text)),
        mimeType: imageFile?.mimeType ?? (text ? 'text/plain' : null),
        textContent: text,
        managedAssetId: material.fileId,
        binarySha256: imageFile?.sha256 ?? null,
        visualCapability: imageFile && imageAvailability === 'ready' ? 'native_image_input' : imageFile ? 'unreadable' : null,
        visualSummaryVersion: imageFile && parsedText ? `ocr:${sourceVersion}` : null
      })
      if (sourceKind === 'brief' && text) text.split(/\n+/gu).map((item) => item.trim()).filter(Boolean).slice(0, 500).forEach((point, index) => facts.push({
        projectId, sourceKind: 'brief_point', sourceId: `${material.id}:${index + 1}`, label: `Brief要点${index + 1}`,
        summary: `Brief分项·${point.length}字`, group: 'brief', sourceVersion, availability: 'ready', mimeType: 'text/plain',
        textContent: point, managedAssetId: material.fileId, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      }))
    })

    const assetRows = this.orm.select({ link: schema.projectAssetLinks, file: schema.fileReferences })
      .from(schema.projectAssetLinks).innerJoin(schema.fileReferences, eq(schema.projectAssetLinks.fileReferenceId, schema.fileReferences.id))
      .where(eq(schema.projectAssetLinks.projectId, projectId)).orderBy(asc(schema.projectAssetLinks.position), asc(schema.projectAssetLinks.id)).all()
    assetRows.filter(({ file }) => file.mimeType.startsWith('image/')).forEach(({ link, file }) => {
      const availability = availabilityForFile(file.availability, file.processState)
      facts.push({
        projectId, sourceKind: 'project_image', sourceId: link.id, label: file.originalName,
        summary: `项目图片·${file.mimeType || '未知格式'}`, group: 'project_image',
        sourceVersion: `${link.updatedAt}:${file.sha256}`, availability, mimeType: file.mimeType, textContent: null,
        managedAssetId: file.id, binarySha256: file.sha256,
        visualCapability: availability === 'ready' ? 'native_image_input' : 'unreadable', visualSummaryVersion: null
      })
    })

    this.orm.select().from(schema.captures).all().filter((capture) => {
      const referenced = parseJson<string[]>(capture.referencedProjectIdsJson, [])
      return capture.useStatus === 'active' && (capture.primaryProjectId === projectId || referenced.includes(projectId))
        && (capture.captureKind === 'client_feedback' || capture.captureKind === 'project_content')
    }).forEach((capture) => {
      const sourceKind = capture.captureKind === 'client_feedback'
        ? 'client_feedback' as const : capture.usageType === 'opinion' ? 'real_experience' as const : 'project_material' as const
      facts.push({
        projectId, sourceKind, sourceId: capture.id,
        label: capture.mobileTitle?.trim() || (sourceKind === 'client_feedback' ? '客户修改' : sourceKind === 'real_experience' ? '真实体验' : '项目内容'),
        summary: `${sourceKind === 'client_feedback' ? '客户修改' : sourceKind === 'real_experience' ? '真实体验' : '项目资料'}·${capture.originalContent.length}字`,
        group: sourceKind === 'client_feedback' ? 'client_feedback' : 'project_material',
        sourceVersion: `${capture.createdAt}:${sha256(capture.originalContent)}`, availability: 'ready', mimeType: 'text/plain',
        textContent: capture.originalContent, managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      })
    })

    const versions = this.orm.select().from(schema.draftVersions).where(eq(schema.draftVersions.projectId, projectId))
      .orderBy(asc(schema.draftVersions.documentType), asc(schema.draftVersions.revision), asc(schema.draftVersions.id)).all()
    versions.filter((version) => version.documentType === 'outline').forEach((version) => {
      const outline = parseOutlineReference(version.content); const contentHash = sha256(version.content)
      const outlineLabel = outline.name || version.displayName || `大纲v${version.revision}`
      facts.push({
        projectId, sourceKind: 'outline_version', sourceId: version.id, label: outlineLabel,
        summary: `大纲版本v${version.revision}·${outline.items.length}项`, group: 'outline', sourceVersion: `${version.revision}:${contentHash}`,
        availability: outline.items.length ? 'ready' : 'unsupported', mimeType: 'application/json', textContent: version.content,
        managedAssetId: version.sourceFileId, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      })
      outline.items.slice(0, 500).forEach((item, index) => facts.push({
        projectId, sourceKind: 'outline_point', sourceId: `${version.id}:${item.id}`, label: `${outlineLabel}·第${index + 1}项`,
        summary: `大纲要点·${item.text.length}字`, group: 'outline', sourceVersion: `${version.revision}:${contentHash}`,
        availability: 'ready', mimeType: 'text/plain', textContent: item.text, managedAssetId: null, binarySha256: null,
        visualCapability: null, visualSummaryVersion: null
      }))
    })
    versions.filter((version) => version.documentType === 'script' && version.kind !== 'conversation_snapshot').forEach((version) => {
      const text = richTextHtmlToPlainText(sourceContentToRichTextHtml(version.workspaceContent ?? version.content))
      facts.push({
        projectId, sourceKind: 'draft_version', sourceId: version.id, label: version.displayName || `文案v${version.revision}`,
        summary: `历史文案·v${version.revision}·${text.length}字`, group: 'history',
        sourceVersion: `${version.revision}:${sha256(text)}`, availability: 'ready', mimeType: 'text/plain', textContent: text,
        managedAssetId: version.sourceFileId, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      })
    })

    const temporaryRows = sessionScope ? this.orm.select({ attachment: schema.contentTemporaryAttachments, file: schema.fileReferences })
      .from(schema.contentTemporaryAttachments).innerJoin(schema.fileReferences, eq(schema.contentTemporaryAttachments.fileReferenceId, schema.fileReferences.id))
      .where(and(eq(schema.contentTemporaryAttachments.projectId, projectId), eq(schema.contentTemporaryAttachments.sessionScope, sessionScope)))
      .orderBy(asc(schema.contentTemporaryAttachments.createdAt), asc(schema.contentTemporaryAttachments.id)).all() : []
    const currentTime = timestamp()
    temporaryRows.forEach(({ attachment, file }) => {
      const expired = attachment.expiresAt ? attachment.expiresAt <= currentTime : false
      const fileAvailability = availabilityForFile(file.availability, file.processState)
      const availability = expired || attachment.state === 'expired' ? 'missing' as const
        : attachment.state === 'processing' ? 'processing' as const
          : attachment.state === 'missing' ? 'missing' as const
            : fileAvailability !== 'ready' ? fileAvailability
              : file.mimeType.startsWith('image/') ? 'ready' as const : 'stored_only' as const
      facts.push({
        projectId, sourceKind: 'temporary_attachment', sourceId: attachment.id, label: file.originalName,
        summary: `本次附件·${file.mimeType || '未知格式'}`, group: 'temporary',
        sourceVersion: `${attachment.updatedAt}:${attachment.contentSha256}`, availability, mimeType: file.mimeType,
        textContent: null, managedAssetId: file.id, binarySha256: file.sha256,
        visualCapability: file.mimeType.startsWith('image/') && availability === 'ready' ? 'native_image_input' : file.mimeType.startsWith('image/') ? 'unreadable' : null,
        visualSummaryVersion: null
      })
    })

    this.orm.select({ reference: schema.projectResourceReferences, resource: schema.resources })
      .from(schema.projectResourceReferences).innerJoin(schema.resources, eq(schema.projectResourceReferences.resourceId, schema.resources.id))
      .where(and(eq(schema.projectResourceReferences.projectId, projectId), eq(schema.projectResourceReferences.enabled, true)))
      .orderBy(asc(schema.resources.name), asc(schema.resources.id)).all()
      .filter(({ reference, resource }) => reference.role === 'reference_style' || resource.resourceType === 'style_profile')
      .forEach(({ resource }) => facts.push({
        projectId, sourceKind: 'style_resource', sourceId: resource.id, label: resource.name,
        summary: `风格资源·v${resource.version}`, group: 'style', sourceVersion: String(resource.version),
        availability: resource.isActive ? 'ready' : 'stale', mimeType: 'application/json',
        textContent: JSON.stringify({ description: resource.description, payload: parseJson<Record<string, unknown>>(resource.payloadJson, {}) }),
        managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null
      }))
    return facts
  }

  listCatalog(projectId: string, sessionScope: string, query = ''): StructuredReferenceCatalogItem[] {
    const normalizedSessionScope = sessionScope.trim()
    if (!normalizedSessionScope || normalizedSessionScope.length > 120) throw new Error('引用目录会话范围无效')
    const facts = this.facts(projectId, normalizedSessionScope)
    const searchTextByKey = new Map(facts.map((fact) => [
      structuredReferenceSourceKey(projectId, fact.sourceKind, fact.sourceId),
      `${fact.label}\n${fact.summary}\n${fact.textContent ?? ''}`.toLocaleLowerCase('zh-CN')
    ]))
    const items = facts.map(toStructuredReferenceCatalogItem)
    this.orm.select().from(schema.contentReferenceGroups).where(eq(schema.contentReferenceGroups.projectId, projectId))
      .orderBy(asc(schema.contentReferenceGroups.createdAt), asc(schema.contentReferenceGroups.id)).all().forEach((group) => items.push({
        sourceKey: structuredReferenceSourceKey(projectId, 'project_material_group', group.id), sourceKind: 'project_material_group',
        sourceId: group.id, label: group.name, summary: `资料组·v${group.revision}`, group: 'material_group',
        sourceVersion: String(group.revision), availability: 'ready', mimeType: null, contentCharacters: 0,
        rememberedUse: null, rememberedUses: [], lastUsedAt: null
      }))
    const preferences = new Map<string, Array<typeof schema.projectReferenceRolePreferences.$inferSelect>>()
    this.orm.select().from(schema.projectReferenceRolePreferences)
      .where(eq(schema.projectReferenceRolePreferences.projectId, projectId))
      .orderBy(desc(schema.projectReferenceRolePreferences.updatedAt), asc(schema.projectReferenceRolePreferences.scope)).all()
      .forEach((preference) => preferences.set(preference.sourceKey, [...(preferences.get(preference.sourceKey) ?? []), preference]))
    items.forEach((item) => {
      const sourcePreferences = preferences.get(item.sourceKey) ?? []
      item.rememberedUses = sourcePreferences.map((preference) => ({
        role: preference.role as ResolvedStructuredReferenceRole,
        aspect: preference.aspect,
        scope: preference.scope as StructuredReferenceScope
      }))
      const preference = sourcePreferences[0]
      item.rememberedUse = preference ? {
        role: preference.role as ResolvedStructuredReferenceRole,
        aspect: preference.aspect,
        scope: preference.scope as StructuredReferenceScope
      } : null
    })
    const recentUses = new Map(this.orm.select().from(schema.projectReferenceRecentUses)
      .where(eq(schema.projectReferenceRecentUses.projectId, projectId)).all()
      .map((use) => [use.sourceKey, use.lastUsedAt]))
    items.forEach((item) => { item.lastUsedAt = recentUses.get(item.sourceKey) ?? null })
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    const filtered = normalizedQuery
      ? items.filter((item) => (searchTextByKey.get(item.sourceKey) ?? `${item.label}\n${item.summary}`.toLocaleLowerCase('zh-CN')).includes(normalizedQuery))
      : items
    const groupOrder: StructuredReferenceCatalogItem['group'][] = [
      'current_material', 'brief', 'client_feedback', 'project_material', 'project_image', 'material_group',
      'outline', 'history', 'style', 'conversation', 'temporary'
    ]
    return filtered.sort((left, right) => groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group)
      || (left.label < right.label ? -1 : left.label > right.label ? 1 : left.sourceKey < right.sourceKey ? -1 : 1)).slice(0, 2_000)
  }

  setRolePreference(input: {
    projectId: string
    sourceKind: StructuredReferenceSourceKind
    sourceId: string
    role: ResolvedStructuredReferenceRole
    aspect: string | null
    scope: StructuredReferenceScope
  }): ProjectReferenceRolePreference {
    this.requireProject(input.projectId)
    const item = this.listCatalog(input.projectId, 'project-role-preference')
      .find((candidate) => candidate.sourceKind === input.sourceKind && candidate.sourceId === input.sourceId)
    if (!item) throw new Error('要记住用途的引用不存在或不属于当前项目')
    if (!allowedStructuredReferenceScopes(item.sourceKind).includes(input.scope)) throw new Error('引用作用范围与来源不匹配')
    const now = timestamp()
    const existing = this.orm.select().from(schema.projectReferenceRolePreferences).where(and(
      eq(schema.projectReferenceRolePreferences.projectId, input.projectId),
      eq(schema.projectReferenceRolePreferences.sourceKey, item.sourceKey),
      eq(schema.projectReferenceRolePreferences.scope, input.scope)
    )).get()
    this.orm.insert(schema.projectReferenceRolePreferences).values({
      projectId: input.projectId,
      sourceKey: item.sourceKey,
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      role: input.role,
      aspect: input.aspect,
      scope: input.scope,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }).onConflictDoUpdate({
      target: [schema.projectReferenceRolePreferences.projectId, schema.projectReferenceRolePreferences.sourceKey, schema.projectReferenceRolePreferences.scope],
      set: { sourceKind: item.sourceKind, sourceId: item.sourceId, role: input.role, aspect: input.aspect, updatedAt: now }
    }).run()
    return {
      projectId: input.projectId,
      sourceKey: item.sourceKey,
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      role: input.role,
      aspect: input.aspect,
      scope: input.scope,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
  }

  removeRolePreference(projectId: string, sourceKind: StructuredReferenceSourceKind, sourceId: string, scope: StructuredReferenceScope): void {
    this.requireProject(projectId)
    const sourceKey = structuredReferenceSourceKey(projectId, sourceKind, sourceId)
    this.orm.delete(schema.projectReferenceRolePreferences).where(and(
      eq(schema.projectReferenceRolePreferences.projectId, projectId),
      eq(schema.projectReferenceRolePreferences.sourceKey, sourceKey),
      eq(schema.projectReferenceRolePreferences.scope, scope)
    )).run()
  }

  createGroup(input: CreateContentReferenceGroupInput): StructuredReferenceCatalogItem {
    this.requireProject(input.projectId)
    const name = input.name.replace(/[\r\n\t]+/gu, ' ').trim()
    if (!name || name.length > 120) throw new Error('资料组名称必须在1到120字之间')
    if (input.members.length < 1 || input.members.length > 100) throw new Error('资料组成员数量无效')
    if (input.members.some((member) => member.sourceKind === 'project_material_group')) throw new Error('资料组暂不支持嵌套')
    if (input.members.some((member) => member.sourceKind === 'temporary_attachment')) {
      throw new Error('临时附件不能保存到项目资料组，请先转为项目资料')
    }
    const sessionScope = input.sessionScope.trim()
    if (!sessionScope || sessionScope.length > 120) throw new Error('资料组会话范围无效')
    const facts = this.facts(input.projectId, sessionScope)
    input.members.forEach((member, index) => resolveStructuredReferenceFact(input.projectId, {
      occurrenceId: `group-member-${index + 1}`, sourceKey: structuredReferenceSourceKey(input.projectId, member.sourceKind, member.sourceId),
      sourceKind: member.sourceKind, sourceId: member.sourceId, sourceLocator: member.sourceLocator, label: `资料组成员${index + 1}`,
      role: 'ordinary_reference', roleOrigin: 'manual', runtimeRole: 'ordinary_reference', aspect: null, scope: 'whole_source',
      ruleEvidence: null, ruleConflicts: [], manualConflictResolution: null
    }, facts))
    const createdAt = timestamp(); const id = randomUUID()
    this.native.transaction(() => {
      this.orm.insert(schema.contentReferenceGroups).values({ id, projectId: input.projectId, name, revision: 1, createdAt, updatedAt: createdAt }).run()
      this.orm.insert(schema.contentReferenceGroupMembers).values(input.members.map((member, index) => ({
        id: randomUUID(), groupId: id, position: index, sourceKind: member.sourceKind, sourceId: member.sourceId,
        sourceLocatorJson: JSON.stringify(member.sourceLocator), createdAt
      }))).run()
    })()
    return this.listCatalog(input.projectId, sessionScope).find((item) => item.sourceId === id && item.sourceKind === 'project_material_group')!
  }

  createTemporaryAttachment(input: { projectId: string; sessionScope: string; file: FileReferenceInput; expiresAt?: string | null }): StructuredReferenceCatalogItem {
    this.requireProject(input.projectId)
    const sessionScope = input.sessionScope.trim()
    if (!sessionScope || sessionScope.length > 120) throw new Error('临时附件会话范围无效')
    if (!/^[a-f0-9]{64}$/u.test(input.file.sha256)) throw new Error('临时附件哈希无效')
    const createdAt = timestamp(); const id = randomUUID()
    const sourceBookmark = input.file.sourceBookmark ?? input.file.encryptedSourcePath ?? null
    this.native.transaction(() => {
      this.orm.insert(schema.fileReferences).values({
        ...input.file,
        kind: input.file.kind ?? 'file', managedLocator: input.file.managedLocator ?? input.file.relativePath,
        sourceBookmark, sourceOrigin: input.file.sourceOrigin ?? (sourceBookmark ? 'file_picker' : 'managed_import'),
        availability: input.file.availability ?? 'available', processState: input.file.processState ?? 'ready',
        capabilitiesJson: input.file.capabilitiesJson ?? (input.file.mimeType.startsWith('image/') ? '["preview","ocr"]' : '["preview"]'),
        updatedAt: input.file.updatedAt ?? input.file.createdAt
      }).onConflictDoNothing().run()
      const storedFile = this.orm.select().from(schema.fileReferences).where(eq(schema.fileReferences.id, input.file.id)).get()
      if (!storedFile || storedFile.sha256 !== input.file.sha256) throw new Error('临时附件与已存文件身份冲突')
      this.orm.insert(schema.contentTemporaryAttachments).values({
        id, projectId: input.projectId, sessionScope, fileReferenceId: input.file.id, contentSha256: input.file.sha256,
        state: 'ready', expiresAt: input.expiresAt ?? null, createdAt, updatedAt: createdAt
      }).run()
    })()
    return this.listCatalog(input.projectId, sessionScope).find((item) => item.sourceId === id && item.sourceKind === 'temporary_attachment')!
  }

  resolve(projectId: string, sessionScope: string, references: StructuredReferenceUse[]): FrozenStructuredReference[] {
    const normalizedSessionScope = sessionScope.trim()
    if (!normalizedSessionScope || normalizedSessionScope.length > 120) throw new Error('引用解析会话范围无效')
    if (references.length > 500) throw new Error('单次引用不能超过500项')
    if (new Set(references.map((reference) => reference.occurrenceId)).size !== references.length) throw new Error('引用出现位置重复')
    if (new Set(references.map((reference) => `${reference.sourceKey}:${reference.scope}`)).size !== references.length) {
      throw new Error('同一资料的同一作用范围不能重复引用')
    }
    const facts = this.facts(projectId, normalizedSessionScope)
    return references.map((use) => {
      if (!allowedStructuredReferenceScopes(use.sourceKind, use.sourceLocator).includes(use.scope)) {
        throw new Error(`引用“${use.label}”的作用范围与来源不匹配`)
      }
      const submittedMemory = use.projectMemory
        ?? (use.roleOrigin === 'project_memory' && use.role !== 'pending'
          ? { role: use.role, aspect: use.aspect, scope: use.scope }
          : null)
      if (submittedMemory) {
        const memory = this.orm.select().from(schema.projectReferenceRolePreferences).where(and(
          eq(schema.projectReferenceRolePreferences.projectId, projectId),
          eq(schema.projectReferenceRolePreferences.sourceKey, use.sourceKey),
          eq(schema.projectReferenceRolePreferences.scope, submittedMemory.scope)
        )).get()
        if (
          !memory || memory.sourceKind !== use.sourceKind || memory.sourceId !== use.sourceId
          || memory.role !== submittedMemory.role || memory.aspect !== submittedMemory.aspect || memory.scope !== submittedMemory.scope
        ) throw new Error(`引用“${use.label}”提交的项目记忆不存在或已变化`)
      }
      if (!use.runtimeRole || (use.role === 'pending' && use.roleOrigin !== 'runtime_fallback')) {
        throw new Error(`请先确认引用“${use.label}”的用途`)
      }
      if (use.manualConflictResolution === 'unresolved') throw new Error(`引用“${use.label}”的手动用途与规则冲突`)
      if (use.ruleConflicts?.length) throw new Error(`引用“${use.label}”匹配到了多种用途，请手动确认`)
      if (use.sourceKind !== 'project_material_group') return resolveStructuredReferenceFact(projectId, use, facts)
      if (use.sourceKey !== structuredReferenceSourceKey(projectId, use.sourceKind, use.sourceId)) throw new Error('引用身份校验失败')
      const group = this.orm.select().from(schema.contentReferenceGroups).where(and(
        eq(schema.contentReferenceGroups.id, use.sourceId), eq(schema.contentReferenceGroups.projectId, projectId)
      )).get()
      if (!group) throw new Error('资料组不存在或不属于当前项目')
      const rows = this.orm.select().from(schema.contentReferenceGroupMembers).where(eq(schema.contentReferenceGroupMembers.groupId, group.id))
        .orderBy(asc(schema.contentReferenceGroupMembers.position), asc(schema.contentReferenceGroupMembers.id)).all()
      if (!rows.length) throw new Error('资料组已经为空')
      const members = rows.map((member, order) => resolveStructuredReferenceFact(projectId, {
        ...use, occurrenceId: `${use.occurrenceId}:member:${order}`,
        sourceKind: member.sourceKind as StructuredReferenceUse['sourceKind'], sourceId: member.sourceId,
        sourceKey: structuredReferenceSourceKey(projectId, member.sourceKind as StructuredReferenceUse['sourceKind'], member.sourceId),
        sourceLocator: parseJson<Record<string, string | number>>(member.sourceLocatorJson, {}), scope: 'whole_source'
      }, facts))
      const frozenMembers = members.map((member, order) => ({
        occurrenceId: member.occurrenceId, sourceKey: member.sourceKey, sourceKind: member.sourceKind,
        sourceVersion: member.sourceVersion, contentSha256: member.contentSha256, managedAssetId: member.managedAssetId,
        binarySha256: member.binarySha256, order
      }))
      const groupManifest = members.map((member, order) => ({
        order, sourceKey: member.sourceKey, sourceVersion: member.sourceVersion, contentSha256: member.contentSha256,
        binarySha256: member.binarySha256, content: member.frozenTextContent
      }))
      const availability = members.find((member) => member.availability !== 'ready')?.availability ?? 'ready'
      return freezeStructuredReference({
        use: { ...use, label: group.name },
        sourceVersion: `${group.revision}:${canonicalSha256(groupManifest.map((member) => ({
          order: member.order,
          sourceKey: member.sourceKey,
          sourceVersion: member.sourceVersion,
          contentSha256: member.contentSha256,
          binarySha256: member.binarySha256
        })))}`,
        textContent: JSON.stringify(groupManifest), managedAssetId: null, binarySha256: null,
        visualCapability: null, visualSummaryVersion: null, frozenMembers, availability
      })
    })
  }

  private validateTarget(projectId: string, target: ContentTargetSnapshot | null): void {
    if (!target) return
    if (target.kind === 'current_script') {
      const row = this.orm.select().from(schema.projectCurrentScriptDocuments).where(and(
        eq(schema.projectCurrentScriptDocuments.projectId, projectId),
        eq(schema.projectCurrentScriptDocuments.workingDocumentId, target.workingDocumentId)
      )).get()
      if (!row || row.revision !== target.revision || row.contentHash !== target.contentHash) throw new Error('当前文案已变化，请重新选择')
      const blocks = new Map(extractCurrentScriptBlocks(parseJson<Record<string, unknown>>(row.editorDocumentJson, {})).map((block) => [block.blockId, block.text]))
      target.blockSelections.forEach((selection) => {
        const text = blocks.get(selection.blockId)
        if (text === undefined || selection.from < 0 || selection.to <= selection.from || selection.to > text.length || text.slice(selection.from, selection.to) !== selection.text) {
          throw new Error('当前文案选区已变化，请重新选择')
        }
      })
      return
    }
    if (target.kind === 'material_draft') {
      const row = this.orm.select().from(schema.scriptMaterialDrafts).where(and(
        eq(schema.scriptMaterialDrafts.id, target.draftId), eq(schema.scriptMaterialDrafts.projectId, projectId)
      )).get()
      if (!row || row.contentHash !== target.contentHash) throw new Error('素材稿已变化，请重新选择')
      const paragraphs = new Map(parseJson<Array<{ id: string; text: string }>>(row.paragraphsJson, []).map((paragraph) => [paragraph.id, paragraph.text]))
      target.paragraphSelections.forEach((selection) => {
        const text = paragraphs.get(selection.paragraphId)
        if (text === undefined || selection.from < 0 || selection.to <= selection.from || selection.to > text.length || text.slice(selection.from, selection.to) !== selection.text) {
          throw new Error('素材稿选区已变化，请重新选择')
        }
      })
      if (target.applicationTarget) {
        const applicationTarget = target.applicationTarget
        const paragraphIds = [...new Set(target.paragraphSelections.map((selection) => selection.paragraphId))]
        if (paragraphIds.length !== 1 || applicationTarget.targetId !== `material-relation:${target.draftId}:${paragraphIds[0]}`) {
          throw new Error('素材稿应用目标身份无效，请重新选择')
        }
        const current = this.orm.select().from(schema.projectCurrentScriptDocuments)
          .where(eq(schema.projectCurrentScriptDocuments.projectId, projectId)).get()
        const projections = current ? extractCurrentScriptMarkProjections(parseJson<Record<string, unknown>>(current.editorDocumentJson, {}))
          .filter((projection) => projection.type === 'scriptMaterialRelation'
            && projection.attrs.draftId === target.draftId
            && String(projection.attrs.draftParagraphIds ?? '').split(',').includes(paragraphIds[0]!)) : []
        const actualText = projections.sort((left, right) => left.blockId.localeCompare(right.blockId) || left.start - right.start)
          .map((projection) => projection.selectedText).join('')
        if (
          applicationTarget.to <= applicationTarget.from
          || sha256(applicationTarget.selectedText) !== applicationTarget.contentHash
          || !actualText
          || applicationTarget.selectedText.replace(/\s+/gu, ' ').trim() !== actualText.replace(/\s+/gu, ' ').trim()
        ) throw new Error('素材稿应用目标快照无效，请重新选择')
      }
      return
    }
    if (target.kind === 'draft_comparison') {
      const groupRow = this.orm.select({ group: schema.draftAlignmentGroups, session: schema.draftComparisonSessions })
        .from(schema.draftAlignmentGroups)
        .innerJoin(schema.draftComparisonSessions, eq(schema.draftAlignmentGroups.sessionId, schema.draftComparisonSessions.id))
        .where(and(eq(schema.draftAlignmentGroups.id, target.groupId), eq(schema.draftComparisonSessions.projectId, projectId))).get()
      if (!groupRow) throw new Error('对照组不存在或不属于当前项目')
      target.sourceSelections.forEach((selection) => this.dependencies.validateSourceSelection(projectId, selection))
      target.sourceSelections.forEach((selection) => {
        if (selection.sourceKind === 'comparison_candidate') {
          const candidate = this.orm.select({ groupId: schema.draftCandidateRevisions.groupId }).from(schema.draftCandidateRevisions)
            .where(eq(schema.draftCandidateRevisions.id, selection.sourceId)).get()
          if (!candidate || candidate.groupId !== target.groupId) throw new Error('对照候选不属于当前对照组')
        }
        if (selection.sourceKind === 'comparison_source') {
          const source = this.orm.select().from(schema.draftSourceSnapshots).where(and(
            eq(schema.draftSourceSnapshots.id, selection.sourceId),
            eq(schema.draftSourceSnapshots.sessionId, groupRow.session.id)
          )).get()
          const paragraphIds = source?.side === 'claude'
            ? parseJson<string[]>(groupRow.group.claudeParagraphIdsJson, [])
            : parseJson<string[]>(groupRow.group.codexParagraphIdsJson, [])
          if (!source || !paragraphIds.includes(selection.blockId)) throw new Error('对照来源选区不属于当前对照组')
        }
      })
      return
    }
    if (target.kind === 'version_comparison') {
      target.sourceSelections.forEach((selection) => this.dependencies.validateSourceSelection(projectId, selection))
      return
    }
    const versions = this.orm.select().from(schema.draftVersions).where(and(
      eq(schema.draftVersions.projectId, projectId), eq(schema.draftVersions.documentType, 'outline')
    )).orderBy(desc(schema.draftVersions.revision)).all()
    const version = versions.find((candidate) => candidate.id === target.outlineId || parseOutlineReference(candidate.content).outlineId === target.outlineId)
    if (!version) throw new Error('大纲不存在或不属于当前项目')
    const pointIds = new Set(parseOutlineReference(version.content).items.map((item) => item.id))
    if (target.moduleIds.length || target.pointIds.some((id) => !pointIds.has(id))) throw new Error('大纲目标已变化，请重新选择')
  }

  private validateSurfaceTarget(surface: ContentInstructionSurface, target: ContentTargetSnapshot | null): void {
    const allowedKinds: Record<ContentInstructionSurface, Array<ContentTargetSnapshot['kind'] | 'none'>> = {
      outline_conversation: ['none', 'outline'],
      outline_generation: ['none', 'outline'],
      outline_rewrite: ['outline'],
      outline_comparison: ['outline'],
      script_conversation: ['none', 'current_script'],
      script_material_first_draft: ['none'],
      script_material_chat: ['none', 'material_draft'],
      script_material_rewrite: ['material_draft'],
      script_draft_comparison: ['draft_comparison'],
      script_version_comparison: ['version_comparison'],
      current_script_rewrite: ['current_script']
    }
    const kind = target?.kind ?? 'none'
    if (!allowedKinds[surface].includes(kind)) throw new Error('输入入口与修改目标不一致，请重新发起')
  }

  private assertCanonicalReferenceLabels(projectId: string, sessionScope: string, references: StructuredReferenceUse[]): void {
    const labels = new Map(this.facts(projectId, sessionScope).map((fact) => [
      `${fact.sourceKind}\u0000${fact.sourceId}`,
      toStructuredReferenceCatalogItem(fact).label
    ]))
    this.orm.select().from(schema.contentReferenceGroups).where(eq(schema.contentReferenceGroups.projectId, projectId)).all()
      .forEach((group) => labels.set(`project_material_group\u0000${group.id}`, group.name))
    references.forEach((reference) => {
      const canonicalLabel = labels.get(`${reference.sourceKind}\u0000${reference.sourceId}`)
      if (canonicalLabel && canonicalLabel !== reference.label) {
        throw new Error(`引用“${reference.label}”的名称已变化，请重新选择`)
      }
    })
  }

  private buildProjectContextSnapshot(
    project: ProjectDetail,
    materialRevision: typeof schema.scriptMaterialRevisions.$inferSelect | null,
    briefVersion: typeof schema.projectMaterials.$inferSelect | null,
    outlineVersion: typeof schema.draftVersions.$inferSelect | null,
    references: FrozenStructuredReference[],
    taskResourceSnapshot: TaskResourceSnapshot
  ): Record<string, unknown> {
    const generationContext = taskResourceSnapshot.generationContext
    if (!generationContext) throw new Error('项目上下文快照缺少既有任务资源准备结果')
    const explicitWholeSourceKeys = new Set(references.flatMap((reference) => [
      ...(reference.scope === 'whole_source' ? [reference.sourceKey] : []),
      ...reference.frozenMembers.map((member) => member.sourceKey)
    ]))
    const materialById = new Map(project.materials.map((material) => [material.id, material]))
    const brief = generationContext.brief ? {
      ...structuredClone(generationContext.brief),
      items: generationContext.brief.items.map((item) => {
        const explicitlyReferenced = explicitWholeSourceKeys.has(structuredReferenceSourceKey(project.id, 'brief', item.id))
        return {
          ...structuredClone(item),
          content: explicitlyReferenced ? null : item.content,
          contentSha256: sha256(item.content),
          includedBy: explicitlyReferenced ? 'explicit_reference' : 'project_context'
        }
      })
    } : null
    const primaryReferences = generationContext.primaryReferences.map((reference) => {
      const material = materialById.get(reference.projectMaterialId)
      const sourceKind = reference.fileReferenceId
        ? 'project_image' as const
        : material?.role === 'brief'
          ? 'brief' as const
          : reference.projectMaterialId.startsWith(PROJECT_SCRATCH_NOTE_MATERIAL_ID_PREFIX)
              || reference.projectMaterialId.startsWith(PROJECT_FRAMEWORK_MATERIAL_ID_PREFIX)
            ? 'scratch_note' as const
            : 'project_material' as const
      const sourceId = reference.fileReferenceId ? reference.linkId : reference.projectMaterialId
      const explicitlyReferenced = explicitWholeSourceKeys.has(structuredReferenceSourceKey(project.id, sourceKind, sourceId))
      return {
        ...structuredClone(reference),
        content: explicitlyReferenced ? null : reference.content,
        contentSha256: sha256(reference.content ?? ''),
        includedBy: explicitlyReferenced ? 'explicit_reference' : material?.role === 'brief' ? 'brief' : 'project_context'
      }
    })
    const selectedOutline = outlineVersion ? {
      id: outlineVersion.id,
      documentType: 'outline',
      kind: outlineVersion.kind,
      revision: outlineVersion.revision,
      content: outlineVersion.content,
      isFinal: outlineVersion.isFinal,
      createdAt: outlineVersion.createdAt
    } : structuredClone(generationContext.selectedOutline)
    return {
      ...structuredClone(generationContext),
      schemaVersion: 2,
      project: {
        ...structuredClone(generationContext.project),
        platformTargets: project.platformTargets,
        referenceRequirements: taskResourceSnapshot.referenceRequirements
      },
      materialRevision: materialRevision ? {
        id: materialRevision.id,
        revision: materialRevision.revision,
        content: materialRevision.content,
        contentSha256: materialRevision.contentHash,
        createdAt: materialRevision.createdAt
      } : null,
      selectedBriefId: briefVersion?.id ?? null,
      brief,
      selectedOutline,
      primaryReferences
    }
  }

  private validatedHistory(
    input: PrepareContentInstructionRequestInput,
    target: ContentInstructionTargetPreparation
  ): { hash: string; estimatedTokens: number } {
    const provider = target.providerSecurity.provider
    const requestedIds = [...new Set(target.historyMessageIds)]
    if (requestedIds.length !== target.historyMessageIds.length) throw new Error('Provider历史消息不能重复')
    const materialSurface = input.surface === 'script_material_chat'
      || input.surface === 'script_material_rewrite'
      || input.surface === 'script_material_first_draft'
    const outlineSurface = input.surface === 'outline_conversation'
      || input.surface === 'outline_generation'
      || input.surface === 'outline_rewrite'
      || input.surface === 'outline_comparison'
    let snapshot: Record<string, unknown>
    if (outlineSurface) {
      if (requestedIds.length || target.historyThreadId || target.providerThreadId) {
        throw new Error('大纲入口不能复用文案Provider历史')
      }
      snapshot = { kind: 'outline', messages: [] }
    } else if (materialSurface) {
      if (!input.materialRevisionId) throw new Error('素材任务必须冻结素材修订')
      if (target.historyThreadId) throw new Error('素材对话不使用文案Provider历史线程')
      if (target.providerThreadId) throw new Error('素材对话不能引用其他Provider线程')
      const expectedSide = provider === 'codex_cli' ? 'codex' : 'claude'
      const rows = requestedIds.length ? this.orm.select({
        id: schema.scriptMaterialMessages.id,
        content: schema.scriptMaterialMessages.content,
        role: schema.scriptMaterialMessages.role,
        side: schema.scriptMaterialMessages.side,
        revisionId: schema.scriptMaterialMessages.revisionId
      }).from(schema.scriptMaterialMessages).where(and(
        eq(schema.scriptMaterialMessages.projectId, input.projectId),
        eq(schema.scriptMaterialMessages.revisionId, input.materialRevisionId),
        inArray(schema.scriptMaterialMessages.id, requestedIds)
      )).all() : []
      const valid = rows.filter((row) => row.side === expectedSide)
      if (valid.some((row) => row.role !== 'user' && row.role !== 'assistant')) {
        throw new Error('素材Provider历史消息角色无效')
      }
      const byId = new Map(valid.map((row) => [row.id, { role: row.role, content: row.content }]))
      if (valid.length !== requestedIds.length || requestedIds.some((id) => !byId.has(id))) {
        throw new Error('Provider历史消息不属于当前素材修订或AI侧')
      }
      snapshot = {
        kind: 'material',
        revisionId: input.materialRevisionId,
        provider,
        messages: requestedIds.map((id) => ({ id, ...byId.get(id)! }))
      }
    } else {
      const expectedSurface = input.surface === 'script_version_comparison' ? 'version_compare' : 'conversation'
      if (requestedIds.length && !target.historyThreadId) throw new Error('Provider历史消息必须绑定明确的本地线程')
      const rows = requestedIds.length ? this.orm.select({
        id: schema.scriptRevisionMessages.id,
        content: schema.scriptRevisionMessages.content,
        role: schema.scriptRevisionMessages.role,
        threadId: schema.scriptRevisionThreads.id,
        provider: schema.scriptRevisionThreads.provider,
        surface: schema.scriptRevisionThreads.surface,
        providerFingerprint: schema.scriptRevisionThreads.providerFingerprint,
        providerThreadId: schema.scriptRevisionThreads.providerThreadId,
        model: schema.scriptRevisionThreads.model,
        reasoningEffort: schema.scriptRevisionThreads.reasoningEffort
      }).from(schema.scriptRevisionMessages)
        .innerJoin(schema.scriptRevisionThreads, eq(schema.scriptRevisionMessages.threadId, schema.scriptRevisionThreads.id))
        .where(and(eq(schema.scriptRevisionThreads.projectId, input.projectId), inArray(schema.scriptRevisionMessages.id, requestedIds))).all() : []
      const valid = rows.filter((row) => row.provider === provider && row.surface === expectedSurface)
      if (valid.some((row) => row.role !== 'user' && row.role !== 'assistant')) {
        throw new Error('Provider历史消息角色无效')
      }
      const byId = new Map(valid.map((row) => [row.id, { role: row.role, content: row.content }]))
      if (valid.length !== requestedIds.length || requestedIds.some((id) => !byId.has(id))) {
        throw new Error('Provider历史消息不属于当前项目、模型或工作区')
      }
      const threadIds = new Set(valid.map((row) => row.threadId))
      if (threadIds.size > 1) throw new Error('Provider历史消息不能混用多个线程')
      if (target.historyThreadId && valid.some((row) => row.threadId !== target.historyThreadId)) {
        throw new Error('Provider历史消息不属于指定本地线程')
      }
      let thread = valid[0] ?? null
      if (!thread && (target.historyThreadId || target.providerThreadId)) {
        const identityCondition = target.historyThreadId
          ? eq(schema.scriptRevisionThreads.id, target.historyThreadId)
          : eq(schema.scriptRevisionThreads.providerThreadId, target.providerThreadId!)
        const matches = this.orm.select().from(schema.scriptRevisionThreads).where(and(
          eq(schema.scriptRevisionThreads.projectId, input.projectId),
          eq(schema.scriptRevisionThreads.provider, provider),
          eq(schema.scriptRevisionThreads.surface, expectedSurface),
          identityCondition
        )).all()
        if (matches.length !== 1) throw new Error('Provider线程不属于当前项目、模型或工作区')
        thread = {
          id: '', role: '', content: '', threadId: matches[0]!.id, provider: matches[0]!.provider,
          surface: matches[0]!.surface, providerFingerprint: matches[0]!.providerFingerprint,
          providerThreadId: matches[0]!.providerThreadId, model: matches[0]!.model,
          reasoningEffort: matches[0]!.reasoningEffort
        }
      }
      if (thread) {
        if (thread.providerFingerprint !== target.providerSecurity.fingerprint) throw new Error('Provider历史线程安全指纹已变化')
        if (target.providerThreadId && thread.providerThreadId !== target.providerThreadId) throw new Error('Provider历史线程身份不一致')
      }
      snapshot = {
        kind: 'revision',
        historyThreadId: target.historyThreadId,
        thread: thread ? {
          id: thread.threadId,
          providerThreadId: thread.providerThreadId,
          providerFingerprint: thread.providerFingerprint,
          model: thread.model,
          reasoningEffort: thread.reasoningEffort,
          surface: thread.surface
        } : null,
        messages: requestedIds.map((id) => ({ id, ...byId.get(id)! }))
      }
    }
    const serialized = JSON.stringify(snapshot)
    return { hash: canonicalSha256(snapshot), estimatedTokens: estimateContentTokens(serialized) }
  }

  prepare(input: PrepareContentInstructionRequestInput, actualTaskResourceSnapshot?: TaskResourceSnapshot | null): ContentInstructionRequestRecord {
    const project = this.requireProject(input.projectId)
    this.validateSurfaceTarget(input.surface, input.target)
    this.validateTarget(input.projectId, input.target)
    if (input.references.some((reference) => reference.scope === 'current_target') && !input.target) {
      throw new Error('当前没有可供限定的修改目标，请调整引用范围')
    }
    if (input.references.some((reference) => reference.scope === 'whole_script') && !input.surface.startsWith('script_') && input.surface !== 'current_script_rewrite') {
      throw new Error('完整文案范围只能用于文案任务')
    }
    if (input.supersedesRequestId) {
      const previous = this.orm.select().from(schema.contentInstructionRequests).where(and(
        eq(schema.contentInstructionRequests.id, input.supersedesRequestId), eq(schema.contentInstructionRequests.projectId, input.projectId)
      )).get()
      if (!previous) throw new Error('被修订的请求不存在或不属于当前项目')
    }
    const materialSurface = input.surface === 'script_material_chat'
      || input.surface === 'script_material_rewrite'
      || input.surface === 'script_material_first_draft'
    if (materialSurface && !input.materialRevisionId) throw new Error('素材任务必须冻结素材修订')
    const materialRevision = input.materialRevisionId ? this.orm.select().from(schema.scriptMaterialRevisions).where(and(
      eq(schema.scriptMaterialRevisions.id, input.materialRevisionId), eq(schema.scriptMaterialRevisions.projectId, input.projectId)
    )).get() ?? null : null
    if (input.materialRevisionId && !materialRevision) throw new Error('素材修订不存在或不属于当前项目')
    const briefVersion = input.briefVersionId ? this.orm.select().from(schema.projectMaterials).where(and(
      eq(schema.projectMaterials.id, input.briefVersionId), eq(schema.projectMaterials.projectId, input.projectId), eq(schema.projectMaterials.role, 'brief')
    )).get() ?? null : null
    if (input.briefVersionId && !briefVersion) throw new Error('Brief版本不存在或不属于当前项目')
    const outlineVersion = input.outlineVersionId ? this.orm.select().from(schema.draftVersions).where(and(
      eq(schema.draftVersions.id, input.outlineVersionId), eq(schema.draftVersions.projectId, input.projectId), eq(schema.draftVersions.documentType, 'outline')
    )).get() ?? null : null
    if (input.outlineVersionId && !outlineVersion) throw new Error('大纲版本不存在或不属于当前项目')
    if (input.target?.kind === 'outline') {
      if (!outlineVersion) throw new Error('大纲目标必须冻结明确的大纲版本')
      const outlineIdentity = parseOutlineReference(outlineVersion.content).outlineId
      if (input.target.outlineId !== outlineVersion.id && input.target.outlineId !== outlineIdentity) {
        throw new Error('大纲目标与冻结大纲版本不一致')
      }
    }
    if (input.target?.kind === 'material_draft' && materialRevision) {
      const draft = this.orm.select({ revisionId: schema.scriptMaterialDrafts.revisionId }).from(schema.scriptMaterialDrafts)
        .where(eq(schema.scriptMaterialDrafts.id, input.target.draftId)).get()
      if (!draft || draft.revisionId !== materialRevision.id) throw new Error('素材稿与本次素材修订不一致')
    }
    this.assertCanonicalReferenceLabels(input.projectId, input.sessionScope, input.references)
    const finalReferences = resolveStructuredReferenceRoles(input.displayText, input.references).map((result) => result.reference)
    const references = this.resolve(input.projectId, input.sessionScope, finalReferences)
    const occurrenceIds = new Set(references.map((reference) => reference.occurrenceId))
    if (input.constraints.some((constraint) => constraint.sourceOccurrenceId && !occurrenceIds.has(constraint.sourceOccurrenceId))) {
      throw new Error('约束引用了不存在的资料')
    }
    const taskResourceSnapshot = input.includeProjectContext
      ? actualTaskResourceSnapshot === undefined
        ? this.dependencies.buildTaskResourceSnapshot(input.projectId, {
          ...(input.resourceSelection ?? {}),
          preserveFullContext: true
        })
        : actualTaskResourceSnapshot
      : null
    if (input.includeProjectContext && !taskResourceSnapshot) throw new Error('实际AI任务缺少项目资源快照')
    const projectContextSnapshot = taskResourceSnapshot
      ? this.buildProjectContextSnapshot(project, materialRevision, briefVersion, outlineVersion, references, taskResourceSnapshot)
      : null
    const resourceSnapshot = taskResourceSnapshot ? (() => {
      const selectionSnapshot = structuredClone(taskResourceSnapshot)
      delete selectionSnapshot.generationContext
      return selectionSnapshot as unknown as Record<string, unknown>
    })() : null
    const request = contentInstructionRequestSchema.parse(buildContentInstructionRequest({
      projectId: input.projectId, sessionScope: input.sessionScope, surface: input.surface, supersedesRequestId: input.supersedesRequestId,
      generationId: input.generationId, target: input.target, materialRevisionId: input.materialRevisionId,
      materialRevisionContentHash: materialRevision?.contentHash ?? null,
      briefVersionId: input.briefVersionId, briefVersionContentHash: briefVersion ? sha256(briefVersion.textContent ?? '') : null,
      outlineVersionId: input.outlineVersionId, outlineVersionContentHash: outlineVersion ? sha256(outlineVersion.content) : null,
      adoptedOpeningSnapshots: input.adoptedOpeningSnapshots, displayText: input.displayText,
      editorDocument: input.editorDocument, currentDocumentParagraphs: input.currentDocumentParagraphs ?? [], references, constraints: input.constraints,
      projectContextSnapshot, resourceSnapshotId: resourceSnapshot ? canonicalSha256(resourceSnapshot) : null, resourceSnapshot,
      webSearchMode: input.webSearchMode, factRegion: input.factRegion, factAsOf: input.factAsOf,
      maxInputTokens: CONTENT_INSTRUCTION_MAX_INPUT_TOKENS, aiCount: input.aiCount
    }))
    assertContentInstructionTargetsMatchRequest(request, input.targets)
    const targets = input.targets.map((preparation): ContentInstructionRequestTarget => {
      if (preparation.providerConfigId !== preparation.providerSecurity.providerConfigId) throw new Error('Provider配置与安全快照不一致')
      const history = this.validatedHistory(input, preparation)
      const estimatedInputTokens = request.inputBudget.estimatedTokens + history.estimatedTokens
      if (estimatedInputTokens > request.inputBudget.maxTokens) throw new Error(`${preparation.providerSecurity.displayName}的历史消息使本次输入超过预算，请减少历史或引用`)
      return contentInstructionRequestTargetSchema.parse({
        id: randomUUID(), requestId: request.id, provider: preparation.providerSecurity.provider,
        providerConfigId: preparation.providerConfigId, providerSecurityFingerprint: preparation.providerSecurity.fingerprint,
        providerPolicyVersion: preparation.providerSecurity.policyVersion,
        runtimeVersion: preparation.providerSecurity.cliVersion, requestedModel: preparation.requestedModel,
        actualModel: preparation.actualModel,
        requestedReasoningEffort: preparation.requestedReasoningEffort,
        actualReasoningEffort: preparation.actualReasoningEffort,
        historyThreadId: preparation.historyThreadId,
        providerThreadId: preparation.providerThreadId,
        historyMessageIds: preparation.historyMessageIds, historyHash: history.hash,
        historyEstimatedTokens: history.estimatedTokens, estimatedInputTokens, taskId: null, status: 'queued'
      })
    })
    this.native.transaction(() => {
      this.orm.insert(schema.contentInstructionRequests).values({
        id: request.id, projectId: request.projectId, surface: request.surface, supersedesRequestId: request.supersedesRequestId,
        generationId: request.generationId, requestJson: JSON.stringify(request), commonFingerprint: request.commonFingerprint, createdAt: request.createdAt
      }).run()
      this.orm.insert(schema.contentInstructionRequestTargets).values(targets.map((target) => ({
        id: target.id, requestId: target.requestId, provider: target.provider, providerConfigId: target.providerConfigId,
        targetJson: JSON.stringify(target), providerSecurityFingerprint: target.providerSecurityFingerprint,
        providerPolicyVersion: target.providerPolicyVersion,
        runtimeVersion: target.runtimeVersion, requestedModel: target.requestedModel,
        requestedReasoningEffort: target.requestedReasoningEffort, historyHash: target.historyHash, createdAt: request.createdAt
      }))).run()
      references.forEach((reference) => this.orm.insert(schema.projectReferenceRecentUses).values({
        projectId: request.projectId, sourceKey: reference.sourceKey, sourceKind: reference.sourceKind,
        sourceId: reference.sourceId, lastUsedAt: request.createdAt
      }).onConflictDoUpdate({
        target: [schema.projectReferenceRecentUses.projectId, schema.projectReferenceRecentUses.sourceKey],
        set: { sourceKind: reference.sourceKind, sourceId: reference.sourceId, lastUsedAt: request.createdAt }
      }).run())
    })()
    return this.get(request.id)
  }

  get(requestId: string): ContentInstructionRequestRecord {
    const row = this.orm.select().from(schema.contentInstructionRequests).where(eq(schema.contentInstructionRequests.id, requestId)).get()
    if (!row) throw new Error('内容指令请求不存在')
    const request = contentInstructionRequestSchema.parse(parseJson<unknown>(row.requestJson, null))
    if (request.id !== row.id || request.projectId !== row.projectId || request.surface !== row.surface || request.createdAt !== row.createdAt) {
      throw new Error('内容指令请求元数据已损坏')
    }
    const fingerprint = contentInstructionCommonFingerprint(request)
    if (fingerprint !== row.commonFingerprint || fingerprint !== request.commonFingerprint) throw new Error('内容指令请求指纹校验失败')
    const targetRows = this.orm.select().from(schema.contentInstructionRequestTargets).where(eq(schema.contentInstructionRequestTargets.requestId, request.id))
      .orderBy(asc(schema.contentInstructionRequestTargets.createdAt), asc(schema.contentInstructionRequestTargets.id)).all()
    const eventRows = targetRows.length ? this.orm.select().from(schema.contentInstructionRequestTargetEvents)
      .where(inArray(schema.contentInstructionRequestTargetEvents.targetId, targetRows.map((target) => target.id)))
      .orderBy(asc(schema.contentInstructionRequestTargetEvents.targetId), asc(schema.contentInstructionRequestTargetEvents.sequence)).all() : []
    const targetEvents = eventRows.map((event) => contentInstructionRequestTargetEventSchema.parse({
      id: event.id, targetId: event.targetId, sequence: event.sequence, eventKind: event.eventKind, actualModel: event.actualModel,
      actualReasoningEffort: event.actualReasoningEffort, providerThreadId: event.providerThreadId, taskId: event.taskId,
      status: event.status, createdAt: event.createdAt
    }))
    const eventsByTarget = new Map<string, ContentInstructionRequestTargetEvent[]>()
    targetEvents.forEach((event) => eventsByTarget.set(event.targetId, [...(eventsByTarget.get(event.targetId) ?? []), event]))
    const targets = targetRows.map((targetRow) => {
      const immutableTarget = contentInstructionRequestTargetSchema.parse(parseJson<unknown>(targetRow.targetJson, null))
      if (
        immutableTarget.id !== targetRow.id || immutableTarget.requestId !== targetRow.requestId
        || immutableTarget.provider !== targetRow.provider || immutableTarget.providerConfigId !== targetRow.providerConfigId
        || immutableTarget.providerSecurityFingerprint !== targetRow.providerSecurityFingerprint
        || immutableTarget.providerPolicyVersion !== targetRow.providerPolicyVersion
        || immutableTarget.runtimeVersion !== targetRow.runtimeVersion || immutableTarget.requestedModel !== targetRow.requestedModel
        || immutableTarget.requestedReasoningEffort !== targetRow.requestedReasoningEffort || immutableTarget.historyHash !== targetRow.historyHash
      ) throw new Error('内容指令Provider目标已损坏')
      return (eventsByTarget.get(targetRow.id) ?? []).reduce<ContentInstructionRequestTarget>((current, event) => ({
        ...current, actualModel: event.actualModel ?? current.actualModel,
        actualReasoningEffort: event.actualReasoningEffort ?? current.actualReasoningEffort,
        providerThreadId: event.providerThreadId ?? current.providerThreadId,
        taskId: event.taskId ?? current.taskId, status: event.status
      }), immutableTarget)
    })
    if (targets.length !== request.aiCount) throw new Error('内容指令请求的Provider目标不完整')
    return deepFreeze({ request: structuredClone(request), targets: structuredClone(targets), targetEvents: structuredClone(targetEvents) })
  }

  getByTaskId(taskId: string): ContentInstructionRequestRecord {
    const record = this.findByTaskId(taskId)
    if (!record) throw new Error('AI任务没有关联的内容指令请求')
    return record
  }

  private assertFileBelongsToRequestProject(projectId: string, sessionScope: string, fileReferenceId: string): void {
    const linkedAsset = this.orm.select({ id: schema.projectAssetLinks.id }).from(schema.projectAssetLinks).where(and(
      eq(schema.projectAssetLinks.projectId, projectId), eq(schema.projectAssetLinks.fileReferenceId, fileReferenceId)
    )).get()
    const linkedMaterial = this.orm.select({ id: schema.projectMaterials.id }).from(schema.projectMaterials).where(and(
      eq(schema.projectMaterials.projectId, projectId), eq(schema.projectMaterials.fileId, fileReferenceId)
    )).get()
    const temporary = this.orm.select({ id: schema.contentTemporaryAttachments.id }).from(schema.contentTemporaryAttachments).where(and(
      eq(schema.contentTemporaryAttachments.projectId, projectId),
      eq(schema.contentTemporaryAttachments.sessionScope, sessionScope),
      eq(schema.contentTemporaryAttachments.fileReferenceId, fileReferenceId)
    )).get()
    if (!linkedAsset && !linkedMaterial && !temporary) throw new Error('引用图片不属于本次项目或会话')
  }

  private providerImages(
    request: ContentInstructionRequest,
    target: ContentInstructionRequestTarget
  ): ContentProviderImageAsset[] {
    const images: ContentProviderImageAsset[] = []
    const add = (input: {
      occurrenceId: string
      sourceOccurrenceId: string
      sourceKind: string
      label: string
      managedAssetId: string | null
      binarySha256: string | null
      role: Exclude<FrozenStructuredReference['runtimeRole'], null>
      scope: string
      aspect: string | null
      declaredCapability: FrozenStructuredReference['visualCapability']
      visualSummaryAvailable: boolean
      visualSummaryVersion: string | null
      availability: FrozenStructuredReference['availability']
      honorReferenceAvailability: boolean
    }): void => {
      if (!input.managedAssetId || !input.binarySha256) return
      const file = this.orm.select().from(schema.fileReferences).where(eq(schema.fileReferences.id, input.managedAssetId)).get()
      if (!file || file.sha256 !== input.binarySha256 || !file.mimeType.startsWith('image/')) {
        throw new Error(`引用图片“${input.label}”身份或哈希已经变化`)
      }
      this.assertFileBelongsToRequestProject(request.projectId, request.sessionScope, file.id)
      const fileAvailability = availabilityForFile(file.availability, file.processState)
      const effectiveAvailability = input.honorReferenceAvailability && input.availability !== 'ready'
        ? input.availability
        : fileAvailability
      const capability = effectiveAvailability !== 'ready'
        ? 'unreadable' as const
        : input.role === 'style_reference' && input.declaredCapability === 'native_image_input'
          ? input.visualSummaryAvailable && input.visualSummaryVersion?.startsWith('summary:')
            ? 'auditable_visual_summary' as const
            : input.visualSummaryAvailable && input.visualSummaryVersion?.startsWith('ocr:')
              ? 'ocr_text_only' as const
              : 'unreadable' as const
          : target.provider === 'codex_cli' && input.declaredCapability === 'native_image_input'
            ? 'native_image_input' as const
          : input.visualSummaryAvailable && input.visualSummaryVersion?.startsWith('summary:')
            ? 'auditable_visual_summary' as const
            : input.visualSummaryAvailable && input.visualSummaryVersion?.startsWith('ocr:')
              ? 'ocr_text_only' as const
              : 'unreadable' as const
      const required = input.role === 'hard_constraint'
      const purposeText = [
        request.displayText,
        input.aspect ?? '',
        ...request.constraints.filter((constraint) => !constraint.sourceOccurrenceId || constraint.sourceOccurrenceId === input.sourceOccurrenceId)
          .map((constraint) => constraint.description)
      ].join('\n')
      const requiresVisualUnderstanding = /(?:外观|材质|做工|颜色|纹理|造型|工业设计|视觉|图像内容|图片内容|画面|构图|细节)/u.test(purposeText)
      if (capability === 'unreadable') {
        throw new Error(`${required ? '硬性' : ''}图片“${input.label}”无法被${target.provider === 'codex_cli' ? 'Codex' : 'Claude'}真实读取，请移除该引用、更换AI或调整引用用途`)
      }
      if (capability === 'ocr_text_only' && requiresVisualUnderstanding) {
        throw new Error(`图片“${input.label}”本轮只能读取文字，不能满足外观、材质、做工或其他视觉理解要求，请更换AI或提供可审计视觉摘要`)
      }
      images.push({
        occurrenceId: input.occurrenceId,
        sourceOccurrenceId: input.sourceOccurrenceId,
        sourceKind: input.sourceKind,
        label: input.label,
        managedAssetId: file.id,
        binarySha256: input.binarySha256,
        mimeType: file.mimeType,
        role: input.role,
        scope: input.scope,
        required,
        capability,
        capabilityReason: capability === 'native_image_input'
          ? `${target.provider === 'codex_cli' ? 'Codex' : 'Provider'}本轮收到哈希校验后的原图`
          : capability === 'auditable_visual_summary'
            ? '本轮只收到可审计视觉摘要，没有收到原图'
            : capability === 'ocr_text_only'
              ? '本轮只能读取图片文字，不能理解外观、材质或做工'
          : input.role === 'style_reference' && input.declaredCapability === 'native_image_input'
              ? '风格图片没有可审计摘要，为避免其中的型号、价格或文字事实泄漏，本轮不向模型发送原图'
            : target.provider === 'claude_cli'
              ? '当前Claude受控执行器没有开放原生图片输入'
              : `图片状态为${effectiveAvailability}，本轮不可读取`
      })
    }
    request.references.forEach((reference) => {
      const role = reference.runtimeRole
      if (!role) throw new Error(`引用“${reference.label}”缺少运行时用途`)
      add({
        occurrenceId: reference.occurrenceId,
        sourceOccurrenceId: reference.occurrenceId,
        sourceKind: reference.sourceKind,
        label: reference.label,
        managedAssetId: reference.managedAssetId,
        binarySha256: reference.binarySha256,
        role,
        scope: reference.scope,
        aspect: reference.aspect,
        declaredCapability: reference.visualCapability,
        visualSummaryAvailable: Boolean(reference.visualSummaryVersion && reference.frozenTextContent),
        visualSummaryVersion: reference.visualSummaryVersion,
        availability: reference.availability,
        honorReferenceAvailability: true
      })
      reference.frozenMembers.forEach((member) => add({
        occurrenceId: member.occurrenceId,
        sourceOccurrenceId: reference.occurrenceId,
        sourceKind: member.sourceKind,
        label: `${reference.label}·图片${member.order + 1}`,
        managedAssetId: member.managedAssetId,
        binarySha256: member.binarySha256,
        role,
        scope: reference.scope,
        aspect: reference.aspect,
        declaredCapability: member.binarySha256 ? 'native_image_input' : null,
        visualSummaryAvailable: false,
        visualSummaryVersion: null,
        availability: reference.availability,
        honorReferenceAvailability: false
      }))
    })
    return images
  }

  bindProviderInput(requestId: string, targetId: string, taskId: string): ContentProviderInputSnapshot {
    return this.native.transaction(() => {
      const record = this.get(requestId)
      const target = record.targets.find((candidate) => candidate.id === targetId)
      if (!target || target.requestId !== requestId) throw new Error('内容Provider目标不属于本次请求')
      if (target.taskId) throw new Error('内容Provider目标已经绑定任务')
      const task = this.orm.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, taskId)).get()
      if (!task || task.projectId !== record.request.projectId || task.provider !== target.provider) {
        throw new Error('内容Provider输入与真实任务不匹配')
      }
      if (!['script_revision', 'script_material_chat', 'draft_candidate'].includes(task.taskType)) {
        throw new Error('当前写作任务不支持结构化Provider输入')
      }
      const existing = this.orm.select().from(schema.contentProviderInputSnapshots).where(or(
        eq(schema.contentProviderInputSnapshots.targetId, targetId),
        eq(schema.contentProviderInputSnapshots.taskId, taskId)
      )).get()
      if (existing) throw new Error('内容Provider输入已经冻结')
      const snapshot = buildContentProviderInput({
        request: record.request,
        target,
        images: this.providerImages(record.request, target),
        placeholderTexts: record.request.materialRevisionId
          ? this.orm.select({ content: schema.scriptMaterialRevisions.content }).from(schema.scriptMaterialRevisions)
            .where(eq(schema.scriptMaterialRevisions.id, record.request.materialRevisionId)).all()
            .map((row) => ({ text: row.content, source: 'material_source' as const }))
          : []
      })
      this.orm.insert(schema.contentProviderInputSnapshots).values({
        id: randomUUID(), requestId, targetId, projectId: record.request.projectId, taskId,
        inputJson: JSON.stringify(snapshot), inputFingerprint: snapshot.inputFingerprint, createdAt: snapshot.createdAt
      }).run()
      return snapshot
    })()
  }

  getProviderInputByTaskId(taskId: string): ContentProviderInputSnapshot | null {
    const row = this.orm.select().from(schema.contentProviderInputSnapshots)
      .where(eq(schema.contentProviderInputSnapshots.taskId, taskId)).get()
    if (!row) return null
    const snapshot = parseContentProviderInput(parseJson<unknown>(row.inputJson, null))
    if (
      snapshot.requestId !== row.requestId || snapshot.targetId !== row.targetId
      || snapshot.projectId !== row.projectId || snapshot.inputFingerprint !== row.inputFingerprint
    ) throw new Error('内容Provider分层输入元数据已损坏')
    const plain = { ...snapshot } as Partial<ContentProviderInputSnapshot>
    delete plain.inputFingerprint
    if (contentProviderInputFingerprint(plain as Omit<ContentProviderInputSnapshot, 'inputFingerprint'>) !== row.inputFingerprint) {
      throw new Error('内容Provider分层输入指纹校验失败')
    }
    return deepFreeze(snapshot)
  }

  cloneProviderInputForRetry(sourceTaskId: string, taskId: string): ContentProviderInputSnapshot | null {
    return this.native.transaction(() => {
      const sourceRow = this.orm.select().from(schema.contentProviderInputSnapshots)
        .where(eq(schema.contentProviderInputSnapshots.taskId, sourceTaskId)).get()
      if (!sourceRow) return null
      const source = this.getProviderInputByTaskId(sourceTaskId)
      if (!source) throw new Error('原任务的内容Provider输入已损坏')
      const retryTask = this.orm.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, taskId)).get()
      if (!retryTask || retryTask.projectId !== source.projectId || retryTask.provider !== source.provider) {
        throw new Error('重试任务与原Provider输入不匹配')
      }
      const existing = this.orm.select().from(schema.contentProviderInputSnapshots)
        .where(eq(schema.contentProviderInputSnapshots.taskId, taskId)).get()
      if (existing) throw new Error('重试任务已经绑定Provider输入')
      const record = this.get(sourceRow.requestId)
      const target = record.targets.find((candidate) => candidate.id === sourceRow.targetId)
      if (!target || target.taskId !== sourceTaskId || !['failed', 'canceled'].includes(target.status)) {
        throw new Error('原任务的结构化Provider目标尚未进入可重试状态')
      }
      const retryBase = {
        ...source,
        actualModel: target.actualModel ?? source.actualModel,
        actualReasoningEffort: target.actualReasoningEffort ?? source.actualReasoningEffort
      }
      const retryPlain = { ...retryBase } as Partial<ContentProviderInputSnapshot>
      delete retryPlain.inputFingerprint
      const retrySnapshot = parseContentProviderInput({
        ...retryPlain,
        inputFingerprint: contentProviderInputFingerprint(retryPlain as Omit<ContentProviderInputSnapshot, 'inputFingerprint'>)
      })
      this.orm.insert(schema.contentProviderInputSnapshots).values({
        id: randomUUID(), requestId: sourceRow.requestId, targetId: sourceRow.targetId,
        projectId: sourceRow.projectId, taskId, inputJson: JSON.stringify(retrySnapshot),
        inputFingerprint: retrySnapshot.inputFingerprint, createdAt: timestamp()
      }).run()
      this.appendEvent({
        targetId: target.id,
        eventKind: 'requeued',
        actualModel: null,
        actualReasoningEffort: null,
        providerThreadId: null,
        taskId,
        status: 'queued'
      })
      return retrySnapshot
    })()
  }

  recordProviderRuntime(
    taskId: string,
    runtime: { model: string; reasoningEffort: string; providerThreadId: string | null }
  ): ContentInstructionRequestRecord | null {
    const inputRow = this.orm.select().from(schema.contentProviderInputSnapshots)
      .where(eq(schema.contentProviderInputSnapshots.taskId, taskId)).get()
    if (!inputRow) return null
    const record = this.get(inputRow.requestId)
    const target = record.targets.find((candidate) => candidate.id === inputRow.targetId)
    if (!target) throw new Error('Provider运行时找不到冻结目标')
    if (['completed', 'failed', 'canceled'].includes(target.status) || target.taskId !== taskId) return record
    return this.appendEvent({
      targetId: target.id,
      eventKind: 'runtime_resolved',
      actualModel: runtime.model,
      actualReasoningEffort: runtime.reasoningEffort,
      providerThreadId: runtime.providerThreadId,
      taskId,
      status: target.status
    })
  }

  findByTaskId(taskId: string): ContentInstructionRequestRecord | null {
    const match = this.orm.select({ requestId: schema.contentInstructionRequestTargets.requestId })
      .from(schema.contentInstructionRequestTargetEvents)
      .innerJoin(
        schema.contentInstructionRequestTargets,
        eq(schema.contentInstructionRequestTargetEvents.targetId, schema.contentInstructionRequestTargets.id)
      )
      .where(and(
        eq(schema.contentInstructionRequestTargetEvents.taskId, taskId),
        eq(schema.contentInstructionRequestTargetEvents.eventKind, 'task_linked')
      ))
      .get()
    if (match) return this.get(match.requestId)
    const retry = this.orm.select({ requestId: schema.contentProviderInputSnapshots.requestId })
      .from(schema.contentProviderInputSnapshots)
      .where(eq(schema.contentProviderInputSnapshots.taskId, taskId)).get()
    return retry ? this.get(retry.requestId) : null
  }

  syncTaskStatus(taskId: string, taskStatus: 'queued' | 'running' | 'waiting_confirmation' | 'succeeded' | 'failed' | 'canceled'): void {
    let record = this.findByTaskId(taskId)
    if (!record) return
    let target = record.targets.find((candidate) => candidate.taskId === taskId)
    if (!target || ['completed', 'failed', 'canceled'].includes(target.status)) return
    const append = (eventKind: ContentInstructionRequestTargetEvent['eventKind'], status: ContentInstructionRequestTarget['status']): void => {
      record = this.appendEvent({
        targetId: target!.id,
        eventKind,
        actualModel: null,
        actualReasoningEffort: null,
        providerThreadId: null,
        taskId,
        status
      })
      target = record.targets.find((candidate) => candidate.id === target!.id)
    }
    if (taskStatus === 'queued' && target.status === 'running') append('requeued', 'queued')
    if ((taskStatus === 'running' || taskStatus === 'succeeded') && target.status === 'queued') append('started', 'running')
    if (taskStatus === 'succeeded' && target.status === 'running') append('completed', 'completed')
    else if (taskStatus === 'failed') append('failed', 'failed')
    else if (taskStatus === 'canceled') append('canceled', 'canceled')
  }

  appendEvent(input: Omit<ContentInstructionRequestTargetEvent, 'id' | 'sequence' | 'createdAt'> & { id?: string; createdAt?: string }): ContentInstructionRequestRecord {
    return this.native.transaction(() => {
      const targetRow = this.orm.select().from(schema.contentInstructionRequestTargets).where(eq(schema.contentInstructionRequestTargets.id, input.targetId)).get()
      if (!targetRow) throw new Error('内容指令Provider目标不存在')
      const currentRecord = this.get(targetRow.requestId)
      const current = currentRecord.targets.find((target) => target.id === input.targetId)!
      const retryRequeue = ['failed', 'canceled'].includes(current.status)
        && input.eventKind === 'requeued' && input.status === 'queued'
        && Boolean(input.taskId && current.taskId && input.taskId !== current.taskId)
      const latestRequeue = [...currentRecord.targetEvents].reverse().find((event) => (
        event.targetId === input.targetId && event.eventKind === 'requeued'
      )) ?? null
      const retryRuntimeResolution = input.eventKind === 'runtime_resolved'
        && Boolean(latestRequeue?.taskId && latestRequeue.taskId === current.taskId && input.taskId === current.taskId)
        && !currentRecord.targetEvents.some((event) => (
          event.targetId === input.targetId && event.eventKind === 'runtime_resolved'
          && latestRequeue !== null && event.sequence > latestRequeue.sequence
        ))
      if ((current.status === 'completed' || current.status === 'failed' || current.status === 'canceled') && !retryRequeue) {
        throw new Error('内容指令Provider目标已经结束')
      }
      if (current.status === 'queued' && input.status === 'completed') throw new Error('Provider目标尚未开始，不能直接完成')
      if (current.status === 'running' && input.status === 'queued' && input.eventKind !== 'requeued') throw new Error('Provider目标状态不能回退')
      const terminalStatuses = new Set<ContentInstructionRequestTarget['status']>(['completed', 'failed', 'canceled'])
      if (terminalStatuses.has(input.status) && input.eventKind !== input.status) {
        throw new Error('Provider终态必须使用对应的终态事件')
      }
      if ((input.eventKind === 'runtime_resolved' || input.eventKind === 'task_linked') && terminalStatuses.has(input.status)) {
        throw new Error('Provider运行时或任务关联事件不能结束目标')
      }
      if (input.eventKind === 'started' && input.status !== 'running') throw new Error('Provider开始事件状态无效')
      if (input.eventKind === 'requeued' && input.status !== 'queued') throw new Error('Provider重新排队事件状态无效')
      if (input.eventKind === 'completed' && input.status !== 'completed') throw new Error('Provider完成事件状态无效')
      if (input.eventKind === 'failed' && input.status !== 'failed') throw new Error('Provider失败事件状态无效')
      if (input.eventKind === 'canceled' && input.status !== 'canceled') throw new Error('Provider取消事件状态无效')
      if (input.eventKind === 'task_linked' && current.taskId) throw new Error('Provider目标已经关联任务')
      if (input.eventKind !== 'task_linked' && input.eventKind !== 'runtime_resolved' && !current.taskId) {
        throw new Error('Provider目标尚未关联真实任务')
      }
      if (current.taskId && input.taskId && current.taskId !== input.taskId && !retryRequeue) throw new Error('Provider目标不能替换已关联任务')
      if (input.taskId) {
        const task = this.orm.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, input.taskId)).get()
        if (!task) throw new Error('Provider目标关联的任务不存在')
        if (task.projectId !== currentRecord.request.projectId || task.provider !== current.provider) {
          throw new Error('Provider目标关联的任务与项目或Provider不一致')
        }
        const validTaskStatus = input.eventKind === 'task_linked'
          ? input.status === (task.status === 'running' ? 'running' : 'queued')
          : input.eventKind === 'started' ? task.status === 'running' || task.status === 'succeeded'
            : input.eventKind === 'requeued' ? task.status === 'queued'
              : input.eventKind === 'completed' ? task.status === 'succeeded'
                : input.eventKind === 'failed' ? task.status === 'failed'
                  : input.eventKind === 'canceled' ? task.status === 'canceled'
                    : true
        if (!validTaskStatus) throw new Error('Provider目标事件与真实任务状态不一致')
      } else if (input.eventKind === 'task_linked' || input.eventKind === 'started' || input.eventKind === 'requeued' || terminalStatuses.has(input.status)) {
        throw new Error('Provider任务生命周期事件必须绑定真实任务')
      }
      const immutableValues = [
        ['实际模型', current.actualModel, input.actualModel],
        ['推理档位', current.actualReasoningEffort, input.actualReasoningEffort],
        ...(!retryRuntimeResolution ? [['Provider线程', current.providerThreadId, input.providerThreadId] as const] : []),
        ...(!retryRequeue ? [['任务', current.taskId, input.taskId] as const] : [])
      ] as const
      immutableValues.forEach(([label, frozenValue, nextValue]) => {
        if (frozenValue !== null && nextValue !== null && frozenValue !== nextValue) throw new Error(`${label}已冻结，不能在后续事件中替换`)
      })
      const previousSequence = currentRecord.targetEvents.filter((event) => event.targetId === input.targetId).at(-1)?.sequence ?? 0
      const event = contentInstructionRequestTargetEventSchema.parse({
        ...input,
        id: input.id ?? randomUUID(),
        sequence: previousSequence + 1,
        createdAt: input.createdAt ?? timestamp()
      })
      this.orm.insert(schema.contentInstructionRequestTargetEvents).values({
        id: event.id, targetId: event.targetId, sequence: event.sequence, eventKind: event.eventKind, actualModel: event.actualModel,
        actualReasoningEffort: event.actualReasoningEffort, providerThreadId: event.providerThreadId,
        taskId: event.taskId, status: event.status, createdAt: event.createdAt
      }).run()
      return this.get(targetRow.requestId)
    })()
  }
}
