import { TransportMode } from './types'

export const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080'
export const GPS_FEED_URL = 'https://transport.tallinn.ee/gps.txt'
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export const TALLINN_CENTER = { lat: 59.437, lng: 24.7536 }
export const DEFAULT_ZOOM = 13

export const POLL_INTERVALS = {
  vehiclePositions: 7_000, // ms
  tripUpdates: 30_000,
  serviceAlerts: 60_000,
}

// Mapping from gps.txt type codes to our transport modes
export const GPS_TYPE_MAP: Record<string, TransportMode> = {
  '1': 'tram',
  '2': 'trolleybus',
  '3': 'bus',
  '4': 'train',
  '5': 'ferry',
}

export const MODE_COLORS: Record<TransportMode, string> = {
  bus: '#4CAF50',
  tram: '#F44336',
  trolleybus: '#2196F3',
  train: '#FF9800',
  ferry: '#9C27B0',
}

export const MODE_LABELS: Record<TransportMode, string> = {
  bus: 'Bus',
  tram: 'Tram',
  trolleybus: 'Trolleybus',
  train: 'Train',
  ferry: 'Ferry',
}

export const ALL_MODES: TransportMode[] = ['bus', 'tram', 'trolleybus', 'train', 'ferry']
