import { otpModeToLocal } from './otp'
import { StopDeparture, StopInfo } from './types'

export interface GqlStoptime {
  serviceDay: number
  scheduledDeparture: number
  realtimeDeparture: number
  realtime: boolean
  headsign?: string | null
  trip?: {
    gtfsId: string
    route?: { shortName?: string | null; mode?: string | null } | null
  } | null
}

export function mapDeparture(st: GqlStoptime): StopDeparture | null {
  if (!st.trip) return null
  // serviceDay is epoch seconds at the *service day's* midnight; scheduledDeparture/
  // realtimeDeparture are seconds-since-that-midnight offsets (>= 86400 past midnight,
  // for a departure after midnight — OTP does not wrap these back into 0-86399).
  // The absolute time is always serviceDay + offset — never treat the offset alone as a clock.
  const departure = (st.serviceDay + (st.realtime ? st.realtimeDeparture : st.scheduledDeparture)) * 1000
  const delaySeconds = st.realtime ? st.realtimeDeparture - st.scheduledDeparture : 0

  return {
    tripId: st.trip.gtfsId,
    line: st.trip.route?.shortName || '',
    mode: otpModeToLocal(st.trip.route?.mode || ''),
    headsign: st.headsign || '',
    departure,
    scheduledDeparture: (st.serviceDay + st.scheduledDeparture) * 1000,
    realtime: st.realtime,
    delaySeconds,
  }
}

export function mapWheelchairBoarding(v?: string | null): StopInfo['wheelchairBoarding'] {
  if (v === 'POSSIBLE' || v === 'NOT_POSSIBLE') return v
  return 'NO_INFORMATION'
}
