import { ServiceAlert } from '@/lib/types'

// Shared by src/app/api/alerts/route.ts (city-wide alerts) and
// src/lib/plan-query.ts (leg-scoped alerts) so the same OTP
// AlertSeverityLevel value is never classified two different ways
// depending on which feature happens to be reading it.
export function mapAlertSeverity(severity?: string | null): ServiceAlert['severity'] {
  if (!severity) return 'info'
  if (severity === 'SEVERE' || severity === 'WARNING') return 'severe'
  if (severity === 'INFO') return 'info'
  return 'warning'
}
