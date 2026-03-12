import { TransportMode } from './types'

export const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://localhost:8080'
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
  'Harjumaa',
  'Tartumaa',
  'Ida-Virumaa',
  'Pärnumaa',
  'Viljandimaa',
  'Lääne-Virumaa',
  'Saaremaa',
  'Läänemaa',
  'Raplamaa',
  'Järvamaa',
  'Jõgevamaa',
  'Põlvamaa',
  'Valgamaa',
  'Võrumaa',
  'Hiiumaa',
] as const

export const CITIES: CityDef[] = [
  // Harju
  { id: 'tallinn', name: 'Tallinn', county: 'Harjumaa', lat: 59.437, lng: 24.7536, zoom: 11 },
  { id: 'maardu', name: 'Maardu', county: 'Harjumaa', lat: 59.479, lng: 25.015, zoom: 12 },
  { id: 'keila', name: 'Keila', county: 'Harjumaa', lat: 59.303, lng: 24.414, zoom: 13 },
  { id: 'saue', name: 'Saue', county: 'Harjumaa', lat: 59.322, lng: 24.549, zoom: 13 },
  // Tartu
  { id: 'tartu', name: 'Tartu', county: 'Tartumaa', lat: 58.378, lng: 26.729, zoom: 12 },
  { id: 'elva', name: 'Elva', county: 'Tartumaa', lat: 58.222, lng: 26.418, zoom: 13 },
  // Ida-Viru
  { id: 'narva', name: 'Narva', county: 'Ida-Virumaa', lat: 59.379, lng: 28.179, zoom: 13 },
  { id: 'kohtla-jarve', name: 'Kohtla-Järve', county: 'Ida-Virumaa', lat: 59.398, lng: 27.273, zoom: 13 },
  { id: 'johvi', name: 'Jõhvi', county: 'Ida-Virumaa', lat: 59.359, lng: 27.421, zoom: 13 },
  { id: 'sillamae', name: 'Sillamäe', county: 'Ida-Virumaa', lat: 59.396, lng: 27.764, zoom: 13 },
  { id: 'narva-joesuu', name: 'Narva-Jõesuu', county: 'Ida-Virumaa', lat: 59.458, lng: 28.041, zoom: 13 },
  // Pärnu
  { id: 'parnu', name: 'Pärnu', county: 'Pärnumaa', lat: 58.385, lng: 24.497, zoom: 12 },
  { id: 'sindi', name: 'Sindi', county: 'Pärnumaa', lat: 58.399, lng: 24.662, zoom: 13 },
  { id: 'virtsu', name: 'Virtsu', county: 'Pärnumaa', lat: 58.575, lng: 23.508, zoom: 13 },
  // Viljandi
  { id: 'viljandi', name: 'Viljandi', county: 'Viljandimaa', lat: 58.363, lng: 25.596, zoom: 13 },
  // Lääne-Viru
  { id: 'rakvere', name: 'Rakvere', county: 'Lääne-Virumaa', lat: 59.346, lng: 26.355, zoom: 13 },
  { id: 'tapa', name: 'Tapa', county: 'Lääne-Virumaa', lat: 59.261, lng: 25.957, zoom: 13 },
  // Saare
  { id: 'kuressaare', name: 'Kuressaare', county: 'Saaremaa', lat: 58.248, lng: 22.503, zoom: 13 },
  // Lääne
  { id: 'haapsalu', name: 'Haapsalu', county: 'Läänemaa', lat: 58.943, lng: 23.541, zoom: 13 },
  // Rapla
  { id: 'rapla', name: 'Rapla', county: 'Raplamaa', lat: 58.998, lng: 24.799, zoom: 13 },
  // Järva
  { id: 'paide', name: 'Paide', county: 'Järvamaa', lat: 58.885, lng: 25.557, zoom: 13 },
  { id: 'turi', name: 'Türi', county: 'Järvamaa', lat: 58.809, lng: 25.431, zoom: 13 },
  // Jõgeva
  { id: 'jogeva', name: 'Jõgeva', county: 'Jõgevamaa', lat: 58.746, lng: 26.393, zoom: 13 },
  { id: 'polva', name: 'Põltsamaa', county: 'Jõgevamaa', lat: 58.653, lng: 25.972, zoom: 13 },
  // Põlva
  { id: 'polva-linn', name: 'Põlva', county: 'Põlvamaa', lat: 58.054, lng: 27.055, zoom: 13 },
  // Valga
  { id: 'valga', name: 'Valga', county: 'Valgamaa', lat: 57.778, lng: 26.031, zoom: 13 },
  // Võru
  { id: 'voru', name: 'Võru', county: 'Võrumaa', lat: 57.834, lng: 27.017, zoom: 13 },
  // Hiiu
  { id: 'kardla', name: 'Kärdla', county: 'Hiiumaa', lat: 58.993, lng: 22.749, zoom: 13 },
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
