import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const query = body.query
    const variables = body.variables

    console.log('📍 Mock OTP Request:', { query: '...', variables })

    // Handle plan query
    if (query?.includes('plan(')) {
      const from = variables?.from
      const to = variables?.to

      if (!from || !to) {
        return NextResponse.json(
          { errors: [{ message: 'Missing from/to coordinates' }] },
          { status: 400 }
        )
      }

      // Generate mock routes
      const now = Date.now()
      const startTime = now + 60000 // 1 minute from now
      const endTime = startTime + 1800000 // 30 minutes duration

      const response = {
        data: {
          plan: {
            itineraries: [
              {
                duration: 1800000,
                startTime,
                endTime,
                walkDistance: 250,
                legs: [
                  {
                    mode: 'WALK',
                    start: { scheduledTime: startTime },
                    end: { scheduledTime: startTime + 120000 },
                    from: {
                      name: 'Start walk',
                      lat: from.lat,
                      lon: from.lon,
                    },
                    to: {
                      name: 'Bus stop A',
                      lat: from.lat + 0.002,
                      lon: from.lon + 0.002,
                    },
                    duration: 120000,
                    legGeometry: { points: '_' },
                  },
                  {
                    mode: 'BUS',
                    start: { scheduledTime: startTime + 120000 },
                    end: { scheduledTime: startTime + 1020000 },
                    from: {
                      name: 'Bus stop A',
                      lat: from.lat + 0.002,
                      lon: from.lon + 0.002,
                      stop: { gtfsId: 'mock:1' },
                    },
                    to: {
                      name: 'Bus stop B',
                      lat: to.lat - 0.002,
                      lon: to.lon - 0.002,
                      stop: { gtfsId: 'mock:2' },
                    },
                    duration: 900000,
                    route: { shortName: '2' },
                    trip: { gtfsId: 'mock:trip:1' },
                    legGeometry: { points: '_' },
                    realTime: false,
                  },
                  {
                    mode: 'WALK',
                    start: { scheduledTime: startTime + 1020000 },
                    end: { scheduledTime: endTime },
                    from: {
                      name: 'Bus stop B',
                      lat: to.lat - 0.002,
                      lon: to.lon - 0.002,
                    },
                    to: {
                      name: 'Destination',
                      lat: to.lat,
                      lon: to.lon,
                    },
                    duration: 780000,
                    legGeometry: { points: '_' },
                  },
                ],
              },
              {
                duration: 2400000,
                startTime: startTime + 600000,
                endTime: startTime + 600000 + 2400000,
                walkDistance: 180,
                legs: [
                  {
                    mode: 'WALK',
                    start: { scheduledTime: startTime + 600000 },
                    end: { scheduledTime: startTime + 720000 },
                    from: {
                      name: 'Start walk',
                      lat: from.lat,
                      lon: from.lon,
                    },
                    to: {
                      name: 'Tram stop C',
                      lat: from.lat - 0.001,
                      lon: from.lon + 0.001,
                    },
                    duration: 120000,
                    legGeometry: { points: '_' },
                  },
                  {
                    mode: 'TRAM',
                    start: { scheduledTime: startTime + 720000 },
                    end: { scheduledTime: startTime + 2520000 },
                    from: {
                      name: 'Tram stop C',
                      lat: from.lat - 0.001,
                      lon: from.lon + 0.001,
                      stop: { gtfsId: 'mock:3' },
                    },
                    to: {
                      name: 'Tram stop D',
                      lat: to.lat + 0.001,
                      lon: to.lon - 0.001,
                      stop: { gtfsId: 'mock:4' },
                    },
                    duration: 1800000,
                    route: { shortName: '4' },
                    trip: { gtfsId: 'mock:trip:2' },
                    legGeometry: { points: '_' },
                    realTime: false,
                  },
                  {
                    mode: 'WALK',
                    start: { scheduledTime: startTime + 2520000 },
                    end: { scheduledTime: startTime + 2640000 },
                    from: {
                      name: 'Tram stop D',
                      lat: to.lat + 0.001,
                      lon: to.lon - 0.001,
                    },
                    to: {
                      name: 'Destination',
                      lat: to.lat,
                      lon: to.lon,
                    },
                    duration: 120000,
                    legGeometry: { points: '_' },
                  },
                ],
              },
            ],
          },
        },
      }

      return NextResponse.json(response)
    }

    // Handle alerts query
    if (query?.includes('alerts')) {
      return NextResponse.json({
        data: { alerts: [] },
      })
    }

    return NextResponse.json(
      { errors: [{ message: 'Unknown query' }] },
      { status: 400 }
    )
  } catch (error) {
    console.error('❌ Mock OTP error:', error)
    return NextResponse.json(
      { errors: [{ message: 'Server error' }] },
      { status: 500 }
    )
  }
}
