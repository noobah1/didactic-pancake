import { TransportMode } from './types'

// Use mock OTP API route in development, real OTP in production
export const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080'
console.log('OTP_BASE_URL:', OTP_BASE_URL)

export const GPS_FEED_URL = 'https://transport.tallinn.ee/gps.txt'
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export const TALLINN_CENTER = { lat: 59.437, lng: 24.7536 }
export const DEFAULT_ZOOM = 13

export interface CityDef {
  id: string
  name: string
  county: string
  lat: number
  lng: number
  zoom: number
}

export const COUNTIES = [
  'Harju',
  'Tartu',
  'Ida-Viru',
  'Pärnu',
  'Viljandi',
  'Lääne-Viru',
  'Saare',
  'Lääne',
  'Rapla',
  'Järva',
  'Jõgeva',
  'Põlva',
  'Valga',
  'Võru',
  'Hiiu',
] as const

export const CITIES: CityDef[] = [
  // Harju
  { id: 'tallinn', name: 'Tallinn', county: 'Harju', lat: 59.437, lng: 24.7536, zoom: 13 },
  { id: 'maardu', name: 'Maardu', county: 'Harju', lat: 59.479, lng: 25.015, zoom: 14 },
  { id: 'keila', name: 'Keila', county: 'Harju', lat: 59.303, lng: 24.414, zoom: 14 },
  { id: 'saue', name: 'Saue', county: 'Harju', lat: 59.322, lng: 24.549, zoom: 14 },
  // Tartu
  { id: 'tartu', name: 'Tartu', county: 'Tartu', lat: 58.378, lng: 26.729, zoom: 13 },
  { id: 'elva', name: 'Elva', county: 'Tartu', lat: 58.222, lng: 26.418, zoom: 14 },
  // Ida-Viru
  { id: 'narva', name: 'Narva', county: 'Ida-Viru', lat: 59.379, lng: 28.179, zoom: 14 },
  { id: 'kohtla-jarve', name: 'Kohtla-Järve', county: 'Ida-Viru', lat: 59.398, lng: 27.273, zoom: 14 },
  { id: 'johvi', name: 'Jõhvi', county: 'Ida-Viru', lat: 59.359, lng: 27.421, zoom: 14 },
  { id: 'sillamae', name: 'Sillamäe', county: 'Ida-Viru', lat: 59.396, lng: 27.764, zoom: 14 },
  { id: 'narva-joesuu', name: 'Narva-Jõesuu', county: 'Ida-Viru', lat: 59.458, lng: 28.041, zoom: 14 },
  // Pärnu
  { id: 'parnu', name: 'Pärnu', county: 'Pärnu', lat: 58.385, lng: 24.497, zoom: 14 },
  { id: 'sindi', name: 'Sindi', county: 'Pärnu', lat: 58.399, lng: 24.662, zoom: 14 },
  // Viljandi
  { id: 'viljandi', name: 'Viljandi', county: 'Viljandi', lat: 58.363, lng: 25.596, zoom: 14 },
  // Lääne-Viru
  { id: 'rakvere', name: 'Rakvere', county: 'Lääne-Viru', lat: 59.346, lng: 26.355, zoom: 14 },
  { id: 'tapa', name: 'Tapa', county: 'Lääne-Viru', lat: 59.261, lng: 25.957, zoom: 14 },
  // Saare
  { id: 'kuressaare', name: 'Kuressaare', county: 'Saare', lat: 58.248, lng: 22.503, zoom: 14 },
  // Lääne
  { id: 'haapsalu', name: 'Haapsalu', county: 'Lääne', lat: 58.943, lng: 23.541, zoom: 14 },
  { id: 'virtsu', name: 'Virtsu', county: 'Lääne', lat: 58.575, lng: 23.508, zoom: 14 },
  // Rapla
  { id: 'rapla', name: 'Rapla', county: 'Rapla', lat: 58.998, lng: 24.799, zoom: 14 },
  // Järva
  { id: 'paide', name: 'Paide', county: 'Järva', lat: 58.885, lng: 25.557, zoom: 14 },
  { id: 'turi', name: 'Türi', county: 'Järva', lat: 58.809, lng: 25.431, zoom: 14 },
  // Jõgeva
  { id: 'jogeva', name: 'Jõgeva', county: 'Jõgeva', lat: 58.746, lng: 26.393, zoom: 14 },
  { id: 'polva', name: 'Põltsamaa', county: 'Jõgeva', lat: 58.653, lng: 25.972, zoom: 14 },
  // Põlva
  { id: 'polva-linn', name: 'Põlva', county: 'Põlva', lat: 58.054, lng: 27.055, zoom: 14 },
  // Valga
  { id: 'valga', name: 'Valga', county: 'Valga', lat: 57.778, lng: 26.031, zoom: 14 },
  // Võru
  { id: 'voru', name: 'Võru', county: 'Võru', lat: 57.834, lng: 27.017, zoom: 14 },
  // Hiiu
  { id: 'kardla', name: 'Kärdla', county: 'Hiiu', lat: 58.993, lng: 22.749, zoom: 14 },
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
