import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { ServiceAlert } from '@/lib/types'

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const useTestData = searchParams.get('test') === '1'

  if (useTestData) {
    return NextResponse.json({ alerts: MOCK_ALERTS, timestamp: Date.now(), test: true })
  }

  try {
    const now = Date.now()
    if (cache && now - cache.timestamp < CACHE_TTL) {
      return NextResponse.json({ alerts: cache.data, timestamp: cache.timestamp })
    }

    const response = await fetch(`${OTP_BASE_URL}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ALERTS_QUERY }),
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`OTP alerts returned ${response.status}`)
    }

    const data = await response.json()
    const gqlAlerts: GqlAlert[] = data.data?.alerts || []

    const alerts: ServiceAlert[] = gqlAlerts.map((alert) => ({
      id: alert.id || String(Math.random()),
      headerText: alert.alertHeaderText || 'Service alert',
      descriptionText: alert.alertDescriptionText || '',
      severity: mapSeverity(alert.alertSeverityLevel),
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

    cache = { data: alerts, timestamp: now }
    return NextResponse.json({ alerts, timestamp: now })
  } catch (error) {
    console.error('Failed to fetch alerts:', error)
    if (cache) {
      return NextResponse.json({ alerts: cache.data, timestamp: cache.timestamp, stale: true })
    }
    return NextResponse.json({ alerts: [] })
  }
}

function mapSeverity(severity?: string): ServiceAlert['severity'] {
  if (!severity) return 'info'
  if (severity === 'SEVERE' || severity === 'WARNING') return 'severe'
  if (severity === 'INFO') return 'info'
  return 'warning'
}
