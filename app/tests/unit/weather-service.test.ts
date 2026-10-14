import { describe, expect, it, vi } from 'vitest'
import { WEATHER_RESOLVER_VERSION, WeatherService, type WeatherCacheRecord, type WeatherCacheStore } from '../../src/main/weather-service'
import { localHourAt, mapWmoWeatherCode, weatherPeriodForHour } from '../../src/shared/weather'

class MemoryWeatherCache implements WeatherCacheStore {
  record: WeatherCacheRecord | null = null
  async read() { return this.record }
  async write(record: WeatherCacheRecord) { this.record = record }
}

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' }
})

describe('weather scene mapping', () => {
  it('maps WMO codes into the four scene conditions', () => {
    expect(mapWmoWeatherCode(0)).toBe('clear')
    expect(mapWmoWeatherCode(3)).toBe('cloudy')
    expect(mapWmoWeatherCode(63)).toBe('rain')
    expect(mapWmoWeatherCode(85)).toBe('snow')
    expect(mapWmoWeatherCode(999)).toBe('cloudy')
  })

  it('uses approximate local-time bands for sunrise and sunset', () => {
    expect(weatherPeriodForHour(6)).toBe('sunrise')
    expect(weatherPeriodForHour(10)).toBe('day')
    expect(weatherPeriodForHour(18)).toBe('sunset')
    expect(weatherPeriodForHour(23)).toBe('night')
    expect(localHourAt(new Date('2026-07-29T22:00:00.000Z'), 'Asia/Shanghai')).toBe(6)
  })
})

describe('WeatherService', () => {
  it('fetches a city in Main and returns only the structured snapshot', async () => {
    const cache = new MemoryWeatherCache()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ name: '杭州', latitude: 30.27, longitude: 120.15 }] }))
      .mockResolvedValueOnce(jsonResponse({ timezone: 'Asia/Shanghai', current: { weather_code: 61, is_day: 1, time: '2026-07-29T12:00' } }))
    const service = new WeatherService(cache, fetcher as unknown as typeof fetch)

    await expect(service.getSnapshot(' 杭州 ')).resolves.toMatchObject({
      condition: 'rain',
      period: 'day',
      city: '杭州',
      timeZone: 'Asia/Shanghai',
      isCached: false,
      source: 'live'
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(cache.record?.cityKey).toBe('杭州')
  })

  it('uses the provider local time for the scene period', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ name: '杭州', latitude: 30.27, longitude: 120.15 }] }))
      .mockResolvedValueOnce(jsonResponse({ timezone: 'Asia/Shanghai', current: { weather_code: 0, is_day: 1, time: '2026-07-29T18:30' } }))
    const service = new WeatherService(new MemoryWeatherCache(), fetcher as unknown as typeof fetch)

    await expect(service.getSnapshot('杭州')).resolves.toMatchObject({
      condition: 'clear',
      period: 'sunset',
      timeZone: 'Asia/Shanghai',
      source: 'live'
    })
  })

  it('resolves supported Chinese city names to the major city instead of a smaller namesake', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        results: [
          { name: 'Changsha', latitude: 30.99997, longitude: 108.30463, country_code: 'CN', population: 47170 },
          { name: 'Changsha', latitude: 28.19874, longitude: 112.97087, country_code: 'CN', population: 3093980 }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({ timezone: 'Asia/Shanghai', current: { weather_code: 3, is_day: 1, time: '2026-07-29T17:00' } }))
    const service = new WeatherService(new MemoryWeatherCache(), fetcher as unknown as typeof fetch)

    await expect(service.getSnapshot('长沙')).resolves.toMatchObject({
      condition: 'cloudy',
      city: '长沙',
      source: 'live'
    })
    const geocodingUrl = new URL(String(fetcher.mock.calls[0]?.[0]))
    const forecastUrl = new URL(String(fetcher.mock.calls[1]?.[0]))
    expect(geocodingUrl.searchParams.get('name')).toBe('Changsha')
    expect(forecastUrl.searchParams.get('latitude')).toBe('28.19874')
    expect(forecastUrl.searchParams.get('longitude')).toBe('112.97087')
  })

  it('reuses a fresh matching cache without network access', async () => {
    const cache = new MemoryWeatherCache()
    cache.record = {
      resolverVersion: WEATHER_RESOLVER_VERSION,
      cityKey: '杭州',
      snapshot: {
        condition: 'clear',
        period: 'night',
        city: '杭州',
        timeZone: 'Asia/Shanghai',
        updatedAt: new Date().toISOString(),
        isCached: false,
        source: 'live'
      }
    }
    const fetcher = vi.fn()
    const service = new WeatherService(cache, fetcher as unknown as typeof fetch)

    await expect(service.getSnapshot('杭州')).resolves.toMatchObject({
      condition: 'clear',
      period: 'night',
      isCached: true,
      source: 'cache'
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('falls back to the last snapshot after a provider failure', async () => {
    const cache = new MemoryWeatherCache()
    cache.record = {
      resolverVersion: WEATHER_RESOLVER_VERSION,
      cityKey: '杭州',
      snapshot: {
        condition: 'snow',
        period: 'day',
        city: '杭州',
        timeZone: 'Asia/Shanghai',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isCached: false,
        source: 'live'
      }
    }
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const service = new WeatherService(cache, fetcher as unknown as typeof fetch)

    await expect(service.getSnapshot('杭州', true)).resolves.toMatchObject({
      condition: 'snow',
      isCached: true,
      source: 'cache'
    })
  })

  it('uses static cloudy when neither city nor cache is available', async () => {
    const service = new WeatherService(new MemoryWeatherCache(), vi.fn() as unknown as typeof fetch)
    await expect(service.getSnapshot('')).resolves.toMatchObject({
      condition: 'cloudy',
      city: null,
      isCached: false,
      source: 'fallback'
    })
  })
})
