import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CloudRain, Flame, Square, Volume2, Waves, X } from 'lucide-react'
import { calculateDailyTodoGrowth } from '../../../shared/todo-growth'
import { localPeriodAt, type WeatherCondition, type WeatherPeriod, type WeatherSceneSnapshot } from '../../../shared/weather'
import orangeTreeSprite from '../assets/orange-tree-growth-sprite.png'
import weatherBase from '../assets/orange-tree-weather-base.png'
import weatherClear from '../assets/orange-tree-weather-clear-v1.png'
import weatherSnow from '../assets/orange-tree-weather-snow-v1.png'
import wateringCan from '../assets/orange-tree-watering-can.png'
import { useWorkspaceStore } from '../store/workspace'
import { AmbientAudioEngine, type AmbientSoundKind } from '../utils/ambient-audio'
import { AnchoredPopover } from './AnchoredPopover'

type PlantStyle = CSSProperties & {
  '--growth-progress': string
  '--growth-scale': number
}

function frameOpacities(ratio: number): [number, number, number, number] {
  if (ratio < 0.5) return [1, 0, 0, 0]
  if (ratio < 0.8) return [0, 1, 0, 0]
  if (ratio < 1) return [0, 0, 1, 0]
  return [0, 0, 0, 1]
}

const weatherLabels: Record<WeatherCondition, string> = {
  clear: '晴天',
  cloudy: '多云',
  rain: '下雨',
  snow: '下雪'
}

const periodLabels: Record<WeatherPeriod, string> = {
  sunrise: '日出',
  day: '白天',
  sunset: '夕阳',
  night: '夜晚'
}

const ambientSoundLabels: Record<AmbientSoundKind, string> = {
  rain: '雨声',
  fireplace: '火炉',
  stream: '溪流'
}

function fallbackWeather(): WeatherSceneSnapshot {
  return {
    condition: 'cloudy',
    period: localPeriodAt(),
    city: null,
    timeZone: null,
    updatedAt: new Date().toISOString(),
    isCached: false,
    source: 'fallback'
  }
}

