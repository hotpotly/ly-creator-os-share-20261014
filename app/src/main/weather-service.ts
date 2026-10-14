import { readFile, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  localPeriodAt,
  mapWmoWeatherCode,
  weatherPeriodForHour,
  weatherSceneSnapshotSchema,
  type WeatherSceneSnapshot
} from '../shared/weather'

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1_000
const WEATHER_REQUEST_TIMEOUT_MS = 8_000
export const WEATHER_RESOLVER_VERSION = 2 as const

const WEATHER_CITY_SEARCH_NAMES: Record<string, string> = {
  '北京': 'Beijing',
  '上海': 'Shanghai',
  '天津': 'Tianjin',
  '重庆': 'Chongqing',
  '长沙': 'Changsha',
  '杭州': 'Hangzhou',
  '广州': 'Guangzhou',
  '深圳': 'Shenzhen',
  '成都': 'Chengdu',
  '武汉': 'Wuhan',
  '南京': 'Nanjing',
  '苏州': 'Suzhou',
  '西安': 'Xian',
  '郑州': 'Zhengzhou',
  '青岛': 'Qingdao',
  '厦门': 'Xiamen',
  '福州': 'Fuzhou',
  '济南': 'Jinan',
  '合肥': 'Hefei',
  '南昌': 'Nanchang',
  '昆明': 'Kunming',
  '贵阳': 'Guiyang',
  '南宁': 'Nanning',
  '海口': 'Haikou',
  '沈阳': 'Shenyang',
  '大连': 'Dalian',
  '长春': 'Changchun',
  '哈尔滨': 'Harbin',
  '石家庄': 'Shijiazhuang',
  '太原': 'Taiyuan',
  '兰州': 'Lanzhou',
  '西宁': 'Xining',
  '银川': 'Yinchuan',
  '乌鲁木齐': 'Urumqi',
  '拉萨': 'Lhasa',
  '呼和浩特': 'Hohhot'
}

const weatherCacheRecordSchema = z.object({
  resolverVersion: z.literal(WEATHER_RESOLVER_VERSION),
  cityKey: z.string().min(1).max(80),
  snapshot: weatherSceneSnapshotSchema
}).strict()

const geocodingResponseSchema = z.object({
  results: z.array(z.object({
    name: z.string().min(1),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    country_code: z.string().length(2).optional(),
    population: z.number().nonnegative().optional()
  }).passthrough()).optional()
}).passthrough()

const forecastResponseSchema = z.object({
  timezone: z.string().min(1).max(80).optional(),
  current: z.object({
    weather_code: z.number().int(),
    is_day: z.union([z.literal(0), z.literal(1)]).optional(),
    time: z.string().optional()
  }).passthrough()
}).passthrough()

export interface WeatherCacheRecord {
  resolverVersion: typeof WEATHER_RESOLVER_VERSION
  cityKey: string
  snapshot: WeatherSceneSnapshot
}

export interface WeatherCacheStore {
  read(): Promise<WeatherCacheRecord | null>
  write(record: WeatherCacheRecord): Promise<void>
}

export class JsonWeatherCacheStore implements WeatherCacheStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<WeatherCacheRecord | null> {
    try {
      return weatherCacheRecordSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return null
    }
  }

  async write(record: WeatherCacheRecord): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(weatherCacheRecordSchema.parse(record)), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }
}

type WeatherFetch = typeof fetch

export class WeatherService {
  constructor(
    private readonly cache: WeatherCacheStore,
    private readonly fetcher: WeatherFetch = globalThis.fetch
  ) {}

  async getSnapshot(city: string | null | undefined, force = false): Promise<WeatherSceneSnapshot> {
    const requestedCity = city?.trim().slice(0, 80) || null
    const cityKey = requestedCity?.toLocaleLowerCase('zh-CN') ?? null
    const cached = await this.cache.read()

    if (!requestedCity || !cityKey) {
      if (cached) return { ...cached.snapshot, isCached: true, source: 'cache' }
      return this.fallback(null)
    }

    if (!force && cached?.cityKey === cityKey && this.isFresh(cached.snapshot.updatedAt)) {
      return { ...cached.snapshot, isCached: true, source: 'cache' }
    }

    try {
      const live = await this.fetchLiveSnapshot(requestedCity)
      await this.cache.write({ resolverVersion: WEATHER_RESOLVER_VERSION, cityKey, snapshot: live }).catch(() => undefined)
      return live
    } catch {
      if (cached) return { ...cached.snapshot, isCached: true, source: 'cache' }
      return this.fallback(requestedCity)
    }
  }

  private isFresh(updatedAt: string): boolean {
    const timestamp = Date.parse(updatedAt)
    return Number.isFinite(timestamp) && Date.now() - timestamp < WEATHER_CACHE_TTL_MS
  }

  private fallback(city: string | null): WeatherSceneSnapshot {
    return {
      condition: 'cloudy',
      period: localPeriodAt(),
      city,
      timeZone: null,
      updatedAt: new Date().toISOString(),
      isCached: false,
      source: 'fallback'
    }
  }

  private async fetchLiveSnapshot(city: string): Promise<WeatherSceneSnapshot> {
    const searchName = WEATHER_CITY_SEARCH_NAMES[city] ?? city
    const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
    geocodingUrl.searchParams.set('name', searchName)
    geocodingUrl.searchParams.set('count', '10')
    geocodingUrl.searchParams.set('language', 'en')
    geocodingUrl.searchParams.set('format', 'json')
    geocodingUrl.searchParams.set('countryCode', 'CN')
    const geocoding = geocodingResponseSchema.parse(await this.fetchJson(geocodingUrl))
    const locations = geocoding.results ?? []
    const chineseLocations = locations.filter((location) => location.country_code === 'CN')
    const location = [...(chineseLocations.length > 0 ? chineseLocations : locations)]
      .sort((left, right) => (right.population ?? 0) - (left.population ?? 0))[0]
    if (!location) throw new Error('找不到天气城市')

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
    forecastUrl.searchParams.set('latitude', String(location.latitude))
    forecastUrl.searchParams.set('longitude', String(location.longitude))
    forecastUrl.searchParams.set('current', 'weather_code,is_day')
    forecastUrl.searchParams.set('timezone', 'auto')
    const forecast = forecastResponseSchema.parse(await this.fetchJson(forecastUrl))
    const timeZone = forecast.timezone ?? null
    const providerHour = forecast.current.time?.match(/T(\d{2})/)?.[1]
    const period = providerHour === undefined
      ? localPeriodAt(new Date(), timeZone)
      : weatherPeriodForHour(Number(providerHour))
    return {
      condition: mapWmoWeatherCode(forecast.current.weather_code),
      period,
      city,
      timeZone,
      updatedAt: new Date().toISOString(),
      isCached: false,
      source: 'live'
    }
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(WEATHER_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`天气服务响应${response.status}`)
    return response.json()
  }
}
