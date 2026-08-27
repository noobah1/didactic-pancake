import { NextResponse } from 'next/server'
import { recordReport } from '@/lib/rider-reports'
import { decodePolyline } from '@/lib/decode-polyline'

// Riding mode (use-riding-mode.ts) already holds the leg it's reporting
// against — including its own encoded shape, straight from the plan OTP
// already returned — so the client sends that shape along with each report
// rather than the server re-fetching it from OTP on every 15s tick. The
// shape itself is public route geometry, not sensitive; what actually needs
// protecting is the raw fix, and that happens inside recordReport
// (rider-reports.ts), which snaps it onto the shape and never stores or
// returns the raw value — see that module's own comments for why.
interface RiderReportBody {
  tripId?: string
  lat?: number
  lng?: number
  heading?: number
  sessionId?: string
  shape?: string // encoded polyline, e.g. leg.legGeometry.points
}

export async function POST(request: Request) {
  const body: RiderReportBody = await request.json()
  const { tripId, lat, lng, sessionId, shape } = body

  if (
    !tripId ||
    !sessionId ||
    !shape ||
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return NextResponse.json(
      { error: 'tripId, sessionId, shape, lat and lng are required' },
      { status: 400 },
    )
  }
  if (typeof body.heading === 'number' && !Number.isFinite(body.heading)) {
    return NextResponse.json({ error: 'heading must be a finite number' }, { status: 400 })
  }

  let points: [number, number][]
  try {
    points = decodePolyline(shape)
  } catch {
    return NextResponse.json({ error: 'Could not decode shape' }, { status: 400 })
  }
  if (points.length < 2) {
    return NextResponse.json({ error: 'shape must have at least two points' }, { status: 400 })
  }

  const ok = recordReport({
    tripId,
    sessionId,
    lat,
    lng,
    heading: body.heading,
    shapeLats: points.map((p) => p[1]),
    shapeLons: points.map((p) => p[0]),
    nowMs: Date.now(),
  })

  // recordReport rejects an update sent faster than its own rate limit, or a
  // trip already at its reporter cap — neither is the client's fault in any
  // way worth surfacing as an error, so this stays 200 either way. A caller
  // that cares can still tell from `ok`.
  return NextResponse.json({ ok })
}
