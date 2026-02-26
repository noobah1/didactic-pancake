import { NextResponse } from 'next/server'
import { NOMINATIM_URL } from '@/lib/constants'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '5',
      viewbox: '24.55,59.50,24.95,59.35',
      bounded: '1',
    })

    const response = await fetch(`${NOMINATIM_URL}/search?${params}`, {
      headers: { 'User-Agent': 'TallinnTransit/1.0' },
    })

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`)
    }

    const data = await response.json()
    const results = data.map((item: any) => ({
      name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }))

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Geocoding failed:', error)
    return NextResponse.json({ results: [] })
  }
}
