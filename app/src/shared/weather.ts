import { z } from 'zod'

export const WEATHER_CONDITIONS = ['clear', 'cloudy', 'rain', 'snow'] as const
export const WEATHER_PERIODS = ['sunrise', 'day', 'sunset', 'night'] as const
export const WEATHER_SOURCES = ['live', 'cache', 'fallback'] as const
export const WEATHER_CITY_OPTIONS = [
  '北京', '上海', '天津', '重庆',
  '长沙', '杭州', '广州', '深圳', '成都', '武汉', '南京', '苏州', '西安', '郑州',
  '青岛', '厦门', '福州', '济南', '合肥', '南昌', '昆明', '贵阳', '南宁', '海口',
  '沈阳', '大连', '长春', '哈尔滨', '石家庄', '太原', '兰州', '西宁', '银川',
  '乌鲁木齐', '拉萨', '呼和浩特'
] as const

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]
export type WeatherPeriod = (typeof WEATHER_PERIODS)[number]
export type WeatherSource = (typeof WEATHER_SOURCES)[number]

export interface WeatherSceneSnapshot {
  condition: WeatherCondition
  period: WeatherPeriod
  city: string | null
  timeZone: string | null
  updatedAt: string
  isCached: boolean
  source: WeatherSource
}

export const weatherSceneSnapshotSchema = z.object({
  condition: z.enum(WEATHER_CONDITIONS),
  period: z.enum(WEATHER_PERIODS),
  city: z.string().trim().min(1).max(80).nullable(),
  timeZone: z.string().trim().min(1).max(80).nullable().default(null),
  updatedAt: z.string().datetime(),
  isCached: z.boolean(),
  source: z.enum(WEATHER_SOURCES)
}).strict()

export function mapWmoWeatherCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'cloudy'
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return 'rain'
  return 'cloudy'
}

export function weatherPeriodForHour(hour: number): WeatherPeriod {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24
  if (normalized >= 5 && normalized < 8) return 'sunrise'
  if (normalized >= 8 && normalized < 17) return 'day'
  if (normalized >= 17 && normalized < 20) return 'sunset'
  return 'night'
}

export function localHourAt(date = new Date(), timeZone: string | null = null): number {
  if (!timeZone) return date.getHours()
  try {
    const hourPart = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone
    }).formatToParts(date).find((part) => part.type === 'hour')?.value
    const hour = Number(hourPart)
    return Number.isFinite(hour) ? hour : date.getHours()
  } catch {
    return date.getHours()
  }
}

export function localPeriodAt(date = new Date(), timeZone: string | null = null): WeatherPeriod {
  return weatherPeriodForHour(localHourAt(date, timeZone))
}