export function DailyGrowthPlant(): React.JSX.Element {
  const { today, todos, preferences } = useWorkspaceStore((state) => state.snapshot)
  const growth = useMemo(() => calculateDailyTodoGrowth(todos, today, preferences.todoCategoryWeights), [preferences.todoCategoryWeights, today, todos])
  const rootRef = useRef<HTMLElement | null>(null)
  const previousRatio = useRef(growth.ratio)
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wateringTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ambientAudio = useRef<AmbientAudioEngine | null>(null)
  const [reacting, setReacting] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [watering, setWatering] = useState(false)
  const [bookAnchor, setBookAnchor] = useState<HTMLElement | null>(null)
  const [ambientSound, setAmbientSound] = useState<AmbientSoundKind | null>(null)
  const [ambientVolume, setAmbientVolume] = useState(45)
  const [weather, setWeather] = useState<WeatherSceneSnapshot>(fallbackWeather)
  const [sceneTime, setSceneTime] = useState(() => new Date())
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible')
  const [sceneVisible, setSceneVisible] = useState(true)
  const displayWeather = useMemo<WeatherSceneSnapshot>(() => ({
    ...weather,
    condition: preferences.weatherPreviewCondition ?? weather.condition,
    period: preferences.weatherPreviewPeriod ?? localPeriodAt(sceneTime, weather.timeZone)
  }), [preferences.weatherPreviewCondition, preferences.weatherPreviewPeriod, sceneTime, weather])
  const opacities = frameOpacities(growth.ratio)
  const visualPercent = Math.round(growth.ratio * 100)
  const sceneBackground = displayWeather.condition === 'clear'
    ? weatherClear
    : displayWeather.condition === 'snow'
      ? weatherSnow
      : displayWeather.condition === 'rain'
        ? weatherBase
        : weatherClear
  const motionPaused = !documentVisible || !sceneVisible
  const style: PlantStyle = {
    '--growth-progress': `${visualPercent}%`,
    '--growth-scale': growth.ratio <= 0.3 ? 0.86 + (growth.ratio / 0.3) * 0.14 : 1
  }

  useEffect(() => {
    let active = true
    const refresh = (force = false): void => {
      if (!documentVisible) return
      void window.creatorOS?.getWeather(force).then((snapshot) => {
        if (active) setWeather(snapshot)
      }).catch(() => undefined)
    }
    refresh(false)
    const timer = window.setInterval(() => refresh(false), 10 * 60 * 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [documentVisible, preferences.weatherCity])

  useEffect(() => {
    const onVisibilityChange = (): void => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    if (!documentVisible) return
    const timer = window.setInterval(() => setSceneTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [documentVisible])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setSceneVisible(entry?.isIntersecting ?? true), { threshold: 0.05 })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let animationFrame: number | null = null
    if (previousRatio.current < 1 && growth.ratio >= 1) {
      animationFrame = requestAnimationFrame(() => {
        setCelebrating(true)
        if (celebrationTimer.current) clearTimeout(celebrationTimer.current)
        celebrationTimer.current = setTimeout(() => setCelebrating(false), 1700)
      })
    } else if (growth.ratio < 1 && celebrating) {
      animationFrame = requestAnimationFrame(() => {
        if (celebrationTimer.current) clearTimeout(celebrationTimer.current)
        celebrationTimer.current = null
        setCelebrating(false)
      })
    }
    previousRatio.current = growth.ratio
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    }
  }, [celebrating, growth.ratio])

  useEffect(() => () => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current)
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current)
    if (wateringTimer.current) clearTimeout(wateringTimer.current)
    ambientAudio.current?.dispose()
  }, [])

  const react = (): void => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current)
    setReacting(false)
    requestAnimationFrame(() => {
      setReacting(true)
      reactionTimer.current = setTimeout(() => setReacting(false), 620)
    })
  }

  const water = (): void => {
    if (wateringTimer.current) clearTimeout(wateringTimer.current)
    setWatering(false)
    requestAnimationFrame(() => {
      setWatering(true)
      wateringTimer.current = setTimeout(() => setWatering(false), 2_050)
    })
  }

  const playAmbientSound = (kind: AmbientSoundKind): void => {
    if (!ambientAudio.current) ambientAudio.current = new AmbientAudioEngine()
    void ambientAudio.current.play(kind, ambientVolume / 100).then(() => {
      setAmbientSound(kind)
    }).catch(() => setAmbientSound(null))
  }

  const stopAmbientSound = (): void => {
    ambientAudio.current?.stop()
    setAmbientSound(null)
  }

  const updateAmbientVolume = (value: number): void => {
    setAmbientVolume(value)
    ambientAudio.current?.setVolume(value / 100)
  }

  const weatherDescription = `${weather.city ? `${weather.city}·` : ''}${weatherLabels[displayWeather.condition]}·${periodLabels[displayWeather.period]}`

  return (
    <section
      ref={rootRef}
      className={`daily-growth weather-${displayWeather.condition} period-${displayWeather.period}${reacting ? ' reacting' : ''}${celebrating ? ' celebrating' : ''}${watering ? ' watering' : ''}${bookAnchor ? ' book-open' : ''}${motionPaused ? ' motion-paused' : ''}`}
      style={style}
      aria-label="今日待办成长植物"
      data-weather={displayWeather.condition}
      data-period={displayWeather.period}
      data-weather-source={weather.source}
      data-ambient-sound={ambientSound ?? 'off'}
    >
      <div
        className="daily-growth-plant"
      >
        <span
        className="daily-growth-scene"
          style={{ backgroundImage: `url(${sceneBackground})` }}
        >
          <span className="daily-weather-window" aria-hidden="true">
            {[1, 2, 3, 4].map((pane) => (
              <span className={`daily-weather-pane pane-${pane}`} key={pane}>
                <i className="daily-weather-cloud cloud-a" />
                <i className="daily-weather-cloud cloud-b" />
              </span>
            ))}
          </span>
          <button className="daily-growth-watering-can" type="button" aria-label="给植物浇水" onClick={water}>
            <img src={wateringCan} alt="" />
          </button>
          <span className="daily-growth-water-stream" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
          </span>
          <span className="daily-growth-stack">
            {opacities.map((opacity, index) => (
              <span
                className={`daily-growth-frame frame-${index + 1}`}
                key={index}
                style={{ backgroundImage: `url(${orangeTreeSprite})`, opacity }}
              />
            ))}
            <span className="daily-growth-soil-wet" aria-hidden="true" />
          </span>
          <button className="daily-growth-plant-hit" type="button" aria-label={`今日待办进度${visualPercent}%，点击植物`} onClick={react} />
          <button
            className="daily-growth-book-hit"
            type="button"
            aria-label={ambientSound ? `打开白噪音书本，正在播放${ambientSoundLabels[ambientSound]}` : '打开白噪音书本'}
            aria-expanded={Boolean(bookAnchor)}
            onClick={(event) => {
              const anchor = event.currentTarget
              setBookAnchor((current) => current ? null : anchor)
            }}
          >
            {ambientSound ? <span aria-hidden="true"><Volume2 size={12} /></span> : null}
          </button>
          <span className="visually-hidden">{weatherDescription}</span>
        </span>
      </div>
      <div
        className="daily-growth-progress"
        role="progressbar"
        aria-label="今日待办完成进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={visualPercent}
      ><i /></div>
      {bookAnchor ? (
        <AnchoredPopover
          anchor={bookAnchor}
          ariaLabel="窗边白噪音"
          className="ambient-book-popover"
          onDismiss={() => setBookAnchor(null)}
        >
          <header>
            <span aria-hidden="true"><BookOpen size={18} /></span>
            <div><strong>窗边白噪音</strong><small>选择一种声音，安静做事</small></div>
            <button type="button" aria-label="合上白噪音书本" onClick={() => setBookAnchor(null)}><X size={14} /></button>
          </header>
          <div className="ambient-sound-options" role="group" aria-label="选择白噪音">
            <button type="button" aria-pressed={ambientSound === 'rain'} onClick={() => playAmbientSound('rain')}>
              <CloudRain size={17} /><span>雨声</span><small>细雨落窗</small>
            </button>
            <button type="button" aria-pressed={ambientSound === 'fireplace'} onClick={() => playAmbientSound('fireplace')}>
              <Flame size={17} /><span>火炉</span><small>轻柔燃烧</small>
            </button>
            <button type="button" aria-pressed={ambientSound === 'stream'} onClick={() => playAmbientSound('stream')}>
              <Waves size={17} /><span>溪流</span><small>缓慢流水</small>
            </button>
          </div>
          <small
            className="ambient-source-credit"
            title="雨声：alex36917（CC BY 4.0）；溪流：gluckose（CC0）；火炉：NPS与MSU Acoustic Atlas（公有领域）"
          >开放声音来自Blankie声音库</small>
          <footer>
            <label>
              <Volume2 size={14} />
              <span className="visually-hidden">白噪音音量</span>
              <input
                type="range"
                min={10}
                max={80}
                step={5}
                value={ambientVolume}
                aria-label="白噪音音量"
                onChange={(event) => updateAmbientVolume(Number(event.target.value))}
              />
            </label>
            <button type="button" disabled={!ambientSound} onClick={stopAmbientSound}><Square size={11} />停止</button>
          </footer>
        </AnchoredPopover>
      ) : null}
    </section>
  )
}
