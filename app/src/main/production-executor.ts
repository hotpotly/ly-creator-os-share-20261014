import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { access, copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { z } from 'zod'
import type { FileReferenceInput, SubtitleAnomaly, SubtitleArtifact, TaskRun } from '../shared/domain'
import type { WorkspaceStore } from './db'
import { discardManagedLocator, openVerifiedLinkedFileSnapshot, resolveManagedFilePath, retainManagedFileFromPath } from './managed-files'
import {
  buildProviderSandboxProfile,
  CODEX_IMAGE_FEATURE_ARGUMENTS,
  imageProviderFingerprint,
  IMAGE_PROVIDER_SECURITY_POLICY_VERSION,
  inspectProviderExecutable,
  prepareProviderEnvironment
} from './provider-execution'

export const coverGenerationTaskSnapshotSchema = z.object({
  version: z.literal(1), projectId: z.string(), projectTitle: z.string(), platform: z.string(),
  layout: z.enum(['bilibili_landscape', 'xiaohongshu_portrait']), generationMode: z.enum(['ai_finished', 'stable_layers']),
  batchCount: z.number().int().min(1).max(5), headline: z.string().min(1).max(40), groupNote: z.string().max(2_000),
  sourceVersionId: z.string(), sourceRevision: z.number().int().positive(), sourceExcerpt: z.string().min(1).max(20_000),
  materialFileIds: z.array(z.string()).max(12), promptSnapshot: z.string().min(1).max(40_000),
  providerConfigId: z.enum(['codex_cli_image_generation_v1']).nullable().default(null),
  providerSecurity: z.object({
    provider: z.literal('codex_cli'), cliVersion: z.string(), fingerprint: z.string().length(64), policyVersion: z.string()
  }).nullable().default(null)
})

export const subtitleGenerationTaskSnapshotSchema = z.object({
  version: z.literal(1), projectId: z.string(), jobId: z.string(), schema: z.enum(['zh', 'bilingual']), inputFileId: z.string(),
  confirmedZhArtifactId: z.string().nullable().default(null), sourceVersionId: z.string().nullable().default(null),
  sourceRevision: z.number().int().positive().nullable().default(null), referenceText: z.string().max(20_000).nullable().default(null)
})

export type CoverSnapshot = z.infer<typeof coverGenerationTaskSnapshotSchema>
const SUBTITLE_STYLE_PRESET = {
  id: 'youtube-bilingual-v1',
  chinese: { font: 'PingFang SC', weight: 'Semibold', sizePt: 52, color: '#FFFFFF', shadow: { distance: 3, angle: 315, blur: 8 } },
  english: { font: 'Avenir Next', weight: 'Demi Bold', sizePt: 31, color: '#FFFFFF', shadow: { distance: 2, angle: 315, blur: 6 } }
}

export function subtitleStylePreset(): Record<string, unknown> { return structuredClone(SUBTITLE_STYLE_PRESET) }

function safeScope(value: string): string { return value.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'project' }

function assertNotAborted(signal: AbortSignal): void { if (signal.aborted) throw new Error('TASK_CANCELED') }

function normalizeMixedSpacing(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
    .replace(/([\p{Script=Han}])\s+([A-Za-z0-9])/gu, '$1$2')
    .replace(/([A-Za-z0-9])\s+([\p{Script=Han}])/gu, '$1$2').trim()
}

export function withoutPunctuation(value: string): string {
  return normalizeMixedSpacing(value).replace(/[，。！？、；：,.!?;:“”‘’（）()【】[\]《》<>…—]/g, '').replace(/\n{3,}/g, '\n\n')
}

const SUBTITLE_CONNECTORS = new Set(['当然', '但是', '但', '不过', '所以', '然后', '接着', '首先', '最后', '而且', '因为', '如果', '比如', '除非'])

function subtitleTokens(value: string): string[] {
  return value.match(/[A-Za-z0-9][A-Za-z0-9+_.-]*(?:\s+[A-Za-z0-9][A-Za-z0-9+_.-]*){0,5}|\d+(?:\.\d+)?(?:克|倍|Hz|GB|TB|MB|分钟|秒|天|年|%|％)|./gu) ?? []
}

function subtitleTokenWeight(token: string): number {
  return [...token].reduce((sum, character) => sum + (/[\p{Script=Han}]/u.test(character) ? 1 : character === ' ' ? 0.25 : 0.55), 0)
}

export function subtitleSkillLines(value: string, maximumUnits = 24): string[] {
  const text = normalizeMixedSpacing(value)
  if (!text) return []
  const rawClauses = text.split(/[，。！？、；：,.!?;:“”‘’（）()【】[\]《》<>…—]+/u).map((item) => item.trim()).filter(Boolean)
  const clauses: string[] = []; let pendingConnector = ''
  for (const clause of rawClauses) {
    if (SUBTITLE_CONNECTORS.has(clause)) { pendingConnector += clause; continue }
    clauses.push(`${pendingConnector}${clause}`); pendingConnector = ''
  }
  if (pendingConnector) clauses.push(pendingConnector)
  const lines: string[] = []
  for (const clause of clauses) {
    let current = ''; let units = 0
    for (const token of subtitleTokens(clause)) {
      const tokenUnits = subtitleTokenWeight(token)
      if (current && units + tokenUnits > maximumUnits) { lines.push(current.trim()); current = ''; units = 0 }
      current += token; units += tokenUnits
    }
    if (current.trim()) lines.push(current.trim())
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index]!
    const connector = [...SUBTITLE_CONNECTORS].find((item) => line === item || line.endsWith(item))
    if (!connector) continue
    const prefix = line.slice(0, -connector.length).trim()
    lines[index + 1] = `${connector}${lines[index + 1]}`
    if (prefix) lines[index] = prefix
    else { lines.splice(index, 1); index -= 1 }
  }
  return lines.filter(Boolean)
}

function srtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000)); const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000); const secs = Math.floor((milliseconds % 60_000) / 1000); const ms = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

interface WhisperSegment { index: number; start: number; end: number; text: string; confidence: number; noSpeechProbability: number }
interface WhisperPayload { engine: string; language: string; segments: WhisperSegment[]; translatedSegments: WhisperSegment[] }
export interface ConfirmedSubtitleCue { index: number; start: number; end: number; text: string }

function translatedFor(segment: WhisperSegment, translated: WhisperSegment[]): string {
  const match = translated.find((candidate) => candidate.start < segment.end && candidate.end > segment.start)
  return normalizeMixedSpacing(match?.text ?? '')
}

export function mapTranslatedSegmentsToConfirmedCues(cues: ConfirmedSubtitleCue[], translated: WhisperSegment[]): string[] {
  const parts = cues.map(() => [] as string[])
  for (const segment of [...translated].sort((left, right) => left.start - right.start)) {
    const text = normalizeMixedSpacing(segment.text)
    if (!text) continue
    const overlaps = cues.map((cue, cueIndex) => ({
      cueIndex,
      overlap: Math.max(0, Math.min(cue.end, segment.end) - Math.max(cue.start, segment.start)),
      midpointDistance: Math.abs((cue.start + cue.end) / 2 - (segment.start + segment.end) / 2)
    })).filter((item) => item.overlap > 0)
    if (!overlaps.length) {
      const nearest = cues.map((cue, cueIndex) => ({
        cueIndex,
        midpointDistance: Math.abs((cue.start + cue.end) / 2 - (segment.start + segment.end) / 2)
      })).sort((left, right) => left.midpointDistance - right.midpointDistance)[0]
      if (nearest) parts[nearest.cueIndex]!.push(text)
      continue
    }
    if (overlaps.length === 1) {
      parts[overlaps[0]!.cueIndex]!.push(text)
      continue
    }
    const tokens = text.split(/\s+/).filter(Boolean)
    if (tokens.length < overlaps.length) {
      const best = [...overlaps].sort((left, right) => right.overlap - left.overlap || left.midpointDistance - right.midpointDistance)[0]!
      parts[best.cueIndex]!.push(text)
      continue
    }
    const ordered = overlaps.sort((left, right) => left.cueIndex - right.cueIndex)
    const totalOverlap = ordered.reduce((sum, item) => sum + item.overlap, 0)
    const cumulative = ordered.reduce<number[]>((values, item) => [...values, (values.at(-1) ?? 0) + item.overlap / totalOverlap], [])
    tokens.forEach((token, tokenIndex) => {
      const normalizedPosition = (tokenIndex + 0.5) / tokens.length
      const target = cumulative.findIndex((boundary) => normalizedPosition <= boundary)
      parts[ordered[target < 0 ? ordered.length - 1 : target]!.cueIndex]!.push(token)
    })
  }
  return parts.map((items) => items.join(' ').trim())
}

