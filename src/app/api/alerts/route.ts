import { NextResponse } from 'next/server'
import { OTP_BASE_URL, OTP_FETCH_TIMEOUT_MS } from '@/lib/constants'
import { getRoadDisruptionAlerts } from '@/lib/tarktee'
import { getDatexHazardAlerts } from '@/lib/traffic/datex-srti'
import { ServiceAlert } from '@/lib/types'
import { Availability, STALE_MAX_AGE_MS } from '@/lib/feed-status'
import { mapAlertSeverity } from '@/lib/alert-severity'

const ALERTS_QUERY = `
{
  alerts {
    id
    alertHeaderText
    alertDescriptionText
    alertSeverityLevel
    effectiveStartDate
    effectiveEndDate
    entities {
      ... on Route {
        shortName
      }
    }
  }
}
`

interface GqlAlertEntity {
  shortName?: string
}

interface GqlAlert {
  id?: string
  alertHeaderText?: string
  alertDescriptionText?: string
  alertSeverityLevel?: string
  effectiveStartDate?: number
  effectiveEndDate?: number
  entities?: GqlAlertEntity[]
}

let cache: { data: ServiceAlert[]; timestamp: number } | null = null
const CACHE_TTL = 60_000 // 1 minute

const MOCK_ALERTS: ServiceAlert[] = [
  {
    id: 'mock-1',
    headerText: 'Tram 4 disruption — track works',
    descriptionText: 'Tram line 4 is diverted between Viru and Tondi due to track repair works. Expected to last until March 5.',
    severity: 'severe',
    affectedRoutes: ['4'],
  },
  {
    id: 'mock-2',
    headerText: 'Bus 2 delays',
    descriptionText: 'Bus line 2 is experiencing 10-15 minute delays due to road construction on Pärnu maantee.',
    severity: 'warning',
    affectedRoutes: ['2'],
  },
  {
    id: 'mock-3',
    headerText: 'Tram 3 temporary stop closure',
    descriptionText: 'The Hobujaama stop for tram line 3 is temporarily closed. Please use the Viru stop instead.',
    severity: 'warning',
    affectedRoutes: ['3'],
  },
]

async function fetchOtpAlerts(): Promise<ServiceAlert[]> {
  const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ALERTS_QUERY }),
    cache: 'no-store',
    signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OTP alerts returned ${response.status}`)
  }

  const data = await response.json()
  const gqlAlerts: GqlAlert[] = data.data?.alerts || []

  return gqlAlerts.map((alert) => ({
    id: alert.id || String(Math.random()),
    headerText: alert.alertHeaderText || 'Service alert',
    descriptionText: alert.alertDescriptionText || '',
    severity: mapAlertSeverity(alert.alertSeverityLevel),
    affectedRoutes: (alert.entities || [])
      .filter((e) => e.shortName)
      .map((e) => e.shortName!),
    activePeriodStart: alert.effectiveStartDate
      ? new Date(alert.effectiveStartDate * 1000).toISOString()
      : undefined,
    activePeriodEnd: alert.effectiveEndDate
      ? new Date(alert.effectiveEndDate * 1000).toISOString()
      : undefined,
  }))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const useTestData = searchParams.get('test') === '1'

  if (useTestData) {
    return NextResponse.json({ alerts: MOCK_ALERTS, timestamp: Date.now(), test: true })
  }

  const now = Date.now()
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return NextResponse.json({ alerts: cache.data, timestamp: cache.timestamp })
  }

  // Fetched independently so either source's failure leaves the other's
  // alerts intact. Tark Tee already protected OTP this way (its own
  // .catch below predates this change); the reverse wasn't true — an OTP
  // outage used to throw and discard already-working road disruptions
  // along with it. datexHazardAlerts joins the same way: it's a no-op
  // (empty array, no fetch) whenever DATEX_API_KEY isn't set, and its own
  // failure shouldn't cost the ArcGIS-sourced disruptions their result.
  const [otpResult, roadDisruptionAlerts, datexHazardAlerts] = await Promise.all([
    fetchOtpAlerts()
      .then((alerts) => ({ ok: true as const, alerts }))
      .catch((error) => {
        console.error('Failed to fetch OTP alerts:', error)
        return { ok: false as const, alerts: [] as ServiceAlert[] }
      }),
    getRoadDisruptionAlerts().catch(() => [] as ServiceAlert[]),
    getDatexHazardAlerts().catch(() => [] as ServiceAlert[]),
  ])

  if (!otpResult.ok && roadDisruptionAlerts.length === 0 && datexHazardAlerts.length === 0) {
    // Nothing usable came back from either source this cycle — fall back to
    // a labeled cache/unavailable response instead of caching and
    // presenting an empty result as current (see STALE_MAX_AGE_MS: an old
    // enough cache is no longer honestly "stale", it's unavailable).
    if (cache && now - cache.timestamp < STALE_MAX_AGE_MS) {
      return NextResponse.json(
        { alerts: cache.data, timestamp: cache.timestamp, availability: 'stale' },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(
      { alerts: [], timestamp: now, availability: 'unavailable' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const alerts: ServiceAlert[] = [...otpResult.alerts, ...roadDisruptionAlerts, ...datexHazardAlerts]
  cache = { data: alerts, timestamp: now }
  const availability: Availability = otpResult.ok ? 'live' : 'partial'
  return NextResponse.json({ alerts, timestamp: now, availability })
}
