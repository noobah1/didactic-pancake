'use client'

import { useRef, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TALLINN_CENTER, DEFAULT_ZOOM, MODE_COLORS, CityDef } from '@/lib/constants'
import { VehiclePosition, TransportMode, RouteResult, ServiceAlert, TripStopInfo } from '@/lib/types'
import { decodePolyline } from '@/lib/decode-polyline'

function formatSecondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const ROUTE_LINE_SOURCE = 'route-line-source'
const ROUTE_LINE_LAYER = 'route-line-layer'
const ROUTE_STOPS_SOURCE = 'route-stops-source'
const ROUTE_STOPS_LAYER = 'route-stops-layer'
const ROUTE_STOPS_LABEL_LAYER = 'route-stops-label-layer'
const VEHICLE_DOT_SOURCE = 'vehicle-dot-source'
const VEHICLE_DOT_LAYER = 'vehicle-dot-layer'
const VEHICLE_DOT_GLOW_LAYER = 'vehicle-dot-glow-layer'
const VEHICLE_CLUSTER_SOURCE = 'vehicle-cluster-source'
const CLUSTER_CIRCLE_LAYER = 'cluster-circle-layer'
const CLUSTER_COUNT_LAYER = 'cluster-count-layer'

const PLAN_LAYER_PREFIX = 'plan-leg-'
const PLAN_SOURCE_PREFIX = 'plan-leg-src-'
const PLAN_WALK_LAYER_PREFIX = 'plan-walk-'
const PLAN_STOPS_SOURCE = 'plan-stops-source'
const PLAN_STOPS_LAYER = 'plan-stops-layer'
const PLAN_STOPS_LABEL_LAYER = 'plan-stops-label-layer'

const INCIDENT_LINE_PREFIX = 'incident-line-'
const INCIDENT_SOURCE_PREFIX = 'incident-src-'

// Get current time in Tallinn as seconds since midnight
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getNowSeconds(): number {
  const now = new Date()
  const parts = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Tallinn', hour12: false }).split(':')
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
}

// Interpolate vehicle position along route line based on schedule
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function interpolateVehiclePosition(
  stops: TripStopInfo[],
  lineCoords: [number, number][],
  nowSec: number,
): [number, number] | null {
  if (stops.length < 2 || lineCoords.length < 2) return null

  // Find which two stops we're between
  for (let i = 0; i < stops.length - 1; i++) {
    const dep = stops[i].scheduledDeparture
    const arr = stops[i + 1].scheduledArrival

    // Currently dwelling at stop i
    if (nowSec >= stops[i].scheduledArrival && nowSec < dep) {
      return [stops[i].lng, stops[i].lat]
    }

    // Between stop i and stop i+1
    if (nowSec >= dep && nowSec <= arr) {
      const frac = arr > dep ? (nowSec - dep) / (arr - dep) : 0

      // Find the segments of the route line closest to each stop
      const fromStop: [number, number] = [stops[i].lng, stops[i].lat]
      const toStop: [number, number] = [stops[i + 1].lng, stops[i + 1].lat]

      const fromIdx = nearestPointIndex(lineCoords, fromStop)
      const toIdx = nearestPointIndex(lineCoords, toStop)

      if (fromIdx === toIdx) {
        // Same segment — lerp between stops directly
        return [
          fromStop[0] + frac * (toStop[0] - fromStop[0]),
          fromStop[1] + frac * (toStop[1] - fromStop[1]),
        ]
      }

      // Walk along route line from fromIdx to toIdx
      const startIdx = Math.min(fromIdx, toIdx)
      const endIdx = Math.max(fromIdx, toIdx)
      const segments: [number, number][] = lineCoords.slice(startIdx, endIdx + 1)

      // Calculate total distance along these segments
      let totalDist = 0
      const segDists: number[] = []
      for (let j = 1; j < segments.length; j++) {
        const d = Math.hypot(segments[j][0] - segments[j - 1][0], segments[j][1] - segments[j - 1][1])
        segDists.push(d)
        totalDist += d
      }

      // Walk to the fractional distance
      const targetDist = frac * totalDist
      let walked = 0
      for (let j = 0; j < segDists.length; j++) {
        if (walked + segDists[j] >= targetDist) {
          const segFrac = segDists[j] > 0 ? (targetDist - walked) / segDists[j] : 0
          return [
            segments[j][0] + segFrac * (segments[j + 1][0] - segments[j][0]),
            segments[j][1] + segFrac * (segments[j + 1][1] - segments[j][1]),
          ]
        }
        walked += segDists[j]
      }

      return segments[segments.length - 1]
    }
  }

  // Before first stop
  if (nowSec < stops[0].scheduledArrival) {
    return [stops[0].lng, stops[0].lat]
  }

  // After last stop
  const last = stops[stops.length - 1]
  return [last.lng, last.lat]
}