export function makeSrt(segments: WhisperSegment[], translated: WhisperSegment[] | null): string {
  const cues: Array<{ start: number; end: number; text: string }> = []
  for (const segment of segments) {
    const chunks = subtitleSkillLines(segment.text); if (!chunks.length) continue
    const duration = Math.max(0.4, segment.end - segment.start)
    chunks.forEach((chunk, index) => {
      const start = segment.start + duration * index / chunks.length; const end = segment.start + duration * (index + 1) / chunks.length
      const english = translated ? translatedFor(segment, translated) : ''
      cues.push({ start, end, text: english ? `${chunk}\n${english}` : chunk })
    })
  }
  return `${cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`).join('\n\n')}\n`
}

function parseSrtTime(value: string): number {
  const match = value.trim().match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/)
  if (!match) throw new Error('CONFIRMED_ZH_SRT_INVALID')
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

export function parseConfirmedSrt(value: string): ConfirmedSubtitleCue[] {
  const blocks = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)
  const cues = blocks.map((block, position) => {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) throw new Error('CONFIRMED_ZH_SRT_INVALID')
    const [startText, endText] = lines[timingIndex]!.split('-->').map((item) => item.trim())
    if (!startText || !endText) throw new Error('CONFIRMED_ZH_SRT_INVALID')
    const start = parseSrtTime(startText); const end = parseSrtTime(endText)
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (!text || end <= start) throw new Error('CONFIRMED_ZH_SRT_INVALID')
    return { index: position, start, end, text }
  })
  if (!cues.length) throw new Error('CONFIRMED_ZH_SRT_EMPTY')
  return cues
}

function confirmedCueAsSegment(cue: ConfirmedSubtitleCue): WhisperSegment {
  return { ...cue, confidence: 1, noSpeechProbability: 0 }
}

export function makeBilingualSrtFromConfirmed(cues: ConfirmedSubtitleCue[], translated: WhisperSegment[]): string {
  const englishByCue = mapTranslatedSegmentsToConfirmedCues(cues, translated)
  return `${cues.map((cue, index) => {
    const english = englishByCue[index] ?? ''
    return `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}${english ? `\n${english}` : ''}`
  }).join('\n\n')}\n`
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor((centiseconds % 360_000) / 6_000)
  const secs = Math.floor((centiseconds % 6_000) / 100)
  const cs = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function escapeAss(value: string): string {
  return value.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').replace(/\r?\n/g, '\\N')
}

export function makeBilingualAss(segments: WhisperSegment[], translated: WhisperSegment[]): string {
  return makeBilingualAssFromConfirmed(segments.map(({ index, start, end, text }) => ({ index, start, end, text: normalizeMixedSpacing(text) })), translated)
}

export function makeBilingualAssFromConfirmed(cues: ConfirmedSubtitleCue[], translated: WhisperSegment[]): string {
  const dialogues: string[] = []
  const englishByCue = mapTranslatedSegmentsToConfirmedCues(cues, translated)
  for (const [index, cue] of cues.entries()) {
    const english = englishByCue[index] ?? ''
    const text = `{\\rChinese\\blur8\\xshad2.12\\yshad-2.12}${escapeAss(cue.text)}${english ? `\\N{\\rEnglish\\blur6\\xshad1.41\\yshad-1.41}${escapeAss(english)}` : ''}`
    dialogues.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Chinese,,0,0,0,,${text}`)
  }
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Chinese,PingFang SC Semibold,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,2,80,80,72,1',
    'Style: English,Avenir Next Demi Bold,31,&H00FFFFFF,&H00FFFFFF,&H00000000,&H70000000,0,0,0,0,100,100,0,0,1,0,0,2,80,80,34,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...dialogues,
    ''
  ].join('\n')
}

