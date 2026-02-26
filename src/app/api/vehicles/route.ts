import { NextResponse } from 'next/server'
import { GPS_FEED_URL } from '@/lib/constants'
import { parseGpsFeed } from '@/lib/parse-gps'
import { TransportMode } from '@/lib/types'

let cache: { data: ReturnType<typeof parseGpsFeed>; timestamp: number } | null = null
const CACHE_TTL = 5_000 // 5 seconds

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const modesParam = searchParams.get('modes')
  const modes = modesParam ? (modesParam.split(',') as TransportMode[]) : null

  try {
    const now = Date.now()
    if (!cache || now - cache.timestamp > CACHE_TTL) {
      const response = await fetch(GPS_FEED_URL, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`GPS feed returned ${response.status}`)
      }
      const text = await response.text()
      cache = { data: parseGpsFeed(text), timestamp: now }
    }

    let vehicles = cache.data
    if (modes) {
      vehicles = vehicles.filter((v) => modes.includes(v.mode))
    }

    return NextResponse.json({
      vehicles,
      timestamp: cache.timestamp,
    })
  } catch (error) {
    console.error('Failed to fetch vehicle positions:', error)
    if (cache) {
      return NextResponse.json({
        vehicles: cache.data,
        timestamp: cache.timestamp,
        stale: true,
      })
    }
    return NextResponse.json({ error: 'Failed to fetch vehicle positions' }, { status: 502 })
  }
}
