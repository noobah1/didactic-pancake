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

export async function GET() {
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