function coverDimensions(layout: CoverSnapshot['layout']): { width: number; height: number } {
  return layout === 'bilibili_landscape' ? { width: 1440, height: 1080 } : { width: 1080, height: 1440 }
}

function wrapCanvasText(context: ReturnType<ReturnType<typeof createCanvas>['getContext']>, text: string, maximumWidth: number): string[] {
  const lines: string[] = []; let line = ''
  for (const character of [...text]) {
    const candidate = `${line}${character}`
    if (line && context.measureText(candidate).width > maximumWidth) { lines.push(line); line = character } else line = candidate
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

async function renderCover(input: { snapshot: CoverSnapshot; outputPath: string; position: number; backgroundPath?: string | null }): Promise<void> {
  const { width, height } = coverDimensions(input.snapshot.layout); const canvas = createCanvas(width, height); const context = canvas.getContext('2d')
  const palettes = [
    ['#EEEAE1', '#718064', '#263126'], ['#E7E3DA', '#526B63', '#1F2A27'], ['#F2ECE2', '#8B725D', '#332921'], ['#E6E9E0', '#68765C', '#20271F']
  ] as const
  const palette = palettes[input.position % palettes.length]!
  context.fillStyle = palette[0]; context.fillRect(0, 0, width, height)
  if (input.backgroundPath) {
    try {
      const image = await loadImage(input.backgroundPath); const scale = Math.max(width / image.width, height / image.height)
      const drawWidth = image.width * scale; const drawHeight = image.height * scale
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
      context.fillStyle = 'rgba(22,27,21,.46)'; context.fillRect(0, 0, width, height)
    } catch { /* retain the deterministic fallback background */ }
  } else {
    const gradient = context.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, palette[0]); gradient.addColorStop(1, palette[1])
    context.fillStyle = gradient; context.fillRect(0, 0, width, height)
    context.globalAlpha = 0.16; context.fillStyle = palette[2]
    for (let index = 0; index < 5; index += 1) {
      const size = Math.min(width, height) * (0.12 + index * 0.035)
      context.beginPath(); context.roundRect(width * (0.62 + index * 0.035), height * (0.12 + index * 0.11), size, size * 0.72, size * 0.1); context.fill()
    }
    context.globalAlpha = 1
  }
  const margin = width * 0.075; const titleWidth = input.snapshot.layout === 'bilibili_landscape' ? width * 0.56 : width * 0.84
  const fontSize = input.snapshot.layout === 'bilibili_landscape' ? 112 : 94
  context.fillStyle = '#FFFFFF'; context.font = `700 ${fontSize}px "PingFang SC", sans-serif`; context.textBaseline = 'top'
  context.shadowColor = 'rgba(0,0,0,.38)'; context.shadowBlur = 18; context.shadowOffsetY = 5
  const lines = wrapCanvasText(context, input.snapshot.headline, titleWidth)
  const startY = input.snapshot.layout === 'bilibili_landscape' ? height * 0.25 : height * 0.16
  lines.forEach((line, index) => context.fillText(line, margin, startY + index * fontSize * 1.18, titleWidth))
  context.shadowColor = 'transparent'; context.font = `600 ${Math.round(fontSize * 0.25)}px "PingFang SC", sans-serif`
  context.fillStyle = 'rgba(255,255,255,.86)'; context.fillText(input.snapshot.platform, margin, startY - fontSize * 0.48)
  await writeFile(input.outputPath, canvas.toBuffer('image/png'))
}

function runChild(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; signal: AbortSignal; timeoutMs: number; inputFd?: number }): Promise<void> {
  return new Promise((resolveChild, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: options.inputFd === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', options.inputFd],
      env: options.env ?? process.env
    })
    let output = ''; let settled = false
    const finish = (error?: Error): void => { if (settled) return; settled = true; clearTimeout(timeout); options.signal.removeEventListener('abort', abort); if (error) reject(error); else resolveChild() }
    const abort = (): void => { child.kill('SIGTERM'); finish(new Error('TASK_CANCELED')) }
    const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('TASK_TIMEOUT')) }, options.timeoutMs)
    options.signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-8_000) })
    child.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-8_000) })
    child.once('error', () => finish(new Error('TASK_START_FAILED')))
    child.once('exit', (code) => {
      const safeDetail = process.env.CREATOR_OS_PROVIDER_DEBUG === '1'
        ? output.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>').replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>').slice(-2_000)
        : ''
      finish(code === 0 ? undefined : new Error(output.includes('not authenticated')
        ? 'PROVIDER_NOT_AUTHENTICATED'
        : `PROVIDER_EXIT_${code ?? 'UNKNOWN'}${safeDetail ? `:${safeDetail}` : ''}`))
    })
  })
}