// Find the index of the closest point in coords to target
function nearestPointIndex(coords: [number, number][], target: [number, number]): number {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - target[0], coords[i][1] - target[1])
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

interface RouteShapePattern {
  directionId: number
  geometry: string
  stops: { name: string; lat: number; lng: number }[]
}

interface MapViewProps {
  vehicles?: VehiclePosition[]
  activeModes?: TransportMode[]
  selectedRoute?: RouteResult | null
  selectedVehicle?: VehiclePosition | null
  incidents?: ServiceAlert[]
  cities?: CityDef[]
  onVehicleClick?: (vehicle: VehiclePosition | null) => void
}

export function MapView({ vehicles, activeModes = [], selectedRoute, selectedVehicle, incidents, cities, onVehicleClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const arrowMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const activeRouteRef = useRef<string | null>(null)
  const stopMarkersRef = useRef<maplibregl.Marker[]>([])
  const planLayerIdsRef = useRef<string[]>([])
  const planMarkerRef = useRef<maplibregl.Marker[]>([])
  const mapReadyRef = useRef(false)
  const incidentLayerIdsRef = useRef<string[]>([])
  const showRouteShapeRef = useRef<(v: VehiclePosition) => void>(() => {})
  const onVehicleClickRef = useRef(onVehicleClick)
  const vehicleDotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const incidentMarkersRef = useRef<maplibregl.Marker[]>([])

  const clearRouteShape = useCallback(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return

    activeRouteRef.current = null

    if (vehicleDotTimerRef.current) {
      clearInterval(vehicleDotTimerRef.current)
      vehicleDotTimerRef.current = null
    }

    if (map.getLayer(VEHICLE_DOT_GLOW_LAYER)) map.removeLayer(VEHICLE_DOT_GLOW_LAYER)
    if (map.getLayer(VEHICLE_DOT_LAYER)) map.removeLayer(VEHICLE_DOT_LAYER)
    if (map.getSource(VEHICLE_DOT_SOURCE)) map.removeSource(VEHICLE_DOT_SOURCE)
    if (map.getLayer(ROUTE_STOPS_LABEL_LAYER)) map.removeLayer(ROUTE_STOPS_LABEL_LAYER)
    if (map.getLayer(ROUTE_LINE_LAYER)) map.removeLayer(ROUTE_LINE_LAYER)
    if (map.getSource(ROUTE_LINE_SOURCE)) map.removeSource(ROUTE_LINE_SOURCE)
    if (map.getLayer(ROUTE_STOPS_LAYER)) map.removeLayer(ROUTE_STOPS_LAYER)
    if (map.getSource(ROUTE_STOPS_SOURCE)) map.removeSource(ROUTE_STOPS_SOURCE)

    stopMarkersRef.current.forEach((m) => m.remove())
    stopMarkersRef.current = []
  }, [])

  const showRouteShape = useCallback(
    async (vehicle: VehiclePosition) => {
      const map = mapRef.current
      if (!map || !mapReadyRef.current) return

      const routeKey = `${vehicle.mode}-${vehicle.line}-${vehicle.id}`
      if (activeRouteRef.current === routeKey) {
        clearRouteShape()
        onVehicleClick?.(null)
        return
      }

      clearRouteShape()
      activeRouteRef.current = routeKey
      onVehicleClick?.(vehicle)

      try {
        const isScheduled = vehicle.id.includes(':')

        // Build trip-stops URL: direct lookup for scheduled, match by line/mode for GPS
        const tripStopsUrl = isScheduled
          ? `/api/trip-stops?tripId=${encodeURIComponent(vehicle.id)}`
          : `/api/trip-stops?line=${encodeURIComponent(vehicle.line)}&mode=${encodeURIComponent(vehicle.mode)}&destination=${encodeURIComponent(vehicle.destination)}&lat=${vehicle.lat}&lng=${vehicle.lng}&heading=${vehicle.heading}`

        // Fetch trip stops (includes geometry now) — this is the primary data source
        const tripRes = await fetch(tripStopsUrl).catch(() => null)

        let tripStops: TripStopInfo[] | null = null
        let tripGeometry: string | null = null
        if (tripRes && tripRes.ok) {
          const tripData = await tripRes.json()
          tripStops = tripData.stops || null
          tripGeometry = tripData.geometry || null
        }

        // If trip-stops failed, fall back to route-shape API
        if (!tripStops || tripStops.length === 0) {
          const shapeRes = await fetch(
            `/api/route-shape?line=${encodeURIComponent(vehicle.line)}&mode=${encodeURIComponent(vehicle.mode)}`,
          )
          if (!shapeRes.ok) return
          const shapeData: { patterns: RouteShapePattern[] } = await shapeRes.json()
          if (!shapeData.patterns?.length) return

          // If route changed while we were fetching, abort
          if (activeRouteRef.current !== routeKey) return

          // Pick the pattern whose direction matches the vehicle's heading
          let bestPattern = shapeData.patterns[0]
          if (shapeData.patterns.length > 1 && vehicle.heading != null) {
            for (const p of shapeData.patterns) {
              if (p.stops.length >= 2) {
                const first = p.stops[0]
                const last = p.stops[p.stops.length - 1]
                const dLng = ((last.lng - first.lng) * Math.PI) / 180
                const rLat1 = (first.lat * Math.PI) / 180
                const rLat2 = (last.lat * Math.PI) / 180
                const y = Math.sin(dLng) * Math.cos(rLat2)
                const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng)
                const patternHeading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
                const diff = Math.abs(vehicle.heading - patternHeading) % 360
                const angleDiff = diff > 180 ? 360 - diff : diff
                if (angleDiff < 90) {
                  bestPattern = p
                  break
                }
              }
            }
          }
          tripStops = null
          if (!tripGeometry && bestPattern.geometry) {
            tripGeometry = bestPattern.geometry
          }
        }

        // If route changed while we were fetching, abort
        if (activeRouteRef.current !== routeKey) return

        const color = MODE_COLORS[vehicle.mode]

        let stopFeatures: GeoJSON.Feature<GeoJSON.Point>[]
        let lineCoords: [number, number][] = []

        if (tripStops && tripStops.length > 0) {
          stopFeatures = tripStops.map((stop) => ({
            type: 'Feature' as const,
            properties: {
              name: stop.name,
              status: stop.status,
              arrivalTime: formatSecondsToTime(stop.scheduledArrival),
              departureTime: formatSecondsToTime(stop.scheduledDeparture),
              hasSchedule: 'true',
            },
            geometry: { type: 'Point' as const, coordinates: [stop.lng, stop.lat] },
          }))

          // Use geometry from trip-stops API (exact match for this trip)
          if (tripGeometry) {
            const decoded = decodePolyline(tripGeometry)
            lineCoords = decoded.length >= 2 ? decoded : tripStops.map((s) => [s.lng, s.lat] as [number, number])
          } else {
            lineCoords = tripStops.map((s) => [s.lng, s.lat] as [number, number])
          }
        } else {
          // No trip data — decode geometry if available
          stopFeatures = []
          if (tripGeometry) {
            lineCoords = decodePolyline(tripGeometry)
          }
        }

        // ALWAYS draw line — fallback to stop-to-stop if lineCoords is empty
        if (lineCoords.length < 2 && tripStops && tripStops.length >= 2) {
          lineCoords = tripStops.map((s) => [s.lng, s.lat] as [number, number])
        }

        // Ensure no leftover source/layer before adding
        if (map.getLayer(ROUTE_LINE_LAYER)) map.removeLayer(ROUTE_LINE_LAYER)
        if (map.getSource(ROUTE_LINE_SOURCE)) map.removeSource(ROUTE_LINE_SOURCE)

        // Draw line connecting all stops in order
        if (lineCoords.length >= 2) {
          map.addSource(ROUTE_LINE_SOURCE, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: lineCoords },
            },
          })
          map.addLayer({
            id: ROUTE_LINE_LAYER,
            type: 'line',
            source: ROUTE_LINE_SOURCE,
            paint: {
              'line-color': color,
              'line-width': 5,
              'line-opacity': 0.85,
            },
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
          })
        }

        if (map.getLayer(ROUTE_STOPS_LABEL_LAYER)) map.removeLayer(ROUTE_STOPS_LABEL_LAYER)
        if (map.getLayer(ROUTE_STOPS_LAYER)) map.removeLayer(ROUTE_STOPS_LAYER)
        if (map.getSource(ROUTE_STOPS_SOURCE)) map.removeSource(ROUTE_STOPS_SOURCE)

        map.addSource(ROUTE_STOPS_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: stopFeatures },
        })

        map.addLayer({
          id: ROUTE_STOPS_LAYER,
          type: 'circle',
          source: ROUTE_STOPS_SOURCE,
          paint: {
            'circle-radius': [
              'match', ['get', 'status'],
              'current', 8,
              5,
            ],
            'circle-color': [
              'match', ['get', 'status'],
              'passed', '#9CA3AF',
              'current', '#FCD34D',
              '#ffffff',
            ],
            'circle-stroke-color': [
              'match', ['get', 'status'],
              'passed', '#6B7280',
              'current', '#F59E0B',
              color,
            ],
            'circle-stroke-width': [
              'match', ['get', 'status'],
              'current', 3,
              2,
            ],
          },
        })

        map.addLayer({
          id: ROUTE_STOPS_LABEL_LAYER,
          type: 'symbol',
          source: ROUTE_STOPS_SOURCE,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': [
              'match', ['get', 'status'],
              'passed', '#9CA3AF',
              '#1f2937',
            ],
            'text-halo-color': '#ffffff',
            'text-halo-width': 2,
          },
        })

      } catch (err) {
        console.error('showRouteShape failed:', err)
      }
    },
    [clearRouteShape, onVehicleClick],
  )

  // Keep refs in sync so click handlers always use the latest version
  useEffect(() => {
    showRouteShapeRef.current = showRouteShape
  }, [showRouteShape])
  useEffect(() => {
    onVehicleClickRef.current = onVehicleClick
  }, [onVehicleClick])

  // Clear route shape when vehicle is deselected externally (e.g. timetable X)
  useEffect(() => {
    if (!selectedVehicle && activeRouteRef.current) {
      clearRouteShape()
    }
  }, [selectedVehicle, clearRouteShape])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [TALLINN_CENTER.lng, TALLINN_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-left')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'bottom-left',
    )

    map.on('load', () => {
      mapReadyRef.current = true

      // Clustered GeoJSON source for vehicle grouping
      map.addSource(VEHICLE_CLUSTER_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 80,
        clusterMinPoints: 25,
      })

      map.addLayer({
        id: CLUSTER_CIRCLE_LAYER,
        type: 'circle',
        source: VEHICLE_CLUSTER_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#6366F1',
          'circle-radius': ['step', ['get', 'point_count'], 20, 50, 25, 100, 30],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      })

      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: 'symbol',
        source: VEHICLE_CLUSTER_SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      })

      // Click cluster to zoom in and expand
      map.on('click', CLUSTER_CIRCLE_LAYER, async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE_LAYER] })
        if (!features.length) return
        const clusterId = features[0].properties?.cluster_id
        if (clusterId == null) return
        const source = map.getSource(VEHICLE_CLUSTER_SOURCE) as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(clusterId)
        map.easeTo({
          center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        })
      })

      map.on('mouseenter', CLUSTER_CIRCLE_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', CLUSTER_CIRCLE_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })

      // Hide individual markers that are inside a cluster
      const updateVisibility = () => {
        if (!map.getSource(VEHICLE_CLUSTER_SOURCE)) return
        const features = map.querySourceFeatures(VEHICLE_CLUSTER_SOURCE)
        // If source tiles aren't loaded yet, keep current visibility
        if (features.length === 0) return
        const unclusteredIds = new Set<string>()
        for (const f of features) {
          if (!f.properties?.cluster && f.properties?.vehicleId) {
            unclusteredIds.add(f.properties.vehicleId as string)
          }
        }
        markersRef.current.forEach((marker, id) => {
          const show = unclusteredIds.has(id)
          marker.getElement().style.display = show ? '' : 'none'
          const arrow = arrowMarkersRef.current.get(id)
          if (arrow) arrow.getElement().style.display = show ? '' : 'none'
        })
      }

      // Click empty map area to dismiss route shape and timetable
      map.on('click', (e) => {
        const interactive = map.queryRenderedFeatures(e.point, {
          layers: [CLUSTER_CIRCLE_LAYER, ROUTE_STOPS_LAYER].filter((id) => map.getLayer(id)),
        })
        if (interactive.length > 0) return
        if (activeRouteRef.current) {
          clearRouteShape()
          onVehicleClickRef.current?.(null)
        }
      })

      let visFrame: ReturnType<typeof requestAnimationFrame> | null = null
      const scheduleVisUpdate = () => {
        if (visFrame) cancelAnimationFrame(visFrame)
        visFrame = requestAnimationFrame(updateVisibility)
      }
      map.on('zoom', scheduleVisUpdate)
      map.on('sourcedata', (e) => {
        if (e.sourceId === VEHICLE_CLUSTER_SOURCE) {
          scheduleVisUpdate()
        }
      })
    })

    // Show stop info on click (name, times, status)
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: '220px' })
    map.on('click', ROUTE_STOPS_LAYER, (e) => {
      if (!e.features?.length) return
      const feature = e.features[0]
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
      const props = feature.properties || {}
      const name = escapeHtml(props.name || '')
      const hasSchedule = props.hasSchedule === 'true'
      const arrivalTime = props.arrivalTime || ''
      const departureTime = props.departureTime || ''
      const status = props.status || 'none'

      let html = `<strong>${name}</strong>`

      if (hasSchedule && (arrivalTime || departureTime)) {
        html += `<div style="margin-top:4px;font-size:13px;color:#374151">`
        if (arrivalTime) html += `<span style="color:#6B7280">Arr</span> ${arrivalTime}`
        if (arrivalTime && departureTime) html += `&nbsp;&nbsp;`
        if (departureTime) html += `<span style="color:#6B7280">Dep</span> ${departureTime}`
        html += `</div>`

        const statusLabel = status === 'passed' ? 'Passed'
          : status === 'current' ? 'At stop'
          : 'Upcoming'
        const statusColor = status === 'passed' ? '#6B7280'
          : status === 'current' ? '#F59E0B'
          : '#10B981'
        html += `<div style="margin-top:4px"><span style="display:inline-block;padding:1px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${statusColor}">${statusLabel}</span></div>`
      } else if (!hasSchedule) {
        html += `<div style="margin-top:4px;font-size:12px;color:#9CA3AF">Live GPS &mdash; schedule not available</div>`
      }

      popup.setLngLat(coords).setHTML(html).addTo(map)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      mapReadyRef.current = false
    }
  }, [])

  // Fly to city/cities when selection changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !cities || cities.length === 0) return
    if (cities.length === 1) {
      map.flyTo({
        center: [cities[0].lng, cities[0].lat],
        zoom: cities[0].zoom,
        duration: 1500,
      })
    } else {
      const bounds = new maplibregl.LngLatBounds(
        [cities[0].lng, cities[0].lat],
        [cities[0].lng, cities[0].lat],
      )
      for (const c of cities) {
        bounds.extend([c.lng, c.lat])
      }
      map.fitBounds(bounds, { padding: 80, duration: 1500 })
    }
  }, [cities])

  // Update vehicle markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !vehicles) return

    const currentIds = new Set<string>()

    vehicles
      .filter((v) => activeModes.includes(v.mode))
      .forEach((vehicle) => {
        currentIds.add(vehicle.id)
        const existing = markersRef.current.get(vehicle.id)

        if (existing) {
          existing.setLngLat([vehicle.lng, vehicle.lat])
          const arrowEntry = arrowMarkersRef.current.get(vehicle.id)
          if (arrowEntry) {
            const pillWidth = Math.max(18, vehicle.line.length * 7 + 8)
            const offsetDist = Math.max(pillWidth / 2, 11) + 4
            const rad = (vehicle.heading * Math.PI) / 180
            arrowEntry.setOffset([Math.sin(rad) * offsetDist, -Math.cos(rad) * offsetDist])
            arrowEntry.setLngLat([vehicle.lng, vehicle.lat])
            arrowEntry.setRotation(vehicle.heading)
          }
        } else {
          const el = document.createElement('div')
          el.className = 'vehicle-marker'
          el.style.minWidth = '18px'
          el.style.height = '18px'
          el.style.padding = '0 4px'
          el.style.borderRadius = '9px'
          el.style.backgroundColor = MODE_COLORS[vehicle.mode]
          el.style.border = '2px solid white'
          el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
          el.style.cursor = 'pointer'
          el.style.display = 'flex'
          el.style.alignItems = 'center'
          el.style.justifyContent = 'center'
          el.style.color = 'white'
          el.style.fontSize = '10px'
          el.style.fontWeight = '700'
          el.style.fontFamily = 'system-ui, sans-serif'
          el.style.lineHeight = '1'
          el.style.whiteSpace = 'nowrap'
          el.textContent = vehicle.line
          el.title = `${vehicle.mode} ${vehicle.line} → ${vehicle.destination}`

          el.addEventListener('click', (e) => {
            e.stopPropagation()
            showRouteShapeRef.current(vehicle)
          })

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([vehicle.lng, vehicle.lat])
            .setPopup(
              new maplibregl.Popup({ offset: 10 }).setHTML(
                `<strong>${vehicle.line}</strong><br/>${vehicle.destination}`,
              ),
            )
            .addTo(map)

          markersRef.current.set(vehicle.id, marker)

          // Arrow marker — rendered behind pill, offset in heading direction
          const arrowEl = document.createElement('div')
          arrowEl.style.width = '0'
          arrowEl.style.height = '0'
          arrowEl.style.borderLeft = '3px solid transparent'
          arrowEl.style.borderRight = '3px solid transparent'
          arrowEl.style.borderBottom = `6px solid ${MODE_COLORS[vehicle.mode]}`

          // Offset further for wider pills
          const pillWidth = Math.max(18, vehicle.line.length * 7 + 8)
          const offsetDist = Math.max(pillWidth / 2, 11) + 4
          const rad = (vehicle.heading * Math.PI) / 180
          const arrowMarker = new maplibregl.Marker({
            element: arrowEl,
            rotation: vehicle.heading,
            rotationAlignment: 'map',
            offset: [Math.sin(rad) * offsetDist, -Math.cos(rad) * offsetDist],
          })
            .setLngLat([vehicle.lng, vehicle.lat])
            .addTo(map)

          // Move arrow behind pill in DOM
          const arrowWrapper = arrowEl.closest('.maplibregl-marker') as HTMLElement
          if (arrowWrapper) arrowWrapper.style.zIndex = '0'
          const pillWrapper = el.closest('.maplibregl-marker') as HTMLElement
          if (pillWrapper) pillWrapper.style.zIndex = '1'

          arrowMarkersRef.current.set(vehicle.id, arrowMarker)
        }
      })

    // Remove markers for vehicles no longer present or filtered out
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
        const arrowMarker = arrowMarkersRef.current.get(id)
        if (arrowMarker) {
          arrowMarker.remove()
          arrowMarkersRef.current.delete(id)
        }
      }
    })

    // Feed vehicle positions into the cluster source
    if (map.getSource(VEHICLE_CLUSTER_SOURCE)) {
      const features: GeoJSON.Feature<GeoJSON.Point>[] = vehicles
        .filter((v) => activeModes.includes(v.mode))
        .map((v) => ({
          type: 'Feature' as const,
          properties: { vehicleId: v.id },
          geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
        }))
      ;(map.getSource(VEHICLE_CLUSTER_SOURCE) as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features,
      })
    }
  }, [vehicles, activeModes, showRouteShape])

  // Draw planned route on map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const cleanup = () => {
      // Remove stop layers/source
      if (map.getLayer(PLAN_STOPS_LABEL_LAYER)) map.removeLayer(PLAN_STOPS_LABEL_LAYER)
      if (map.getLayer(PLAN_STOPS_LAYER)) map.removeLayer(PLAN_STOPS_LAYER)
      if (map.getSource(PLAN_STOPS_SOURCE)) map.removeSource(PLAN_STOPS_SOURCE)
      // Remove previous plan leg layers first, then sources
      for (const id of planLayerIdsRef.current) {
        if (map.getLayer(id)) map.removeLayer(id)
        const idx = id.replace(PLAN_LAYER_PREFIX, '').replace(PLAN_WALK_LAYER_PREFIX, '')
        const srcId = `${PLAN_SOURCE_PREFIX}${idx}`
        if (map.getSource(srcId)) map.removeSource(srcId)
      }
      planLayerIdsRef.current = []
      planMarkerRef.current.forEach((m) => m.remove())
      planMarkerRef.current = []
    }

    const draw = () => {
      cleanup()
      if (!selectedRoute || !mapReadyRef.current) return

      const layerIds: string[] = []
      const addedSources = new Set<string>()

      selectedRoute.legs.forEach((leg, i) => {
        if (!leg.legGeometry?.points) return

        const coords = decodePolyline(leg.legGeometry.points)
        if (coords.length < 2) return

        const srcId = `${PLAN_SOURCE_PREFIX}${i}`
        const isWalk = leg.mode === 'walk'
        const layerId = isWalk ? `${PLAN_WALK_LAYER_PREFIX}${i}` : `${PLAN_LAYER_PREFIX}${i}`
        const color = isWalk ? '#6B7280' : MODE_COLORS[leg.mode as TransportMode]

        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        }

        map.addSource(srcId, { type: 'geojson', data: geojson })
        addedSources.add(srcId)

        if (isWalk) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: srcId,
            paint: {
              'line-color': color,
              'line-width': 4,
              'line-opacity': 0.6,
              'line-dasharray': [2, 2],
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          })
        } else {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: srcId,
            paint: {
              'line-color': color,
              'line-width': 5,
              'line-opacity': 0.85,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          })
        }

        layerIds.push(layerId)
      })

      planLayerIdsRef.current = layerIds

      // Collect stops from transit legs (from, intermediateStops, to)
      const stopFeatures: GeoJSON.Feature<GeoJSON.Point>[] = []
      const seenStops = new Set<string>()

      selectedRoute.legs.forEach((leg) => {
        if (leg.mode === 'walk') return
        const color = MODE_COLORS[leg.mode as TransportMode]

        const addStop = (name: string, lat: number, lng: number) => {
          const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
          if (seenStops.has(key)) return
          seenStops.add(key)
          stopFeatures.push({
            type: 'Feature',
            properties: { name, color },
            geometry: { type: 'Point', coordinates: [lng, lat] },
          })
        }

        addStop(leg.from.name, leg.from.lat, leg.from.lng)
        if (leg.intermediateStops) {
          for (const stop of leg.intermediateStops) {
            addStop(stop.name, stop.lat, stop.lng)
          }
        }
        addStop(leg.to.name, leg.to.lat, leg.to.lng)
      })

      if (stopFeatures.length > 0) {
        map.addSource(PLAN_STOPS_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: stopFeatures },
        })

        map.addLayer({
          id: PLAN_STOPS_LAYER,
          type: 'circle',
          source: PLAN_STOPS_SOURCE,
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 2,
          },
        })

        map.addLayer({
          id: PLAN_STOPS_LABEL_LAYER,
          type: 'symbol',
          source: PLAN_STOPS_SOURCE,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#1f2937',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
          },
        })
      }

      // A marker (start)
      const firstLeg = selectedRoute.legs[0]
      if (firstLeg) {
        const aEl = document.createElement('div')
        aEl.style.width = '24px'
        aEl.style.height = '24px'
        aEl.style.borderRadius = '50%'
        aEl.style.backgroundColor = '#2563EB'
        aEl.style.border = '3px solid white'
        aEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)'
        aEl.style.display = 'flex'
        aEl.style.alignItems = 'center'
        aEl.style.justifyContent = 'center'
        aEl.style.color = 'white'
        aEl.style.fontSize = '12px'
        aEl.style.fontWeight = '700'
        aEl.style.fontFamily = 'system-ui, sans-serif'
        aEl.textContent = 'A'

        const aMarker = new maplibregl.Marker({ element: aEl })
          .setLngLat([firstLeg.from.lng, firstLeg.from.lat])
          .addTo(map)
        planMarkerRef.current.push(aMarker)
      }

      // B marker (end)
      const lastLeg = selectedRoute.legs[selectedRoute.legs.length - 1]
      if (lastLeg) {
        const bEl = document.createElement('div')
        bEl.style.width = '24px'
        bEl.style.height = '24px'
        bEl.style.borderRadius = '50%'
        bEl.style.backgroundColor = '#DC2626'
        bEl.style.border = '3px solid white'
        bEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)'
        bEl.style.display = 'flex'
        bEl.style.alignItems = 'center'
        bEl.style.justifyContent = 'center'
        bEl.style.color = 'white'
        bEl.style.fontSize = '12px'
        bEl.style.fontWeight = '700'
        bEl.style.fontFamily = 'system-ui, sans-serif'
        bEl.textContent = 'B'

        const bMarker = new maplibregl.Marker({ element: bEl })
          .setLngLat([lastLeg.to.lng, lastLeg.to.lat])
          .addTo(map)
        planMarkerRef.current.push(bMarker)
      }

      // Fit map to show the entire route
      const allCoords: [number, number][] = []
      selectedRoute.legs.forEach((leg) => {
        if (leg.legGeometry?.points) {
          allCoords.push(...decodePolyline(leg.legGeometry.points))
        }
      })
      if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (b, c) => b.extend(c as [number, number]),
          new maplibregl.LngLatBounds(allCoords[0], allCoords[0]),
        )
        map.fitBounds(bounds, { padding: { top: 220, bottom: 80, left: 60, right: 60 } })
      }
    }

    if (mapReadyRef.current) {
      draw()
    } else {
      map.once('load', draw)
    }

    return cleanup
  }, [selectedRoute])

  // Incident overlay effect
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    const cleanup = () => {
      cancelled = true
      for (const id of incidentLayerIdsRef.current) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      for (const id of incidentLayerIdsRef.current) {
        const srcId = id.replace(INCIDENT_LINE_PREFIX, INCIDENT_SOURCE_PREFIX)
        if (map.getSource(srcId)) map.removeSource(srcId)
      }
      incidentLayerIdsRef.current = []
      incidentMarkersRef.current.forEach((m) => m.remove())
      incidentMarkersRef.current = []
    }

    const fetchRouteShape = async (
      routeName: string,
    ): Promise<{ patterns: RouteShapePattern[] } | null> => {
      for (const mode of ['bus', 'tram', 'train', 'ferry']) {
        const res = await fetch(
          `/api/route-shape?line=${encodeURIComponent(routeName)}&mode=${mode}`,
        )
        if (res.ok) {
          const data = await res.json()
          if (data.patterns?.length) return data
        }
      }
      return null
    }


    const draw = async () => {
      cleanup()
      cancelled = false
      if (!incidents || incidents.length === 0 || !mapReadyRef.current) return

      // Fetch all route shapes in parallel
      const fetchTasks = incidents.flatMap((alert) =>
        alert.affectedRoutes.map(async (routeName) => {
          try {
            const shapeData = await fetchRouteShape(routeName)
            return shapeData ? { alert, routeName, patterns: shapeData.patterns } : null
          } catch {
            return null
          }
        }),
      )
      const results = (await Promise.allSettled(fetchTasks))
        .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<(typeof fetchTasks)[0]>>> =>
          r.status === 'fulfilled' && r.value != null,
        )
        .map((r) => r.value)

      if (cancelled) return

      const layerIds: string[] = []
      let routeIndex = 0

      for (const { alert, routeName, patterns } of results) {
        const color = alert.severity === 'severe' ? '#EF4444' : '#D97706'
        let markerPlaced = false

        for (const pattern of patterns) {
          const coords = decodePolyline(pattern.geometry)
          if (coords.length < 2) continue

          const srcId = `${INCIDENT_SOURCE_PREFIX}${routeIndex}`
          const layerId = `${INCIDENT_LINE_PREFIX}${routeIndex}`

          const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          }

          map.addSource(srcId, { type: 'geojson', data: geojson })
          map.addLayer({
            id: layerId,
            type: 'line',
            source: srcId,
            paint: {
              'line-color': color,
              'line-width': 6,
              'line-opacity': 0.7,
            },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          })

          layerIds.push(layerId)

          // Place one warning marker per (alert, route) pair
          if (!markerPlaced) {
            markerPlaced = true
            const mid = coords[Math.floor(coords.length / 2)]
            const el = document.createElement('div')
            el.style.width = '28px'
            el.style.height = '28px'
            el.style.borderRadius = '50%'
            el.style.backgroundColor = alert.severity === 'severe' ? '#FEE2E2' : '#FEF3C7'
            el.style.border = `2px solid ${color}`
            el.style.display = 'flex'
            el.style.alignItems = 'center'
            el.style.justifyContent = 'center'
            el.style.cursor = 'pointer'
            el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'
            el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#FBBF24" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`

            const popup = new maplibregl.Popup({ offset: 15, maxWidth: '250px' }).setHTML(
              `<div style="padding:4px"><strong style="color:${color}">${escapeHtml(alert.headerText)}</strong>${alert.descriptionText ? `<p style="margin:4px 0 0;font-size:13px;color:#374151">${escapeHtml(alert.descriptionText)}</p>` : ''}<p style="margin:4px 0 0;font-size:11px;color:#6B7280">Affected: ${escapeHtml(routeName)}</p></div>`,
            )

            const marker = new maplibregl.Marker({ element: el })
              .setLngLat(mid as [number, number])
              .setPopup(popup)
              .addTo(map)

            incidentMarkersRef.current.push(marker)
          }

          routeIndex++
        }
      }

      incidentLayerIdsRef.current = layerIds
    }

    if (mapReadyRef.current) {
      draw()
    } else {
      map.once('load', () => draw())
    }

    return cleanup
  }, [incidents])

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} />
}
