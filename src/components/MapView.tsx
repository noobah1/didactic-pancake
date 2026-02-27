'use client'

import { useRef, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TALLINN_CENTER, DEFAULT_ZOOM, MODE_COLORS } from '@/lib/constants'
import { VehiclePosition, TransportMode, RouteResult, ServiceAlert } from '@/lib/types'
import { decodePolyline } from '@/lib/decode-polyline'

const ROUTE_LINE_SOURCE = 'route-line-source'
const ROUTE_LINE_LAYER = 'route-line-layer'
const ROUTE_STOPS_SOURCE = 'route-stops-source'
const ROUTE_STOPS_LAYER = 'route-stops-layer'
const ROUTE_STOPS_LABEL_LAYER = 'route-stops-label-layer'

const PLAN_LAYER_PREFIX = 'plan-leg-'
const PLAN_SOURCE_PREFIX = 'plan-leg-src-'
const PLAN_WALK_LAYER_PREFIX = 'plan-walk-'
const PLAN_STOPS_SOURCE = 'plan-stops-source'
const PLAN_STOPS_LAYER = 'plan-stops-layer'
const PLAN_STOPS_LABEL_LAYER = 'plan-stops-label-layer'

const INCIDENT_LINE_PREFIX = 'incident-line-'
const INCIDENT_SOURCE_PREFIX = 'incident-src-'

interface RouteShapePattern {
  directionId: number
  geometry: string
  stops: { name: string; lat: number; lng: number }[]
}

interface MapViewProps {
  vehicles?: VehiclePosition[]
  activeModes?: TransportMode[]
  selectedRoute?: RouteResult | null
  incidents?: ServiceAlert[]
  onStopClick?: (stopId: string) => void
}

export function MapView({ vehicles, activeModes = [], selectedRoute, incidents }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const activeRouteRef = useRef<string | null>(null)
  const stopMarkersRef = useRef<maplibregl.Marker[]>([])
  const planLayerIdsRef = useRef<string[]>([])
  const planMarkerRef = useRef<maplibregl.Marker[]>([])
  const mapReadyRef = useRef(false)
  const incidentLayerIdsRef = useRef<string[]>([])
  const incidentMarkersRef = useRef<maplibregl.Marker[]>([])

  const clearRouteShape = useCallback(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return

    activeRouteRef.current = null

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

      const routeKey = `${vehicle.mode}-${vehicle.line}`
      if (activeRouteRef.current === routeKey) {
        // Clicking the same route again clears it
        clearRouteShape()
        return
      }

      clearRouteShape()
      activeRouteRef.current = routeKey

      try {
        const res = await fetch(
          `/api/route-shape?line=${encodeURIComponent(vehicle.line)}&mode=${encodeURIComponent(vehicle.mode)}`,
        )
        if (!res.ok) return

        const data: { patterns: RouteShapePattern[] } = await res.json()
        if (!data.patterns?.length) return

        // If route changed while we were fetching, abort
        if (activeRouteRef.current !== routeKey) return

        const color = MODE_COLORS[vehicle.mode]

        // Decode all pattern geometries into GeoJSON MultiLineString
        const coordinates = data.patterns.map((p) => decodePolyline(p.geometry))

        const geojson: GeoJSON.Feature<GeoJSON.MultiLineString> = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiLineString', coordinates },
        }

        map.addSource(ROUTE_LINE_SOURCE, { type: 'geojson', data: geojson })
        map.addLayer({
          id: ROUTE_LINE_LAYER,
          type: 'line',
          source: ROUTE_LINE_SOURCE,
          paint: {
            'line-color': color,
            'line-width': 4,
            'line-opacity': 0.8,
          },
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
        })

        // Collect unique stops (deduplicate by name + coordinates)
        const stopSet = new Map<string, { name: string; lat: number; lng: number }>()
        for (const pattern of data.patterns) {
          for (const stop of pattern.stops) {
            const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`
            if (!stopSet.has(key)) stopSet.set(key, stop)
          }
        }

        const stopFeatures: GeoJSON.Feature<GeoJSON.Point>[] = Array.from(stopSet.values()).map(
          (stop) => ({
            type: 'Feature',
            properties: { name: stop.name },
            geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] },
          }),
        )

        map.addSource(ROUTE_STOPS_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: stopFeatures },
        })

        map.addLayer({
          id: ROUTE_STOPS_LAYER,
          type: 'circle',
          source: ROUTE_STOPS_SOURCE,
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-color': color,
            'circle-stroke-width': 2,
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
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#1f2937',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
          },
        })
      } catch {
        // Silently fail - route shape is a nice-to-have
      }
    },
    [clearRouteShape],
  )

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [TALLINN_CENTER.lng, TALLINN_CENTER.lat],
      zoom: DEFAULT_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    )

    map.on('load', () => {
      mapReadyRef.current = true
    })

    // Show stop name on click
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true })
    map.on('click', ROUTE_STOPS_LAYER, (e) => {
      if (!e.features?.length) return
      const feature = e.features[0]
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
      const name = feature.properties?.name || ''
      popup.setLngLat(coords).setHTML(`<strong>${name}</strong>`).addTo(map)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      mapReadyRef.current = false
    }
  }, [])

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
            showRouteShape(vehicle)
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
        }
      })

    // Remove markers for vehicles no longer present or filtered out
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    })
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
        map.fitBounds(bounds, { padding: 60 })
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

    const escapeHtml = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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

  return <div ref={containerRef} className="absolute inset-0" />
}