async function collectGeneratedImages(directory: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  const images: Array<{ path: string; mtimeMs: number }> = []
  const walk = async (current: string): Promise<void> => {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name)) images.push({ path, mtimeMs: (await stat(path)).mtimeMs })
    }
  }
  await walk(directory)
  return images.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

export async function runCodexImage(snapshot: CoverSnapshot, taskDirectory: string, position: number, signal: AbortSignal, materialPaths: string[]): Promise<string> {
  if (snapshot.providerConfigId !== 'codex_cli_image_generation_v1' || !snapshot.providerSecurity) throw new Error('IMAGE_PROVIDER_ATTESTATION_MISSING')
  const provider = await inspectProviderExecutable('codex_cli'); if (!provider) throw new Error('CODEX_IMAGE_PROVIDER_MISSING')
  if (snapshot.providerSecurity.policyVersion !== IMAGE_PROVIDER_SECURITY_POLICY_VERSION
    || provider.version !== snapshot.providerSecurity.cliVersion
    || imageProviderFingerprint(provider) !== snapshot.providerSecurity.fingerprint) throw new Error('IMAGE_PROVIDER_ATTESTATION_STALE')
  const imageTaskDirectory = join(taskDirectory, `image-run-${position + 1}`)
  await mkdir(imageTaskDirectory, { recursive: true, mode: 0o700 })
  const referenceNames: string[] = []
  for (let index = 0; index < materialPaths.length; index += 1) {
    const source = materialPaths[index]!
    const extension = source.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '.img'
    const name = `reference-${index + 1}${extension}`
    await copyFile(source, join(imageTaskDirectory, name))
    referenceNames.push(name)
  }
  const prompt = [
    'Use the built-in image generation tool exactly once. Shell, unified exec, web, apps, plugins, and computer control are disabled.',
    `Create a ${snapshot.layout === 'bilibili_landscape' ? '4:3 landscape' : '3:4 portrait'} professional technology content cover background for: ${snapshot.projectTitle}.`,
    `Visual direction: ${snapshot.promptSnapshot}`,
    referenceNames.length
      ? `Use only these user-provided reference images as identity and product truth: ${referenceNames.join(', ')}. Preserve recognizable people and products instead of inventing replacements.`
      : 'No user reference image was selected; use a clean abstract technology composition without inventing a recognizable person or branded product.',
    'Do not generate text, letters, numbers, logos, brands, or watermarks. Keep clear negative space for a later title overlay.',
    'Return only a short success message after the image tool finishes.'
  ].join('\n')
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config',
    ...CODEX_IMAGE_FEATURE_ARGUMENTS, '--color', 'never', prompt]
  const environment = await prepareProviderEnvironment(provider, imageTaskDirectory)
  const sandboxProfile = buildProviderSandboxProfile(provider, imageTaskDirectory)
  await runChild('/usr/bin/sandbox-exec', ['-p', sandboxProfile, provider.executablePath, ...args], { cwd: imageTaskDirectory, env: environment, signal, timeoutMs: 12 * 60_000 })
  const codexHome = environment.CODEX_HOME
  if (!codexHome) throw new Error('IMAGE_PROVIDER_OUTPUT_MISSING')
  const images = await collectGeneratedImages(join(codexHome, 'generated_images'))
  if (!images[0] || !(await lstat(images[0].path)).isFile()) throw new Error('IMAGE_PROVIDER_OUTPUT_MISSING')
  return images[0].path
}

