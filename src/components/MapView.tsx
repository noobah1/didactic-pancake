'use client'

import { useRef, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TALLINN_CENTER, DEFAULT_ZOOM, MODE_COLORS } from '@/lib/constants'
import { VehiclePosition, TransportMode } from '@/lib/types'

interface MapViewProps {
  vehicles?: VehiclePosition[]
  activeModes?: TransportMode[]
  routeGeometry?: string // encoded polyline
  onStopClick?: (stopId: string) => void
}

export function MapView({ vehicles, activeModes = [], routeGeometry }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())

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

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
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
          el.style.width = '12px'
          el.style.height = '12px'
          el.style.borderRadius = '50%'
          el.style.backgroundColor = MODE_COLORS[vehicle.mode]
          el.style.border = '2px solid white'
          el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
          el.title = `${vehicle.mode} ${vehicle.line} → ${vehicle.destination}`

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
  }, [vehicles, activeModes])

  return <div ref={containerRef} className="flex-1" />
}
