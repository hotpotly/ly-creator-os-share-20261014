import fireplaceUrl from '../assets/ambient/fireplace.m4a?url'
import rainUrl from '../assets/ambient/rain.m4a?url'
import streamUrl from '../assets/ambient/stream.m4a?url'

export type AmbientSoundKind = 'rain' | 'fireplace' | 'stream'

const soundSources: Record<AmbientSoundKind, { url: string; normalization: number }> = {
  rain: { url: rainUrl, normalization: 1.3047235 },
  fireplace: { url: fireplaceUrl, normalization: 7.081784 },
  stream: { url: streamUrl, normalization: 4.0023947 }
}

export class AmbientAudioEngine {
  private context: AudioContext | null = null
  private bus: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private readonly buffers = new Map<AmbientSoundKind, AudioBuffer>()
  private volume = 0.45
  private generation = 0

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) this.context = new AudioContext()
    if (this.context.state === 'suspended') await this.context.resume()
    return this.context
  }

  private async loadBuffer(context: AudioContext, kind: AmbientSoundKind): Promise<AudioBuffer> {
    const cached = this.buffers.get(kind)
    if (cached) return cached
    const response = await fetch(soundSources[kind].url)
    if (!response.ok) throw new Error('白噪音资源读取失败')
    const decoded = await context.decodeAudioData(await response.arrayBuffer())
    this.buffers.set(kind, decoded)
    return decoded
  }

  async play(kind: AmbientSoundKind, volume = this.volume): Promise<void> {
    const context = await this.ensureContext()
    const generation = ++this.generation
    const buffer = await this.loadBuffer(context, kind)
    if (generation !== this.generation) return
    this.stop(false)
    this.generation = generation
    this.volume = volume

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const normalize = context.createGain()
    normalize.gain.value = soundSources[kind].normalization
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 4
    limiter.ratio.value = 12
    limiter.attack.value = 0.006
    limiter.release.value = 0.22
    const bus = context.createGain()
    bus.gain.setValueAtTime(0, context.currentTime)
    bus.gain.linearRampToValueAtTime(volume, context.currentTime + 0.2)

    source.connect(normalize)
    normalize.connect(limiter)
    limiter.connect(bus)
    bus.connect(context.destination)
    source.start()
    this.source = source
    this.bus = bus
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (!this.context || !this.bus) return
    this.bus.gain.setTargetAtTime(volume, this.context.currentTime, 0.04)
  }

  stop(fade = true): void {
    this.generation += 1
    if (!this.context || !this.bus || !this.source) {
      this.source = null
      this.bus = null
      return
    }
    const source = this.source
    const bus = this.bus
    const stopAt = this.context.currentTime + (fade ? 0.14 : 0)
    if (fade) bus.gain.linearRampToValueAtTime(0, stopAt)
    try {
      source.stop(stopAt)
    } catch {
      // Switching sounds may race with a source that has already stopped.
    }
    this.source = null
    this.bus = null
    window.setTimeout(() => {
      source.disconnect()
      bus.disconnect()
    }, fade ? 180 : 0)
  }

  dispose(): void {
    this.stop(false)
    if (this.context) void this.context.close()
    this.context = null
    this.buffers.clear()
  }
}
