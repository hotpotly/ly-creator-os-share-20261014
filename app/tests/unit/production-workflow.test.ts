import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import { openWorkspaceStore, type WorkspaceStore } from '../../src/main/db'
import {
  makeBilingualAss,
  makeBilingualAssFromConfirmed,
  makeBilingualSrtFromConfirmed,
  makeSrt,
  mapTranslatedSegmentsToConfirmedCues,
  parseConfirmedSrt,
  ProductionExecutor,
  subtitleSkillLines,
  withoutPunctuation
} from '../../src/main/production-executor'
import { assertPublishingHandoffCurrent, preparePublishingPackage, publishingClipboardText, SUPPORTED_PUBLISHING_PLATFORMS } from '../../src/main/publishing-adapters'
import { retainPublishingAsset } from '../../src/main/publishing-assets'
import { retainManagedFileFromBytes } from '../../src/main/managed-files'
import { PROJECT_PLATFORMS, PUBLISHING_PLATFORM_CAPABILITIES, type FileReferenceInput, type SubtitleArtifactKind } from '../../src/shared/domain'
import { RESPONSE_SCHEMAS } from '../../src/shared/ipc'

const roots: string[] = []
const unitRoot = join(import.meta.dirname, '../../test-results/unit')

async function createStore(): Promise<{ store: WorkspaceStore; directory: string }> {
  await mkdir(unitRoot, { recursive: true })
  const directory = await mkdtemp(join(unitRoot, 'creator-os-production-'))
  roots.push(directory)
  return { store: await openWorkspaceStore(directory), directory }
}

afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('production outputs and publishing handoff', () => {
  it('renders stable cover candidates and promotes only the selected candidate', async () => {
    const { store, directory } = await createStore()
    const project = store.repository.getProject('ai-browser', false)
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    store.repository.setFinalVersion(project.id, final.id)
    const task = store.repository.createTaskRun({
      taskType: 'image_generation', projectId: project.id, title: '本机封面测试', provider: 'none',
      inputSnapshot: JSON.stringify({ version: 1, projectId: project.id, projectTitle: project.title, platform: 'B站', layout: 'bilibili_landscape', generationMode: 'stable_layers', batchCount: 5, headline: 'AI浏览器真实体验', groupNote: '', sourceVersionId: final.id, sourceRevision: final.revision, sourceExcerpt: '这是定稿摘要', materialFileIds: [], promptSnapshot: '暖灰绿科技封面' }),
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:cover'
    })
    const taskDirectory = join(directory, 'task-output'); await mkdir(taskDirectory)
    const summary = await new ProductionExecutor(store).run(task, taskDirectory, new AbortController().signal, () => undefined)
    expect(summary).toContain('已生成5张')
    const candidates = store.repository.listCoverCandidates(project.id)
    expect(candidates).toHaveLength(5)
    expect(store.repository.getProject(project.id, false).stageTimeRecords.find((record) => record.stageKey === 'postproduction')).toMatchObject({
      status: 'in_progress', startedAt: expect.any(Object)
    })
    await Promise.all(candidates.map((candidate) => access(join(dirname(store.databasePath), store.repository.getCoverCandidateFile(project.id, candidate.id).relativePath))))
    expect(store.repository.selectCoverCandidate(project.id, candidates[0]!.id)).toMatchObject({ platform: 'B站', materialKind: 'cover', sourceVersionId: final.id })
    expect(store.repository.listCoverCandidates(project.id).filter((candidate) => candidate.isSelected)).toHaveLength(1)
    store.close()
  })

  it('keeps one selected reference image in every item of a five-candidate AI cover batch', async () => {
    const { store, directory } = await createStore()
    const project = store.repository.getProject('ai-browser', false)
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    store.repository.setFinalVersion(project.id, final.id)
    const canvas = createCanvas(32, 32)
    const context = canvas.getContext('2d')
    context.fillStyle = '#718064'; context.fillRect(0, 0, 32, 32)
    const reference = await retainManagedFileFromBytes(directory, {
      managedDirectory: join('project-materials', project.id), sourceName: '产品参考.png',
      profile: { mimeType: 'image/png', capabilities: ['preview', 'ocr'], processState: 'ready' }
    }, canvas.toBuffer('image/png'))
    store.repository.createProjectAssetMaterial({
      projectId: project.id, role: 'project_material', title: '本期产品参考',
      entries: [{ file: reference.file, importRelativePath: reference.file.originalName, parentFileId: null }],
      usageType: 'material_clue'
    })
    const task = store.repository.createTaskRun({
      taskType: 'image_generation', projectId: project.id, title: 'AI封面五图测试', provider: 'codex_cli',
      inputSnapshot: JSON.stringify({
        version: 1, projectId: project.id, projectTitle: project.title, platform: 'B站', layout: 'bilibili_landscape',
        generationMode: 'ai_finished', batchCount: 5, headline: 'AI浏览器真实体验', groupNote: '',
        sourceVersionId: final.id, sourceRevision: final.revision, sourceExcerpt: '这是定稿摘要',
        materialFileIds: [reference.file.id], promptSnapshot: '保持产品外观', providerConfigId: 'codex_cli_image_generation_v1',
        providerSecurity: { provider: 'codex_cli', cliVersion: 'unit', fingerprint: 'f'.repeat(64), policyVersion: 'image-cli-sandbox-v1' }
      }),
      permissionProfile: { network: 'provider_only', readableRefs: [reference.file.id], writableTarget: 'candidate_asset', shell: false },
      outputTarget: 'candidate:cover'
    })
    const calls: string[][] = []
    const executor = new ProductionExecutor(store, async (_snapshot, _taskDirectory, _position, _signal, materialPaths) => {
      calls.push(materialPaths)
      await access(materialPaths[0]!)
      return materialPaths[0]!
    })
    const taskDirectory = join(directory, 'ai-cover-output'); await mkdir(taskDirectory)
    expect(await executor.run(task, taskDirectory, new AbortController().signal, () => undefined)).toContain('已生成5张')
    expect(calls).toHaveLength(5)
    expect(calls.every((paths) => paths.length === 1 && paths[0] === reference.absolutePath)).toBe(true)
    expect(store.repository.listCoverCandidates(project.id).filter((candidate) => candidate.taskId === task.id)).toHaveLength(5)
    store.close()
  })

  it('formats the confirmed bilingual ASS style and resolves the exact macOS font faces', () => {
    const segments = [{ index: 0, start: 1.25, end: 3.5, text: '今天测试 MX Master 4 鼠标', confidence: 0.9, noSpeechProbability: 0.01 }]
    const translated = [{ ...segments[0]!, text: 'Testing MX Master 4 today' }]
    const srt = makeSrt(segments, translated)
    expect(srt).toContain('00:00:01,250 --> 00:00:03,500')
    expect(srt).toContain('测试MX Master 4鼠标')
    expect(srt).toContain('Testing MX Master 4 today')
    const ass = makeBilingualAss(segments, translated)
    expect(ass).toContain('Style: Chinese,PingFang SC Semibold,52')
    expect(ass).toContain('Style: English,Avenir Next Demi Bold,31')
    expect(ass).toContain('{\\rChinese\\blur8\\xshad2.12\\yshad-2.12}今天测试MX Master 4鼠标')
    expect(ass).toContain('\\N{\\rEnglish\\blur6\\xshad1.41\\yshad-1.41}Testing MX Master 4 today')
    expect(withoutPunctuation('罗技 MX Master 4，真的好用！')).toBe('罗技MX Master 4真的好用')
    const lines = subtitleSkillLines('当然，罗技 MX Master 4出来之后，但是对我来说141克还是太重了。')
    expect(lines).toContain('当然罗技MX Master 4出来之后')
    expect(lines).not.toContain('当然')
    expect(lines.join('\n')).toContain('141克')
    expect(lines.join('\n')).not.toMatch(/[，。！？]/)

    const pingFang = spawnSync('/opt/homebrew/bin/fc-match', ['-f', '%{family}|%{style}', 'PingFang SC Semibold'], { encoding: 'utf8' })
    const avenir = spawnSync('/opt/homebrew/bin/fc-match', ['-f', '%{family}|%{style}', 'Avenir Next Demi Bold'], { encoding: 'utf8' })
    expect(pingFang.status).toBe(0)
    expect(pingFang.stdout).toContain('PingFang SC Semibold|Semibold')
    expect(avenir.status).toBe(0)
    expect(avenir.stdout).toContain('Avenir Next Demi Bold|Demi Bold')
  })

  it('keeps the confirmed Chinese cues and timecodes unchanged in bilingual exports', () => {
    const confirmed = '1\n00:00:01,250 --> 00:00:03,500\n这句中文  MX Master 4  已人工确认\n并保留双行\n\n2\n00:00:04,000 --> 00:00:05,000\n第二句\n'
    const cues = parseConfirmedSrt(confirmed)
    const translated = [
      { index: 0, start: 1.2, end: 3.6, text: 'This Chinese cue was confirmed', confidence: 0.9, noSpeechProbability: 0 },
      { index: 1, start: 4, end: 5, text: 'Second cue', confidence: 0.9, noSpeechProbability: 0 }
    ]
    const bilingualSrt = makeBilingualSrtFromConfirmed(cues, translated)
    expect(bilingualSrt).toContain('00:00:01,250 --> 00:00:03,500\n这句中文  MX Master 4  已人工确认\n并保留双行\nThis Chinese cue was confirmed')
    expect(bilingualSrt).toContain('00:00:04,000 --> 00:00:05,000\n第二句\nSecond cue')
    const ass = makeBilingualAssFromConfirmed(cues, translated)
    expect(ass).toContain('Dialogue: 0,0:00:01.25,0:00:03.50,Chinese')
    expect(ass).toContain('这句中文  MX Master 4  已人工确认\\N并保留双行')
  })

  it('aggregates many English segments and distributes one spanning segment without loss or duplication', () => {
    const cues = [
      { index: 0, start: 0, end: 4, text: '第一句' },
      { index: 1, start: 4, end: 6, text: '第二句' }
    ]
    const manyToOne = mapTranslatedSegmentsToConfirmedCues(cues, [
      { index: 0, start: 0, end: 2, text: 'First half', confidence: 1, noSpeechProbability: 0 },
      { index: 1, start: 2, end: 4, text: 'second half', confidence: 1, noSpeechProbability: 0 }
    ])
    expect(manyToOne).toEqual(['First half second half', ''])

    const oneToMany = mapTranslatedSegmentsToConfirmedCues(cues, [
      { index: 0, start: 0, end: 6, text: 'one two three four five six', confidence: 1, noSpeechProbability: 0 }
    ])
    expect(oneToMany).toEqual(['one two three four', 'five six'])
    expect(oneToMany.join(' ').split(/\s+/).sort()).toEqual(['five', 'four', 'one', 'six', 'three', 'two'])
  })

  it('requires Chinese confirmation before the reusable bilingual ASS job', async () => {
    const { store } = await createStore()
    const project = store.repository.getProject('ai-browser', false)
    const file = (id: string, name: string, mimeType: string): FileReferenceInput => ({
      id, relativePath: `publishing-assets/ai-browser/${name}`, originalName: name, sha256: id.padEnd(64, '0').slice(0, 64),
      sizeBytes: 10, mimeType, createdAt: new Date().toISOString(), encryptedSourcePath: null
    })
    const source = file('audio-source', '口播.wav', 'audio/wav')
    const zhTask = store.repository.createTaskRun({
      taskType: 'subtitle_generation', projectId: project.id, title: '中文字幕', provider: 'none', inputSnapshot: '{}',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:subtitle'
    })
    const zhJob = store.repository.createSubtitleJob({ taskId: zhTask.id, projectId: project.id, inputFile: source, schema: 'zh', engine: 'unit', stylePreset: {}, sourceVersionId: null })
    const zhArtifacts: Array<{ kind: SubtitleArtifactKind; file: FileReferenceInput }> = [
      { kind: 'zh_srt', file: file('zh-srt-file', '中文字幕.srt', 'application/x-subrip') },
      { kind: 'plain_transcript', file: file('plain-file', '无标点字幕稿.txt', 'text/plain') }
    ]
    const completedZh = store.repository.saveSubtitleGenerationResult({ taskId: zhTask.id, language: 'zh', transcript: {}, anomalies: [], artifacts: zhArtifacts })
    expect(completedZh.confirmedZhArtifactId).toBeNull()
    expect(store.repository.getProject(project.id, false).stageTimeRecords.find((record) => record.stageKey === 'postproduction')).toMatchObject({
      status: 'in_progress', startedAt: expect.any(Object)
    })
    const confirmed = store.repository.confirmSubtitleArtifact(project.id, completedZh.artifacts.find((item) => item.artifactKind === 'zh_srt')!.id)
    expect(confirmed.confirmedZhArtifactId).toBeTruthy()

    const latestZhTask = store.repository.createTaskRun({
      taskType: 'subtitle_generation', projectId: project.id, title: '更新后的中文字幕', provider: 'none', inputSnapshot: '{}',
      permissionProfile: { network: 'off', readableRefs: [], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:subtitle'
    })
    store.repository.createSubtitleJob({ taskId: latestZhTask.id, projectId: project.id, inputFile: source, schema: 'zh', engine: 'unit', stylePreset: {}, sourceVersionId: null })
    const latestZh = store.repository.saveSubtitleGenerationResult({
      taskId: latestZhTask.id, language: 'zh', transcript: {}, anomalies: [],
      artifacts: [
        { kind: 'zh_srt', file: file('latest-zh-srt-file', '新中文字幕.srt', 'application/x-subrip') },
        { kind: 'plain_transcript', file: file('latest-plain-file', '新无标点字幕稿.txt', 'text/plain') }
      ]
    })
    expect(() => store.repository.getConfirmedChineseSubtitleSource(project.id, confirmed.confirmedZhArtifactId!)).toThrow('最新生成')
    expect(() => store.repository.confirmSubtitleArtifact(project.id, confirmed.confirmedZhArtifactId!)).toThrow('最新生成')
    const latestConfirmed = store.repository.confirmSubtitleArtifact(project.id, latestZh.artifacts.find((item) => item.artifactKind === 'zh_srt')!.id)
    expect(store.repository.getConfirmedChineseSubtitleSource(project.id, latestConfirmed.confirmedZhArtifactId!).job.id).toBe(latestConfirmed.id)

    const bilingualTask = store.repository.createTaskRun({
      taskType: 'subtitle_generation', projectId: project.id, title: '中英ASS', provider: 'none', inputSnapshot: '{}',
      permissionProfile: { network: 'off', readableRefs: [source.id], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:subtitle'
    })
    store.repository.createSubtitleJob({ taskId: bilingualTask.id, projectId: project.id, inputFile: source, schema: 'bilingual', engine: 'unit', stylePreset: {}, sourceVersionId: null })
    const bilingualKinds: SubtitleArtifactKind[] = ['zh_srt', 'bilingual_srt', 'bilingual_ass', 'plain_transcript']
    const completedBilingual = store.repository.saveSubtitleGenerationResult({
      taskId: bilingualTask.id, language: 'zh', transcript: {}, anomalies: [],
      artifacts: bilingualKinds.map((kind, index) => ({
        kind,
        file: file(`bilingual-${index}`, `${kind}.${kind === 'bilingual_ass' ? 'ass' : kind === 'plain_transcript' ? 'txt' : 'srt'}`, kind === 'bilingual_ass' ? 'text/x-ssa' : 'text/plain')
      }))
    })
    expect(completedBilingual.artifacts.map((item) => item.artifactKind)).toEqual(bilingualKinds)
    expect(() => store.repository.confirmSubtitleArtifact(project.id, completedBilingual.artifacts.find((item) => item.artifactKind === 'zh_srt')!.id)).toThrow('中文字幕SRT')
    expect(() => store.repository.confirmSubtitleArtifact(project.id, completedBilingual.artifacts.find((item) => item.artifactKind === 'bilingual_ass')!.id)).toThrow('中文字幕SRT')
    expect(zhJob.inputFileId).toBe(completedBilingual.inputFileId)
    store.close()
  })

  it('prechecks all seven publishing adapters, account and video before handoff', async () => {
    const { store } = await createStore()
    expect(SUPPORTED_PUBLISHING_PLATFORMS).toEqual(['B站', '小红书', '抖音', '头条', '视频号', '微博', 'YouTube'])
    expect(PUBLISHING_PLATFORM_CAPABILITIES.map((capability) => capability.platform)).toEqual(PROJECT_PLATFORMS)
    expect(PUBLISHING_PLATFORM_CAPABILITIES.find((capability) => capability.platform === '小红书')?.handoffMode).toBe('manual_only')
    const project = store.repository.getProject('ai-browser', false)
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    store.repository.setFinalVersion(project.id, final.id)
    store.repository.savePublishingTextMaterial({ projectId: project.id, platform: '主标题', materialKind: 'title', textValue: '统一主标题' })
    const draft = store.repository.preparePublishingDraft(project.id, 'B站')
    expect(draft).toMatchObject({ title: '统一主标题', sourceVersionId: final.id })
    expect(draft.description.length).toBeGreaterThan(0)
    expect(draft.tags).toContain(project.contentTypeName)
    for (const [kind, value] of [['title', 'AI浏览器真实体验'], ['description', '这是一次真实体验。'], ['tags', 'AI,浏览器']] as const) {
      store.repository.savePublishingTextMaterial({ projectId: project.id, platform: 'B站', materialKind: kind, textValue: value })
    }
    const file = await retainPublishingAsset(dirname(store.databasePath), project.id, 'cover', '封面.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    store.repository.savePublishingFileMaterial({ projectId: project.id, platform: 'B站', materialKind: 'cover', file })
    const video = await retainManagedFileFromBytes(dirname(store.databasePath), { managedDirectory: join('publishing-assets', project.id), sourceName: '成片.mp4', maximumBytes: 100 }, new Uint8Array([0, 0, 0, 20]))
    store.repository.savePublishingFileMaterial({ projectId: project.id, platform: 'B站', materialKind: 'video', file: video.file })
    const account = store.repository.savePublishingAccount({ platform: 'B站', accountName: 'LY数码', positioning: '数码长视频' })
    store.repository.selectPublishingAccount(project.id, 'B站', account.id)
    expect(() => store.repository.savePublishingAccount({ id: account.id, platform: '抖音', accountName: 'LY数码', positioning: '数码长视频' })).toThrow('不能改换平台')
    const prepared = store.repository.createPublishingHandoff(preparePublishingPackage(store.repository.getProject(project.id, false), 'B站', store.repository.getSelectedPublishingAccount(project.id, 'B站')))
    expect(prepared).toMatchObject({ status: 'prepared', issues: [], platform: 'B站' })
    expect(prepared.packageSnapshot).toMatchObject({ accountId: account.id, accountName: 'LY数码', videoFileName: '成片.mp4' })
    expect(() => assertPublishingHandoffCurrent({
      ...prepared,
      packageSnapshot: { ...prepared.packageSnapshot, accountId: '', videoFileId: '' }
    }, preparePublishingPackage(store.repository.getProject(project.id, false), 'B站', account))).toThrow('已过期')
    const legacy = store.repository.createPublishingHandoff(preparePublishingPackage(store.repository.getProject(project.id, false), 'B站', account))
    store.repository.native.prepare('UPDATE publishing_handoffs SET package_snapshot_json=? WHERE id=?').run(JSON.stringify({
      title: legacy.packageSnapshot.title,
      description: legacy.packageSnapshot.description,
      tags: legacy.packageSnapshot.tags,
      coverFileName: legacy.packageSnapshot.coverFileName,
      subtitleFileName: legacy.packageSnapshot.subtitleFileName,
      sourceVersionId: legacy.packageSnapshot.sourceVersionId
    }), legacy.id)
    const upgradedProject = store.repository.getProject(project.id, false)
    expect(RESPONSE_SCHEMAS.projectDetailSchema.parse(upgradedProject).publishingHandoffs.find((handoff) => handoff.id === legacy.id)?.packageSnapshot).toMatchObject({
      accountId: '', videoFileId: '', coverFileId: '', subtitleFileId: null
    })
    expect(publishingClipboardText(prepared)).toContain('【B站发布包】')
    expect(() => store.repository.updatePublishingHandoff(prepared.id, 'confirmed')).toThrow('请先打开')
    expect(store.repository.updatePublishingHandoff(prepared.id, 'opened').status).toBe('opened')
    expect(store.repository.updatePublishingHandoff(prepared.id, 'confirmed').status).toBe('confirmed')
    store.repository.savePublishingTextMaterial({ projectId: project.id, platform: 'B站', materialKind: 'title', textValue: '修改后的标题' })
    expect(() => assertPublishingHandoffCurrent(prepared, preparePublishingPackage(store.repository.getProject(project.id, false), 'B站', account))).toThrow('已变化')
    store.repository.setPublishingAccountStatus(account.id, 'disabled')
    expect(() => store.repository.selectPublishingAccount(project.id, 'B站', account.id)).toThrow('不可用')
    expect(preparePublishingPackage(store.repository.getProject(project.id, false), 'B站', store.repository.getSelectedPublishingAccount(project.id, 'B站')).issues).toContain('所选发布账号已停用')
    store.close()
  })

  it('binds platform title candidates to the selected master title snapshot', async () => {
    const { store } = await createStore()
    const project = store.repository.getProject('ai-browser', false)
    const final = project.versions.find((version) => version.documentType === 'script' && version.kind === 'merged_draft')!
    store.repository.setFinalVersion(project.id, final.id)
    const task = store.repository.createTaskRun({
      taskType: 'title_generation', projectId: project.id, title: '小红书短标题', provider: 'codex_cli',
      inputSnapshot: JSON.stringify({ platform: '小红书', sourceVersionId: final.id, candidateCount: 2, masterTitle: '第一版主标题', platformTitleLimit: 20 }),
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:title'
    })
    const candidates = store.repository.saveTitleGenerationResult(task.id, [
      { angle: '搜索', title: '短标题A', coverText: '封面A' },
      { angle: '体验', title: '短标题B', coverText: '封面B' }
    ])
    expect(candidates).toHaveLength(2)
    expect(candidates.every((candidate) => candidate.masterTitleSnapshot === '第一版主标题')).toBe(true)
    const overLimitTask = store.repository.createTaskRun({
      taskType: 'title_generation', projectId: project.id, title: '小红书超限标题', provider: 'claude_cli',
      inputSnapshot: JSON.stringify({ platform: '小红书', sourceVersionId: final.id, candidateCount: 2, masterTitle: '第一版主标题', platformTitleLimit: 5 }),
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:title'
    })
    expect(() => store.repository.saveTitleGenerationResult(overLimitTask.id, [
      { angle: '超限', title: '这条标题一定超过五个字', coverText: '封面A' },
      { angle: '合规', title: '五字内', coverText: '封面B' }
    ])).toThrow('不能超过5字')
    expect(store.repository.listTitleCandidates(project.id).some((candidate) => candidate.taskId === overLimitTask.id)).toBe(false)
    store.repository.savePublishingTextMaterial({ projectId: project.id, platform: '小红书', materialKind: 'title', textValue: '旧平台标题' })
    const masterTask = store.repository.createTaskRun({
      taskType: 'title_generation', projectId: project.id, title: '主标题', provider: 'claude_cli',
      inputSnapshot: JSON.stringify({ platform: '主标题', sourceVersionId: final.id, candidateCount: 10, masterTitle: null }),
      permissionProfile: { network: 'provider_only', readableRefs: [], writableTarget: 'candidate_asset', shell: false }, outputTarget: 'candidate:title'
    })
    const masterCandidates = store.repository.saveTitleGenerationResult(masterTask.id, Array.from({ length: 10 }, (_, index) => ({
      angle: `角度${index + 1}`, title: index === 0 ? '第二版主标题' : `备用主标题${index}`, coverText: index === 0 ? '第二版' : `备用${index}`
    })))
    store.repository.selectTitleCandidate(project.id, masterCandidates[0]!.id)
    expect(store.repository.listPublishingMaterials(project.id).some((item) => item.platform === '小红书' && item.materialKind === 'title')).toBe(false)
    store.close()
  })
})