async function findWhisperModel(): Promise<string> {
  const bundled = join(process.resourcesPath, 'whisper-model-small')
  try { await access(join(bundled, 'model.bin')); return bundled } catch { /* use the local development/runtime cache */ }
  const snapshots = join(homedir(), '.cache', 'huggingface', 'hub', 'models--Systran--faster-whisper-small', 'snapshots')
  const entries = await readdir(snapshots, { withFileTypes: true })
  const directory = entries.find((entry) => entry.isDirectory())
  if (!directory) throw new Error('WHISPER_MODEL_MISSING')
  return join(snapshots, directory.name)
}

async function findPythonRuntime(): Promise<{ python: string; pythonPath: string; script: string }> {
  const pythonCandidates = ['/opt/homebrew/bin/python3.12', '/opt/homebrew/bin/python3']
  const python = (await Promise.all(pythonCandidates.map(async (candidate) => { try { await access(candidate); return candidate } catch { return null } }))).find(Boolean)
  if (!python) throw new Error('WHISPER_PYTHON_MISSING')
  const pathCandidates = [join(process.resourcesPath, 'whisper-python'), resolve(process.cwd(), '.runtime', 'whisper-python'), resolve(__dirname, '..', '..', '.runtime', 'whisper-python')]
  const pythonPath = (await Promise.all(pathCandidates.map(async (candidate) => { try { await access(join(candidate, 'faster_whisper')); return candidate } catch { return null } }))).find(Boolean)
  if (!pythonPath) throw new Error('WHISPER_RUNTIME_MISSING')
  const scriptCandidates = [join(process.resourcesPath, 'whisper_transcribe.py'), resolve(process.cwd(), 'scripts', 'whisper_transcribe.py'), resolve(__dirname, '..', '..', 'scripts', 'whisper_transcribe.py')]
  const script = (await Promise.all(scriptCandidates.map(async (candidate) => { try { await access(candidate); return candidate } catch { return null } }))).find(Boolean)
  if (!script) throw new Error('WHISPER_SCRIPT_MISSING')
  return { python, pythonPath, script }
}

async function retainGeneratedFile(userDataPath: string, projectId: string, path: string, fileName: string, profile: { mimeType: string; capabilities: Array<'preview' | 'parse' | 'ocr'> }): Promise<FileReferenceInput> {
  const retained = await retainManagedFileFromPath(userDataPath, {
    sourcePath: path, sourceName: fileName, managedDirectory: join('publishing-assets', safeScope(projectId)), sourceOrigin: 'generated',
    profile: { ...profile, processState: 'ready' }, maximumBytes: 25 * 1024 * 1024
  })
  return retained.file
}

