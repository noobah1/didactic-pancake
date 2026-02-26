import { NextResponse } from 'next/server'
import { OTP_BASE_URL } from '@/lib/constants'
import { ServiceAlert } from '@/lib/types'

interface OtpAlertEntity {
  route?: string
}

interface OtpAlert {
  id?: string
  alertHeaderText?: string
  alertDescriptionText?: string
  severity?: string
  entities?: OtpAlertEntity[]
  effectiveStartDate?: number
  effectiveEndDate?: number
}

let cache: { data: ServiceAlert[]; timestamp: number } | null = null
const CACHE_TTL = 60_000 // 1 minute

export async function GET() {
  try {
    const now = Date.now()
    if (cache && now - cache.timestamp < CACHE_TTL) {
      return NextResponse.json({ alerts: cache.data, timestamp: cache.timestamp })
    }

    const response = await fetch(`${OTP_BASE_URL}/otp/routers/default/alerts`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`OTP alerts returned ${response.status}`)
    }

    const data = await response.json()
    const alerts: ServiceAlert[] = (data || []).map((alert: OtpAlert) => ({
      id: alert.id || String(Math.random()),
      headerText: alert.alertHeaderText || 'Service alert',
      descriptionText: alert.alertDescriptionText || '',
      severity: mapSeverity(alert.severity),
      affectedRoutes: (alert.entities || [])
        .filter((e: OtpAlertEntity) => e.route)
        .map((e: OtpAlertEntity) => e.route),
      activePeriodStart: alert.effectiveStartDate
        ? new Date(alert.effectiveStartDate).toISOString()
        : undefined,
      activePeriodEnd: alert.effectiveEndDate
        ? new Date(alert.effectiveEndDate).toISOString()
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
