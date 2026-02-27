import { TransportMode } from './types'

export const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080'
export const GPS_FEED_URL = 'https://transport.tallinn.ee/gps.txt'
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export const TALLINN_CENTER = { lat: 59.437, lng: 24.7536 }
export const DEFAULT_ZOOM = 13

export interface CityDef {
  id: string
  name: string
  lat: number
  lng: number
  zoom: number
}

export const CITIES: CityDef[] = [
  { id: 'tallinn', name: 'Tallinn', lat: 59.437, lng: 24.7536, zoom: 13 },
  { id: 'tartu', name: 'Tartu', lat: 58.378, lng: 26.729, zoom: 13 },
  { id: 'narva', name: 'Narva', lat: 59.379, lng: 28.179, zoom: 14 },
  { id: 'parnu', name: 'Pärnu', lat: 58.385, lng: 24.497, zoom: 14 },
  { id: 'kohtla-jarve', name: 'Kohtla-Järve', lat: 59.398, lng: 27.273, zoom: 14 },
  { id: 'viljandi', name: 'Viljandi', lat: 58.363, lng: 25.596, zoom: 14 },
  { id: 'rakvere', name: 'Rakvere', lat: 59.346, lng: 26.355, zoom: 14 },
  { id: 'kuressaare', name: 'Kuressaare', lat: 58.248, lng: 22.503, zoom: 14 },
  { id: 'haapsalu', name: 'Haapsalu', lat: 58.943, lng: 23.541, zoom: 14 },
  { id: 'johvi', name: 'Jõhvi', lat: 59.359, lng: 27.421, zoom: 14 },
]

export const POLL_INTERVALS = {
  vehiclePositions: 7_000, // ms
  tripUpdates: 30_000,
  serviceAlerts: 60_000,
}

// Mapping from gps.txt type codes to our transport modes
// Verified against live feed: type 2 = bus (majority), type 3 = tram (lines 1-5)
export const GPS_TYPE_MAP: Record<string, TransportMode> = {
  '2': 'bus',
  '3': 'tram',
  '4': 'train',
  '5': 'ferry',
}

export const MODE_COLORS: Record<TransportMode, string> = {
  bus: '#4CAF50',
  tram: '#F44336',
  train: '#FF9800',
  ferry: '#9C27B0',
}

export const MODE_LABELS: Record<TransportMode, string> = {
  bus: 'Bus',
  tram: 'Tram',
  train: 'Train',
  ferry: 'Ferry',
}

export const ALL_MODES: TransportMode[] = ['bus', 'tram', 'train', 'ferry']