export class ProductionExecutor {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly imageRunner: typeof runCodexImage = runCodexImage
  ) {
    try { GlobalFonts.registerFromPath('/System/Library/Fonts/PingFang.ttc', 'PingFang SC') } catch { /* canvas keeps its system fallback */ }
  }

  supports(task: TaskRun): boolean { return task.taskType === 'image_generation' || task.taskType === 'subtitle_generation' }

  async run(task: TaskRun, taskDirectory: string, signal: AbortSignal, onProgress: (progress: number) => void): Promise<string> {
    if (task.taskType === 'image_generation') return this.runCover(task, taskDirectory, signal, onProgress)
    if (task.taskType === 'subtitle_generation') return this.runSubtitle(task, taskDirectory, signal, onProgress)
    throw new Error('LOCAL_TASK_UNSUPPORTED')
  }

  private async runCover(task: TaskRun, taskDirectory: string, signal: AbortSignal, onProgress: (progress: number) => void): Promise<string> {
    const snapshot = coverGenerationTaskSnapshotSchema.parse(JSON.parse(task.inputSnapshot)); const userDataPath = resolve(this.store.databasePath, '..')
    const materialPaths = snapshot.materialFileIds.map((fileId) => {
      const file = this.store.repository.getFileReference(fileId); return resolveManagedFilePath(userDataPath, file.managedLocator || file.relativePath)
    })
    const retained: FileReferenceInput[] = []
    try {
      for (let index = 0; index < snapshot.batchCount; index += 1) {
        assertNotAborted(signal); onProgress(5 + Math.round(index / snapshot.batchCount * 80))
        const background = snapshot.generationMode === 'ai_finished'
          ? await this.imageRunner(snapshot, taskDirectory, index, signal, materialPaths)
          : materialPaths[index % Math.max(materialPaths.length, 1)] ?? null
        const output = join(taskDirectory, `cover-${index + 1}.png`)
        await renderCover({ snapshot, outputPath: output, position: index, backgroundPath: background })
        retained.push(await retainGeneratedFile(userDataPath, snapshot.projectId, output, `${snapshot.platform}-封面候选-${index + 1}.png`, { mimeType: 'image/png', capabilities: ['preview', 'ocr'] }))
      }
      assertNotAborted(signal); onProgress(92)
      const candidates = this.store.repository.saveCoverGenerationResult({
        taskId: task.id, projectId: snapshot.projectId, platform: snapshot.platform, layout: snapshot.layout, generationMode: snapshot.generationMode,
        headline: snapshot.headline, promptSnapshot: snapshot.promptSnapshot, sourceVersionId: snapshot.sourceVersionId, files: retained
      })
      return `${snapshot.platform}封面已生成${candidates.length}张·${snapshot.generationMode === 'ai_finished' ? 'Codex图像生成＋稳定文字图层' : '稳定图层'}`
    } catch (error) {
      await Promise.all(retained.map((file) => discardManagedLocator(userDataPath, file.managedLocator || file.relativePath).catch(() => undefined)))
      throw error
    }
  }

  private async runSubtitle(task: TaskRun, taskDirectory: string, signal: AbortSignal, onProgress: (progress: number) => void): Promise<string> {
    const snapshot = subtitleGenerationTaskSnapshotSchema.parse(JSON.parse(task.inputSnapshot)); const userDataPath = resolve(this.store.databasePath, '..')
    const inputFile = this.store.repository.getFileReference(snapshot.inputFileId); const inputPath = resolveManagedFilePath(userDataPath, inputFile.managedLocator || inputFile.relativePath)
    let confirmedSrt: string | null = null
    let confirmedCues: ConfirmedSubtitleCue[] | null = null
    if (snapshot.schema === 'bilingual') {
      if (!snapshot.confirmedZhArtifactId) throw new Error('CONFIRMED_ZH_SRT_REQUIRED')
      const confirmed = this.store.repository.getConfirmedChineseSubtitleSource(snapshot.projectId, snapshot.confirmedZhArtifactId)
      if (confirmed.job.inputFileId !== snapshot.inputFileId) throw new Error('CONFIRMED_ZH_SOURCE_MISMATCH')
      const confirmedPath = resolveManagedFilePath(userDataPath, confirmed.file.managedLocator || confirmed.file.relativePath)
      confirmedSrt = await readFile(confirmedPath, 'utf8')
      confirmedCues = parseConfirmedSrt(confirmedSrt)
    }
    const runtime = await findPythonRuntime(); const model = await findWhisperModel(); const transcriptPath = join(taskDirectory, 'whisper-result.json')
    const referencePath = join(taskDirectory, 'subtitle-reference.txt')
    if (snapshot.referenceText) await writeFile(referencePath, snapshot.referenceText, 'utf8')
    onProgress(8); assertNotAborted(signal)
    const verifiedInput = await openVerifiedLinkedFileSnapshot(inputPath, inputFile)
    try {
      await runChild(runtime.python, [runtime.script, '--input', '/dev/fd/3', '--model', model, '--output', transcriptPath,
        ...(snapshot.referenceText ? ['--initial-prompt-file', referencePath] : []), ...(snapshot.schema === 'bilingual' ? ['--bilingual'] : [])], {
        cwd: taskDirectory, signal, timeoutMs: 45 * 60_000, inputFd: verifiedInput.fd,
        env: { ...process.env, PYTHONPATH: runtime.pythonPath, HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' }
      })
    } finally { await verifiedInput.close() }
    onProgress(76); assertNotAborted(signal)
    const payload = z.object({
      engine: z.string(), language: z.string(),
      segments: z.array(z.object({ index: z.number().int(), start: z.number(), end: z.number(), text: z.string(), confidence: z.number(), noSpeechProbability: z.number() })),
      translatedSegments: z.array(z.object({ index: z.number().int(), start: z.number(), end: z.number(), text: z.string(), confidence: z.number(), noSpeechProbability: z.number() }))
    }).parse(JSON.parse(await readFile(transcriptPath, 'utf8'))) as WhisperPayload
    if (!payload.segments.length) throw new Error('SUBTITLE_TRANSCRIPT_EMPTY')
    const zhPath = join(taskDirectory, '中文字幕.srt'); const bilingualPath = join(taskDirectory, '中英双语字幕.srt')
    const bilingualAssPath = join(taskDirectory, '中英双语字幕.ass'); const plainPath = join(taskDirectory, '无标点字幕稿.txt')
    let outputSegments = payload.segments
    if (snapshot.schema === 'bilingual') {
      if (!confirmedSrt || !confirmedCues) throw new Error('CONFIRMED_ZH_SRT_REQUIRED')
      const cues = confirmedCues
      outputSegments = cues.map(confirmedCueAsSegment)
      const translated = payload.translatedSegments.length ? payload.translatedSegments : payload.segments
      await writeFile(zhPath, confirmedSrt.endsWith('\n') ? confirmedSrt : `${confirmedSrt}\n`, 'utf8')
      await writeFile(bilingualPath, makeBilingualSrtFromConfirmed(cues, translated), 'utf8')
      await writeFile(bilingualAssPath, makeBilingualAssFromConfirmed(cues, translated), 'utf8')
    } else {
      await writeFile(zhPath, makeSrt(payload.segments, null), 'utf8')
    }
    await writeFile(plainPath, `${outputSegments.flatMap((segment) => subtitleSkillLines(withoutPunctuation(segment.text))).filter(Boolean).join('\n')}\n`, 'utf8')
    const anomalySource = snapshot.schema === 'bilingual' ? payload.translatedSegments : payload.segments
    const anomalies: SubtitleAnomaly[] = anomalySource.filter((segment) => segment.confidence < 0.65 || segment.noSpeechProbability > 0.45).map((segment) => ({
      segmentIndex: segment.index, start: segment.start, end: segment.end, text: normalizeMixedSpacing(segment.text), confidence: segment.confidence
    }))
    const retained: Array<{ kind: SubtitleArtifact['artifactKind']; file: FileReferenceInput }> = []
    try {
      retained.push({ kind: 'zh_srt', file: await retainGeneratedFile(userDataPath, snapshot.projectId, zhPath, '中文字幕.srt', { mimeType: 'application/x-subrip', capabilities: ['preview', 'parse'] }) })
      if (snapshot.schema === 'bilingual') {
        retained.push({ kind: 'bilingual_srt', file: await retainGeneratedFile(userDataPath, snapshot.projectId, bilingualPath, '中英双语字幕.srt', { mimeType: 'application/x-subrip', capabilities: ['preview', 'parse'] }) })
        retained.push({ kind: 'bilingual_ass', file: await retainGeneratedFile(userDataPath, snapshot.projectId, bilingualAssPath, '中英双语字幕.ass', { mimeType: 'text/x-ssa', capabilities: ['preview', 'parse'] }) })
      }
      retained.push({ kind: 'plain_transcript', file: await retainGeneratedFile(userDataPath, snapshot.projectId, plainPath, '无标点字幕稿.txt', { mimeType: 'text/plain', capabilities: ['preview', 'parse'] }) })
      onProgress(94)
      const transcript = { ...payload, segments: outputSegments }
      this.store.repository.saveSubtitleGenerationResult({ taskId: task.id, language: payload.language, transcript, anomalies, artifacts: retained })
      return `字幕已完成：${outputSegments.length}段·${anomalies.length}处低置信片段·${retained.length}类产物已归档`
    } catch (error) {
      await Promise.all(retained.map(({ file }) => discardManagedLocator(userDataPath, file.managedLocator || file.relativePath).catch(() => undefined)))
      throw error
    }
  }
}
