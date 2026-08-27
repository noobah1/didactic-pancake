import { snapToShape, recordReport, consensusFor, REPORT_MAX_AGE_MS } from '../rider-reports'

// A short straight shape on one meridian, same fixture style as
// riding-progress.test.ts — lets distances be reasoned about directly.
const LAT0 = 59.4
const LNG0 = 24.7
const M_PER_DEG_LAT = 111_320
function atMeters(m: number) {
  return { lat: LAT0 + m / M_PER_DEG_LAT, lng: LNG0 }
}
const SHAPE_LATS = [atMeters(0).lat, atMeters(1000).lat]
const SHAPE_LONS = [atMeters(0).lng, atMeters(1000).lng]

let tripCounter = 0
// Every test gets its own trip id so the module-level store in
// rider-reports.ts never leaks state between tests.
function freshTripId() {
  tripCounter++
  return `test-trip-${tripCounter}`
}

describe('snapToShape', () => {
  it('projects a raw fix that is off the line onto the nearest point on it', () => {
    // The shape runs along constant longitude (varying latitude only), so
    // "off to the side" means offsetting longitude, not latitude.
    const raw = { lat: atMeters(500).lat, lng: atMeters(500).lng + 0.01 } // ~0.6km off to the side
    const snapped = snapToShape(raw.lat, raw.lng, SHAPE_LATS, SHAPE_LONS)
    expect(snapped).not.toBeNull()
    // The snapped point must not be the raw fix itself — its longitude has
    // moved back onto the shape's own line...
    expect(snapped!.lng).not.toBeCloseTo(raw.lng, 4)
    expect(snapped!.lng).toBeCloseTo(LNG0, 4)
    // ...while its latitude (the direction the shape actually runs in) is
    // unchanged, since the raw fix was already at that point along the line.
    expect(snapped!.lat).toBeCloseTo(atMeters(500).lat, 4)
  })

  it('returns null for a shape with fewer than two points', () => {
    expect(snapToShape(LAT0, LNG0, [LAT0], [LNG0])).toBeNull()
  })
})

describe('recordReport + consensusFor', () => {
  it('returns null when nothing has been reported for a trip', () => {
    expect(consensusFor(freshTripId(), Date.now())).toBeNull()
  })

  it('a single report becomes the consensus, snapped rather than raw', () => {
    const tripId = freshTripId()
    const now = Date.now()
    const raw = atMeters(400)
    const ok = recordReport({
      tripId, sessionId: 's1', lat: raw.lat, lng: raw.lng,
      shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now,
    })
    expect(ok).toBe(true)

    const consensus = consensusFor(tripId, now)
    expect(consensus).not.toBeNull()
    expect(consensus!.evidence).toBe('rider-reported')
    expect(consensus!.reporterCount).toBe(1)
    expect(consensus!.lat).toBeCloseTo(raw.lat, 4)
    // The result carries no per-rider identifier of any kind.
    expect(consensus).not.toHaveProperty('sessionId')
  })

  it('rejects a report from the same session updating faster than the minimum interval', () => {
    const tripId = freshTripId()
    const now = Date.now()
    const pos = atMeters(200)
    expect(recordReport({
      tripId, sessionId: 's1', lat: pos.lat, lng: pos.lng,
      shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now,
    })).toBe(true)
    expect(recordReport({
      tripId, sessionId: 's1', lat: pos.lat, lng: pos.lng,
      shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now + 1_000,
    })).toBe(false)
  })

  it('averages several close reports into one consensus with the full reporter count', () => {
    const tripId = freshTripId()
    const now = Date.now()
    const center = atMeters(600)
    for (const [session, offsetM] of [['a', -20], ['b', 0], ['c', 20]] as [string, number][]) {
      const p = atMeters(600 + offsetM)
      expect(recordReport({
        tripId, sessionId: session, lat: p.lat, lng: p.lng,
        shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now,
      })).toBe(true)
    }
    const consensus = consensusFor(tripId, now)!
    expect(consensus.reporterCount).toBe(3)
    expect(consensus.lat).toBeCloseTo(center.lat, 3)
  })

  it('drops a wildly divergent report from the consensus without dropping the good cluster', () => {
    const tripId = freshTripId()
    const now = Date.now()
    const cluster = atMeters(300)
    for (const session of ['a', 'b', 'c']) {
      const p = { lat: cluster.lat, lng: cluster.lng }
      expect(recordReport({
        tripId, sessionId: session, lat: p.lat, lng: p.lng,
        shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now,
      })).toBe(true)
    }
    // A fourth report, snapped near the far end of the shape — nowhere near
    // the tight cluster above.
    const stray = atMeters(950)
    expect(recordReport({
      tripId, sessionId: 'stray', lat: stray.lat, lng: stray.lng,
      shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now,
    })).toBe(true)

    const consensus = consensusFor(tripId, now)!
    expect(consensus.reporterCount).toBe(3) // the stray report was excluded
    expect(consensus.lat).toBeCloseTo(cluster.lat, 3)
  })

  it('expires reports older than REPORT_MAX_AGE_MS', () => {
    const tripId = freshTripId()
    const now = Date.now()
    const pos = atMeters(100)
    expect(recordReport({
      tripId, sessionId: 's1', lat: pos.lat, lng: pos.lng,
      shapeLats: SHAPE_LATS, shapeLons: SHAPE_LONS, nowMs: now,
    })).toBe(true)

    expect(consensusFor(tripId, now + REPORT_MAX_AGE_MS - 1_000)).not.toBeNull()
    expect(consensusFor(tripId, now + REPORT_MAX_AGE_MS + 1_000)).toBeNull()
  })

  it('refuses to record against a shape with fewer than two points', () => {
    const tripId = freshTripId()
    const pos = atMeters(100)
    expect(recordReport({
      tripId, sessionId: 's1', lat: pos.lat, lng: pos.lng,
      shapeLats: [LAT0], shapeLons: [LNG0], nowMs: Date.now(),
    })).toBe(false)
    expect(consensusFor(tripId, Date.now())).toBeNull()
  })
})
