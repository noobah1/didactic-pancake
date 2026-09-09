import { TransportMode } from './types'

const OTP_MODE_MAP: Record<string, TransportMode> = {
  BUS: 'bus',
  TRAM: 'tram',
  RAIL: 'train',
  FERRY: 'ferry',
}

/** Maps an OTP GraphQL mode string to our TransportMode, defaulting unmapped modes to bus. */
export function otpModeToLocal(otpMode: string): TransportMode {
  return OTP_MODE_MAP[otpMode] || 'bus'
}

/** Same mapping, but returns undefined for null/unmapped modes instead of guessing bus. */
export function otpModeToLocalOrUndefined(otpMode: string | null | undefined): TransportMode | undefined {
  if (!otpMode) return undefined
  return OTP_MODE_MAP[otpMode]
}
